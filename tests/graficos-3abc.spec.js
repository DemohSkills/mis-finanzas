const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const SNAPS_KEY = 'finanzas-v1-snaps';
const TEST_PIN = '1234';

function buildEstado() {
  return {
    iniciales: { 'Efectivo': 100000 },
    gastos: [
      { id: 'g1', monto: 5000, fecha: '2026-10-01', categoria: 'Comida', descripcion: 'test', tipo: 'gasto', soloHistorial: false },
      { id: 'g2', monto: 3000, fecha: '2026-09-15', categoria: 'Transporte', descripcion: 'test', tipo: 'gasto', soloHistorial: false },
    ],
    items: [
      { id: 'ia1', nombre: 'Efectivo', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 100000 },
      { id: 'id1', nombre: 'Visa Santander', grupo: 'Tarjetas de crédito', tipo: 'deuda', monto: 50000 },
    ],
    patrimonioCargado: true,
    compromisos: [
      { id: 'c1', nombre: 'Alquiler', entidad: 'Juan', monto: 30000, pendientes: 3, proxVenc: '2026-11-01', tipo: 'cuota' },
      { id: 'c2', nombre: 'Internet', entidad: 'Fibertel', monto: 8000.5, pendientes: 2, proxVenc: '2026-11-15', tipo: 'cuota' },
    ],
  };
}

async function seedAndUnlock(page, estado) {
  const snaps = [
    { d: '2026-09-13', n: 80000, a: 90000, dv: 10000, dd: { vs: 10000, mc: 0, bm: 0, cm: 0 } },
    { d: '2026-10-13', n: 90000, a: 100000, dv: 10000, dd: { vs: 10000, mc: 5000, bm: 0, cm: 0 } },
    { d: '2026-10-20', n: 95000, a: 105000, dv: 10000, dd: { vs: 10000, mc: 5000, bm: 2000, cm: 0 } },
  ];
  await page.addInitScript(({ sk, pk, pin, data, snk, sndata }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    localStorage.setItem(snk, JSON.stringify(sndata));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado, snk: SNAPS_KEY, sndata: snaps });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}

async function goToEvolucion(page) {
  await page.locator('nav.tabs button[data-vista="evolucion"]').click();
  // wait for Chart.js to load and at least cD to be initialized
  await page.waitForFunction(() => typeof Chart !== 'undefined' && window._ci && Object.keys(window._ci).length > 0, null, { timeout: 10000 });
  await page.waitForTimeout(300);
}

async function goToAnalisis(page) {
  await page.locator('nav.tabs button[data-vista="analisis"]').click();
  await page.waitForFunction(() => typeof Chart !== 'undefined' && window._ci && window._ci['cIngD'], null, { timeout: 10000 });
  await page.waitForTimeout(300);
}

// ─── 3a: toggle en todos los gráficos ────────────────────────

test.describe('3a: clic en leyenda toggle en todos los gráficos', () => {
  test('det-ev-cIC tiene ev-hint "clic leyenda"', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToAnalisis(page);
    const hint = page.locator('#det-ev-cIC .ev-hint');
    await expect(hint).toBeVisible();
    expect(await hint.textContent()).toMatch(/clic leyenda/i);
  });

  test('cD tiene leyenda visible y Chart.js soporta toggle', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToEvolucion(page);
    const visible = await page.evaluate(() => {
      const chart = window._ci && window._ci['cD'];
      if (!chart) return null;
      return chart.data.datasets.length >= 2;
    });
    expect(visible).toBe(true);
  });

  test('cD (deudas) tiene 4 series', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToEvolucion(page);
    const count = await page.evaluate(() => {
      const c = window._ci && window._ci['cD'];
      return c ? c.data.datasets.length : 0;
    });
    expect(count).toBe(4);
  });

  test('toggle programático en cD oculta y muestra serie', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToEvolucion(page);
    const result = await page.evaluate(() => {
      const c = window._ci['cD'];
      if (!c) return null;
      const wasVisible = c.isDatasetVisible(0);
      c.hide(0);
      const hiddenAfter = !c.isDatasetVisible(0);
      c.show(0);
      const shownAfter = c.isDatasetVisible(0);
      return { wasVisible, hiddenAfter, shownAfter };
    });
    expect(result.wasVisible).toBe(true);
    expect(result.hiddenAfter).toBe(true);
    expect(result.shownAfter).toBe(true);
  });
});

