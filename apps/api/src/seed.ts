import { pool, withTransaction } from './db.js';
import { hashAuditEvent } from './domain.js';
import { hashPassword } from './auth.js';

type DemoArtwork = {
  key: string;
  id: string;
  title: string;
  artist: string;
  date: string;
  publicDomain: boolean;
  imageUrl: string | null;
  sourceUrl: string;
  startOffsetHours: number;
  durationHours: number;
  openingCents: number;
  incrementCents: number;
};

const artworks: DemoArtwork[] = [
  { key: 'van-gogh-bedroom', id: '28560', title: 'The Bedroom', artist: 'Vincent van Gogh', date: '1889', publicDomain: true, imageUrl: '/api/images/6644829f-f292-c5c4-a73c-0356a6fdbf0d', sourceUrl: 'https://www.artic.edu/artworks/28560', startOffsetHours: -1, durationHours: 2, openingCents: 70000, incrementCents: 5000 },
  { key: 'dali-monsters', id: '151424', title: 'Inventions of the Monsters', artist: 'Salvador Dalí', date: '1937', publicDomain: false, imageUrl: '/api/images/be9551d4-860f-37a0-1408-086617f1824e', sourceUrl: 'https://www.artic.edu/artworks/151424', startOffsetHours: 24, durationHours: 48, openingCents: 90000, incrementCents: 10000 },
  { key: 'dali-venus', id: '185184', title: 'Venus de Milo with Drawers', artist: 'Salvador Dalí', date: '1936', publicDomain: false, imageUrl: '/api/images/678c7a7a-b8c7-2857-7b97-f3c3501b8b1c', sourceUrl: 'https://www.artic.edu/artworks/185184', startOffsetHours: -96, durationHours: 24, openingCents: 65000, incrementCents: 5000 },
  { key: 'portinari-cafe', id: 'portinari-16371', title: 'Café', artist: 'Candido Portinari', date: '1935', publicDomain: false, imageUrl: 'https://acervo-portinari.s3.sa-east-1.amazonaws.com/f5ca02363ab4193d5feccce408eb5220.jpeg', sourceUrl: 'https://www.portinari.org.br/acervo/obras/16371/cafe', startOffsetHours: 48, durationHours: 72, openingCents: 80000, incrementCents: 5000 },
  { key: 'magritte-pipe', id: 'lacma-78-7', title: 'A Traição das Imagens (Isto não é um cachimbo)', artist: 'René Magritte', date: '1929', publicDomain: false, imageUrl: 'https://collections-images.lacma.org/images/31931/31931-1-primary.webp', sourceUrl: 'https://collections.lacma.org/node/239578', startOffsetHours: -0.5, durationHours: 1.5, openingCents: 120000, incrementCents: 10000 },
  { key: 'magritte-time-transfixed', id: '34181', title: 'La durée poignardée (Time Transfixed)', artist: 'René Magritte', date: '1938', publicDomain: false, imageUrl: '/api/images/91e4c46b-9ef3-ca78-148c-86845e457d88', sourceUrl: 'https://www.artic.edu/artworks/34181', startOffsetHours: -120, durationHours: 24, openingCents: 55000, incrementCents: 5000 }
];

const demoUsers = [
  { name: 'Helena Ribeiro', role: 'auctioneer', email: 'leiloeira@lancearte.test', password: 'Atelie#2026' },
  { name: 'Marcos Lima', role: 'bidder', email: 'colecionador@lancearte.test', password: 'Galeria#2026' },
  { name: 'Camila Souza', role: 'bidder', email: 'segundo.licitante@lancearte.test', password: 'Segundo#2026' }
] as const;

try {
  await withTransaction(async client => {
    const users: { id: string }[] = [];
    for (const demo of demoUsers) {
      const found = await client.query('SELECT id FROM users WHERE name=$1 AND role=$2 ORDER BY created_at LIMIT 1', [demo.name, demo.role]);
      const id = found.rows[0]?.id ?? (await client.query('INSERT INTO users(name, role) VALUES($1,$2) RETURNING id', [demo.name, demo.role])).rows[0].id;
      await client.query('UPDATE users SET email=$1,password_hash=$2 WHERE id=$3', [demo.email, hashPassword(demo.password), id]);
      users.push({ id });
      const wallet = await client.query('SELECT 1 FROM wallet_transactions WHERE user_id=$1 LIMIT 1', [id]);
      if (!wallet.rowCount) await client.query("INSERT INTO wallet_transactions(user_id, kind, available_delta_cents, committed_delta_cents, note) VALUES($1,'deposit',500000,0,'Saldo inicial de demonstração')", [id]);
    }
    const sellerId = users[0].id;
    for (const item of artworks) {
      const seedKey = `demo:${item.key}`;
      const exists = await client.query("SELECT id FROM lots WHERE artwork->>'seedKey'=$1 LIMIT 1", [seedKey]);
      if (exists.rowCount) {
        await client.query("UPDATE lots SET image_url=$1, artwork=jsonb_set(jsonb_set(artwork, '{imageUrl}', COALESCE(to_jsonb($1::text), 'null'::jsonb), true), '{publicDomain}', to_jsonb($3::boolean), true) WHERE id=$2", [item.imageUrl, exists.rows[0].id, item.publicDomain]);
        continue;
      }
      const now = Date.now();
      const startsAt = new Date(now + item.startOffsetHours * 60 * 60 * 1000);
      const endsAt = new Date(now + (item.startOffsetHours + item.durationHours) * 60 * 60 * 1000);
      const status = startsAt > new Date(now) ? 'scheduled' : endsAt <= new Date(now) ? 'closed' : 'live';
      const artwork = { id: item.id, title: item.title, artist: item.artist, date: item.date, publicDomain: item.publicDomain, source: item.sourceUrl.includes('artic.edu') ? 'Art Institute of Chicago' : item.key === 'portinari-cafe' ? 'Projeto Portinari' : 'Los Angeles County Museum of Art', sourceUrl: item.sourceUrl, imageUrl: item.imageUrl, seedKey };
      const lot = await client.query(
        'INSERT INTO lots(seller_id, source_id, artwork, title, image_url, opening_bid_cents, increment_cents, starts_at, ends_at, status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
        [sellerId, seedKey, artwork, item.title, item.imageUrl, item.openingCents, item.incrementCents, startsAt, endsAt, status]
      );
      if (status === 'closed') {
        const lotId = lot.rows[0].id;
        const payload = { type: 'lot_closed', lotId, winningBidCents: null, winner: null, closedAt: endsAt.toISOString() };
        const eventHash = hashAuditEvent('GENESIS', payload);
        await client.query('INSERT INTO settlements(lot_id, winner_id, seller_id, amount_cents, settled_at) VALUES($1,NULL,$2,0,$3) ON CONFLICT(lot_id) DO NOTHING', [lotId, sellerId, endsAt]);
        await client.query('INSERT INTO audit_events(lot_id, sequence, event_type, payload, previous_hash, event_hash, created_at) VALUES($1,1,$2,$3,$4,$5,$6)', [lotId, 'lot_closed', payload, 'GENESIS', eventHash, endsAt]);
        await client.query('UPDATE lots SET audit_count=1, audit_tip_hash=$1 WHERE id=$2', [eventHash, lotId]);
      }
    }
  });
  console.log(`Catálogo de demonstração garantido: ${artworks.length} obras; lotes ao vivo, agendados e encerrados. Acessos de teste prontos para leiloeira e licitantes.`);
} finally {
  await pool.end();
}
