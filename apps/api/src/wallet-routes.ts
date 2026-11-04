import type { FastifyInstance } from 'fastify';
import { pool, withTransaction } from './db.js';
import { asDate, centsFromMoney, DbRow, errorReply, money } from './http-utils.js';
import { publicImageUrl } from './lot-service.js';
import { requireUser } from './session.js';

export function registerWalletRoutes(app: FastifyInstance) {
  app.get('/wallet/me', async (request, reply) => {
    try {
      const user = await requireUser(request, 'bidder');
      const [result, txResult] = await Promise.all([
        pool.query<DbRow<{ available: string | number | bigint; committed: string | number | bigint }>>(
          'SELECT COALESCE(sum(available_delta_cents),0)::bigint AS available, COALESCE(sum(committed_delta_cents),0)::bigint AS committed FROM wallet_transactions WHERE user_id=$1',
          [user.id]
        ),
        pool.query<
          DbRow<{
            id: string;
            lot_id: string | null;
            kind: 'deposit' | 'reserve' | 'release' | 'settlement_debit' | 'settlement_credit';
            available_delta_cents: string | number | bigint;
            committed_delta_cents: string | number | bigint;
            note: string;
            created_at: string | Date;
            lot_title: string | null;
          }>
        >(
          'SELECT wallet_transactions.id, wallet_transactions.lot_id, wallet_transactions.kind, wallet_transactions.available_delta_cents, wallet_transactions.committed_delta_cents, wallet_transactions.note, wallet_transactions.created_at, lots.title AS lot_title FROM wallet_transactions LEFT JOIN lots ON lots.id=wallet_transactions.lot_id WHERE wallet_transactions.user_id=$1 ORDER BY wallet_transactions.created_at DESC LIMIT 20',
          [user.id]
        )
      ]);
      return {
        user: { id: user.id, name: user.name },
        available: money(result.rows[0].available),
        committed: money(result.rows[0].committed),
        total: money(BigInt(result.rows[0].available) + BigInt(result.rows[0].committed)),
        transactions: txResult.rows.map(row => ({
          id: row.id,
          lotId: row.lot_id,
          lotTitle: row.lot_title,
          kind: row.kind,
          availableDelta: money(row.available_delta_cents),
          committedDelta: money(row.committed_delta_cents),
          note: row.note,
          createdAt: asDate(row.created_at)
        }))
      };
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post<{ Body: { amount?: number } }>('/wallet/deposits', async (request, reply) => {
    try {
      const user = await requireUser(request, 'bidder');
      const amountCents = centsFromMoney(request.body?.amount);
      if (amountCents > 1_000_000) {
        throw new Error('O depósito de demonstração é limitado a R$ 10.000,00 por operação.');
      }
      await withTransaction(async client => {
        await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
        await client.query(
          "INSERT INTO wallet_transactions(user_id, kind, available_delta_cents, committed_delta_cents, note) VALUES($1,'deposit',$2,0,'Depósito simulado')",
          [user.id, amountCents]
        );
      });
      return reply.code(201).send({ ok: true, deposited: money(amountCents) });
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.get('/wallet/wins', async (request, reply) => {
    try {
      const user = await requireUser(request, 'bidder');
      const result = await pool.query<
        DbRow<{
          id: string;
          title: string;
          image_url: string | null;
          current_bid_cents: string | number | bigint | null;
          ends_at: string | Date;
          token: string;
        }>
      >(
        "SELECT lots.id, lots.title, lots.image_url, lots.current_bid_cents, lots.ends_at, receipts.token FROM lots JOIN receipts ON receipts.lot_id=lots.id WHERE lots.current_leader_id=$1 AND lots.status='closed' ORDER BY lots.ends_at DESC",
        [user.id]
      );
      return result.rows.map(row => ({
        id: row.id,
        title: row.title,
        imageUrl: publicImageUrl(row.image_url),
        amount: money(row.current_bid_cents ?? 0),
        closedAt: asDate(row.ends_at),
        receiptToken: row.token
      }));
    } catch (error) {
      return errorReply(error, reply);
    }
  });
}
