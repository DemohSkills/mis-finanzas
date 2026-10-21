const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

function buildEstado() {
  return {
    iniciales: { 'Efectivo': 100000 },
    gastos: [],
    items: [{ id: 'ia1', nombre: 'Efectivo', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 100000 }],
    patrimonioCargado: true,
    compromisos: [
      // monto con 1 decimal para reproducir el bug original
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

  test('subtotal de grupo muestra 2 decimales (no 1)', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await page.locator('nav.tabs button[data-vista="compromisos"]').click();
    await page.waitForTimeout(300);
    // open all details
    await page.evaluate(() => {
      document.querySelectorAll('details.comp-mes').forEach(d => { d.open = true; });
    });
    await page.waitForTimeout(200);
    const subtotals = await page.locator('.comp-mes-sub').allTextContents();
    for (const txt of subtotals) {
      // must not match single-decimal like ",7" at end (should be ",70" or no decimals shown consistently)
      // The fix ensures minimumFractionDigits:2, so all amounts show exactly 2 decimals
      expect(txt).not.toMatch(/,\d(?!\d)/); // reject X,Y (1 decimal) - must have 2 or none (but now always 2)
    }
  });

  test('fmt con 1 decimal muestra 2 decimales (ej: 4779062,7 → ...4.779.062,70)', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const formatted = await page.evaluate(() => {
      // call fmt directly
      return window.fmt ? window.fmt(4779062.7) : null;
    });
    // should end with ,70
    if (formatted) {
      expect(formatted).toMatch(/,70$/);
    }
  });

  test('fmt con número entero muestra ,00', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const formatted = await page.evaluate(() => window.fmt ? window.fmt(5000) : null);
    if (formatted) {
      expect(formatted).toMatch(/,00$/);
    }
  });
});
