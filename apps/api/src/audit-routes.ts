import type { FastifyInstance } from 'fastify';
import { pool } from './db.js';
import type { Artwork } from './artworks.js';
import { auditMatchesCheckpoint, isUuid, pseudonym } from './domain.js';
import { asDate, DbRow, money } from './http-utils.js';
import { LotRow, publicImageUrl } from './lot-service.js';

export function registerAuditRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/audit/lots/:id', async (request, reply) => {
    if (!isUuid(request.params.id)) return reply.code(400).send({ error: 'Identificador de lote inválido.' });
    const lot = await pool.query<
      DbRow<{
        id: string;
        title: string;
        artwork: Artwork | null;
        status: LotRow['status'];
        audit_count: number | string;
        audit_tip_hash: string | null;
      }>
    >('SELECT id, title, artwork, status, audit_count, audit_tip_hash FROM lots WHERE id=$1', [
      request.params.id
    ]);
    if (!lot.rowCount) return reply.code(404).send({ error: 'Lote não encontrado.' });
    const result = await pool.query<
      DbRow<{
        sequence: number;
        event_type: string;
        payload: Record<string, unknown>;
        previous_hash: string;
        event_hash: string;
        created_at: string | Date;
      }>
    >(
      'SELECT sequence, event_type, payload, previous_hash, event_hash, created_at FROM audit_events WHERE lot_id=$1 ORDER BY sequence ASC',
      [request.params.id]
    );
    const valid = auditMatchesCheckpoint(
      result.rows.map(row => ({
        previousHash: row.previous_hash,
        eventHash: row.event_hash,
        payload: row.payload
      })),
      Number(lot.rows[0].audit_count),
      lot.rows[0].audit_tip_hash ?? 'GENESIS'
    );
    return {
      lotId: request.params.id,
      title: lot.rows[0].title,
      artwork: lot.rows[0].artwork,
      status: lot.rows[0].status,
      auditCount: Number(lot.rows[0].audit_count),
      auditTipHash: lot.rows[0].audit_tip_hash,
      valid,
      events: result.rows.map(row => ({
        sequence: row.sequence,
        type: row.event_type,
        ...row.payload,
        previousHash: row.previous_hash,
        eventHash: row.event_hash,
        createdAt: asDate(row.created_at)
      }))
    };
  });

  app.get<{ Params: { token: string } }>('/receipts/:token', async (request, reply) => {
    const result = await pool.query<
      DbRow<{
        token: string;
        lot_id: string;
        title: string;
        artwork: Artwork | null;
        image_url: string | null;
        opening_bid_cents: string | number | bigint;
        current_bid_cents: string | number | bigint | null;
        current_leader_id: string | null;
        status: LotRow['status'];
        ends_at: string | Date;
        seller_name: string;
        bid_count: number;
      }>
    >(
      'SELECT receipts.token, lots.id AS lot_id, lots.title, lots.artwork, lots.image_url, lots.opening_bid_cents, lots.current_bid_cents, lots.current_leader_id, lots.status, lots.ends_at, users.name AS seller_name, (SELECT count(*)::int FROM bids WHERE bids.lot_id=lots.id) AS bid_count FROM receipts JOIN lots ON lots.id=receipts.lot_id JOIN users ON users.id=lots.seller_id WHERE receipts.token=$1',
      [request.params.token]
    );
    const row = result.rows[0];
    if (!row || row.status !== 'closed' || !row.current_leader_id) {
      return reply.code(404).send({ error: 'Comprovante ainda não disponível.' });
    }
    return {
      token: row.token,
      lotId: row.lot_id,
      title: row.title,
      artwork: row.artwork,
      imageUrl: publicImageUrl(row.image_url),
      openingBid: money(row.opening_bid_cents),
      amount: money(row.current_bid_cents ?? 0),
      winner: pseudonym(row.current_leader_id),
      sellerName: row.seller_name,
      bidCount: Number(row.bid_count ?? 0),
      closedAt: asDate(row.ends_at)
    };
  });
}
