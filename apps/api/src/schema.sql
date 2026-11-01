CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('auctioneer', 'bidder')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES users(id),
  source_id TEXT NOT NULL,
  artwork JSONB NOT NULL,
  title TEXT NOT NULL,
  image_url TEXT,
  opening_bid_cents BIGINT NOT NULL CHECK (opening_bid_cents > 0),
  increment_cents BIGINT NOT NULL CHECK (increment_cents > 0),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'closed', 'cancelled')),
  current_bid_cents BIGINT,
  current_leader_id UUID REFERENCES users(id),
  audit_count INTEGER NOT NULL DEFAULT 0,
  audit_tip_hash TEXT NOT NULL DEFAULT 'GENESIS',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id UUID NOT NULL REFERENCES lots(id),
  bidder_id UUID NOT NULL REFERENCES users(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bids_lot_created_idx ON bids(lot_id, created_at);
CREATE INDEX IF NOT EXISTS lots_status_ends_idx ON lots(status, ends_at);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  lot_id UUID REFERENCES lots(id),
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'reserve', 'release', 'settlement_debit', 'settlement_credit')),
  available_delta_cents BIGINT NOT NULL,
  committed_delta_cents BIGINT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS receipts (
  token TEXT PRIMARY KEY,
  lot_id UUID NOT NULL UNIQUE REFERENCES lots(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id UUID NOT NULL UNIQUE REFERENCES lots(id),
  winner_id UUID REFERENCES users(id),
  seller_id UUID NOT NULL REFERENCES users(id),
  amount_cents BIGINT NOT NULL DEFAULT 0,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  lot_id UUID NOT NULL REFERENCES lots(id),
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  previous_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lot_id, sequence)
);

CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only';
END;
$$;
DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events;
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
