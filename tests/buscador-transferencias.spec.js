const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

function buildEstado() {
  return {
    iniciales: { 'Efectivo': 100000, 'Banco Santander': 200000 },
    gastos: [
      { id: 'g1', monto: 5000,  fecha: '2026-10-15', categoria: 'Comida',      descripcion: 'pizza',      tipo: 'gasto',   medio: 'Efectivo',        creado: 1 },
      { id: 'g2', monto: 3000,  fecha: '2026-10-14', categoria: 'Transporte',  descripcion: 'nafta',      tipo: 'gasto',   medio: 'Efectivo',        creado: 2 },
      { id: 'g3', monto: 80000, fecha: '2026-10-10', categoria: 'Salario',     descripcion: 'Sueldo',     tipo: 'ingreso', medio: 'Banco Santander', creado: 3 },
      // Complete transfer pair — transferId 'tx1'
      { id: 't1a', monto: 10000, fecha: '2026-10-12', categoria: 'Transferencia entre cuentas', descripcion: 'Efectivo → Banco Santander', tipo: 'gasto',   medio: 'Efectivo',        transferencia: true, transferId: 'tx1', creado: 4 },
      { id: 't1b', monto: 10000, fecha: '2026-10-12', categoria: 'Transferencia entre cuentas', descripcion: 'Efectivo → Banco Santander', tipo: 'ingreso', medio: 'Banco Santander', transferencia: true, transferId: 'tx1', creado: 5 },
      // Another transfer pair — transferId 'tx2'
      { id: 't2a', monto: 5000, fecha: '2026-10-08', categoria: 'Transferencia entre cuentas', descripcion: 'Banco Santander → Efectivo', tipo: 'gasto',   medio: 'Banco Santander', transferencia: true, transferId: 'tx2', creado: 6 },
      { id: 't2b', monto: 5000, fecha: '2026-10-08', categoria: 'Transferencia entre cuentas', descripcion: 'Banco Santander → Efectivo', tipo: 'ingreso', medio: 'Efectivo',        transferencia: true, transferId: 'tx2', creado: 7 },
    ],
    items: [],
    patrimonioCargado: true,
    compromisos: [],
  };
}

async function seedAndUnlock(page, estado) {
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    window.confirm = () => true;
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}

async function goToMovim(page) {
  await page.locator('nav.tabs button[data-vista="gastos"]').click();
  await page.waitForSelector('#busqMov');
}

async function buscar(page, texto) {
  await page.fill('#busqMov', texto);
  await page.waitForTimeout(300); // debounce
}

test.describe('4b: Buscador — transferencias separadas', () => {

  test('(a) sin búsqueda: transferencias se muestran mezcladas, no hay sección plegable', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    // No query → no <details> section
    await expect(page.locator('#historial details')).toHaveCount(0);
    // Transfers visible in main list
    await expect(page.locator('#historial .chip.hist').first()).toBeVisible();
  });

  test('(b) búsqueda que coincide con normales y transferencias: normales arriba, sección plegable cerrada', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    // "efectivo" matches g1, g2 (medio=Efectivo), and both transfer pairs
    await buscar(page, 'efectivo');
    // At least one normal result visible
    await expect(page.locator('#historial .gasto').first()).toBeVisible();
    // Details section exists and is closed by default
    const det = page.locator('#historial details');
    await expect(det).toHaveCount(1);
    await expect(det).not.toHaveAttribute('open');
  });

  test('(c) sección plegable muestra el conteo correcto de transferencias', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    await buscar(page, 'efectivo');
    const sumText = await page.locator('#historial details summary').textContent();
    // Both transfer pairs match "efectivo" (one has Efectivo as origin, other as dest)
    expect(sumText).toMatch(/Transferencias entre cuentas \(\d+\)/);
    const n = parseInt(sumText.match(/\((\d+)\)/)[1]);
    expect(n).toBeGreaterThanOrEqual(1);
  });

  test('(d) totales del summary (#busqSummary) no incluyen las transferencias', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    // "efectivo" also matches transfers, but summary should show only normal items
    await buscar(page, 'efectivo');
    const summary = await page.locator('#busqSummary').textContent();
    // Summary text shows gastos/ingresos of normal items (g1=5000, g2=3000 → gastos 8000; no ingresos)
    expect(summary).toBeTruthy();
    // Must NOT include transfer amounts
    expect(summary).not.toContain('10000');
    expect(summary).not.toContain('5000'); // tx2 amount
  });

  test('(e) búsqueda que coincide solo con transferencias: aviso + sección abierta', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    // "tx1" only matches transfer pair tx1 (descripcion contains "Efectivo → Banco")
    // Use a term that only transfers contain
    await buscar(page, 'transferencia entre cuentas');
    // Aviso visible
    const aviso = page.locator('#historial .vacio');
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('Solo hay transferencias entre cuentas');
    // Details section is open
    const det = page.locator('#historial details');
    await expect(det).toHaveCount(1);
    await expect(det).toHaveAttribute('open');
  });

  test('(f) búsqueda que coincide solo con normales: sin sección plegable', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    await buscar(page, 'pizza');
    // Normal result visible
    await expect(page.locator('#historial .gasto')).toHaveCount(1);
    // No details section
    await expect(page.locator('#historial details')).toHaveCount(0);
  });

  test('(g) abrir la sección plegable muestra las filas de transferencia', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    await buscar(page, 'efectivo');
    const det = page.locator('#historial details');
    await det.locator('summary').click();
    // Transfer rows inside the details section
    const rowCount = await det.locator('.gasto').count();
    expect(rowCount).toBeGreaterThanOrEqual(1);
    await expect(det.locator('.chip.hist').first()).toBeVisible();
  });

  test('(h) limpiar búsqueda restaura vista normal sin sección plegable', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    await buscar(page, 'efectivo');
    await expect(page.locator('#historial details')).toHaveCount(1);
    // Clear search
    await page.click('#busqLimpiar');
    await page.waitForTimeout(300);
    await expect(page.locator('#historial details')).toHaveCount(0);
    await expect(page.locator('#busqSummary')).toHaveText('');
  });

});
