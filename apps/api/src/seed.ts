import { pool, withTransaction } from './db.js';
import { hashAuditEvent, pseudonym } from './domain.js';

const users = [
  { name: 'Helena Ribeiro', role: 'auctioneer' },
  { name: 'Marcos Lima', role: 'bidder' },
  { name: 'Camila Souza', role: 'bidder' }
] as const;

try {
  const existing = await pool.query('SELECT id FROM lots WHERE source_id = $1', ['27992']);
  if (existing.rowCount) {
    console.log('Lote de demonstração já existe.');
    process.exitCode = 0;
  } else {
    await withTransaction(async client => {
      const ids: string[] = [];
      for (const user of users) {
        const result = await client.query('INSERT INTO users(name, role) VALUES($1, $2) RETURNING id', [user.name, user.role]);
        ids.push(result.rows[0].id);
      }
      const [sellerId, firstBidderId, secondBidderId] = ids;
      await client.query("INSERT INTO wallet_transactions(user_id, kind, available_delta_cents, committed_delta_cents, note) VALUES ($1,'deposit',500000,0,'Saldo inicial de demonstração'), ($2,'deposit',500000,0,'Saldo inicial de demonstração'), ($3,'deposit',500000,0,'Saldo inicial de demonstração')", ids);
      const now = new Date();
      const startsAt = new Date(now.getTime() - 60_000);
      const endsAt = new Date(now.getTime() + 45 * 60_000);
      const artwork = { id: 27992, title: 'A Sunday on La Grande Jatte — 1884', artist: 'Georges Seurat', date: '1884–86', publicDomain: true, source: 'Art Institute of Chicago' };
      const lotResult = await client.query("INSERT INTO lots(seller_id, source_id, artwork, title, image_url, opening_bid_cents, increment_cents, starts_at, ends_at, status) VALUES($1,'27992',$2,$3,$4,50000,5000,$5,$6,'live') RETURNING id", [sellerId, artwork, artwork.title, 'https://www.artic.edu/iiif/2/2d484387-2509-5e8e-2c43-22f9981972eb/full/843,/0/default.jpg', startsAt, endsAt]);
      const lotId = lotResult.rows[0].id;
      const bidAt = new Date(now.getTime() - 10_000);
      await client.query('INSERT INTO bids(lot_id, bidder_id, amount_cents, created_at) VALUES($1,$2,50000,$3)', [lotId, firstBidderId, bidAt]);
      await client.query("INSERT INTO wallet_transactions(user_id, lot_id, kind, available_delta_cents, committed_delta_cents, note) VALUES($1,$2,'reserve',-50000,50000,'Lance líder de demonstração')", [firstBidderId, lotId]);
      await client.query('UPDATE lots SET current_bid_cents=50000, current_leader_id=$1 WHERE id=$2', [firstBidderId, lotId]);
      const payload = { type: 'bid_placed', amountCents: 50000, bidder: pseudonym(firstBidderId), createdAt: bidAt.toISOString() };
      const eventHash = hashAuditEvent('GENESIS', payload);
      await client.query('INSERT INTO audit_events(lot_id, sequence, event_type, payload, previous_hash, event_hash, created_at) VALUES($1,1,$2,$3,$4,$5,$6)', [lotId, 'bid_placed', payload, 'GENESIS', eventHash, bidAt]);
      await client.query('UPDATE lots SET audit_count=1, audit_tip_hash=$1 WHERE id=$2', [eventHash, lotId]);
    });
    console.log('Demonstração criada: leiloeira Helena Ribeiro e licitantes Marcos Lima e Camila Souza.');
  }
} finally {
  await pool.end();
}
