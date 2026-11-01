import { createHash } from 'node:crypto';

export type BidDecision = { accepted: true; nextEndAt: Date } | { accepted: false; reason: string };

export function evaluateBid(input: {
  status: string;
  startsAt: Date;
  endsAt: Date;
  now: Date;
  openingBidCents: number;
  currentBidCents: number | null;
  minimumIncrementCents: number;
  currentLeaderId: string | null;
  bidderId: string;
  availableCents: number;
  sellerId: string;
  amountCents: number;
}): BidDecision {
  if (input.bidderId === input.sellerId) return { accepted: false, reason: 'O leiloeiro não pode dar lances no próprio lote.' };
  if (input.status !== 'scheduled' && input.status !== 'live') return { accepted: false, reason: 'Este lote não está aceitando lances.' };
  if (input.now < input.startsAt) return { accepted: false, reason: 'O lote ainda não foi iniciado.' };
  if (input.now >= input.endsAt) return { accepted: false, reason: 'O lote já foi encerrado.' };
  if (input.currentLeaderId === input.bidderId) return { accepted: false, reason: 'Você já está liderando este lote.' };
  const minimum = input.currentBidCents === null ? input.openingBidCents : input.currentBidCents + input.minimumIncrementCents;
  if (input.amountCents < minimum) return { accepted: false, reason: `O lance mínimo agora é R$ ${(minimum / 100).toFixed(2)}.` };
  if (input.amountCents > input.availableCents) return { accepted: false, reason: 'Saldo disponível insuficiente.' };
  const remainingMs = input.endsAt.getTime() - input.now.getTime();
  const nextEndAt = remainingMs <= 120_000 ? new Date(input.endsAt.getTime() + 120_000) : input.endsAt;
  return { accepted: true, nextEndAt };
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

export function hashAuditEvent(previousHash: string, payload: unknown): string {
  return createHash('sha256').update(previousHash).update(canonicalJson(payload)).digest('hex');
}

export function auditIsValid(events: Array<{ previousHash: string; eventHash: string; payload: unknown }>): boolean {
  let previousHash = 'GENESIS';
  for (const event of events) {
    if (event.previousHash !== previousHash || hashAuditEvent(previousHash, event.payload) !== event.eventHash) return false;
    previousHash = event.eventHash;
  }
  return true;
}

export function auditMatchesCheckpoint(events: Array<{ previousHash: string; eventHash: string; payload: unknown }>, expectedCount: number, expectedTip: string): boolean {
  return events.length === expectedCount && (events.at(-1)?.eventHash ?? 'GENESIS') === expectedTip && auditIsValid(events);
}

export function pseudonym(userId: string): string {
  return `Licitante ${createHash('sha256').update(userId).digest('hex').slice(0, 5).toUpperCase()}`;
}
