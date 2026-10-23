const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const SNAPS_KEY = 'finanzas-v1-snaps';
const TEST_PIN = '1234';
const TODAY = new Date().toISOString().slice(0, 10);

function buildEstado() {
  return {
    iniciales: { 'Banco Santander': 5000000, 'Mercado Pago': 1000000, 'Astropay': 0, 'Efectivo': 0 },
    gastos: [
      { id: 'g1', monto: 15000, fecha: TODAY.slice(0, 7) + '-05', categoria: 'Comida', descripcion: 'Super', tipo: 'gasto', soloHistorial: false },
      { id: 'g2', monto: 8000, fecha: TODAY.slice(0, 7) + '-10', categoria: 'Transporte', descripcion: 'Colectivo', tipo: 'gasto', soloHistorial: false },
      { id: 'g3', monto: 200000, fecha: TODAY.slice(0, 7) + '-01', categoria: 'Cobros/Ventas', medio: 'Banco Santander', descripcion: 'Ingreso', tipo: 'ingreso', soloHistorial: false },
    ],
    items: [
      { id: 'ia1', nombre: 'Banco Santander', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 5000000 },
      { id: 'ia2', nombre: 'Mercado Pago', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 1000000 },
    ],
    patrimonioCargado: true,
    compromisos: [
      { id: 'c1', nombre: 'Alquiler', entidad: 'Prop', monto: 100000, pendientes: 2, proxVenc: TODAY.slice(0, 7) + '-15', tipo: 'cuota' },
    ],
  };
}

function buildSnaps() {
  return [
    { d: TODAY.slice(0, 7) + '-01', n: 5900000, a: 6000000, dv: 100000 },
    { d: TODAY, n: 5950000, a: 6050000, dv: 100000 },
  ];
}

async function seedAndUnlock(page, estado = buildEstado()) {
  await page.addInitScript(({ sk, pk, pin, data, snk, sndata }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    localStorage.setItem(snk, JSON.stringify(sndata));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado, snk: SNAPS_KEY, sndata: buildSnaps() });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}

async function goToAnalisis(page) {
  await page.locator('nav.tabs button[data-vista="analisis"]').click();
  await page.waitForFunction(
    () => typeof Chart !== 'undefined' && window._ci && window._ci['cG'] && window._ci['cIngD'],
    null, { timeout: 10000 }
  );
  await page.waitForTimeout(300);
}

// ─── 1. Existencia y posición de la pestaña ────────────────────────────────

test.describe('pestana-gastos: existencia y posición', () => {
  test('(a) pestaña Gastos existe con data-vista="analisis"', async ({ page }) => {
    await seedAndUnlock(page);
    const btn = page.locator('nav.tabs button[data-vista="analisis"]');
    await expect(btn).toBeVisible();
    expect((await btn.textContent()).trim()).toBe('Gastos');
  });

  test('(b) Gastos está después de "A pagar" y antes de "Patrimonio"', async ({ page }) => {
    await seedAndUnlock(page);
    const btns = await page.locator('nav.tabs button[role="tab"]').all();
    const texts = await Promise.all(btns.map(b => b.textContent()));
    const trimmed = texts.map(t => t.trim());
    const idxAP = trimmed.findIndex(t => t.includes('A pagar'));
    const idxGas = trimmed.findIndex(t => t === 'Gastos');
    const idxPat = trimmed.findIndex(t => t === 'Patrimonio');
    expect(idxGas).toBeGreaterThanOrEqual(0);
    expect(idxAP).toBeLessThan(idxGas);
    expect(idxGas).toBeLessThan(idxPat);
  });

  test('(c) contenedor id="vista-analisis" existe en el DOM', async ({ page }) => {
    await seedAndUnlock(page);
    await expect(page.locator('#vista-analisis')).toBeAttached();
  });
});

// ─── 2. Tarjetas y gráficos en la pestaña Gastos ────────────────────────────

