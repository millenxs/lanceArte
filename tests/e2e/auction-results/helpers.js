const origin = process.env.QA_WEB_BASE_URL || 'https://lancearte.vercel.app';

async function getJson(request, path) {
  const response = await request.get(new URL(path, origin).toString());
  if (!response.ok()) throw new Error(`${path} deve responder com sucesso; status ${response.status()}`);
  return response.json();
}

async function getBids(request, lotId) {
  return getJson(request, `/api/lots/${encodeURIComponent(lotId)}/bids`);
}

async function chooseLot(request, lotPredicate, bidsPredicate) {
  const lots = await getJson(request, '/api/lots');
  for (const lot of lots) {
    if (!lotPredicate(lot)) continue;
    const bids = await getBids(request, lot.id);
    if (await bidsPredicate(lot, bids)) return { lot, bids };
  }
  return null;
}

function brl(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(value)
    .replace(/\u00a0/g, ' ');
}

function normalized(text) {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = { brl, chooseLot, getJson, getBids, normalized };
