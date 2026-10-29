// Cobro semanal: semanas de historial con depositado estimado (~)
const { test, expect } = require('@playwright/test');
const path = require('path');
const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const PIN = '1234';
const h = (d, h2, b, n, est) => ({ desde: d, hasta: h2, bruto: b, neto: n, retencion: n != null ? b - n : null, historial: true, ...(est ? { estimado: true } : {}) });
const estado = cobradas => ({ iniciales: { 'Mercado Pago': 0, 'Banco Santander': 0, 'Efectivo': 0 }, gastos: [], items: [], compromisos: [], patrimonioCargado: true,
  cobrosSemanales: [{ id: 'cs1', nombre: 'Meli Extra', persona: 'Meli Envíos', medioCobro: 'Mercado Pago', entradas: [], cobradas }] });
async function abrir(page, cobradas, tema = 'auto') {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date('2026-10-27T12:00:00'));
  await page.addInitScript(({ est, pin, tema }) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(est));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify(pin));
    localStorage.setItem('finanzas-v1-tema', JSON.stringify(tema));
  }, { est: estado(cobradas), pin: PIN, tema });
  await page.goto(INDEX);
  for (const d of PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForSelector('#pinScr', { state: 'hidden' });
  await page.locator('[role=tab]', { hasText: 'Patrimonio' }).click();
  await page.waitForSelector('#listaActivos');
}
const card = page => page.locator('#listaActivos details[data-cw-id="cs1"]');
const cobs = () => [h('2026-09-14', '2026-09-20', 100000, 90000, true), h('2026-09-21', '2026-09-27', 50000, 45000), h('2026-09-28', '2026-10-04', 20000, null)];

test('~ delante del neto estimado, pie y resumen con conteo', async ({ page }) => {
  await abrir(page, cobs());
  const res = card(page).locator('details.cw-res');
  await res.locator('summary').click();
  await expect(res.locator('.cw-r-dep')).toContainText('~');
  await expect(res.locator('.cw-r-ret')).toContainText('(2 semanas con dato, 1 estimada)');
  const cob = card(page).locator('details.cw-cob');
  await cob.locator('summary').click();
  await expect(cob.locator('.cw-cobrow[data-desde="2026-09-14"]')).toContainText('→ ~$ 90.000');
  await expect(cob.locator('.cw-cobrow[data-desde="2026-09-21"]')).not.toContainText('~');
  await expect(cob).toContainText('~ = depositado estimado');
  await cob.screenshot({ path: path.resolve(__dirname, '..', 'capturas-tmp', 't2-estimado-auto.png') });
});

test('sin estimadas: sin ~ ni pie y el resumen sigue igual', async ({ page }) => {
  await abrir(page, [h('2026-09-14', '2026-09-20', 100000, 90000)]);
  const res = card(page).locator('details.cw-res');
  await res.locator('summary').click();
  await expect(res.locator('.cw-r-dep')).not.toContainText('~');
  await expect(res.locator('.cw-r-ret')).toHaveText('10,0 % (1 semana con dato)');
  await card(page).locator('details.cw-cob summary').click();
  await expect(card(page).locator('details.cw-cob')).not.toContainText('depositado estimado');
});

for (const tema of ['neon-azul', 'claro']) {
  test(`cargar semanas anteriores: check estimado se guarda (${tema})`, async ({ page }) => {
    await abrir(page, [], tema);
    await card(page).locator('.cw-hist-btn').click();
    const f = page.locator('#cwHistFilas .cw-hrow').nth(0);
    await f.locator('.cw-h-desde').fill('2026-09-14');
    await f.locator('.cw-h-bruto').fill('100000');
    await f.locator('.cw-h-dep').fill('90000');
    await f.locator('.cw-h-est').check();
    await page.screenshot({ path: path.resolve(__dirname, '..', 'capturas-tmp', `t2-modal-estimado-${tema}.png`) });
    await page.click('#btnCwHistGuardar');
    const c = await page.evaluate(() => estado.cobrosSemanales[0].cobradas);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ neto: 90000, estimado: true });
    // sin depositado no hay estimado aunque se tilde
    await card(page).locator('.cw-hist-btn').click();
    const g = page.locator('#cwHistFilas .cw-hrow').nth(0);
    await g.locator('.cw-h-desde').fill('2026-09-21');
    await g.locator('.cw-h-bruto').fill('50000');
    await g.locator('.cw-h-est').check();
    await page.click('#btnCwHistGuardar');
    const c2 = await page.evaluate(() => estado.cobrosSemanales[0].cobradas.find(x => x.desde === '2026-09-21'));
    expect(c2.estimado).toBeUndefined();
  });
}

test('✎ edita una semana: depositado real quita estimado; sin cambiar el depositado puede seguir estimada', async ({ page }) => {
  await abrir(page, cobs(), 'neon-azul');
  const cob = card(page).locator('details.cw-cob');
  await cob.locator('summary').click();
  const fila = cob.locator('.cw-cobrow[data-desde="2026-09-14"]');
  await fila.locator('.cw-h-ed').click();
  await expect(page.locator('#cwHistEdModal')).toBeVisible();
  await expect(page.locator('#cwHistEdEst')).toBeChecked();
  await page.screenshot({ path: path.resolve(__dirname, '..', 'capturas-tmp', 't2-editar-neon-azul.png') });
  // cambia solo el bruto: sigue estimada
  await page.fill('#cwHistEdBruto', '110000');
  await page.click('#btnCwHistEdGuardar');
  let c = await page.evaluate(() => estado.cobrosSemanales[0].cobradas.find(x => x.desde === '2026-09-14'));
  expect(c).toMatchObject({ bruto: 110000, neto: 90000, retencion: 20000, estimado: true });
  // depositado real
  await card(page).locator('details.cw-cob').evaluate(d => { d.open = true; });
  await card(page).locator('details.cw-cob .cw-cobrow[data-desde="2026-09-14"] .cw-h-ed').click();
  await page.fill('#cwHistEdDep', '95000');
  await expect(page.locator('#cwHistEdEst')).not.toBeChecked();
  await page.click('#btnCwHistEdGuardar');
  c = await page.evaluate(() => estado.cobrosSemanales[0].cobradas.find(x => x.desde === '2026-09-14'));
  expect(c).toMatchObject({ bruto: 110000, neto: 95000, retencion: 15000 });
  expect(c.estimado).toBeUndefined();
  await expect(card(page).locator('details.cw-res .cw-r-dep')).not.toContainText('~');
});