test.describe('pestana-gastos: tarjetas y gráficos', () => {
  test('(d) det-ev-cG está en vista-analisis', async ({ page }) => {
    await seedAndUnlock(page);
    await goToAnalisis(page);
    await expect(page.locator('#vista-analisis #det-ev-cG')).toBeVisible();
  });

  test('(e) det-ev-cIC está en vista-analisis', async ({ page }) => {
    await seedAndUnlock(page);
    await goToAnalisis(page);
    await expect(page.locator('#vista-analisis #det-ev-cIC')).toBeVisible();
  });

  test('(f) canvas cG tiene tamaño > 0 al abrir la pestaña', async ({ page }) => {
    await seedAndUnlock(page);
    await goToAnalisis(page);
    const size = await page.evaluate(() => {
      const cv = document.getElementById('cG');
      return cv ? { w: cv.offsetWidth, h: cv.offsetHeight } : null;
    });
    expect(size).not.toBeNull();
    expect(size.w).toBeGreaterThan(0);
    expect(size.h).toBeGreaterThan(0);
  });

  test('(g) canvas cIngD tiene tamaño > 0 al abrir la pestaña', async ({ page }) => {
    await seedAndUnlock(page);
    await goToAnalisis(page);
    const size = await page.evaluate(() => {
      const cv = document.getElementById('cIngD');
      return cv ? { w: cv.offsetWidth, h: cv.offsetHeight } : null;
    });
    expect(size).not.toBeNull();
    expect(size.w).toBeGreaterThan(0);
    expect(size.h).toBeGreaterThan(0);
  });

  test('(h) _ci tiene instancias de cG y cIngD tras abrir la pestaña', async ({ page }) => {
    await seedAndUnlock(page);
    await goToAnalisis(page);
    const hasBoth = await page.evaluate(() => !!(window._ci && window._ci['cG'] && window._ci['cIngD'] && window._ci['cCmpD']));
    expect(hasBoth).toBe(true);
  });
});

// ─── 3. Evolución NO contiene det-ev-cG ni det-ev-cIC ─────────────────────

test.describe('pestana-gastos: Evolución conserva sus tarjetas y pierde las movidas', () => {
  test('(i) vista-evolucion no contiene det-ev-cG', async ({ page }) => {
    await seedAndUnlock(page);
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForTimeout(500);
    const count = await page.locator('#vista-evolucion #det-ev-cG').count();
    expect(count).toBe(0);
  });

  test('(j) vista-evolucion no contiene det-ev-cIC', async ({ page }) => {
    await seedAndUnlock(page);
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForTimeout(500);
    const count = await page.locator('#vista-evolucion #det-ev-cIC').count();
    expect(count).toBe(0);
  });

  test('(k) vista-evolucion conserva det-ev-cP', async ({ page }) => {
    await seedAndUnlock(page);
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForTimeout(500);
    await expect(page.locator('#vista-evolucion #det-ev-cP')).toBeVisible();
  });

  test('(l) vista-evolucion conserva det-ev-cB', async ({ page }) => {
    await seedAndUnlock(page);
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForTimeout(500);
    await expect(page.locator('#vista-evolucion #det-ev-cB')).toBeVisible();
  });

  test('(m) vista-evolucion conserva det-ev-cD', async ({ page }) => {
    await seedAndUnlock(page);
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForTimeout(500);
    await expect(page.locator('#vista-evolucion #det-ev-cD')).toBeVisible();
  });

  test('(n) vista-evolucion conserva det-ev-cF', async ({ page }) => {
    await seedAndUnlock(page);
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForTimeout(500);
    await expect(page.locator('#vista-evolucion #det-ev-cF')).toBeVisible();
  });
});

// ─── 4. Estado plegado persiste para las tarjetas movidas ─────────────────

