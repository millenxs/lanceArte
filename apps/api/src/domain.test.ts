import test from 'node:test';
import assert from 'node:assert/strict';
import { auditIsValid, auditMatchesCheckpoint, evaluateBid, hashAuditEvent } from './domain.js';

const base = {
  status: 'live', startsAt: new Date('2026-01-01T10:00:00Z'), endsAt: new Date('2026-01-01T11:00:00Z'),
  now: new Date('2026-01-01T10:30:00Z'), openingBidCents: 5000, currentBidCents: null,
  minimumIncrementCents: 500, currentLeaderId: null, bidderId: 'bidder-1', availableCents: 10000,
  sellerId: 'seller', amountCents: 5000
};

test('accepts a valid opening bid and reserves the correct minimum', () => {
  assert.equal(evaluateBid(base).accepted, true);
});

test('rejects a bid below the opening price or increment', () => {
  assert.deepEqual(evaluateBid({ ...base, amountCents: 4999 }), { accepted: false, reason: 'O lance mínimo agora é R$ 50.00.' });
});

test('rejects self-leading, seller bids, insufficient balance, and a closed lot', () => {
  assert.equal(evaluateBid({ ...base, currentLeaderId: 'bidder-1', currentBidCents: 5000, amountCents: 5500 }).accepted, false);
  assert.equal(evaluateBid({ ...base, bidderId: 'seller' }).accepted, false);
  assert.equal(evaluateBid({ ...base, amountCents: 5000, availableCents: 100 }).accepted, false);
  assert.equal(evaluateBid({ ...base, now: new Date('2026-01-01T11:00:00Z') }).accepted, false);
});

test('extends a lot by two minutes for a late bid', () => {
  const result = evaluateBid({ ...base, endsAt: new Date('2026-01-01T10:31:00Z') });
  assert.equal(result.accepted && result.nextEndAt.toISOString(), '2026-01-01T10:33:00.000Z');
});

test('audit chain detects modified, removed, or inserted events', () => {
  const first = { type: 'bid', amountCents: 5000 };
  const firstHash = hashAuditEvent('GENESIS', first);
  const second = { type: 'bid', amountCents: 10000 };
  const secondHash = hashAuditEvent(firstHash, second);
  assert.equal(auditIsValid([{ previousHash: 'GENESIS', eventHash: firstHash, payload: first }, { previousHash: firstHash, eventHash: secondHash, payload: second }]), true);
  assert.equal(auditIsValid([{ previousHash: 'GENESIS', eventHash: firstHash, payload: { ...first, amountCents: 6000 } }, { previousHash: firstHash, eventHash: secondHash, payload: second }]), false);
  assert.equal(auditIsValid([{ previousHash: firstHash, eventHash: secondHash, payload: second }]), false);
  const fullChain = [{ previousHash: 'GENESIS', eventHash: firstHash, payload: first }, { previousHash: firstHash, eventHash: secondHash, payload: second }];
  assert.equal(auditMatchesCheckpoint(fullChain, 2, secondHash), true);
  assert.equal(auditMatchesCheckpoint(fullChain.slice(1), 2, secondHash), false);
  assert.equal(auditMatchesCheckpoint([...fullChain, { previousHash: secondHash, eventHash: 'inserted', payload: { type: 'inserted' } }], 2, secondHash), false);
});
