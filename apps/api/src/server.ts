import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { Server as SocketServer } from 'socket.io';
import { pool } from './db.js';
import { isUuid } from './domain.js';
import { registerAuditRoutes } from './audit-routes.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerCatalogRoutes } from './catalog-routes.js';
import { registerLotRoutes } from './lot-routes.js';
import { refreshLots } from './lot-service.js';
import { registerWalletRoutes } from './wallet-routes.js';

const app = Fastify({ logger: true, trustProxy: true });
const httpServer = app.server;
const allowedOrigins = process.env.WEB_ORIGIN?.split(',') ?? ['http://localhost:3000'];
const socket = new SocketServer(httpServer, {
  cors: { origin: allowedOrigins, credentials: true }
});
const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);

await app.register(cors, { origin: allowedOrigins, credentials: true });
await app.register(cookie);

app.addHook('onSend', async (_request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
  if (process.env.NODE_ENV === 'production') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return payload;
});

registerAuthRoutes(app);
registerCatalogRoutes(app);
registerLotRoutes(app, socket);
registerWalletRoutes(app);
registerAuditRoutes(app);

socket.on('connection', client => {
  client.on('lot:join', (lotId: unknown) => {
    if (typeof lotId === 'string' && isUuid(lotId)) client.join(`lot:${lotId}`);
  });
});

setInterval(() => {
  refreshLots(socket).catch(error => app.log.error(error));
}, 1000).unref();

const shutdown = async () => {
  await app.close();
  socket.close();
  await pool.end();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.ready();
httpServer.listen(PORT, '0.0.0.0', () => app.log.info(`LanceArte API ouvindo na porta ${PORT}`));
