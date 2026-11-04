import type { FastifyInstance } from 'fastify';
import type { Server as SocketServer } from 'socket.io';
import { pool, withTransaction } from './db.js';
import { getArtwork, type Artwork } from './artworks.js';
import { evaluateBid, isUuid, lotScheduleError, pseudonym } from './domain.js';
import { asDate, centsFromMoney, DbRow, errorReply, money } from './http-utils.js';
import { PUBLIC_LOT_SELECT } from './lot-queries.js';
import { appendAuditEvent, LotRow, publicLot, refreshLots, settleLockedLot } from './lot-service.js';
import { currentUser, requireUser } from './session.js';

export function registerLotRoutes(app: FastifyInstance, socket: SocketServer) {
  app.get<{ Querystring: { status?: string } }>('/lots', async request => {
    await refreshLots(socket);
    const allowed = ['scheduled', 'live', 'closed', 'cancelled'];
    const status = allowed.includes(request.query.status ?? '') ? request.query.status : null;
    const result = await pool.query<LotRow>(
      `${PUBLIC_LOT_SELECT} ${status ? 'WHERE lots.status=$1' : "WHERE lots.status <> 'cancelled'"} ORDER BY CASE lots.status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, lots.ends_at`,
      status ? [status] : []
    );
    return result.rows.map(publicLot);
  });

  app.get<{ Params: { id: string } }>('/lots/:id', async (request, reply) => {
    if (!isUuid(request.params.id)) return reply.code(400).send({ error: 'Identificador de lote inválido.' });
    await refreshLots(socket);
    const result = await pool.query<LotRow>(`${PUBLIC_LOT_SELECT} WHERE lots.id=$1`, [request.params.id]);
    if (!result.rowCount || result.rows[0].status === 'cancelled') {
      return reply.code(404).send({ error: 'Lote não encontrado.' });
    }
    const user = await currentUser(request);
    return {
      ...publicLot(result.rows[0]),
      isCurrentUserLeader: Boolean(user && result.rows[0].current_leader_id === user.id)
    };
  });

  app.get('/auctioneer/lots', async request => {
    const seller = await requireUser(request, 'auctioneer');
    const result = await pool.query<LotRow>(
      `${PUBLIC_LOT_SELECT} WHERE lots.seller_id=$1 ORDER BY lots.created_at DESC`,
      [seller.id]
    );
    return result.rows.map(publicLot);
  });

  app.get<{ Params: { id: string } }>('/lots/:id/bids', async (request, reply) => {
    if (!isUuid(request.params.id)) return reply.code(400).send({ error: 'Identificador de lote inválido.' });
    const exists = await pool.query<DbRow<{ id: string }>>('SELECT id FROM lots WHERE id=$1', [request.params.id]);
    if (!exists.rowCount) return reply.code(404).send({ error: 'Lote não encontrado.' });
    const result = await pool.query<
      DbRow<{ bidder_id: string; amount_cents: string | number | bigint; created_at: string | Date }>
    >('SELECT bidder_id, amount_cents, created_at FROM bids WHERE lot_id=$1 ORDER BY created_at DESC', [
      request.params.id
    ]);
    return result.rows.map(row => ({
      bidder: pseudonym(row.bidder_id),
      amount: money(row.amount_cents),
      createdAt: row.created_at
    }));
  });

  app.post<{
    Body: { sourceId?: string; openingBid?: number; increment?: number; startsAt?: string; endsAt?: string };
  }>('/lots', async (request, reply) => {
    try {
      const seller = await requireUser(request, 'auctioneer');
      const { sourceId, openingBid, increment, startsAt, endsAt } = request.body ?? {};
      if (!sourceId || !startsAt || !endsAt) {
        throw new Error('Selecione uma obra e informe início e fim do lote.');
      }
      const start = new Date(startsAt);
      const end = new Date(endsAt);
      const scheduleError = lotScheduleError(start, end);
      if (scheduleError) throw new Error(scheduleError);
      const openingCents = centsFromMoney(openingBid);
      const incrementCents = centsFromMoney(increment);
      const artwork = await getArtwork(sourceId);
      const result = await pool.query<LotRow>(
        "INSERT INTO lots(seller_id, source_id, artwork, title, image_url, opening_bid_cents, increment_cents, starts_at, ends_at, status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $8 <= now() THEN 'live' ELSE 'scheduled' END) RETURNING *",
        [
          seller.id,
          artwork.id,
          artwork,
          artwork.title,
          artwork.imageUrl,
          openingCents,
          incrementCents,
          start,
          end
        ]
      );
      return reply.code(201).send(publicLot({ ...result.rows[0], seller_name: seller.name }));
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post<{ Params: { id: string } }>('/lots/:id/cancel', async (request, reply) => {
    try {
      const seller = await requireUser(request, 'auctioneer');
      if (!isUuid(request.params.id)) return reply.code(400).send({ error: 'Identificador de lote inválido.' });
      return await withTransaction(async client => {
        const lotResult = await client.query<LotRow>('SELECT * FROM lots WHERE id=$1 FOR UPDATE', [
          request.params.id
        ]);
        const lot = lotResult.rows[0];
        if (!lot || lot.seller_id !== seller.id) {
          throw Object.assign(new Error('Lote não encontrado.'), { statusCode: 404 });
        }
        if (lot.status === 'closed' || lot.status === 'cancelled') {
          throw new Error('Este lote já foi encerrado.');
        }
        const bidCount = await client.query<DbRow<{ count: number }>>(
          'SELECT count(*)::int AS count FROM bids WHERE lot_id=$1',
          [lot.id]
        );
        if (bidCount.rows[0].count > 0) {
          throw new Error('Lotes que já receberam lances não podem ser cancelados.');
        }
        await client.query("UPDATE lots SET status='cancelled' WHERE id=$1", [lot.id]);
        await appendAuditEvent(client, lot.id, 'lot_cancelled', {
          type: 'lot_cancelled',
          lotId: lot.id,
          cancelledAt: new Date().toISOString()
        });
        return { ok: true };
      });
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post<{ Params: { id: string }; Body: { amount?: number } }>('/lots/:id/bids', async (request, reply) => {
    try {
      const bidder = await requireUser(request, 'bidder');
      if (!isUuid(request.params.id)) return reply.code(400).send({ error: 'Identificador de lote inválido.' });
      const amountCents = centsFromMoney(request.body?.amount);
      const result = await withTransaction(async client => {
        const query = await client.query<LotRow>('SELECT * FROM lots WHERE id=$1 FOR UPDATE', [request.params.id]);
        const lot = query.rows[0];
        if (!lot || lot.status === 'closed' || lot.status === 'cancelled') {
          throw new Error('Este lote não está aceitando lances.');
        }
        const now = new Date();
        if (asDate(lot.ends_at) <= now) {
          const closed = await settleLockedLot(client, lot);
          return { expired: true as const, ...closed };
        }
        if (lot.status === 'scheduled' && asDate(lot.starts_at) <= now) {
          lot.status = 'live';
          await client.query("UPDATE lots SET status='live' WHERE id=$1", [lot.id]);
        }
        await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [bidder.id]);
        const wallet = await client.query<DbRow<{ available: string | number | bigint }>>(
          'SELECT COALESCE(sum(available_delta_cents),0)::bigint AS available FROM wallet_transactions WHERE user_id=$1',
          [bidder.id]
        );
        const decision = evaluateBid({
          status: lot.status,
          startsAt: asDate(lot.starts_at),
          endsAt: asDate(lot.ends_at),
          now,
          openingBidCents: Number(lot.opening_bid_cents),
          currentBidCents: lot.current_bid_cents === null ? null : Number(lot.current_bid_cents),
          minimumIncrementCents: Number(lot.increment_cents),
          currentLeaderId: lot.current_leader_id,
          bidderId: bidder.id,
          availableCents: Number(wallet.rows[0].available),
          sellerId: lot.seller_id,
          amountCents
        });
        if (!decision.accepted) throw new Error(decision.reason);
        if (lot.current_leader_id) {
          if (lot.current_bid_cents === null) {
            throw new Error('Estado inválido: o lote tem um líder sem lance registrado.');
          }
          await client.query(
            "INSERT INTO wallet_transactions(user_id, lot_id, kind, available_delta_cents, committed_delta_cents, note) VALUES($1,$2,'release',$3,$4,'Lance superado')",
            [lot.current_leader_id, lot.id, lot.current_bid_cents, -lot.current_bid_cents]
          );
        }
        await client.query(
          "INSERT INTO wallet_transactions(user_id, lot_id, kind, available_delta_cents, committed_delta_cents, note) VALUES($1,$2,'reserve',$3,$4,'Lance em disputa')",
          [bidder.id, lot.id, -amountCents, amountCents]
        );
        const bid = await client.query<DbRow<{ created_at: Date | string }>>(
          'INSERT INTO bids(lot_id, bidder_id, amount_cents) VALUES($1,$2,$3) RETURNING created_at',
          [lot.id, bidder.id, amountCents]
        );
        await client.query(
          "UPDATE lots SET status='live', current_bid_cents=$1, current_leader_id=$2, ends_at=$3 WHERE id=$4",
          [amountCents, bidder.id, decision.nextEndAt, lot.id]
        );
        const createdAt = asDate(bid.rows[0].created_at);
        const payload = {
          type: 'bid_placed',
          amountCents,
          bidder: pseudonym(bidder.id),
          createdAt: createdAt.toISOString()
        };
        const audit = await appendAuditEvent(client, lot.id, 'bid_placed', payload, createdAt);
        return {
          expired: false as const,
          lotId: lot.id,
          amount: money(amountCents),
          leader: payload.bidder,
          endsAt: decision.nextEndAt,
          extended: decision.nextEndAt.getTime() > asDate(lot.ends_at).getTime(),
          createdAt,
          auditSequence: audit.sequence
        };
      });
      if (result.expired) {
        socket.to(`lot:${result.lotId}`).emit('lot:closed', result);
        return reply
          .code(409)
          .send({ error: 'O lote acabou de ser encerrado. Atualize a página para ver o resultado.' });
      }
      socket.to(`lot:${result.lotId}`).emit('lot:bid', result);
      return result;
    } catch (error) {
      return errorReply(error, reply);
    }
  });
}
