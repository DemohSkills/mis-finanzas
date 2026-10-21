const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const SNAPS_KEY = 'finanzas-v1-snaps';
const VALS_KEY = 'finanzas-v1-chart-vals';
const TEST_PIN = '1234';

function buildEstado() {
  return {
    iniciales: { 'Efectivo': 100000 },
    gastos: [],
    items: [
      { id: 'ia1', nombre: 'Efectivo', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 100000 },
      { id: 'id1', nombre: 'Visa Santander', grupo: 'Tarjetas de crédito', tipo: 'deuda', monto: 50000 },
    ],
    patrimonioCargado: true,
    compromisos: [],
  };
}

const snaps = [
  { d: '2026-09-13', n: 80000, a: 90000, dv: 10000, dd: { vs: 10000, mc: 0, bm: 0, cm: 0 } },
  { d: '2026-10-13', n: 90000, a: 100000, dv: 10000, dd: { vs: 12000, mc: 5000, bm: 0, cm: 0 } },
  { d: '2026-10-20', n: 95000, a: 105000, dv: 10000, dd: { vs: 15000, mc: 5000, bm: 2000, cm: 0 } },
];

async function seedAndUnlock(page, valsStored) {
  await page.addInitScript(({ sk, pk, pin, data, snk, sndata, vk, vval }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    localStorage.setItem(snk, JSON.stringify(sndata));
    if (vval !== null) localStorage.setItem(vk, JSON.stringify(vval));
    else localStorage.removeItem(vk);
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: buildEstado(), snk: SNAPS_KEY, sndata: snaps, vk: VALS_KEY, vval: valsStored });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}

async function goToEvolucion(page) {
  await page.locator('nav.tabs button[data-vista="evolucion"]').click();
  await page.waitForFunction(() => typeof Chart !== 'undefined' && window._ci && window._ci['cD'], null, { timeout: 10000 });
  await page.waitForTimeout(400);
}

test.describe('4c: Gráfico cD — leyenda con colores y botón Valores', () => {
  test('gráfico cD existe y tiene 4 datasets', async ({ page }) => {
    await seedAndUnlock(page, null);
    await goToEvolucion(page);
    const count = await page.evaluate(() => window._ci['cD'].data.datasets.length);
    expect(count).toBe(4);
  });

  test('generateLabels retorna fillStyle distinto para cada serie', async ({ page }) => {
    await seedAndUnlock(page, null);
    await goToEvolucion(page);
    const fillStyles = await page.evaluate(() => {
      const chart = window._ci['cD'];
      const labels = chart.options.plugins.legend.labels.generateLabels(chart);
      return labels.map(l => l.fillStyle);
    });
    expect(fillStyles.length).toBe(4);
    // all must be non-empty strings (colors)
    fillStyles.forEach(f => expect(typeof f).toBe('string'));
    // all 4 fill styles are distinct (each series has its own color)
    const unique = new Set(fillStyles);
    expect(unique.size).toBe(4);
  });

  test('generateLabels retorna strokeStyle igual a fillStyle por serie', async ({ page }) => {
    await seedAndUnlock(page, null);
    await goToEvolucion(page);
    const result = await page.evaluate(() => {
      const chart = window._ci['cD'];
      const labels = chart.options.plugins.legend.labels.generateLabels(chart);
      return labels.map(l => ({ fill: l.fillStyle, stroke: l.strokeStyle }));
    });
    result.forEach(({ fill, stroke }) => expect(fill).toBe(stroke));
  });

  test('texto de leyenda incluye el valor (fmtM) cuando ojo está desactivado', async ({ page }) => {
    await seedAndUnlock(page, null);
    await goToEvolucion(page);
    const texts = await page.evaluate(() => {
      const chart = window._ci['cD'];
      return chart.options.plugins.legend.labels.generateLabels(chart).map(l => l.text);
    });
    // at least one label should contain "·" + a number (fmtM format)
    const withVal = texts.filter(t => t.includes('·'));
    expect(withVal.length).toBeGreaterThan(0);
  });

  test('botón #btnValsD existe en la sección de cD', async ({ page }) => {
    await seedAndUnlock(page, null);
    await goToEvolucion(page);
    const btn = page.locator('#btnValsD');
    await expect(btn).toBeVisible();
    expect(await btn.textContent()).toMatch(/Valores/i);
  });

  test('botón Valores alterna localStorage finanzas-v1-chart-vals', async ({ page }) => {
    await seedAndUnlock(page, null);
    await goToEvolucion(page);
    // initially false
    const before = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('finanzas-v1-chart-vals')); } catch { return null; }
    });
    expect(before).toBeFalsy();

    await page.locator('#btnValsD').click();
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('finanzas-v1-chart-vals')); } catch { return null; }
    });
    expect(after).toBe(true);
  });

  test('botón Valores muestra "Valores ✓" cuando está activo', async ({ page }) => {
    await seedAndUnlock(page, true);
    await goToEvolucion(page);
    const txt = await page.locator('#btnValsD').textContent();
    expect(txt).toMatch(/✓/);
  });

  test('botón Valores vuelve a "Valores" al desactivar', async ({ page }) => {
    await seedAndUnlock(page, true);
    await goToEvolucion(page);
    await page.locator('#btnValsD').click();
    await page.waitForTimeout(300);
    const txt = await page.locator('#btnValsD').textContent();
    expect(txt).not.toMatch(/✓/);
    const stored = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('finanzas-v1-chart-vals')); } catch { return null; }
    });
    expect(stored).toBe(false);
  });

  test('con ojo activo generateLabels no incluye valores numéricos en texto', async ({ page }) => {
    await seedAndUnlock(page, null);
    await goToEvolucion(page);
    // activate ojo mode via toggle button
    await page.locator('#btnOjo').click();
    await page.waitForTimeout(300);
    const texts = await page.evaluate(() => {
      const chart = window._ci['cD'];
      return chart.options.plugins.legend.labels.generateLabels(chart).map(l => l.text);
    });
    // With ojo active, no label should include "·" + number
    texts.forEach(t => expect(t).not.toMatch(/·\s*[\d,.]+/));
  });

  test('sin errores JS con cD cargado', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndUnlock(page, null);
    await goToEvolucion(page);
    await page.waitForTimeout(300);
    expect(errors).toHaveLength(0);
  });
});
