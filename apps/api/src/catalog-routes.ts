import type { FastifyInstance } from 'fastify';
import { searchArtworks } from './artworks.js';
import { errorReply } from './http-utils.js';

export function registerCatalogRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true, service: 'lancearte-api' }));

  app.get<{ Params: { imageId: string } }>('/images/:imageId', async (request, reply) => {
    const { imageId } = request.params;
    if (!/^[a-f0-9-]{36}$/i.test(imageId)) {
      return reply.code(400).send({ error: 'Identificador de imagem inválido.' });
    }
    try {
      const response = await fetch(`https://www.artic.edu/iiif/2/${imageId}/full/1200,/0/default.jpg`, {
        headers: {
          'AIC-User-Agent': process.env.AIC_USER_AGENT ?? 'LanceArte/1.0 (local development)',
          'User-Agent': 'LanceArte/1.0'
        },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) return reply.code(502).send({ error: 'Imagem temporariamente indisponível.' });
      const image = Buffer.from(await response.arrayBuffer());
      return reply
        .type(response.headers.get('content-type') ?? 'image/jpeg')
        .header('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400')
        .send(image);
    } catch {
      return reply.code(502).send({ error: 'Imagem temporariamente indisponível.' });
    }
  });

  app.get<{ Querystring: { q?: string } }>('/items', async (request, reply) => {
    const query = request.query.q?.trim();
    if (!query) return reply.code(400).send({ error: 'Digite o nome de uma obra ou artista.' });
    try {
      return { items: await searchArtworks(query) };
    } catch (error) {
      return errorReply(error, reply);
    }
  });
}
