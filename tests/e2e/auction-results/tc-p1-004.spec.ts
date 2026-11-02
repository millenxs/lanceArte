const { test, expect } = require('@playwright/test');
const { normalized } = require('./helpers');

test('TC-P1-004: lote ao vivo vazio mostra espera sem gravar dados na produção', async ({ page }) => {
  const lotId = 'qa-mock-live-empty';
  const now = Date.now();
  const mockLot = {
    id: lotId,
    title: 'Fixture QA sem lances',
    imageUrl: null,
    artwork: { id: 'fixture', title: 'Fixture QA sem lances', artist: 'Fixture', date: '2026' },
    openingBid: 100,
    increment: 10,
    startsAt: new Date(now - 60_000).toISOString(),
    endsAt: new Date(now + 3_600_000).toISOString(),
    status: 'live',
    currentBid: null,
    leader: null,
    sellerName: 'Fixture QA',
    receiptToken: null,
    bidCount: 0,
    auditCount: 0,
    isCurrentUserLeader: false,
  };
  const remoteWrites = [];
  page.on('request', request => {
    if (request.method() !== 'GET' && request.url().includes('/api/')) {
      remoteWrites.push(request.method());
    }
  });

  await page.route(`**/api/lots/${lotId}`, route => route.fulfill({ json: mockLot }));
  await page.route(`**/api/lots/${lotId}/bids`, route => route.fulfill({ json: [] }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.route('**/socket.io/**', route => route.abort());
  await page.goto(`/lots/${lotId}`);

  await expect(page.getByText('Aguardando o primeiro lance neste pregão ao vivo.', { exact: true })).toBeVisible();
  await expect(page.getByText('Tempo real (0)', { exact: true })).toBeVisible();
  const body = normalized(await page.locator('body').innerText());
  expect(body).not.toContain('Seja o primeiro a participar!');
  expect(body).not.toContain('ARREMATADO POR');
  expect(remoteWrites).toEqual([]);
});
