const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

function buildEstado() {
  return {
    iniciales: {},
    gastos: [],
    items: [{ id: 'ia1', nombre: 'Efectivo', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 50000 }],
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
  await page.waitForTimeout(600);
}

test.describe('ojo-graficos: modo ojo oculta/muestra ticks de ejes', () => {
  test('(a) activar modo ojo oculta los ticks de todos los gráficos cargados', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    // Esperar a que los gráficos de evolución estén listos
    await page.waitForTimeout(400);

    // Activar modo ojo
    await page.locator('#btnOjo').click();
    await page.waitForTimeout(300);

    // Verificar que body tiene clase 'ocultar'
    const hasOcultar = await page.evaluate(() => document.body.classList.contains('ocultar'));
    expect(hasOcultar).toBe(true);

    // Verificar que los ticks están ocultos en todos los charts renderizados
    const allTicksHidden = await page.evaluate(() => {
      const ci = window._ci;
      if (!ci) return null;
      const charts = Object.values(ci);
      if (!charts.length) return true; // nada que chequear
      return charts.every(chart => {
        const scales = chart.options && chart.options.scales;
        if (!scales) return true;
        return Object.values(scales).every(scale => {
          if (!scale.ticks) return true;
          return scale.ticks.display === false;
        });
      });
    });
    expect(allTicksHidden).toBe(true);
  });

  test('(b) desactivar modo ojo restaura los ticks de todos los gráficos', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await page.waitForTimeout(400);

    // Activar y luego desactivar modo ojo
    await page.locator('#btnOjo').click();
    await page.waitForTimeout(200);
    await page.locator('#btnOjo').click();
    await page.waitForTimeout(300);

    // Verificar que body NO tiene clase 'ocultar'
    const hasOcultar = await page.evaluate(() => document.body.classList.contains('ocultar'));
    expect(hasOcultar).toBe(false);

    // Verificar que los ticks están visibles en todos los charts
    const allTicksVisible = await page.evaluate(() => {
      const ci = window._ci;
      if (!ci) return null;
      const charts = Object.values(ci);
      if (!charts.length) return true;
      return charts.every(chart => {
        const scales = chart.options && chart.options.scales;
        if (!scales) return true;
        return Object.values(scales).every(scale => {
          if (!scale.ticks) return true;
          return scale.ticks.display !== false;
        });
      });
    });
    expect(allTicksVisible).toBe(true);
  });
});
