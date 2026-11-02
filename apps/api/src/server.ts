import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Server as SocketServer } from 'socket.io';
import type { PoolClient } from 'pg';
import { pool, withTransaction } from './db.js';
import { hashPassword, verifyPassword } from './auth.js';
import { auditMatchesCheckpoint, createRateLimiter, evaluateBid, hashAuditEvent, pseudonym } from './domain.js';

const app = Fastify({ logger: true, trustProxy: true });
const httpServer = app.server;
const socket = new SocketServer(httpServer, {
  cors: { origin: process.env.WEB_ORIGIN?.split(',') ?? ['http://localhost:3000'], credentials: true }
});
const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
const rawSessionSecret = process.env.SESSION_SECRET?.trim();
if (!rawSessionSecret || rawSessionSecret.length < 16) {
  throw new Error('A variável de ambiente SESSION_SECRET deve ser configurada com pelo menos 16 caracteres.');
}
const SESSION_SECRET: string = rawSessionSecret;
const COOKIE = 'lancearte_session';
const loginRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 10 });
const registerRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 6 });
const money = (cents: string | number | bigint) => Number(cents) / 100;
const centsFromMoney = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isSafeInteger(Math.round(parsed * 100))) throw new Error('Informe um valor maior que zero.');
  return Math.round(parsed * 100);
};

await app.register(cors, { origin: process.env.WEB_ORIGIN?.split(',') ?? ['http://localhost:3000'], credentials: true });
await app.register(cookie);

app.addHook('onSend', async (_request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
  if (process.env.NODE_ENV === 'production') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return payload;
});

