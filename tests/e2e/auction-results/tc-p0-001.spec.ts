const { test, expect } = require('@playwright/test');
const { brl, chooseLot, getJson, normalized } = require('./helpers');

test('TC-P0-001: resultado fechado, comprovante e auditoria coincidem com registros públicos', async ({ page, request }) => {
  const fixture = await chooseLot(
    request,
    lot => lot.status === 'closed' && lot.currentBid !== null && Boolean(lot.leader) && Boolean(lot.receiptToken),
    (_lot, bids) => bids.length > 0,
  );
  expect(fixture, 'É necessário manter um lote público encerrado com vencedor e comprovante para este E2E.').toBeTruthy();
  const { lot, bids } = fixture;
  const winnerBid = bids[0];

  await page.goto(`/lots/${encodeURIComponent(lot.id)}`);
  await expect(page.getByText(/ARREMATADO POR/i)).toBeVisible();
  let body = normalized(await page.locator('body').innerText());
  expect(body).toContain(normalized(brl(lot.currentBid)));
  expect(body).toContain(lot.leader);
  expect(winnerBid.bidder).toBe(lot.leader);
  expect(winnerBid.amount).toBe(lot.currentBid);
  expect(await page.locator('.bid-row').count()).toBe(bids.length);
  for (let index = 0; index < bids.length; index++) {
    const row = normalized(await page.locator('.bid-row').nth(index).innerText());
    expect(row).toContain(bids[index].bidder);
    expect(row).toContain(normalized(brl(bids[index].amount)));
  }

  await page.getByRole('link', { name: /Comprovante de Arremate/i }).first().click();
  await expect(page.getByRole('heading', { name: 'Comprovante Oficial de Arremate' })).toBeVisible();
  body = normalized(await page.locator('body').innerText());
  expect(body).toContain(lot.title);
  expect(body).toContain(lot.leader);
  expect(body).toContain(normalized(brl(lot.currentBid)));

  const audit = await getJson(request, `/api/audit/lots/${encodeURIComponent(lot.id)}`);
  expect(audit.valid).toBe(true);
  const closeEvent = audit.events.find(event => event.type === 'lot_closed');
  expect(closeEvent).toBeTruthy();
  expect(closeEvent.winner).toBe(lot.leader);
  expect(closeEvent.winningBidCents).toBe(Math.round(lot.currentBid * 100));

  await page.getByRole('link', { name: /Consultar histórico do lote/i }).click();
  await expect(page.getByText('Histórico Íntegro e Verificado')).toBeVisible();
  body = normalized(await page.locator('body').innerText());
  expect(body).toContain(lot.leader);
  expect(body).toContain(normalized(brl(lot.currentBid)));
});
