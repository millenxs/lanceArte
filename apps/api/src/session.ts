import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { pool } from './db.js';
import type { DbRow } from './http-utils.js';

export type User = { id: string; name: string; role: 'auctioneer' | 'bidder' };

export const COOKIE = 'lancearte_session';

const rawSessionSecret = process.env.SESSION_SECRET?.trim();
if (!rawSessionSecret || rawSessionSecret.length < 16) {
  throw new Error('A variável de ambiente SESSION_SECRET deve ser configurada com pelo menos 16 caracteres.');
}
const SESSION_SECRET = rawSessionSecret;

function sessionValue(id: string): string {
  const signature = createHmac('sha256', SESSION_SECRET).update(id).digest('hex');
  return `${id}.${signature}`;
}

export function setSessionCookie(reply: FastifyReply, id: string) {
  reply.setCookie(COOKIE, sessionValue(id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7
  });
}

function userIdFromCookie(value?: string): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const id = value.slice(0, dot);
  const received = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(createHmac('sha256', SESSION_SECRET).update(id).digest('hex'));
  return received.length === expected.length && timingSafeEqual(received, expected) ? id : null;
}

export async function currentUser(request: FastifyRequest): Promise<User | null> {
  const id = userIdFromCookie(request.cookies[COOKIE]);
  if (!id) return null;
  const result = await pool.query<DbRow<User>>('SELECT id, name, role FROM users WHERE id=$1', [id]);
  return result.rows[0] ?? null;
}

export async function requireUser(request: FastifyRequest, role?: User['role']): Promise<User> {
  const user = await currentUser(request);
  if (!user) throw Object.assign(new Error('Entre ou crie um perfil para continuar.'), { statusCode: 401 });
  if (role && user.role !== role) throw Object.assign(new Error('Seu perfil não permite esta ação.'), { statusCode: 403 });
  return user;
}