test.describe('pestana-gastos: estado plegado persiste', () => {
  test('(o) estado plegado de det-ev-cG persiste en localStorage', async ({ page }) => {
    await seedAndUnlock(page);
    await goToAnalisis(page);
    const card = page.locator('#det-ev-cG');
    await card.locator('summary').click();
    await expect(card).not.toHaveAttribute('open', '');
    await page.waitForTimeout(150);
    const stored = await page.evaluate(() => localStorage.getItem('finanzas-v1-det-det-ev-cG'));
    expect(stored).toBe('false');
  });

  test('(p) estado plegado de det-ev-cIC persiste en localStorage', async ({ page }) => {
    await seedAndUnlock(page);
    await goToAnalisis(page);
    const card = page.locator('#det-ev-cIC');
    await card.locator('summary').click();
    await expect(card).not.toHaveAttribute('open', '');
    await page.waitForTimeout(150);
    const stored = await page.evaluate(() => localStorage.getItem('finanzas-v1-det-det-ev-cIC'));
    expect(stored).toBe('false');
  });

  test('(q) estado plegado de det-ev-cG se restaura al recargar', async ({ page }) => {
    await page.addInitScript(({ sk, pk, pin, data, snk, sndata, detKey }) => {
      localStorage.setItem(sk, JSON.stringify(data));
      localStorage.setItem(pk, JSON.stringify(pin));
      localStorage.setItem(snk, JSON.stringify(sndata));
      localStorage.setItem(detKey, JSON.stringify(false));
    }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: buildEstado(), snk: SNAPS_KEY, sndata: buildSnaps(), detKey: 'finanzas-v1-det-det-ev-cG' });
    await page.goto(INDEX);
    for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
    await page.waitForTimeout(400);
    await page.locator('nav.tabs button[data-vista="analisis"]').click();
    await page.waitForTimeout(400);
    const card = page.locator('#det-ev-cG');
    await expect(card).not.toHaveAttribute('open', '');
  });
});

// ─── 5. Botón "Plegar todo" en la pestaña Gastos ──────────────────────────

test.describe('pestana-gastos: btnPlegGas', () => {
  test('(r) btnPlegGas existe en vista-analisis', async ({ page }) => {
    await seedAndUnlock(page);
    await goToAnalisis(page);
    await expect(page.locator('#btnPlegGas')).toBeVisible();
  });

  test('(s) btnPlegGas pliega todas las tarjetas de analisis', async ({ page }) => {
    await seedAndUnlock(page);
    await goToAnalisis(page);
    await page.click('#btnPlegGas');
    await page.waitForTimeout(200);
    const open = await page.locator('#vista-analisis details.ev-card[open]').count();
    expect(open).toBe(0);
  });
});

// ─── 6. Modo ojo en pestaña Gastos ────────────────────────────────────────

test.describe('pestana-gastos: modo ojo', () => {
  test('(t) activar modo ojo oculta importes de cG y conserva los meses', async ({ page }) => {
    await seedAndUnlock(page);
    await goToAnalisis(page);
    await page.locator('#btnOjo').click();
    await page.waitForTimeout(300);
    const ticksHidden = await page.evaluate(() => {
      const chart = window._ci && window._ci['cG'];
      if (!chart) return null;
      const scales = chart.options && chart.options.scales;
      if (!scales) return true;
      // Gastos por mes: el eje de importes está oculto siempre; los meses (eje x) se conservan
      return scales.y.display === false && Object.entries(scales).every(([k, s]) => k === 'x' || !s.ticks || s.ticks.display === false);
    });
    expect(ticksHidden).toBe(true);
  });

  test('(u) activar modo ojo oculta ticks de cIngD', async ({ page }) => {
    await seedAndUnlock(page);
    await goToAnalisis(page);
    await page.locator('#btnOjo').click();
    await page.waitForTimeout(300);
    const ticksHidden = await page.evaluate(() => {
      const chart = window._ci && window._ci['cIngD'];
      if (!chart) return null;
      const scales = chart.options && chart.options.scales;
      if (!scales) return true;
      return Object.values(scales).every(s => !s.ticks || s.ticks.display === false);
    });
    expect(ticksHidden).toBe(true);
  });
});

// ─── 7. Cambio de tema redibuja gráficos de Gastos ────────────────────────

