const { test, expect } = require('@playwright/test');
const { brl, normalized } = require('./helpers');

test('TC-P1-003: sala ao vivo apresenta apenas os lances recebidos e funciona em celular', async ({ page }) => {
  const now = Date.now();
  const lot = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    title: 'Lote de teste controlado',
    artwork: { id: 'test-work', title: 'Obra de teste', artist: 'Artista de teste', date: '2026' },
    openingBid: 700,
    increment: 50,
    startsAt: new Date(now - 60_000).toISOString(),
    endsAt: new Date(now + 60 * 60_000).toISOString(),
    status: 'live',
    currentBid: 800,
    leader: 'Licitante QA001',
    sellerName: 'Leiloeiro de teste',
    bidCount: 2,
    auditCount: 2,
    receiptToken: null
  };
  const bids = [
    { bidder: 'Licitante QA001', amount: 800, createdAt: new Date(now - 10_000).toISOString() },
    { bidder: 'Licitante QA002', amount: 750, createdAt: new Date(now - 20_000).toISOString() }
  ];

  await page.route(`**/api/lots/${lot.id}`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lot) }),
  );
  await page.route(`**/api/lots/${lot.id}/bids`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bids) }),
  );
  await page.route('**/socket.io/**', route => route.abort());

  await page.goto(`/lots/${encodeURIComponent(lot.id)}`);
  await expect(page.getByText(new RegExp(`Atualização automática \\(${bids.length}\\)`))).toBeVisible();
  const latestBidBanner = page.locator('.live-incoming-banner small');
  await expect(latestBidBanner).toContainText(`Lance mais recente registrado: ${bids[0].bidder}`);
  await expect(latestBidBanner).toContainText(brl(bids[0].amount));
  const initialBanner = normalized(await latestBidBanner.innerText());
  await page.waitForTimeout(3600);
  expect(normalized(await latestBidBanner.innerText())).toBe(initialBanner);
  const body = normalized(await page.locator('body').innerText());
  expect(body).toContain(lot.leader);
  expect(body).toContain(normalized(brl(lot.currentBid)));
  expect(bids[0].bidder).toBe(lot.leader);
  expect(bids[0].amount).toBe(lot.currentBid);
  expect(await page.locator('.bid-row').count()).toBe(Math.min(bids.length, 8));
  for (let index = 0; index < Math.min(bids.length, 8); index++) {
    const row = normalized(await page.locator('.bid-row').nth(index).innerText());
    expect(row).toContain(bids[index].bidder);
    expect(row).toContain(normalized(brl(bids[index].amount)));
  }

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const menuButton = page.getByRole('button', { name: 'Abrir menu de navegação' });
  await expect(menuButton).toBeVisible();
  await menuButton.click();
  await expect(
    page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Explorar Lotes' }),
  ).toBeVisible();
});
