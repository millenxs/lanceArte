const { test, expect } = require('@playwright/test');

test('TC-P1-005: cancelamento de lote sem lances envia POST sem corpo JSON', async ({ page }) => {
  const lotId = '123e4567-e89b-42d3-a456-426614174001';
  const lot = {
    id: lotId,
    title: 'Lote agendado de teste',
    imageUrl: null,
    artwork: { id: 'test-work', title: 'Obra de teste', artist: 'Artista de teste' },
    openingBid: 700,
    increment: 50,
    startsAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    endsAt: new Date(Date.now() + 70 * 60_000).toISOString(),
    status: 'scheduled',
    currentBid: null,
    leader: null,
    sellerId: '123e4567-e89b-42d3-a456-426614174002',
    sellerName: 'Leiloeiro de teste',
    bidCount: 0,
    auditCount: 0,
    receiptToken: null
  };
  let cancelled = false;
  let cancelRequest;

  await page.route('**/api/auth/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { id: lot.sellerId, name: lot.sellerName, role: 'auctioneer' } })
    }),
  );
  await page.route('**/api/auctioneer/lots', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cancelled ? [] : [lot]) }),
  );
  await page.route(`**/api/lots/${lotId}/cancel`, async route => {
    cancelRequest = {
      method: route.request().method(),
      contentType: route.request().headers()['content-type'] ?? null,
      body: route.request().postData()
    };
    cancelled = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/console');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByText('Lote cancelado.', { exact: true })).toBeVisible();
  await expect(page.getByText('Nenhum lote encontrado neste filtro.')).toBeVisible();
  expect(cancelRequest).toEqual({ method: 'POST', contentType: null, body: null });
});