// ─── 3b: persistencia de series en localStorage ──────────────

test.describe('3b: persistencia de visibilidad + botón Mostrar todo', () => {
  test('ocultar serie en cD guarda en localStorage', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToEvolucion(page);
    await page.evaluate(() => {
      const c = window._ci['cD'];
      c.hide(0); // ocultar "Activos"
      const hidden = c.data.datasets.map((ds,i) => c.isDatasetVisible(i) ? null : ds.label).filter(Boolean);
      window.setChartVis('cD', hidden);
    });
    const stored = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('finanzas-v1-chart-vis-cD')); } catch { return null; }
    });
    expect(stored).toContain('Visa Santander');
  });

  test('restaurar app aplica visibilidad guardada en cD', async ({ page }) => {
    // pre-seed localStorage with hidden state
    await page.addInitScript(({ sk, pk, pin, data, snk, sndata, visK, visData }) => {
      localStorage.setItem(sk, JSON.stringify(data));
      localStorage.setItem(pk, JSON.stringify(pin));
      localStorage.setItem(snk, JSON.stringify(sndata));
      localStorage.setItem(visK, JSON.stringify(visData));
    }, {
      sk: SK, pk: PIN_KEY, pin: TEST_PIN,
      data: buildEstado(),
      snk: SNAPS_KEY,
      sndata: [
        { d: '2026-10-20', n: 95000, a: 105000, dv: 10000, dd: { vs:0, mc:0, bm:0, cm:0 } }
      ],
      visK: 'finanzas-v1-chart-vis-cD',
      visData: ['Visa Santander'],
    });
    await page.goto(INDEX);
    for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
    await page.waitForTimeout(400);
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForFunction(() => typeof Chart !== 'undefined' && window._ci && Object.keys(window._ci).length > 0, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    const visible = await page.evaluate(() => {
      const c = window._ci && window._ci['cD'];
      if (!c) return null;
      return c.isDatasetVisible(0); // Activos should be hidden
    });
    expect(visible).toBe(false);
  });

  test('botón "Mostrar todo" existe en det-ev-cD', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToEvolucion(page);
    const btn = page.locator('#det-ev-cD .btn-show-all');
    await expect(btn).toBeVisible();
    expect(await btn.getAttribute('data-chart')).toBe('cD');
  });

  test('botón "Mostrar todo" en cD restaura todas las series y borra localStorage', async ({ page }) => {
    await page.addInitScript(({ sk, pk, pin, data, snk, sndata, visK, visData }) => {
      localStorage.setItem(sk, JSON.stringify(data));
      localStorage.setItem(pk, JSON.stringify(pin));
      localStorage.setItem(snk, JSON.stringify(sndata));
      localStorage.setItem(visK, JSON.stringify(visData));
    }, {
      sk: SK, pk: PIN_KEY, pin: TEST_PIN,
      data: buildEstado(),
      snk: SNAPS_KEY,
      sndata: [{ d: '2026-10-20', n: 95000, a: 105000, dv: 10000, dd: { vs:10000, mc:5000, bm:2000, cm:0 } }],
      visK: 'finanzas-v1-chart-vis-cD',
      visData: ['Visa Santander', 'Boris MP'],
    });
    await page.goto(INDEX);
    for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
    await page.waitForTimeout(400);
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForFunction(() => typeof Chart !== 'undefined' && window._ci && Object.keys(window._ci).length > 0, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    // click "Mostrar todo" for cD
    await page.locator('#det-ev-cD .btn-show-all').click();
    await page.waitForTimeout(200);
    // all series visible
    const allVisible = await page.evaluate(() => {
      const c = window._ci['cD'];
      return c.data.datasets.every((_,i) => c.isDatasetVisible(i));
    });
    expect(allVisible).toBe(true);
    // localStorage cleared
    const stored = await page.evaluate(() => localStorage.getItem('finanzas-v1-chart-vis-cD'));
    expect(stored).toBeNull();
  });

  test('botones "Mostrar todo" existen para cIngD y cCmpD', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToAnalisis(page);
    await expect(page.locator('.btn-show-all[data-chart="cIngD"]')).toBeVisible();
    await expect(page.locator('.btn-show-all[data-chart="cCmpD"]')).toBeVisible();
  });
});

