const { test, expect } = require('@playwright/test');
const { chooseLot, getJson, normalized } = require('./helpers');

test('TC-P1-002: lote encerrado sem lances permanece sem arrematante', async ({ page, request }) => {
  const fixture = await chooseLot(
    request,
    lot => lot.status === 'closed' && lot.currentBid === null,
    (_lot, bids) => bids.length === 0,
  );
  expect(fixture, 'É necessário manter um lote público encerrado sem lances para este E2E.').toBeTruthy();
  const { lot } = fixture;

  await page.goto(`/lots/${encodeURIComponent(lot.id)}`);
  await expect(page.getByText('Este lote foi encerrado sem lances registrados.', { exact: true })).toBeVisible();
  let body = normalized(await page.locator('body').innerText());
  expect(body).toContain('Sem arremate');
  expect(body).not.toContain('Seja o primeiro a participar!');
  expect(body).not.toContain('ARREMATADO POR');
  await expect(page.getByRole('link', { name: /Abrir Comprovante de Arremate/i })).toHaveCount(0);

  const audit = await getJson(request, `/api/audit/lots/${encodeURIComponent(lot.id)}`);
  expect(audit.valid).toBe(true);
  expect(audit.events.filter(event => event.type === 'bid_placed')).toHaveLength(0);
  const closeEvent = audit.events.find(event => event.type === 'lot_closed');
  expect(closeEvent).toBeTruthy();
  expect(closeEvent.winner).toBeNull();

  await page.getByRole('link', { name: /Ver histórico auditado/i }).click();
  await expect(page.getByText('Histórico Íntegro e Verificado')).toBeVisible();
  body = normalized(await page.locator('body').innerText());
  expect(body).toContain('Pregão encerrado');
  expect(body).not.toContain('Arremate:');
  expect(await page.locator('.audit-event').count()).toBe(audit.events.length);
});
