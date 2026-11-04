import { randomBytes } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type { Server as SocketServer } from 'socket.io';
import { pool, withTransaction } from './db.js';
import type { Artwork } from './artworks.js';
import { hashAuditEvent, pseudonym } from './domain.js';
import { asDate, DbRow, money } from './http-utils.js';

export type LotRow = QueryResultRow & {
  id: string;
  title: string;
  image_url: string | null;
  artwork: Artwork | null;
  opening_bid_cents: string | number | bigint;
  increment_cents: string | number | bigint;
  starts_at: string | Date;
  ends_at: string | Date;
  status: 'scheduled' | 'live' | 'closed' | 'cancelled';
  current_bid_cents: string | number | bigint | null;
  current_leader_id: string | null;
  seller_id: string;
  seller_name?: string | null;
  receipt_token?: string | null;
  bid_count?: number | string;
  audit_count: number | string;
  audit_tip_hash: string | null;
  created_at: string | Date;
};

export function publicImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const imageId = value.match(/\/iiif\/2\/([a-f0-9-]{36})(?:\/|$)/i)?.[1];
  return imageId ? `/api/images/${imageId}` : value;
}

export function publicLot(row: LotRow) {
  return {
    id: row.id,
    title: row.title,
    imageUrl: publicImageUrl(row.image_url),
    artwork: row.artwork,
    openingBid: money(row.opening_bid_cents),
    increment: money(row.increment_cents),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    currentBid: row.current_bid_cents == null ? null : money(row.current_bid_cents),
    leader: row.current_leader_id ? pseudonym(row.current_leader_id) : null,
    receiptToken: row.receipt_token ?? null,
    sellerId: row.seller_id,
    sellerName: row.seller_name ?? 'Leiloeiro',
    bidCount: Number(row.bid_count ?? 0),
    auditCount: Number(row.audit_count ?? 0)
  };
}

export async function appendAuditEvent(
  client: PoolClient,
  lotId: string,
  eventType: string,
  payload: unknown,
  createdAt = new Date()
) {
  const last = await client.query<DbRow<{ sequence: number; event_hash: string }>>(
    'SELECT sequence, event_hash FROM audit_events WHERE lot_id=$1 ORDER BY sequence DESC LIMIT 1',
    [lotId]
  );
  const sequence = (last.rows[0]?.sequence ?? 0) + 1;
  const previousHash = last.rows[0]?.event_hash ?? 'GENESIS';
  const eventHash = hashAuditEvent(previousHash, payload);
  await client.query(
    'INSERT INTO audit_events(lot_id, sequence, event_type, payload, previous_hash, event_hash, created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [lotId, sequence, eventType, payload, previousHash, eventHash, createdAt]
  );
  await client.query('UPDATE lots SET audit_count=$1, audit_tip_hash=$2 WHERE id=$3', [sequence, eventHash, lotId]);
  return { sequence, previousHash, eventHash };
}

export async function settleLockedLot(client: PoolClient, lot: LotRow) {
  const receiptToken = randomBytes(24).toString('hex');
  if (lot.current_leader_id) {
    const winningCents = Number(lot.current_bid_cents);
    await client.query(
      "INSERT INTO wallet_transactions(user_id, lot_id, kind, available_delta_cents, committed_delta_cents, note) VALUES($1,$2,'settlement_debit',0,$3,'Arremate liquidado')",
      [lot.current_leader_id, lot.id, -winningCents]
    );
    await client.query(
      "INSERT INTO wallet_transactions(user_id, lot_id, kind, available_delta_cents, committed_delta_cents, note) VALUES($1,$2,'settlement_credit',$3,0,'Crédito do leiloeiro')",
      [lot.seller_id, lot.id, winningCents]
    );
    await client.query('INSERT INTO receipts(token, lot_id) VALUES($1,$2) ON CONFLICT(lot_id) DO NOTHING', [
      receiptToken,
      lot.id
    ]);
  }
  await client.query(
    'INSERT INTO settlements(lot_id, winner_id, seller_id, amount_cents) VALUES($1,$2,$3,$4) ON CONFLICT(lot_id) DO NOTHING',
    [lot.id, lot.current_leader_id, lot.seller_id, lot.current_bid_cents ?? 0]
  );
  await client.query("UPDATE lots SET status='closed' WHERE id=$1", [lot.id]);
  const payload = {
    type: 'lot_closed',
    lotId: lot.id,
    winningBidCents: lot.current_bid_cents == null ? null : Number(lot.current_bid_cents),
    winner: lot.current_leader_id ? pseudonym(lot.current_leader_id) : null,
    closedAt: new Date().toISOString()
  };
  await appendAuditEvent(client, lot.id, 'lot_closed', payload);
  return {
    lotId: lot.id,
    currentBid: lot.current_bid_cents == null ? null : money(lot.current_bid_cents),
    leader: payload.winner
  };
}

async function finishLot(lotId: string, socket: SocketServer) {
  const closed = await withTransaction(async client => {
    const result = await client.query<LotRow>('SELECT * FROM lots WHERE id=$1 FOR UPDATE', [lotId]);
    const lot = result.rows[0];
    if (!lot || lot.status === 'closed' || lot.status === 'cancelled' || asDate(lot.ends_at) > new Date()) {
      return;
    }
    return settleLockedLot(client, lot);
  });
  if (closed) socket.to(`lot:${closed.lotId}`).emit('lot:closed', closed);
}

export async function refreshLots(socket: SocketServer) {
  const started = await pool.query<DbRow<{ id: string }>>(
    "UPDATE lots SET status='live' WHERE status='scheduled' AND starts_at <= now() AND ends_at > now() RETURNING id"
  );
  for (const row of started.rows) socket.to(`lot:${row.id}`).emit('lot:live', { lotId: row.id });
  const overdue = await pool.query<DbRow<{ id: string }>>(
    "SELECT id FROM lots WHERE status IN ('scheduled','live') AND ends_at <= now() LIMIT 25"
  );
  for (const row of overdue.rows) await finishLot(row.id, socket);
}