// ─── 3c: menú ⚙ en cD ────────────────────────────────────────

test.describe('3c: menú ⚙ en gráfico de deudas', () => {
  test('botón ⚙ existe en det-ev-cD', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToEvolucion(page);
    const btn = page.locator('#btnCfgD');
    await expect(btn).toBeVisible();
  });

  test('clic en ⚙ muestra panel con 4 checkboxes', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToEvolucion(page);
    const panel = page.locator('#cfgDPanel');
    // panel starts hidden via style.display:none
    const initialDisplay = await panel.evaluate(el => el.style.display);
    expect(initialDisplay).toBe('none');
    await page.locator('#btnCfgD').click();
    await page.waitForTimeout(200);
    const afterDisplay = await panel.evaluate(el => el.style.display);
    expect(afterDisplay).toBe('flex');
    const cbs = panel.locator('[data-series]');
    expect(await cbs.count()).toBe(4);
  });

  test('desmarcar checkbox oculta serie y guarda en localStorage', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToEvolucion(page);
    await page.locator('#btnCfgD').click();
    await page.waitForTimeout(200);
    const cb = page.locator('#cfgDPanel [data-series="Boris MP"]');
    await cb.uncheck();
    await page.waitForTimeout(200);
    const stored = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('finanzas-v1-chart-vis-cD')); } catch { return null; }
    });
    expect(stored).toContain('Boris MP');
    const visible = await page.evaluate(() => {
      const c = window._ci['cD'];
      const i = c.data.datasets.findIndex(d => d.label === 'Boris MP');
      return c.isDatasetVisible(i);
    });
    expect(visible).toBe(false);
  });

  test('panel ⚙ se sincroniza con visibilidad restaurada de localStorage', async ({ page }) => {
    await page.addInitScript(({ sk, pk, pin, data, snk, sndata, visK, visData }) => {
      localStorage.setItem(sk, JSON.stringify(data));
      localStorage.setItem(pk, JSON.stringify(pin));
      localStorage.setItem(snk, JSON.stringify(sndata));
      localStorage.setItem(visK, JSON.stringify(visData));
    }, {
      sk: SK, pk: PIN_KEY, pin: TEST_PIN,
      data: buildEstado(),
      snk: SNAPS_KEY,
      sndata: [{ d: '2026-10-20', n: 95000, a: 105000, dv: 10000, dd: { vs:10000, mc:5000, bm:2000, cm:0 } }],
      visK: 'finanzas-v1-chart-vis-cD',
      visData: ['Mastercard MP'],
    });
    await page.goto(INDEX);
    for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
    await page.waitForTimeout(400);
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForFunction(() => typeof Chart !== 'undefined' && window._ci && Object.keys(window._ci).length > 0, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    await page.locator('#btnCfgD').click(); // open panel → syncCbs
    await page.waitForTimeout(200);
    const mcChecked = await page.locator('#cfgDPanel [data-series="Mastercard MP"]').isChecked();
    expect(mcChecked).toBe(false); // was hidden
    const vsChecked = await page.locator('#cfgDPanel [data-series="Visa Santander"]').isChecked();
    expect(vsChecked).toBe(true); // was visible
  });
});
