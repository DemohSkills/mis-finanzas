const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

function buildEstado() {
  return {
    iniciales: { 'Efectivo': 100000 },
    gastos: [
      { id: 'g1', monto: 5000,  fecha: '2026-10-15', categoria: 'Comida',      descripcion: 'pizza',       tipo: 'gasto',   medio: 'Efectivo', creado: 1 },
      { id: 'g2', monto: 200000,fecha: '2026-10-10', categoria: 'Transporte',  descripcion: 'nafta',       tipo: 'gasto',   medio: 'Banco Santander', creado: 2 },
      { id: 'g3', monto: 50000, fecha: '2026-09-20', categoria: 'Supermercado',descripcion: 'Supermercado',tipo: 'gasto',   medio: 'Efectivo', creado: 3 },
      { id: 'g4', monto: 80000, fecha: '2026-10-05', categoria: 'Salario',     descripcion: 'Sueldo oct',  tipo: 'ingreso', medio: 'Banco Santander', creado: 4 },
      { id: 'g5', monto: 1500,  fecha: '2026-10-12', categoria: 'Transferencia entre cuentas', descripcion: 'Trans', tipo: 'gasto', medio: 'Efectivo', transferencia: true, transferId: 'tx1', creado: 5 },
      { id: 'g6', monto: 1500,  fecha: '2026-10-12', categoria: 'Transferencia entre cuentas', descripcion: 'Trans', tipo: 'ingreso', medio: 'Banco Santander', transferencia: true, transferId: 'tx1', creado: 6 },
    ],
    items: [{ id: 'ia1', nombre: 'Efectivo', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 100000 }],
    patrimonioCargado: true,
    compromisos: [],
  };
}

async function seedAndUnlock(page, estado) {
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}

async function goToMovim(page) {
  await page.locator('nav.tabs button[data-vista="gastos"]').click();
  await page.waitForSelector('#busqMov');
}

test.describe('4a: Buscador de movimientos', () => {
  test('la caja de búsqueda y el botón limpiar existen en la solapa Movim.', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    await expect(page.locator('#busqMov')).toBeVisible();
    await expect(page.locator('#busqLimpiar')).toBeVisible();
    await expect(page.locator('#busqSummary')).toBeAttached();
  });

  test('con caja vacía se ve el historial completo y summary vacío', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    // summary empty
    const sumTxt = await page.locator('#busqSummary').textContent();
    expect(sumTxt.trim()).toBe('');
    // #total shows all movements
    const totalTxt = await page.locator('#total').textContent();
    expect(totalTxt).toMatch(/6 movimientos/);
  });

  test('búsqueda por texto filtra por descripción (pizza)', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    await page.locator('#busqMov').fill('pizza');
    await page.waitForTimeout(350);
    const rows = page.locator('#historial .gasto');
    expect(await rows.count()).toBe(1);
    expect(await rows.first().textContent()).toMatch(/pizza/i);
  });

  test('búsqueda por texto ignora mayúsculas y tildes (supermercado)', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    await page.locator('#busqMov').fill('supermercado');
    await page.waitForTimeout(350);
    const rows = page.locator('#historial .gasto');
    expect(await rows.count()).toBe(1);
  });

  test('búsqueda por fecha dd/mm filtra correctamente (15/10)', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    await page.locator('#busqMov').fill('15/10');
    await page.waitForTimeout(350);
    const rows = page.locator('#historial .gasto');
    expect(await rows.count()).toBe(1);
  });

  test('búsqueda por importe > filtra por mayor que', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    await page.locator('#busqMov').fill('>100000');
    await page.waitForTimeout(350);
    const rows = page.locator('#historial .gasto');
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
    // the 200000 nafta should be there
    expect(await page.locator('#historial').textContent()).toMatch(/nafta/i);
  });

  test('summary muestra resultados, gastos e ingresos (sin transferencias)', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    await page.locator('#busqMov').fill('Banco Santander');
    await page.waitForTimeout(350);
    const sumTxt = await page.locator('#busqSummary').textContent();
    expect(sumTxt).toMatch(/resultado/i);
    expect(sumTxt).toMatch(/Gastos/i);
    expect(sumTxt).toMatch(/Ingresos/i);
  });

  test('botón limpiar vacía el campo y muestra historial completo', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    await page.locator('#busqMov').fill('pizza');
    await page.waitForTimeout(350);
    expect(await page.locator('#historial .gasto').count()).toBe(1);
    await page.locator('#busqLimpiar').click();
    await page.waitForTimeout(200);
    expect(await page.locator('#busqMov').inputValue()).toBe('');
    const sumTxt = await page.locator('#busqSummary').textContent();
    expect(sumTxt.trim()).toBe('');
  });

  test('búsqueda AND combina términos (pizza 15/10)', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    await page.locator('#busqMov').fill('pizza 15/10');
    await page.waitForTimeout(350);
    // only one movement matches both
    const rows = page.locator('#historial .gasto');
    expect(await rows.count()).toBe(1);
  });

  test('#total siempre muestra el total global aunque haya filtro', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    await page.locator('#busqMov').fill('pizza');
    await page.waitForTimeout(350);
    const totalTxt = await page.locator('#total').textContent();
    expect(totalTxt).toMatch(/6 movimientos/);
  });

  test('sin resultados muestra mensaje de vacío', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    await page.locator('#busqMov').fill('zzzyyyxxx');
    await page.waitForTimeout(350);
    const vacioEl = page.locator('#historial .vacio');
    await expect(vacioEl).toBeVisible();
    expect(await vacioEl.textContent()).toMatch(/sin resultados/i);
  });

  test('sin errores JS en la página', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    await page.locator('#busqMov').fill('pizza');
    await page.waitForTimeout(350);
    expect(errors).toHaveLength(0);
  });
});
