const { test, expect } = require('@playwright/test');
const { brl, chooseLot, normalized } = require('./helpers');

test('TC-P1-003: sala ao vivo apresenta apenas os lances persistidos', async ({ page, request }) => {
  const fixture = await chooseLot(
    request,
    lot => lot.status === 'live',
    (_lot, bids) => bids.length > 0,
  );
  expect(fixture, 'É necessário manter um lote público ao vivo com lances para este E2E.').toBeTruthy();
  const { lot, bids } = fixture;

  await page.goto(`/lots/${encodeURIComponent(lot.id)}`);
  await expect(page.getByText(new RegExp(`Tempo real \\(${bids.length}\\)`))).toBeVisible();
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
});
