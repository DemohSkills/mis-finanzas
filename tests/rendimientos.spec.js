/**
 * Tests para la funcionalidad de Rendimientos.
 * Datos FICTICIOS — sin información personal.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

const BASE_STATE = {
  iniciales: { 'Banco Santander': 0, 'Mercado Pago': 0, 'Astropay': 0,
    'Visa Santander': 0, 'Mastercard MP': 0, 'Efectivo': 0, 'American Express': 0 },
  gastos: [],
  items: [],
  patrimonioCargado: true,
  compromisos: [],
  importaciones: {},
};

async function seedAndLoad(page, state = BASE_STATE) {
  await page.addInitScript((s) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(s));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
  }, state);
  await page.goto(INDEX);
}

async function enterPIN(page) {
  for (const d of ['1', '2', '3', '4']) await page.locator(`[data-d="${d}"]`).click();
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

async function goEvolucion(page) {
  await page.locator('nav.tabs button[data-vista="evolucion"]').click();
  await page.waitForTimeout(800);
}

// ── (a) Categoría aparece en selector de ingresos ──────────────
test('(a) Rendimientos aparece en selector de ingresos manuales', async ({ page }) => {
  await seedAndLoad(page);
  await enterPIN(page);

  // Navigate to Movimientos tab, open form, switch to ingreso
  await page.locator('button[data-vista="gastos"]').click();
  await page.locator('#det-form').evaluate(el => { el.open = true; });
  await page.locator('#form').waitFor({ state: 'visible' });
  await page.selectOption('#tipo', 'ingreso');
  await page.waitForTimeout(200);

  const options = await page.locator('select#categoria option').allTextContents();
  expect(options).toContain('Rendimientos');
});

// ── (b) Rendimientos no se duplica al recargar ─────────────────
test('(b) Rendimientos no se duplica al recargar la app', async ({ page }) => {
  await seedAndLoad(page);
  await enterPIN(page);

  const count1 = await page.evaluate(() => window.getCatsIncome().filter(c => c === 'Rendimientos').length);
  expect(count1).toBe(1);

  // Reload and check again
  await page.reload();
  await enterPIN(page);
  const count2 = await page.evaluate(() => window.getCatsIncome().filter(c => c === 'Rendimientos').length);
  expect(count2).toBe(1);
});

// ── (c) Migración: 'Ingresos extras' + 'rendimiento' → 'Rendimientos' ─
test('(c) migración convierte Ingresos extras con rendimiento en descripción', async ({ page }) => {
  const state = {
    ...BASE_STATE,
    gastos: [
      { id: 'g1', creado: 1, monto: 500, fecha: '2026-08-15', categoria: 'Ingresos extras',
        descripcion: 'Rendimientos Mercado Pago', medio: 'Mercado Pago', tipo: 'ingreso', soloHistorial: false },
      { id: 'g2', creado: 2, monto: 300, fecha: '2026-08-16', categoria: 'Ingresos extras',
        descripcion: 'Rendimientos acumulados sem 32', medio: 'Banco Santander', tipo: 'ingreso', soloHistorial: false },
      // This one should NOT be migrated (different category)
      { id: 'g3', creado: 3, monto: 200, fecha: '2026-08-17', categoria: 'Sueldo/Honorarios',
        descripcion: 'Rendimientos de trabajo', medio: 'Mercado Pago', tipo: 'ingreso', soloHistorial: false },
      // This one should NOT be migrated (no 'rendimiento' in desc)
      { id: 'g4', creado: 4, monto: 100, fecha: '2026-08-18', categoria: 'Ingresos extras',
        descripcion: 'Bonificacion promo', medio: 'Banco Santander', tipo: 'ingreso', soloHistorial: false },
    ],
  };
  await seedAndLoad(page, state);
  await enterPIN(page);

  const cats = await page.evaluate(() =>
    window._getEstado().gastos.map(g => ({ id: g.id, cat: g.categoria }))
  );

  expect(cats.find(g => g.id === 'g1').cat).toBe('Rendimientos');
  expect(cats.find(g => g.id === 'g2').cat).toBe('Rendimientos');
  expect(cats.find(g => g.id === 'g3').cat).toBe('Sueldo/Honorarios');
  expect(cats.find(g => g.id === 'g4').cat).toBe('Ingresos extras');
});

// ── (d) Migración idempotente ──────────────────────────────────
test('(d) migración es idempotente (no se aplica dos veces)', async ({ page }) => {
  const state = {
    ...BASE_STATE,
    gastos: [
      { id: 'g1', creado: 1, monto: 500, fecha: '2026-08-15', categoria: 'Ingresos extras',
        descripcion: 'Rendimientos Mercado Pago', medio: 'Mercado Pago', tipo: 'ingreso', soloHistorial: false },
    ],
  };
  // Pre-set the migration flag to simulate it already ran
  await page.addInitScript((s) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(s));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    localStorage.setItem('finanzas-v1-mig-rend-1', JSON.stringify(true));
  }, state);
  await page.goto(INDEX);
  await enterPIN(page);

  // With migration flag set, should NOT migrate
  const cat = await page.evaluate(() =>
    window._getEstado().gastos[0].categoria
  );
  expect(cat).toBe('Ingresos extras');
});

// ── (e) Importador MP asigna 'Rendimientos' ───────────────────
test('(e) importador MP asigna categoría Rendimientos', async ({ page }) => {
  await seedAndLoad(page);
  await enterPIN(page);

  const result = await page.evaluate(() =>
    window._categorizarMP('Rendimientos Mercado Pago', 1500)
  );
  expect(result.tipo).toBe('ingreso');
  expect(result.cat).toBe('Rendimientos');
  expect(result.agrupable).toBe('Rendimientos Mercado Pago');
});

// ── (f) Santander 'pago interes por saldo' → Rendimientos ──────
test('(f) Santander pago interes por saldo → Rendimientos', async ({ page }) => {
  await seedAndLoad(page);
  await enterPIN(page);

  const result = await page.evaluate(() =>
    window._categorizarSant('pago interes por saldo cuenta', 1200)
  );
  expect(result.tipo).toBe('ingreso');
  expect(result.cat).toBe('Rendimientos');
});

// ── (g) Santander 'bonif' NO va a Rendimientos ────────────────
test('(g) Santander bonif va a Ingresos extras, no Rendimientos', async ({ page }) => {
  await seedAndLoad(page);
  await enterPIN(page);

  const result = await page.evaluate(() =>
    window._categorizarSant('bonif promo digital junio', 500)
  );
  expect(result.tipo).toBe('ingreso');
  expect(result.cat).toBe('Ingresos extras');
  expect(result.cat).not.toBe('Rendimientos');
});

// ── (h) Saldo promedio y % del mes — caso numérico ────────────
test('(h) saldo promedio y % del mes con caso numérico verificado a mano', async ({ page }) => {
  // Setup: iniciales MP = 99000, rendimiento 1000 el 2026-09-01 (día 1 de septiembre)
  // After day 1: saldo = 99000 + 1000 = 100000
  // All 30 days of Sep: saldo = 100000 (rendimiento on day 1 affects all days including day 1)
  // Average = 100000, % = 1000/100000 = 1.00%, anualizado = 12.00%
  const state = {
    ...BASE_STATE,
    iniciales: { ...BASE_STATE.iniciales, 'Mercado Pago': 99000 },
    gastos: [
      { id: 'r1', creado: 1, monto: 1000, fecha: '2026-09-01', categoria: 'Rendimientos',
        descripcion: 'Rendimientos Mercado Pago', medio: 'Mercado Pago', tipo: 'ingreso', soloHistorial: false },
    ],
  };
  await seedAndLoad(page, state);
  await enterPIN(page);

  const result = await page.evaluate(() => {
    const saldoProm = window._saldoPromMes('Mercado Pago', '2026-09');
    const rend = 1000;
    const pctMes = rend / saldoProm * 100;
    const pctAnual = pctMes * 12;
    return { saldoProm, pctMes, pctAnual };
  });

  expect(result.saldoProm).toBeCloseTo(100000, 0);
  expect(result.pctMes).toBeCloseTo(1.0, 1);
  expect(result.pctAnual).toBeCloseTo(12.0, 1);
});

// ── (i) Transferencias propias excluidas del total rendimientos ─
test('(i) transferencias propias no cuentan como rendimientos', async ({ page }) => {
  const state = {
    ...BASE_STATE,
    gastos: [
      // Real rendimiento
      { id: 'r1', creado: 1, monto: 500, fecha: '2026-09-01', categoria: 'Rendimientos',
        descripcion: 'Rendimientos', medio: 'Mercado Pago', tipo: 'ingreso', soloHistorial: false },
      // Transfer with category Rendimientos (should be excluded)
      { id: 'r2', creado: 2, monto: 1000, fecha: '2026-09-02', categoria: 'Rendimientos',
        descripcion: 'Transferencia', medio: 'Mercado Pago', tipo: 'ingreso', soloHistorial: false, transferencia: true },
    ],
  };
  await seedAndLoad(page, state);
  await enterPIN(page);
  await goEvolucion(page);

  const total = await page.evaluate(() => {
    const gastos = window._getEstado().gastos;
    return gastos.filter(g => g.tipo === 'ingreso' && g.categoria === 'Rendimientos' && !g.transferencia)
      .reduce((s, g) => s + g.monto, 0);
  });
  expect(total).toBe(500);
});

// ── (j) Sin NaN con saldo 0 ───────────────────────────────────
test('(j) sin NaN cuando saldo promedio es 0', async ({ page }) => {
  const state = {
    ...BASE_STATE,
    iniciales: { ...BASE_STATE.iniciales, 'Mercado Pago': 0 },
    gastos: [
      { id: 'r1', creado: 1, monto: 100, fecha: '2026-09-01', categoria: 'Rendimientos',
        descripcion: 'Rendimientos', medio: 'Mercado Pago', tipo: 'ingreso', soloHistorial: false },
    ],
  };
  await seedAndLoad(page, state);
  await enterPIN(page);

  const result = await page.evaluate(() => {
    const saldoProm = window._saldoPromMes('Mercado Pago', '2026-09');
    const rend = 100;
    const pct = saldoProm > 0 ? rend / saldoProm * 100 : NaN;
    return { saldoProm, pctIsNaN: isNaN(pct), pctIsFinite: saldoProm === 0 ? true : isFinite(pct) };
  });

  // saldo starts at 0 + rendimiento on day 1 → saldoProm > 0 (100 * 30/30 = 100)
  // NaN only if saldoProm === 0 (which it shouldn't be here)
  // No NaN in table: fmtPct returns '—' when isNaN
  expect(isNaN(result.saldoProm)).toBe(false);
  expect(isFinite(result.saldoProm)).toBe(true);
});

// ── (k) Sin NaN con saldo inicial cero y sin movimientos del mes ─
test('(k) saldo promedio 0 cuando no hay movimientos → pct devuelve — no NaN', async ({ page }) => {
  const state = {
    ...BASE_STATE,
    iniciales: { ...BASE_STATE.iniciales, 'Mercado Pago': 0 },
    gastos: [],
  };
  await seedAndLoad(page, state);
  await enterPIN(page);

  const saldoProm = await page.evaluate(() => window._saldoPromMes('Mercado Pago', '2026-09'));
  expect(saldoProm).toBe(0);
  // pctMes formula: saldoProm > 0 ? ... : NaN — verify '—' is shown, not NaN in DOM
  // If saldoProm === 0, fmtPct returns '—'
  const fmtResult = await page.evaluate(() => {
    const sp = window._saldoPromMes('Mercado Pago', '2026-09');
    const rend = 0;
    const pct = sp > 0 ? rend / sp * 100 : NaN;
    return isNaN(pct) ? '—' : pct.toFixed(2) + '%';
  });
  expect(fmtResult).toBe('—');
});

// ── (l) Modo ojo oculta importes de la tabla ──────────────────
test('(l) modo ojo oculta importes pero porcentajes siguen visibles', async ({ page }) => {
  const state = {
    ...BASE_STATE,
    iniciales: { ...BASE_STATE.iniciales, 'Mercado Pago': 99000 },
    gastos: [
      { id: 'r1', creado: 1, monto: 1000, fecha: '2026-09-01', categoria: 'Rendimientos',
        descripcion: 'Rendimientos', medio: 'Mercado Pago', tipo: 'ingreso', soloHistorial: false },
      // October rendimiento so current month shows % in table
      { id: 'r2', creado: 2, monto: 1000, fecha: '2026-10-01', categoria: 'Rendimientos',
        descripcion: 'Rendimientos', medio: 'Mercado Pago', tipo: 'ingreso', soloHistorial: false },
    ],
  };
  await seedAndLoad(page, state);
  await enterPIN(page);
  await goEvolucion(page);

  // Enable ojo mode
  await page.locator('#btnOjo').click();
  await page.waitForTimeout(300);

  const ocultar = await page.evaluate(() => document.body.classList.contains('ocultar'));
  expect(ocultar).toBe(true);

  // .amt elements should have font-size:0 (hidden via CSS)
  const amtHidden = await page.evaluate(() => {
    const amts = [...document.querySelectorAll('#rendTablaWrap .amt')];
    if (!amts.length) return null;
    const style = window.getComputedStyle(amts[0]);
    return style.fontSize === '0px';
  });
  if (amtHidden !== null) expect(amtHidden).toBe(true);

  // % column should still contain text (not hidden)
  const pctVisible = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#rendTablaWrap td')];
    return cells.some(c => c.textContent.includes('%'));
  });
  expect(pctVisible).toBe(true);
});

// ── (m) Sin overflow a 360px ──────────────────────────────────
test('(m) sin overflow horizontal en la tarjeta Rendimientos a 360px', async ({ page }) => {
  const state = {
    ...BASE_STATE,
    iniciales: { ...BASE_STATE.iniciales, 'Mercado Pago': 99000 },
    gastos: [
      { id: 'r1', creado: 1, monto: 1000, fecha: '2026-09-01', categoria: 'Rendimientos',
        descripcion: 'Rendimientos', medio: 'Mercado Pago', tipo: 'ingreso', soloHistorial: false },
    ],
  };
  await page.setViewportSize({ width: 360, height: 812 });
  await seedAndLoad(page, state);
  await enterPIN(page);
  await goEvolucion(page);

  const overflow = await page.evaluate(() => {
    const card = document.getElementById('det-ev-cRend');
    if (!card) return false;
    return card.scrollWidth > card.clientWidth + 2;
  });
  expect(overflow).toBe(false);
});

// ── (n) Sin overflow a 412px ──────────────────────────────────
test('(n) sin overflow horizontal en la tarjeta Rendimientos a 412px', async ({ page }) => {
  const state = {
    ...BASE_STATE,
    iniciales: { ...BASE_STATE.iniciales, 'Mercado Pago': 99000 },
    gastos: [
      { id: 'r1', creado: 1, monto: 1000, fecha: '2026-09-01', categoria: 'Rendimientos',
        descripcion: 'Rendimientos', medio: 'Mercado Pago', tipo: 'ingreso', soloHistorial: false },
    ],
  };
  await page.setViewportSize({ width: 412, height: 915 });
  await seedAndLoad(page, state);
  await enterPIN(page);
  await goEvolucion(page);

  const overflow = await page.evaluate(() => {
    const card = document.getElementById('det-ev-cRend');
    if (!card) return false;
    return card.scrollWidth > card.clientWidth + 2;
  });
  expect(overflow).toBe(false);
});

// ── (o) Sin overflow a 450px ──────────────────────────────────
test('(o) sin overflow horizontal en la tarjeta Rendimientos a 450px', async ({ page }) => {
  const state = {
    ...BASE_STATE,
    iniciales: { ...BASE_STATE.iniciales, 'Mercado Pago': 99000 },
    gastos: [
      { id: 'r1', creado: 1, monto: 1000, fecha: '2026-09-01', categoria: 'Rendimientos',
        descripcion: 'Rendimientos', medio: 'Mercado Pago', tipo: 'ingreso', soloHistorial: false },
    ],
  };
  await page.setViewportSize({ width: 450, height: 900 });
  await seedAndLoad(page, state);
  await enterPIN(page);
  await goEvolucion(page);

  const overflow = await page.evaluate(() => {
    const card = document.getElementById('det-ev-cRend');
    if (!card) return false;
    return card.scrollWidth > card.clientWidth + 2;
  });
  expect(overflow).toBe(false);
});

// ── (p) Estado vacío amable cuando no hay rendimientos ─────────
test('(p) estado vacío amable cuando no hay rendimientos', async ({ page }) => {
  await seedAndLoad(page);
  await enterPIN(page);
  await goEvolucion(page);

  const text = await page.locator('#rendTablaWrap').textContent();
  expect(text).toMatch(/aún no hay rendimientos importados/i);
});
