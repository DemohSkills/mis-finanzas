// Cobro semanal: las ✕ de semanas cobradas / semanas anteriores / Sumar son compactas (22 px) con área tocable >= 36 px
const { test, expect } = require('@playwright/test');
const path = require('path');
const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const PIN = '1234';
const hist = (d, h, b, n) => ({ desde: d, hasta: h, bruto: b, neto: n, retencion: n != null ? b - n : null, historial: true });
const estado = () => ({ iniciales: { 'Mercado Pago': 0, 'Banco Santander': 0, 'Efectivo': 0 }, gastos: [], items: [], compromisos: [], patrimonioCargado: true,
  cobrosSemanales: [{ id: 'cs1', nombre: 'Meli Extra', persona: 'Meli Envíos', medioCobro: 'Mercado Pago',
    entradas: [{ id: 'e1', fecha: '2026-10-26', monto: 5000, tipo: 'dia' }],
    cobradas: [hist('2026-09-14', '2026-09-20', 123456, 111111), hist('2026-09-21', '2026-09-27', 50000, null)] }] });

async function abrir(page, tema) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date('2026-10-27T12:00:00'));
  await page.addInitScript(({ est, pin, tema }) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(est));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify(pin));
    localStorage.setItem('finanzas-v1-tema', tema);
  }, { est: estado(), pin: PIN, tema });
  await page.goto(INDEX);
  for (const d of PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForSelector('#pinScr', { state: 'hidden' });
  await page.locator('[role=tab]', { hasText: 'Patrimonio' }).click();
  await page.waitForSelector('#listaActivos');
}
const card = page => page.locator('#listaActivos details[data-cw-id="cs1"]');

for (const tema of ['neon-azul', 'claro']) {
  test(`✕ compactas y tocables (${tema})`, async ({ page }) => {
    await abrir(page, tema);
    const cob = card(page).locator('details.cw-cob');
    await cob.locator('summary').click();
    const x = cob.locator('.cw-h-del').first();
    const bb = await x.boundingBox();
    expect(bb.height).toBeLessThanOrEqual(24);
    expect(bb.height).toBeGreaterThanOrEqual(20);
    // área tocable >= 36 px: el pseudo-elemento ::after
    const area = await x.evaluate(el => parseFloat(getComputedStyle(el, '::after').height));
    expect(area).toBeGreaterThanOrEqual(36);
    // fecha en un renglón y datos en el siguiente
    const fila = cob.locator('.cw-cobrow').first();
    const [a, b] = await Promise.all([fila.locator('span').nth(0).boundingBox(), fila.locator('span.num').boundingBox()]);
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
    await card(page).scrollIntoViewIfNeeded();
    await cob.screenshot({ path: path.resolve(__dirname, '..', 'capturas-tmp', `t1-semanas-cobradas-${tema}.png`) });
    // modal de semanas anteriores
    await card(page).locator('.cw-hist-btn').click();
    const q = page.locator('#cwHistFilas .cw-h-quitar').first();
    expect((await q.boundingBox()).height).toBeLessThanOrEqual(24);
    await page.screenshot({ path: path.resolve(__dirname, '..', 'capturas-tmp', `t1-modal-anteriores-${tema}.png`) });
  });
}
