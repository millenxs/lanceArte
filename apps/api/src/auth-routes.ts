import type { FastifyInstance } from 'fastify';
import { pool } from './db.js';
import { hashPassword, verifyPassword } from './auth.js';
import { createRateLimiter } from './domain.js';
import { DbRow, hasErrorCode } from './http-utils.js';
import { COOKIE, currentUser, setSessionCookie, type User } from './session.js';

const loginRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 10 });
const registerRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 6 });

export function registerAuthRoutes(app: FastifyInstance) {
  app.get('/auth/me', async request => ({ user: await currentUser(request) }));

  app.post<{ Body: { email?: string; password?: string } }>('/auth/login', async (request, reply) => {
    const email = request.body?.email?.trim().toLowerCase();
    const password = request.body?.password;
    const ipKey = `login-ip:${request.ip}`;
    const accountKey = `login-acct:${request.ip}:${email ?? 'anonymous'}`;
    const ipLimit = loginRateLimiter.consume(ipKey);
    const accountLimit = loginRateLimiter.consume(accountKey);
    if (!ipLimit.allowed || !accountLimit.allowed) {
      const retryAfter = Math.max(ipLimit.retryAfterSeconds, accountLimit.retryAfterSeconds);
      return reply
        .header('Retry-After', String(retryAfter))
        .code(429)
        .send({ error: 'Muitas tentativas de login em sequência. Aguarde alguns minutos e tente novamente.' });
    }
    if (!email || !password) return reply.code(400).send({ error: 'Informe seu e-mail e sua senha.' });
    const result = await pool.query<DbRow<User & { password_hash: string }>>(
      'SELECT id, name, role, password_hash FROM users WHERE LOWER(email)=$1 LIMIT 1',
      [email]
    );
    const candidate = result.rows[0];
    if (!candidate || !verifyPassword(password, candidate.password_hash)) {
      return reply.code(401).send({ error: 'E-mail ou senha não conferem.' });
    }
    loginRateLimiter.reset(accountKey);
    setSessionCookie(reply, candidate.id);
    return { user: { id: candidate.id, name: candidate.name, role: candidate.role } };
  });

  app.post<{ Body: { name?: string; email?: string; password?: string; role?: string } }>(
    '/auth/register',
    async (request, reply) => {
      const registerLimit = registerRateLimiter.consume(`register-ip:${request.ip}`);
      if (!registerLimit.allowed) {
        return reply
          .header('Retry-After', String(registerLimit.retryAfterSeconds))
          .code(429)
          .send({ error: 'Muitas tentativas de cadastro em sequência. Aguarde alguns minutos e tente novamente.' });
      }
      const name = request.body?.name?.trim();
      const email = request.body?.email?.trim().toLowerCase();
      const password = request.body?.password;
      const role = request.body?.role;
      if (!name || name.length < 2 || name.length > 80) {
        return reply.code(400).send({ error: 'Informe um nome entre 2 e 80 caracteres.' });
      }
      if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return reply.code(400).send({ error: 'Informe um e-mail válido.' });
      }
      if (!password || password.length < 10 || password.length > 128) {
        return reply.code(400).send({ error: 'A senha deve ter entre 10 e 128 caracteres.' });
      }
      if (role !== 'bidder' && role !== 'auctioneer') {
        return reply.code(400).send({ error: 'Escolha como deseja participar do acervo.' });
      }
      try {
        const result = await pool.query<DbRow<User>>(
          'INSERT INTO users(name, role, email, password_hash) VALUES($1,$2,$3,$4) RETURNING id,name,role',
          [name, role, email, hashPassword(password)]
        );
        setSessionCookie(reply, result.rows[0].id);
        return reply.code(201).send({ user: result.rows[0] });
      } catch (error) {
        if (hasErrorCode(error, '23505')) {
          return reply
            .code(409)
            .send({ error: 'Este e-mail já tem um perfil. Entre com sua senha ou use outro e-mail.' });
        }
        throw error;
      }
    }
  );

  app.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie(COOKIE, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    });
    return { ok: true };
  });
}
