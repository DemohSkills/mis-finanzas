const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

function buildEstado() {
  return {
    iniciales: { 'Efectivo': 107400 },
    gastos: [],
    items: [{ id: 'ia1', nombre: 'Efectivo', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 107400 }],
    patrimonioCargado: true,
    compromisos: [
      // monto con 1 decimal para reproducir el bug original ("$ 4.779.062,7")
      { id: 'c1', nombre: 'Cuota A', entidad: 'Banco', monto: 4779062.7, pendientes: 1, proxVenc: '2026-11-01', tipo: 'cuota' },
      { id: 'c2', nombre: 'Cuota B', entidad: 'Banco', monto: 5000, pendientes: 1, proxVenc: '2026-11-15', tipo: 'cuota' },
    ],
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

test.describe('3d: formato de subtotal de Compromisos', () => {
  test('sin errores JS al cargar', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndUnlock(page, buildEstado());
    expect(errors).toHaveLength(0);
  });

  test('subtotal de grupo muestra 2 decimales incluso con 1 decimal natural', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await page.locator('nav.tabs button[data-vista="compromisos"]').click();
    await page.waitForTimeout(300);
    // forzar apertura de los details de grupo
    await page.evaluate(() => {
      document.querySelectorAll('details.comp-mes').forEach(d => { d.open = true; });
    });
    await page.waitForTimeout(200);
    const subtotals = await page.locator('.comp-mes-sub').allTextContents();
    expect(subtotals.length).toBeGreaterThan(0);
    for (const txt of subtotals) {
      // debe NO terminar en un solo dígito decimal (p.ej. ",7")
      expect(txt).not.toMatch(/,\d(?!\d)/);
    }
  });

  test('fmt2 con 1 decimal produce 2 decimales (4779062,7 → ...4.779.062,70)', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const formatted = await page.evaluate(() => window.fmt2 ? window.fmt2(4779062.7) : null);
    expect(formatted).not.toBeNull();
    expect(formatted).toMatch(/,70$/);
  });

  test('fmt2 con número entero muestra ,00', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const formatted = await page.evaluate(() => window.fmt2 ? window.fmt2(5000) : null);
    expect(formatted).toMatch(/,00$/);
  });

  test('fmt (normal) con número entero NO muestra ,00 (sin cambio global)', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const formatted = await page.evaluate(() => window.fmt ? window.fmt(107400) : null);
    expect(formatted).not.toBeNull();
    expect(formatted).not.toMatch(/,00$/); // sin decimales para enteros — fmt global sin cambios
    expect(formatted).toMatch(/107\.400/);
  });

  test('saldo de Efectivo en Inicio NO muestra ,00 (importes redondos sin cambio)', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    // saldo del medio Efectivo debe aparecer como "$ 107.400" no "$ 107.400,00"
    const txt = await page.locator('#saldos').textContent();
    expect(txt).not.toMatch(/107\.400,00/);
    expect(txt).toMatch(/107\.400/);
  });
});
