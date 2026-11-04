export type Artwork = {
  id: string;
  title: string;
  artist: string;
  date: string;
  publicDomain: boolean;
  imageUrl: string | null;
  source: string;
  sourceUrl: string;
};

type AicArtwork = {
  id: string | number;
  title?: string | null;
  artist_title?: string | null;
  date_display?: string | null;
  is_public_domain?: boolean;
  image_id?: string | null;
};

type PortinariItem = {
  id: string | number;
  name?: string;
  image?: {
    versions?: {
      screen?: { url?: string };
      mid?: { url?: string };
    };
  };
};

class CatalogError extends Error {
  readonly statusCode = 502;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function fetchCatalogJson(url: string | URL, source: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new CatalogError(`O catálogo do ${source} não respondeu. Tente novamente mais tarde.`);
  }
  if (!response.ok) {
    throw new CatalogError(`O catálogo do ${source} está temporariamente indisponível.`);
  }
  try {
    const payload: unknown = await response.json();
    return payload;
  } catch {
    throw new CatalogError(`O catálogo do ${source} retornou uma resposta inválida.`);
  }
}

function asAicArtwork(value: unknown): AicArtwork {
  if (!isRecord(value) || (typeof value.id !== 'string' && typeof value.id !== 'number')) {
    throw new CatalogError('A resposta do Art Institute of Chicago não contém uma obra válida.');
  }
  return {
    id: value.id,
    title: typeof value.title === 'string' || value.title === null ? value.title : undefined,
    artist_title:
      typeof value.artist_title === 'string' || value.artist_title === null
        ? value.artist_title
        : undefined,
    date_display:
      typeof value.date_display === 'string' || value.date_display === null
        ? value.date_display
        : undefined,
    is_public_domain: value.is_public_domain === true,
    image_id:
      typeof value.image_id === 'string' || value.image_id === null ? value.image_id : undefined
  };
}

function imageVersion(value: unknown): { url?: string } | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.url === 'string' ? { url: value.url } : undefined;
}

function asPortinariItem(value: unknown): PortinariItem {
  if (!isRecord(value) || (typeof value.id !== 'string' && typeof value.id !== 'number')) {
    throw new CatalogError('A resposta do Projeto Portinari contém uma obra inválida.');
  }
  const image = isRecord(value.image) ? value.image : null;
  const versions = image && isRecord(image.versions) ? image.versions : null;
  return {
    id: value.id,
    name: typeof value.name === 'string' ? value.name : undefined,
    image: versions
      ? {
          versions: {
            screen: imageVersion(versions.screen),
            mid: imageVersion(versions.mid)
          }
        }
      : undefined
  };
}

function asPortinariItems(value: unknown): PortinariItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new CatalogError('A resposta do Projeto Portinari não contém uma lista de obras válida.');
  }
  const items: unknown[] = value.items;
  return items.map(asPortinariItem);
}

function itemFromAic(value: unknown): Artwork {
  const row = isRecord(value) && 'data' in value ? asAicArtwork(value.data) : asAicArtwork(value);
  return {
    id: `aic-${row.id}`,
    title: row.title || 'Obra sem título',
    artist: row.artist_title || 'Autoria desconhecida',
    date: row.date_display || 'Data não informada',
    publicDomain: row.is_public_domain === true,
    imageUrl: row.image_id ? `/api/images/${row.image_id}` : null,
    source: 'Art Institute of Chicago',
    sourceUrl: `https://www.artic.edu/artworks/${row.id}`
  };
}

function itemFromPortinari(item: PortinariItem): Artwork {
  const title = (item.name || 'Obra sem título').replace(/^[A-Z]+-\d+\s*-\s*/, '');
  return {
    id: `portinari-${item.id}`,
    title,
    artist: 'Candido Portinari',
    date: 'Data não informada',
    publicDomain: false,
    imageUrl: item.image?.versions?.screen?.url ?? item.image?.versions?.mid?.url ?? null,
    source: 'Projeto Portinari',
    sourceUrl: `https://www.portinari.org.br/acervo/obras/${item.id}`
  };
}

function portinariQuery(search: string): string {
  const query = {
    search: [],
    filters: [
      { type: 'index', values: [search], mode: 'cs', operator: 'or' },
      { type: 'schema', values: ['VisualArtwork', 'CreativeWork'], operator: 'or' },
      { type: 'status', values: [100], operator: 'or' }
    ],
    sorting: { ordering: '_relevance', orderingDirection: 'desc' },
    pagination: { page: 1, pageSize: 12 }
  };
  return Buffer.from(encodeURIComponent(JSON.stringify(query))).toString('base64');
}

async function searchAic(query: string): Promise<Artwork[]> {
  const url = new URL('https://api.artic.edu/api/v1/artworks/search');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '12');
  url.searchParams.set('fields', 'id,title,artist_title,date_display,is_public_domain,image_id');
  const payload = await fetchCatalogJson(url, 'Art Institute of Chicago', {
    headers: { 'AIC-User-Agent': process.env.AIC_USER_AGENT ?? 'LanceArte/1.0 (local development)' },
    signal: AbortSignal.timeout(8000)
  });
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new CatalogError('A resposta do Art Institute of Chicago não contém resultados válidos.');
  }
  return payload.data.map((item: unknown) => itemFromAic(item));
}

async function searchPortinari(query: string): Promise<Artwork[]> {
  const url = new URL('https://www.portinari.org.br/api/1.0/collection/itemList');
  url.searchParams.set('query', portinariQuery(query));
  for (const field of ['_id', '_code', '_name', '_schema', '_image', '_status']) {
    url.searchParams.append('fields', field);
  }
  return asPortinariItems(
    await fetchCatalogJson(url, 'Projeto Portinari', { signal: AbortSignal.timeout(8000) })
  ).map(itemFromPortinari);
}

export async function searchArtworks(query: string): Promise<Artwork[]> {
  const [aic, portinari] = await Promise.all([searchAic(query), searchPortinari(query)]);
  return [...aic, ...portinari];
}

export async function getArtwork(sourceId: string): Promise<Artwork> {
  if (sourceId.startsWith('portinari-')) {
    const id = Number(sourceId.slice('portinari-'.length));
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Identificador de obra inválido.');
    return itemFromPortinari(
      asPortinariItem(
        await fetchCatalogJson(
          `https://www.portinari.org.br/api/1.0/collection/item/${id}`,
          'Projeto Portinari',
          { signal: AbortSignal.timeout(8000) }
        )
      )
    );
  }

  const id = sourceId.startsWith('aic-') ? sourceId.slice('aic-'.length) : sourceId;
  if (!/^\d+$/.test(id)) throw new Error('Identificador de obra inválido.');
  return itemFromAic(
    await fetchCatalogJson(
      `https://api.artic.edu/api/v1/artworks/${encodeURIComponent(id)}?fields=id,title,artist_title,date_display,is_public_domain,image_id`,
      'Art Institute of Chicago',
      {
        headers: {
          'AIC-User-Agent': process.env.AIC_USER_AGENT ?? 'LanceArte/1.0 (local development)'
        },
        signal: AbortSignal.timeout(8000)
      }
    )
  );
}
