import type { FastifyReply } from 'fastify';
import type { QueryResultRow } from 'pg';

export type DbRow<T> = T & QueryResultRow;

export const money = (cents: string | number | bigint) => Number(cents) / 100;

export function centsFromMoney(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isSafeInteger(Math.round(parsed * 100))) {
    throw new Error('Informe um valor maior que zero.');
  }
  return Math.round(parsed * 100);
}

export const asDate = (value: string | Date) => value instanceof Date ? value : new Date(value);

export function errorReply(error: unknown, reply: FastifyReply) {
  const statusCode =
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
      ? error.statusCode
      : 400;
  const message = error instanceof Error ? error.message : 'Não foi possível concluir a solicitação.';
  return reply.code(statusCode).send({ error: message });
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
