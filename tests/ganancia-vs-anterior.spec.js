// Ganancia bruta del mes: la comparación «vs mes anterior» solo aparece si el mes anterior está completo
const { test, expect } = require('@playwright/test');
const path = require('path');
const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const mov = (id, fecha, monto, tipo = 'ingreso') => ({ id, tipo, fecha, monto, medio: 'Banco Santander', categoria: tipo === 'ingreso' ? 'Sueldo/Honorarios' : 'Varios', descripcion: 'x ' + id });

async function abrir(page, gastos) {
  await page.clock.setFixedTime(new Date('2026-10-27T12:00:00'));
  await page.addInitScript(est => {
    localStorage.setItem('finanzas-v1', JSON.stringify(est));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
  }, { iniciales: { 'Banco Santander': 0, 'Mercado Pago': 0, 'Efectivo': 0 }, gastos, items: [], compromisos: [], patrimonioCargado: true });
  await page.goto(INDEX);
  for (const d of '1234') await page.click(`button[data-d="${d}"]`);
  await page.waitForSelector('#pinScr', { state: 'hidden' });
  await expect(page.locator('#ganCard .gan-total')).toBeVisible();
}
const oct = mov('o', '2026-10-05', 100000);

test('primer movimiento el 3/09: muestra la comparación con septiembre', async ({ page }) => {
  await abrir(page, [mov('s', '2026-09-03', 40000, 'gasto'), mov('s2', '2026-09-20', 60000), oct]);
  await expect(page.locator('#ganCmp')).toContainText('vs Septiembre 2026');
});
test('primer movimiento el 7/09 (límite): sigue mostrando la comparación', async ({ page }) => {
  await abrir(page, [mov('s', '2026-09-07', 60000), oct]);
  await expect(page.locator('#ganCmp')).toBeVisible();
});
test('primer movimiento antes del mes anterior (agosto): muestra la comparación', async ({ page }) => {
  await abrir(page, [mov('a', '2026-08-15', 1000, 'gasto'), mov('s', '2026-09-20', 60000), oct]);
  await expect(page.locator('#ganCmp')).toBeVisible();
});
test('primer movimiento el 8/09 o a mitad de septiembre: oculta la línea, sin mensaje de error', async ({ page }) => {
  for (const f of ['2026-09-08', '2026-09-15']) {
    await abrir(page, [mov('s', f, 60000), oct]);
    await expect(page.locator('#ganCmp')).toHaveCount(0);
    await expect(page.locator('#ganCard')).not.toContainText('vs ');
    await expect(page.locator('#ganCard')).not.toContainText('Igual que');
    await expect(page.locator('#ganCard .gan-total')).toContainText('100.000'); // el resto de la tarjeta sigue igual
    await page.goto('about:blank');
  }
});
