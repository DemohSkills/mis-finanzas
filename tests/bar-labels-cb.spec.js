const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const SNAPS_KEY = 'finanzas-v1-snaps';
const TEST_PIN = '1234';

function buildEstado() {
  return {
    iniciales: { 'Efectivo': 200000 },
    gastos: [],
    items: [
      { id: 'ia1', nombre: 'Efectivo', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 200000 },
      { id: 'id1', nombre: 'Visa Santander', grupo: 'Tarjetas de crédito', tipo: 'deuda', monto: 50000 },
    ],
    patrimonioCargado: true,
    compromisos: [],
  };
}

const snaps = [
  { d: '2026-09-01', a: 150000, dv: 30000, n: 120000, dd: {} },
  { d: '2026-10-01', a: 200000, dv: 50000, n: 150000, dd: {} },
];

async function seedAndUnlock(page) {
  await page.addInitScript(({ sk, pk, pin, data, snk, sndata }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    localStorage.setItem(snk, JSON.stringify(sndata));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: buildEstado(), snk: SNAPS_KEY, sndata: snaps });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}

async function goToEvolucion(page) {
  await page.locator('nav.tabs button[data-vista="evolucion"]').click();
  await page.waitForFunction(() => typeof Chart !== 'undefined' && window._ci && window._ci['cB'], null, { timeout: 10000 });
  await page.waitForTimeout(400);
}

test.describe('Part 1: etiquetas encima de barras en cB', () => {
  test('(a) cB tiene el plugin barLabelsCB registrado', async ({ page }) => {
    await seedAndUnlock(page);
    await goToEvolucion(page);
    const hasPlugin = await page.evaluate(() => {
      const chart = window._ci['cB'];
      if (!chart) return false;
      return chart.config.plugins.some(p => p.id === 'barLabelsCB');
    });
    expect(hasPlugin).toBe(true);
  });

  test('(b) con ojo desactivado body no tiene clase ocultar', async ({ page }) => {
    await seedAndUnlock(page);
    await goToEvolucion(page);
    const hasOcultar = await page.evaluate(() => document.body.classList.contains('ocultar'));
    expect(hasOcultar).toBe(false);
  });

  test('(c) con ojo activado body tiene clase ocultar y cB existe', async ({ page }) => {
    await seedAndUnlock(page);
    await goToEvolucion(page);
    await page.locator('#btnOjo').click();
    await page.waitForTimeout(300);
    const [hasOcultar, chartExists] = await page.evaluate(() => [
      document.body.classList.contains('ocultar'),
      !!window._ci['cB'],
    ]);
    expect(hasOcultar).toBe(true);
    expect(chartExists).toBe(true);
  });

  test('(d) al desactivar ojo cB se re-renderiza (plugin sigue presente)', async ({ page }) => {
    await seedAndUnlock(page);
    await goToEvolucion(page);
    await page.locator('#btnOjo').click();
    await page.waitForTimeout(200);
    await page.locator('#btnOjo').click();
    await page.waitForTimeout(300);
    const hasPlugin = await page.evaluate(() => {
      const chart = window._ci['cB'];
      if (!chart) return false;
      return chart.config.plugins.some(p => p.id === 'barLabelsCB');
    });
    expect(hasPlugin).toBe(true);
  });

  test('(e) sin errores JS en cB con etiquetas', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndUnlock(page);
    await goToEvolucion(page);
    await page.waitForTimeout(300);
    expect(errors).toHaveLength(0);
  });
});