type User = { id: string; name: string; role: 'auctioneer' | 'bidder' };
function sessionValue(id: string): string {
  const signature = createHmac('sha256', SESSION_SECRET).update(id).digest('hex');
  return `${id}.${signature}`;
}
function setSessionCookie(reply: any, id: string) {
  reply.setCookie(COOKIE, sessionValue(id), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 7 });
}
function userIdFromCookie(value?: string): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const id = value.slice(0, dot);
  const received = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(createHmac('sha256', SESSION_SECRET).update(id).digest('hex'));
  return received.length === expected.length && timingSafeEqual(received, expected) ? id : null;
}
async function currentUser(request: FastifyRequest): Promise<User | null> {
  const id = userIdFromCookie(request.cookies[COOKIE]);
  if (!id) return null;
  const result = await pool.query('SELECT id, name, role FROM users WHERE id=$1', [id]);
  return (result.rows[0] as User | undefined) ?? null;
}
async function requireUser(request: FastifyRequest, role?: User['role']): Promise<User> {
  const user = await currentUser(request);
  if (!user) throw Object.assign(new Error('Entre ou crie um perfil para continuar.'), { statusCode: 401 });
  if (role && user.role !== role) throw Object.assign(new Error('Seu perfil não permite esta ação.'), { statusCode: 403 });
  return user;
}
function publicLot(row: any) {
  const imageUrl = publicImageUrl(row.image_url);
  return {
    id: row.id, title: row.title, imageUrl, artwork: row.artwork,
    openingBid: money(row.opening_bid_cents), increment: money(row.increment_cents),
    startsAt: row.starts_at, endsAt: row.ends_at, status: row.status,
    currentBid: row.current_bid_cents == null ? null : money(row.current_bid_cents),
    leader: row.current_leader_id ? pseudonym(row.current_leader_id) : null, receiptToken: row.receipt_token ?? null,
    sellerId: row.seller_id,
    sellerName: row.seller_name ?? 'Leiloeiro',
    bidCount: Number(row.bid_count ?? 0),
    auditCount: Number(row.audit_count ?? 0)
  };
}
function publicImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const imageId = value.match(/\/iiif\/2\/([a-f0-9-]{36})(?:\/|$)/i)?.[1];
  return imageId ? `/api/images/${imageId}` : value;
}
async function appendAuditEvent(client: PoolClient, lotId: string, eventType: string, payload: unknown, createdAt = new Date()) {
  const last = await client.query('SELECT sequence, event_hash FROM audit_events WHERE lot_id=$1 ORDER BY sequence DESC LIMIT 1', [lotId]);
  const sequence = (last.rows[0]?.sequence ?? 0) + 1;
  const previousHash = last.rows[0]?.event_hash ?? 'GENESIS';
  const eventHash = hashAuditEvent(previousHash, payload);
  await client.query('INSERT INTO audit_events(lot_id, sequence, event_type, payload, previous_hash, event_hash, created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [lotId, sequence, eventType, payload, previousHash, eventHash, createdAt]);
  await client.query('UPDATE lots SET audit_count=$1, audit_tip_hash=$2 WHERE id=$3', [sequence, eventHash, lotId]);
  return { sequence, previousHash, eventHash };
}
async function settleLockedLot(client: PoolClient, lot: any) {
  const receiptToken = randomBytes(24).toString('hex');
  if (lot.current_leader_id) {
    const winningCents = Number(lot.current_bid_cents);
    await client.query("INSERT INTO wallet_transactions(user_id, lot_id, kind, available_delta_cents, committed_delta_cents, note) VALUES($1,$2,'settlement_debit',0,$3,'Arremate liquidado')", [lot.current_leader_id, lot.id, -winningCents]);
    await client.query("INSERT INTO wallet_transactions(user_id, lot_id, kind, available_delta_cents, committed_delta_cents, note) VALUES($1,$2,'settlement_credit',$3,0,'Crédito do leiloeiro')", [lot.seller_id, lot.id, winningCents]);
    await client.query('INSERT INTO receipts(token, lot_id) VALUES($1,$2) ON CONFLICT(lot_id) DO NOTHING', [receiptToken, lot.id]);
  }
  await client.query('INSERT INTO settlements(lot_id, winner_id, seller_id, amount_cents) VALUES($1,$2,$3,$4) ON CONFLICT(lot_id) DO NOTHING', [lot.id, lot.current_leader_id, lot.seller_id, lot.current_bid_cents ?? 0]);
  await client.query("UPDATE lots SET status='closed' WHERE id=$1", [lot.id]);
  const payload = { type: 'lot_closed', lotId: lot.id, winningBidCents: lot.current_bid_cents == null ? null : Number(lot.current_bid_cents), winner: lot.current_leader_id ? pseudonym(lot.current_leader_id) : null, closedAt: new Date().toISOString() };
  await appendAuditEvent(client, lot.id, 'lot_closed', payload);
  return { lotId: lot.id, currentBid: lot.current_bid_cents == null ? null : money(lot.current_bid_cents), leader: payload.winner };
}
async function finishLot(lotId: string) {
  const closed = await withTransaction(async client => {
    const result = await client.query('SELECT * FROM lots WHERE id=$1 FOR UPDATE', [lotId]);
    const lot = result.rows[0];
    if (!lot || lot.status === 'closed' || lot.status === 'cancelled' || new Date(lot.ends_at) > new Date()) return;
    return settleLockedLot(client, lot);
  });
  if (closed) socket.to(`lot:${closed.lotId}`).emit('lot:closed', closed);
}
async function refreshLots() {
  const started = await pool.query("UPDATE lots SET status='live' WHERE status='scheduled' AND starts_at <= now() AND ends_at > now() RETURNING id");
  for (const row of started.rows) socket.to(`lot:${row.id}`).emit('lot:live', { lotId: row.id });
  const overdue = await pool.query("SELECT id FROM lots WHERE status IN ('scheduled','live') AND ends_at <= now() LIMIT 25");
  for (const row of overdue.rows) await finishLot(row.id);
}
function errorReply(error: any, reply: any) {
  const statusCode = Number(error.statusCode) || 400;
  return reply.code(statusCode).send({ error: error.message ?? 'Não foi possível concluir a solicitação.' });
}
function itemFromAic(row: any) {
  const artwork = row.data ?? row;
  return {
    id: String(artwork.id), title: artwork.title ?? 'Obra sem título', artist: artwork.artist_title ?? 'Autoria desconhecida',
    date: artwork.date_display ?? 'Data não informada', publicDomain: Boolean(artwork.is_public_domain),
    imageUrl: artwork.image_id ? `/api/images/${artwork.image_id}` : null,
    sourceUrl: `https://www.artic.edu/artworks/${artwork.id}`
  };
}

app.get('/health', async () => ({ ok: true, service: 'lancearte-api' }));
app.get<{ Params: { imageId: string } }>('/images/:imageId', async (request, reply) => {
  const { imageId } = request.params;
  if (!/^[a-f0-9-]{36}$/i.test(imageId)) return reply.code(400).send({ error: 'Identificador de imagem inválido.' });
  try {
    const response = await fetch(`https://www.artic.edu/iiif/2/${imageId}/full/1200,/0/default.jpg`, {
      headers: { 'AIC-User-Agent': process.env.AIC_USER_AGENT ?? 'LanceArte/1.0 (local development)', 'User-Agent': 'LanceArte/1.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return reply.code(502).send({ error: 'Imagem temporariamente indisponível.' });
    const image = Buffer.from(await response.arrayBuffer());
    return reply.type(response.headers.get('content-type') ?? 'image/jpeg').header('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400').send(image);
  } catch {
    return reply.code(502).send({ error: 'Imagem temporariamente indisponível.' });
  }
});
app.get('/auth/me', async request => ({ user: await currentUser(request) }));
app.post<{ Body: { email?: string; password?: string } }>('/auth/login', async (request, reply) => {
  const email = request.body?.email?.trim().toLowerCase();
  const password = request.body?.password;
  const ipKey = `login-ip:${request.ip}`;
  const accountKey = `login-acct:${request.ip}:${email ?? 'anonymous'}`;
  const ipLimit = loginRateLimiter.consume(ipKey);
  const accountLimit = loginRateLimiter.consume(accountKey);
  if (!ipLimit.allowed || !accountLimit.allowed) {
    const retryAfter = Math.max(ipLimit.retryAfterSeconds, accountLimit.retryAfterSeconds);
    return reply.header('Retry-After', String(retryAfter)).code(429).send({ error: 'Muitas tentativas de login em sequência. Aguarde alguns minutos e tente novamente.' });
  }
  if (!email || !password) return reply.code(400).send({ error: 'Informe seu e-mail e sua senha.' });
  const result = await pool.query('SELECT id, name, role, password_hash FROM users WHERE LOWER(email)=$1 LIMIT 1', [email]);
  const candidate = result.rows[0];
  if (!candidate || !verifyPassword(password, candidate.password_hash)) return reply.code(401).send({ error: 'E-mail ou senha não conferem.' });
  loginRateLimiter.reset(accountKey);
  setSessionCookie(reply, candidate.id);
  return { user: { id: candidate.id, name: candidate.name, role: candidate.role } };
});
app.post<{ Body: { name?: string; email?: string; password?: string; role?: string } }>('/auth/register', async (request, reply) => {
  const registerLimit = registerRateLimiter.consume(`register-ip:${request.ip}`);
  if (!registerLimit.allowed) {
    return reply.header('Retry-After', String(registerLimit.retryAfterSeconds)).code(429).send({ error: 'Muitas tentativas de cadastro em sequência. Aguarde alguns minutos e tente novamente.' });
  }
  const name = request.body?.name?.trim();
  const email = request.body?.email?.trim().toLowerCase();
  const password = request.body?.password;
  const role = request.body?.role;
  if (!name || name.length < 2 || name.length > 80) return reply.code(400).send({ error: 'Informe um nome entre 2 e 80 caracteres.' });
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.code(400).send({ error: 'Informe um e-mail válido.' });
  if (!password || password.length < 10 || password.length > 128) return reply.code(400).send({ error: 'A senha deve ter entre 10 e 128 caracteres.' });
  if (role !== 'bidder' && role !== 'auctioneer') return reply.code(400).send({ error: 'Escolha como deseja participar do acervo.' });
  try {
    const result = await pool.query('INSERT INTO users(name, role, email, password_hash) VALUES($1,$2,$3,$4) RETURNING id,name,role', [name, role, email, hashPassword(password)]);
    setSessionCookie(reply, result.rows[0].id);
    return reply.code(201).send({ user: result.rows[0] });
  } catch (error: any) {
    if (error.code === '23505') return reply.code(409).send({ error: 'Este e-mail já tem um perfil. Entre com sua senha ou use outro e-mail.' });
    throw error;
  }
});
app.post('/auth/logout', async (_request, reply) => {
  reply.clearCookie(COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  return { ok: true };
});

app.get<{ Querystring: { q?: string } }>('/items', async (request, reply) => {
  const query = request.query.q?.trim();
  if (!query) return reply.code(400).send({ error: 'Digite o nome de uma obra ou artista.' });
  try {
    const url = new URL('https://api.artic.edu/api/v1/artworks/search');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '12');
    url.searchParams.set('fields', 'id,title,artist_title,date_display,is_public_domain,image_id');
    const response = await fetch(url, { headers: { 'AIC-User-Agent': process.env.AIC_USER_AGENT ?? 'LanceArte/1.0 (local development)' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('A fonte de obras está temporariamente indisponível. Tente novamente em instantes.');
    const payload = await response.json() as any;
    const items = (payload.data ?? []).map((row: any) => itemFromAic({ data: row, config: payload.config }));
    const normalizedQuery = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (normalizedQuery.includes('portinari') || normalizedQuery.trim() === 'cafe') {
      items.unshift({ id: 'portinari-16371', title: 'Café', artist: 'Candido Portinari', date: '1935', publicDomain: false, imageUrl: 'https://acervo-portinari.s3.sa-east-1.amazonaws.com/f5ca02363ab4193d5feccce408eb5220.jpeg', sourceUrl: 'https://www.portinari.org.br/acervo/obras/16371/cafe' });
    }
    if (normalizedQuery.includes('magritte') || normalizedQuery.includes('cachimbo') || normalizedQuery.includes('ceci') || normalizedQuery.includes('trahison')) {
      items.unshift({ id: 'lacma-78-7', title: 'A Traição das Imagens (Isto não é um cachimbo)', artist: 'René Magritte', date: '1929', publicDomain: false, imageUrl: 'https://collections-images.lacma.org/images/31931/31931-1-primary.webp', sourceUrl: 'https://collections.lacma.org/node/239578' });
    }
    return { items };
  } catch (error) {
    return errorReply(error, reply);
  }
});

app.get<{ Querystring: { status?: string } }>('/lots', async request => {
  await refreshLots();
  const allowed = ['scheduled', 'live', 'closed', 'cancelled'];
  const status = allowed.includes(request.query.status ?? '') ? request.query.status : null;
  const result = await pool.query(`SELECT lots.*, users.name AS seller_name, receipts.token AS receipt_token, (SELECT count(*)::int FROM bids WHERE bids.lot_id=lots.id) AS bid_count FROM lots JOIN users ON users.id=lots.seller_id LEFT JOIN receipts ON receipts.lot_id=lots.id ${status ? 'WHERE lots.status=$1' : "WHERE lots.status <> 'cancelled'"} ORDER BY CASE lots.status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, lots.ends_at`, status ? [status] : []);
  return result.rows.map(publicLot);
});
app.get<{ Params: { id: string } }>('/lots/:id', async (request, reply) => {
  await refreshLots();
  const result = await pool.query('SELECT lots.*, users.name AS seller_name, receipts.token AS receipt_token, (SELECT count(*)::int FROM bids WHERE bids.lot_id=lots.id) AS bid_count FROM lots JOIN users ON users.id=lots.seller_id LEFT JOIN receipts ON receipts.lot_id=lots.id WHERE lots.id=$1', [request.params.id]);
  if (!result.rowCount || result.rows[0].status === 'cancelled') return reply.code(404).send({ error: 'Lote não encontrado.' });
  const user = await currentUser(request);
  return { ...publicLot(result.rows[0]), isCurrentUserLeader: Boolean(user && result.rows[0].current_leader_id === user.id) };
});
app.get('/auctioneer/lots', async request => {
  const seller = await requireUser(request, 'auctioneer');
  const result = await pool.query('SELECT lots.*, users.name AS seller_name, receipts.token AS receipt_token, (SELECT count(*)::int FROM bids WHERE bids.lot_id=lots.id) AS bid_count FROM lots JOIN users ON users.id=lots.seller_id LEFT JOIN receipts ON receipts.lot_id=lots.id WHERE lots.seller_id=$1 ORDER BY lots.created_at DESC', [seller.id]);
  return result.rows.map(publicLot);
});
app.get<{ Params: { id: string } }>('/lots/:id/bids', async (request, reply) => {
  const exists = await pool.query('SELECT id FROM lots WHERE id=$1', [request.params.id]);
  if (!exists.rowCount) return reply.code(404).send({ error: 'Lote não encontrado.' });
  const result = await pool.query('SELECT bidder_id, amount_cents, created_at FROM bids WHERE lot_id=$1 ORDER BY created_at DESC', [request.params.id]);
  return result.rows.map((row: any) => ({ bidder: pseudonym(row.bidder_id), amount: money(row.amount_cents), createdAt: row.created_at }));
});

app.post<{ Body: { sourceId?: string; openingBid?: number; increment?: number; startsAt?: string; endsAt?: string } }>('/lots', async (request, reply) => {
  try {
    const seller = await requireUser(request, 'auctioneer');
    const { sourceId, openingBid, increment, startsAt, endsAt } = request.body ?? {};
    if (!sourceId || !startsAt || !endsAt) throw new Error('Selecione uma obra e informe início e fim do lote.');
    const start = new Date(startsAt), end = new Date(endsAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error('O horário final precisa ser posterior ao início.');
    const openingCents = centsFromMoney(openingBid);
    const incrementCents = centsFromMoney(increment);
    let artwork: ReturnType<typeof itemFromAic>;
    if (sourceId === 'portinari-16371') {
      artwork = { id: 'portinari-16371', title: 'Café', artist: 'Candido Portinari', date: '1935', publicDomain: false, imageUrl: 'https://acervo-portinari.s3.sa-east-1.amazonaws.com/f5ca02363ab4193d5feccce408eb5220.jpeg', sourceUrl: 'https://www.portinari.org.br/acervo/obras/16371/cafe' };
    } else if (sourceId === 'lacma-78-7') {
      artwork = { id: 'lacma-78-7', title: 'A Traição das Imagens (Isto não é um cachimbo)', artist: 'René Magritte', date: '1929', publicDomain: false, imageUrl: 'https://collections-images.lacma.org/images/31931/31931-1-primary.webp', sourceUrl: 'https://collections.lacma.org/node/239578' };
    } else {
      const response = await fetch(`https://api.artic.edu/api/v1/artworks/${encodeURIComponent(sourceId)}?fields=id,title,artist_title,date_display,is_public_domain,image_id`, { headers: { 'AIC-User-Agent': process.env.AIC_USER_AGENT ?? 'LanceArte/1.0 (local development)' }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Não foi possível confirmar a obra na API agora. Tente novamente mais tarde.');
      const payload = await response.json() as any;
      artwork = itemFromAic(payload);
    }
    const result = await pool.query("INSERT INTO lots(seller_id, source_id, artwork, title, image_url, opening_bid_cents, increment_cents, starts_at, ends_at, status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $8 <= now() THEN 'live' ELSE 'scheduled' END) RETURNING *", [seller.id, artwork.id, artwork, artwork.title, artwork.imageUrl, openingCents, incrementCents, start, end]);
    return reply.code(201).send(publicLot({ ...result.rows[0], seller_name: seller.name }));
  } catch (error) { return errorReply(error, reply); }
});

app.post<{ Params: { id: string } }>('/lots/:id/cancel', async (request, reply) => {
  try {
    const seller = await requireUser(request, 'auctioneer');
    const result = await withTransaction(async client => {
      const lotResult = await client.query('SELECT * FROM lots WHERE id=$1 FOR UPDATE', [request.params.id]);
      const lot = lotResult.rows[0];
      if (!lot || lot.seller_id !== seller.id) throw Object.assign(new Error('Lote não encontrado.'), { statusCode: 404 });
      if (lot.status === 'closed' || lot.status === 'cancelled') throw new Error('Este lote já foi encerrado.');
      const bidCount = await client.query('SELECT count(*)::int AS count FROM bids WHERE lot_id=$1', [lot.id]);
      if (bidCount.rows[0].count > 0) throw new Error('Lotes que já receberam lances não podem ser cancelados.');
      await client.query("UPDATE lots SET status='cancelled' WHERE id=$1", [lot.id]);
      await appendAuditEvent(client, lot.id, 'lot_cancelled', { type: 'lot_cancelled', lotId: lot.id, cancelledAt: new Date().toISOString() });
      return { ok: true };
    });
    return result;
  } catch (error) { return errorReply(error, reply); }
});

app.post<{ Params: { id: string }; Body: { amount?: number } }>('/lots/:id/bids', async (request, reply) => {
  try {
    const bidder = await requireUser(request, 'bidder');
    const amountCents = centsFromMoney(request.body?.amount);
    const result = await withTransaction(async client => {
      const query = await client.query('SELECT * FROM lots WHERE id=$1 FOR UPDATE', [request.params.id]);
      const lot = query.rows[0];
      if (!lot || lot.status === 'closed' || lot.status === 'cancelled') throw new Error('Este lote não está aceitando lances.');
      const now = new Date();
      if (new Date(lot.ends_at) <= now) {
        const closed = await settleLockedLot(client, lot);
        return { expired: true as const, ...closed };
      }
      if (lot.status === 'scheduled' && new Date(lot.starts_at) <= now) {
        lot.status = 'live';
        await client.query("UPDATE lots SET status='live' WHERE id=$1", [lot.id]);
      }
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [bidder.id]);
      const wallet = await client.query('SELECT COALESCE(sum(available_delta_cents),0)::bigint AS available FROM wallet_transactions WHERE user_id=$1', [bidder.id]);
      const decision = evaluateBid({ status: lot.status, startsAt: new Date(lot.starts_at), endsAt: new Date(lot.ends_at), now, openingBidCents: Number(lot.opening_bid_cents), currentBidCents: lot.current_bid_cents === null ? null : Number(lot.current_bid_cents), minimumIncrementCents: Number(lot.increment_cents), currentLeaderId: lot.current_leader_id, bidderId: bidder.id, availableCents: Number(wallet.rows[0].available), sellerId: lot.seller_id, amountCents });
      if (!decision.accepted) throw new Error(decision.reason);
      if (lot.current_leader_id) {
        await client.query("INSERT INTO wallet_transactions(user_id, lot_id, kind, available_delta_cents, committed_delta_cents, note) VALUES($1,$2,'release',$3,$4,'Lance superado')", [lot.current_leader_id, lot.id, lot.current_bid_cents, -lot.current_bid_cents]);
      }
      await client.query("INSERT INTO wallet_transactions(user_id, lot_id, kind, available_delta_cents, committed_delta_cents, note) VALUES($1,$2,'reserve',$3,$4,'Lance em disputa')", [bidder.id, lot.id, -amountCents, amountCents]);
      const bid = await client.query('INSERT INTO bids(lot_id, bidder_id, amount_cents) VALUES($1,$2,$3) RETURNING created_at', [lot.id, bidder.id, amountCents]);
      await client.query('UPDATE lots SET status=\'live\', current_bid_cents=$1, current_leader_id=$2, ends_at=$3 WHERE id=$4', [amountCents, bidder.id, decision.nextEndAt, lot.id]);
      const payload = { type: 'bid_placed', amountCents, bidder: pseudonym(bidder.id), createdAt: new Date(bid.rows[0].created_at).toISOString() };
      const audit = await appendAuditEvent(client, lot.id, 'bid_placed', payload, new Date(bid.rows[0].created_at));
      return { expired: false as const, lotId: lot.id, amount: money(amountCents), leader: payload.bidder, endsAt: decision.nextEndAt, extended: decision.nextEndAt.getTime() > new Date(lot.ends_at).getTime(), createdAt: bid.rows[0].created_at, auditSequence: audit.sequence };
    });
    if (result.expired) {
      socket.to(`lot:${result.lotId}`).emit('lot:closed', result);
      return reply.code(409).send({ error: 'O lote acabou de ser encerrado. Atualize a página para ver o resultado.' });
    }
    socket.to(`lot:${result.lotId}`).emit('lot:bid', result);
    return result;
  } catch (error) { return errorReply(error, reply); }
});

app.get('/wallet/me', async (request, reply) => {
  try {
    const user = await requireUser(request, 'bidder');
    const [result, txResult] = await Promise.all([
      pool.query('SELECT COALESCE(sum(available_delta_cents),0)::bigint AS available, COALESCE(sum(committed_delta_cents),0)::bigint AS committed FROM wallet_transactions WHERE user_id=$1', [user.id]),
      pool.query('SELECT wallet_transactions.id, wallet_transactions.lot_id, wallet_transactions.kind, wallet_transactions.available_delta_cents, wallet_transactions.committed_delta_cents, wallet_transactions.note, wallet_transactions.created_at, lots.title AS lot_title FROM wallet_transactions LEFT JOIN lots ON lots.id=wallet_transactions.lot_id WHERE wallet_transactions.user_id=$1 ORDER BY wallet_transactions.created_at DESC LIMIT 20', [user.id])
    ]);
    return {
      user: { id: user.id, name: user.name },
      available: money(result.rows[0].available),
      committed: money(result.rows[0].committed),
      total: money(BigInt(result.rows[0].available) + BigInt(result.rows[0].committed)),
      transactions: txResult.rows.map((row: any) => ({
        id: row.id,
        lotId: row.lot_id,
        lotTitle: row.lot_title,
        kind: row.kind,
        availableDelta: money(row.available_delta_cents),
        committedDelta: money(row.committed_delta_cents),
        note: row.note,
        createdAt: row.created_at
      }))
    };
  } catch (error) { return errorReply(error, reply); }
});
app.post<{ Body: { amount?: number } }>('/wallet/deposits', async (request, reply) => {
  try {
    const user = await requireUser(request, 'bidder');
    const amountCents = centsFromMoney(request.body?.amount);
    if (amountCents > 1_000_000) throw new Error('O depósito de demonstração é limitado a R$ 10.000,00 por operação.');
    await withTransaction(async client => {
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
      await client.query("INSERT INTO wallet_transactions(user_id, kind, available_delta_cents, committed_delta_cents, note) VALUES($1,'deposit',$2,0,'Depósito simulado')", [user.id, amountCents]);
    });
    return reply.code(201).send({ ok: true, deposited: money(amountCents) });
  } catch (error) { return errorReply(error, reply); }
});
app.get('/wallet/wins', async (request, reply) => {
  try {
    const user = await requireUser(request, 'bidder');
    const result = await pool.query("SELECT lots.id, lots.title, lots.image_url, lots.current_bid_cents, lots.ends_at, receipts.token FROM lots JOIN receipts ON receipts.lot_id=lots.id WHERE lots.current_leader_id=$1 AND lots.status='closed' ORDER BY lots.ends_at DESC", [user.id]);
    return result.rows.map((row: any) => ({ id: row.id, title: row.title, imageUrl: row.image_url, amount: money(row.current_bid_cents), closedAt: row.ends_at, receiptToken: row.token }));
  } catch (error) { return errorReply(error, reply); }
});

app.get<{ Params: { id: string } }>('/audit/lots/:id', async (request, reply) => {
  const lot = await pool.query('SELECT id, title, artwork, status, audit_count, audit_tip_hash FROM lots WHERE id=$1', [request.params.id]);
  if (!lot.rowCount) return reply.code(404).send({ error: 'Lote não encontrado.' });
  const result = await pool.query('SELECT sequence, event_type, payload, previous_hash, event_hash, created_at FROM audit_events WHERE lot_id=$1 ORDER BY sequence ASC', [request.params.id]);
  const valid = auditMatchesCheckpoint(result.rows.map((row: any) => ({ previousHash: row.previous_hash, eventHash: row.event_hash, payload: row.payload })), Number(lot.rows[0].audit_count), lot.rows[0].audit_tip_hash);
  return {
    lotId: request.params.id,
    title: lot.rows[0].title,
    artwork: lot.rows[0].artwork,
    status: lot.rows[0].status,
    auditCount: Number(lot.rows[0].audit_count),
    auditTipHash: lot.rows[0].audit_tip_hash,
    valid,
    events: result.rows.map((row: any) => ({ sequence: row.sequence, type: row.event_type, ...row.payload, previousHash: row.previous_hash, eventHash: row.event_hash, createdAt: row.created_at }))
  };
});
app.get<{ Params: { token: string } }>('/receipts/:token', async (request, reply) => {
  const result = await pool.query('SELECT receipts.token, lots.id AS lot_id, lots.title, lots.artwork, lots.image_url, lots.opening_bid_cents, lots.current_bid_cents, lots.current_leader_id, lots.status, lots.ends_at, users.name AS seller_name, (SELECT count(*)::int FROM bids WHERE bids.lot_id=lots.id) AS bid_count FROM receipts JOIN lots ON lots.id=receipts.lot_id JOIN users ON users.id=lots.seller_id WHERE receipts.token=$1', [request.params.token]);
  const row = result.rows[0];
  if (!row || row.status !== 'closed' || !row.current_leader_id) return reply.code(404).send({ error: 'Comprovante ainda não disponível.' });
  return {
    token: row.token,
    lotId: row.lot_id,
    title: row.title,
    artwork: row.artwork,
    imageUrl: publicImageUrl(row.image_url),
    openingBid: money(row.opening_bid_cents),
    amount: money(row.current_bid_cents),
    winner: pseudonym(row.current_leader_id),
    sellerName: row.seller_name,
    bidCount: Number(row.bid_count ?? 0),
    closedAt: row.ends_at
  };
});

socket.on('connection', client => {
  client.on('lot:join', (lotId: unknown) => {
    if (typeof lotId === 'string' && /^[0-9a-f-]{36}$/i.test(lotId)) client.join(`lot:${lotId}`);
  });
});

setInterval(() => { refreshLots().catch(error => app.log.error(error)); }, 1000).unref();
const shutdown = async () => { await app.close(); socket.close(); await pool.end(); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.ready();
httpServer.listen(PORT, '0.0.0.0', () => app.log.info(`LanceArte API ouvindo na porta ${PORT}`));