test.describe('pestana-gastos: cambio de tema', () => {
  test('(v) cambiar a tema oscuro redibuja cG correctamente', async ({ page }) => {
    await seedAndUnlock(page);
    await goToAnalisis(page);
    await page.locator('nav.tabs button[data-vista="config"]').click();
    await page.waitForTimeout(200);
    await page.locator('.tema-btn[data-tema="oscuro"]').click();
    await page.waitForTimeout(200);
    await page.locator('nav.tabs button[data-vista="analisis"]').click();
    await page.waitForFunction(() => window._ci && window._ci['cG'], null, { timeout: 5000 });
    await page.waitForTimeout(300);
    const hasChart = await page.evaluate(() => !!(window._ci && window._ci['cG']));
    expect(hasChart).toBe(true);
  });
});

// ─── 8. Sin overflow a 360/412/450 px ─────────────────────────────────────

async function checkNoOverflowAnalisis(page, width) {
  await page.setViewportSize({ width, height: 800 });
  await seedAndUnlock(page);
  await goToAnalisis(page);
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

test.describe('pestana-gastos: sin overflow', () => {
  test('(w) sin overflow en analisis a 360 px', async ({ page }) => {
    expect(await checkNoOverflowAnalisis(page, 360)).toBe(false);
  });
  test('(x) sin overflow en analisis a 412 px', async ({ page }) => {
    expect(await checkNoOverflowAnalisis(page, 412)).toBe(false);
  });
  test('(y) sin overflow en analisis a 450 px', async ({ page }) => {
    expect(await checkNoOverflowAnalisis(page, 450)).toBe(false);
  });
});

// ─── 9. Rendimientos: coma decimal y "% período" completo ─────────────────

function buildEstadoConRendimientos() {
  const mes = TODAY.slice(0, 7);
  const estado = buildEstado();
  estado.gastos.push(
    { id: 'rend1', monto: 510, fecha: mes + '-15', categoria: 'Rendimientos', medio: 'Mercado Pago', descripcion: 'Rend MP', tipo: 'ingreso', soloHistorial: false },
    { id: 'rend2', monto: 200, fecha: mes + '-15', categoria: 'Rendimientos', medio: 'Banco Santander', descripcion: 'Rend BS', tipo: 'ingreso', soloHistorial: false },
  );
  estado.items.push(
    { id: 'ia3', nombre: 'Visa Santander', grupo: 'Tarjetas de crédito', tipo: 'deuda', monto: 50000 },
  );
  return estado;
}

async function goToEvolucion(page) {
  await page.locator('nav.tabs button[data-vista="evolucion"]').click();
  await page.waitForFunction(
    () => typeof Chart !== 'undefined' && window._ci && Object.keys(window._ci).length > 0,
    null, { timeout: 10000 }
  );
  await page.waitForTimeout(300);
}

test.describe('pestana-gastos: rendimientos', () => {
  test('(z) porcentajes en tabla Rendimientos usan coma decimal', async ({ page }) => {
    await seedAndUnlock(page, buildEstadoConRendimientos());
    await goToEvolucion(page);
    await page.waitForTimeout(300);
    const html = await page.locator('#rendTablaWrap').innerHTML();
    // Should contain comma-formatted percentages like "0,51%"
    expect(html).toMatch(/\d+,\d{2}%/);
    // Should NOT contain dot-formatted percentages like "0.51%"
    expect(html).not.toMatch(/\d+\.\d{2}%/);
  });

  test('(aa) columna "% período" completa a 360 px (sin truncamiento)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await seedAndUnlock(page, buildEstadoConRendimientos());
    await goToEvolucion(page);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('.rend-tabla td:nth-child(5), .rend-tabla th:nth-child(5)'));
      return cells.some(el => el.scrollWidth > el.clientWidth + 1);
    });
    expect(overflow).toBe(false);
  });

  test('(ab) sin overflow en tabla Rendimientos a 360 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await seedAndUnlock(page, buildEstadoConRendimientos());
    await goToEvolucion(page);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  });
});
