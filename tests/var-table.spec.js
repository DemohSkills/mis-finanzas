const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const SNAPS_KEY = 'finanzas-v1-snaps';
const SK_VT_PLEGADO = 'finanzas-v1-vt-plegado';
const TEST_PIN = '1234';

function buildEstado() {
  return {
    iniciales: { 'Efectivo': 300000 },
    gastos: [],
    items: [
      { id: 'ia1', nombre: 'Efectivo', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 300000 },
      { id: 'id1', nombre: 'Visa Santander', grupo: 'Tarjetas de crédito', tipo: 'deuda', monto: 80000 },
    ],
    patrimonioCargado: true,
    compromisos: [],
  };
}

// Snaps covering 1d, 7d and 30d ago
function buildSnaps() {
  const now = new Date('2026-10-22');
  function daysAgo(n) {
    const d = new Date(now); d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }
  return [
    { d: daysAgo(35), a: 200000, dv: 100000, n: 100000, dd: {} },
    { d: daysAgo(8),  a: 250000, dv: 90000,  n: 160000, dd: {} },
    { d: daysAgo(2),  a: 280000, dv: 85000,  n: 195000, dd: {} },
  ];
}

async function seedAndUnlock(page, snapsData) {
  await page.addInitScript(({ sk, pk, pin, data, snk, sndata }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    if (sndata) localStorage.setItem(snk, JSON.stringify(sndata));
    else localStorage.removeItem(snk);
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: buildEstado(), snk: SNAPS_KEY, sndata: snapsData });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}

async function goToEvolucion(page) {
  await page.locator('nav.tabs button[data-vista="evolucion"]').click();
  await page.waitForTimeout(600);
}

test.describe('Part 2: cuadro de variaciones en Evolución', () => {
  test('(a) #varTable existe en la vista Evolución', async ({ page }) => {
    await seedAndUnlock(page, buildSnaps());
    await goToEvolucion(page);
    await expect(page.locator('#varTable')).toBeVisible();
  });

  test('(b) la tabla tiene encabezados Hoy, Var. 1 día, Var. 7 días, Var. 30 días', async ({ page }) => {
    await seedAndUnlock(page, buildSnaps());
    await goToEvolucion(page);
    const headers = await page.locator('#varTable .vt-tabla thead th').allTextContents();
    expect(headers).toContain('Hoy');
    expect(headers.some(h => h.includes('1 día'))).toBe(true);
    expect(headers.some(h => h.includes('7 días'))).toBe(true);
    expect(headers.some(h => h.includes('30 días'))).toBe(true);
  });

  test('(c) la tabla tiene filas Patrimonio neto, Activos, Deudas', async ({ page }) => {
    await seedAndUnlock(page, buildSnaps());
    await goToEvolucion(page);
    const rows = await page.locator('#varTable .vt-tabla tbody th').allTextContents();
    expect(rows).toContain('Patrimonio neto');
    expect(rows).toContain('Activos');
    expect(rows).toContain('Deudas');
  });

  test('(d) sin snaps muestra "—" en todas las columnas de variación', async ({ page }) => {
    await seedAndUnlock(page, []);
    await goToEvolucion(page);
    const dashes = await page.locator('#varTable .vt-tabla td').allTextContents();
    const dashCount = dashes.filter(t => t.trim() === '—').length;
    // 3 rows × 3 variation columns = 9 dashes
    expect(dashCount).toBe(9);
  });

  test('(e) con snaps la columna Var. 1 día muestra un valor (no "—")', async ({ page }) => {
    await seedAndUnlock(page, buildSnaps());
    await goToEvolucion(page);
    // segunda columna de variación (3ra td por fila = Var. 1 día)
    // check at least one variation cell has a non-dash value
    const cells = await page.locator('#varTable .vt-tabla tbody td').allTextContents();
    const nonDash = cells.filter(t => t.trim() !== '—' && t.trim() !== 'Hoy');
    expect(nonDash.length).toBeGreaterThan(0);
  });

  test('(f) deuda que baja obtiene clase "pos" (verde)', async ({ page }) => {
    // Current deuda = 80000, snap has dv=85000, so diff = 80000-85000=-5000 → should be pos for deuda
    await seedAndUnlock(page, buildSnaps());
    await goToEvolucion(page);
    // The deuda row's variation cell when debt decreased should have class pos
    const deudaRow = page.locator('#varTable .vt-tabla tbody tr').nth(2); // Deudas row
    const posCells = deudaRow.locator('td.pos');
    const count = await posCells.count();
    expect(count).toBeGreaterThan(0);
  });

  test('(g) con modo ojo activo los importes de Hoy se ocultan (span.amt)', async ({ page }) => {
    await seedAndUnlock(page, buildSnaps());
    await goToEvolucion(page);
    await page.locator('#btnOjo').click();
    await page.waitForTimeout(300);
    // body should have class ocultar
    const hasOcultar = await page.evaluate(() => document.body.classList.contains('ocultar'));
    expect(hasOcultar).toBe(true);
    // varTable should have span.amt elements
    const amtCount = await page.locator('#varTable span.amt').count();
    expect(amtCount).toBeGreaterThan(0);
  });

  test('(h) los porcentajes no están dentro de span.amt (visibles en modo ojo)', async ({ page }) => {
    await seedAndUnlock(page, buildSnaps());
    await goToEvolucion(page);
    // pct spans should use vt-pct class, not amt
    const pctSpans = await page.locator('#varTable .vt-pct').count();
    expect(pctSpans).toBeGreaterThan(0);
    // none of them should be inside a span.amt
    const pctInsideAmt = await page.locator('#varTable span.amt .vt-pct').count();
    expect(pctInsideAmt).toBe(0);
  });

  test('(i) #varTable está antes del primer details.ev-card', async ({ page }) => {
    await seedAndUnlock(page, buildSnaps());
    await goToEvolucion(page);
    const isBeforeCard = await page.evaluate(() => {
      const varTable = document.getElementById('varTable');
      const firstCard = document.querySelector('#vista-evolucion details.ev-card');
      if (!varTable || !firstCard) return false;
      return !!(varTable.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(isBeforeCard).toBe(true);
  });

  test('(j) sin errores JS al cargar la vista con variaciones', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndUnlock(page, buildSnaps());
    await goToEvolucion(page);
    await page.waitForTimeout(300);
    expect(errors).toHaveLength(0);
  });
});

test.describe('Part 3: cuadro de variaciones — layout responsive', () => {
  let browser;
  test.beforeAll(async () => { browser = await chromium.launch(); });
  test.afterAll(async () => { await browser.close(); });

  async function seedUnlockGoEvolucion(width) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 } });
    await ctx.addInitScript(({ sk, pk, pin, data, snk, sndata }) => {
      localStorage.setItem(sk, JSON.stringify(data));
      localStorage.setItem(pk, JSON.stringify(pin));
      localStorage.setItem(snk, JSON.stringify(sndata));
    }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: buildEstado(), snk: SNAPS_KEY, sndata: buildSnaps() });
    const page = await ctx.newPage();
    await page.goto(INDEX);
    for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
    await page.waitForTimeout(400);
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForTimeout(600);
    return { page, ctx };
  }

  test('(k) a 360 px no hay scroll horizontal y las 4 columnas de datos son visibles', async () => {
    const { page, ctx } = await seedUnlockGoEvolucion(360);
    try {
      const noHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(noHScroll).toBe(true);

      const colsVisible = await page.evaluate(() => {
        const ths = Array.from(document.querySelectorAll('#varTable .vt-tabla thead th'));
        const dataCols = ths.filter(th => th.textContent.trim() !== '');
        if (dataCols.length < 4) return false;
        return dataCols.every(th => {
          const r = th.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
      });
      expect(colsVisible).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test('(l) a 390 px no hay scroll horizontal y las 4 columnas de datos son visibles', async () => {
    const { page, ctx } = await seedUnlockGoEvolucion(390);
    try {
      const noHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(noHScroll).toBe(true);

      const colsVisible = await page.evaluate(() => {
        const ths = Array.from(document.querySelectorAll('#varTable .vt-tabla thead th'));
        const dataCols = ths.filter(th => th.textContent.trim() !== '');
        if (dataCols.length < 4) return false;
        return dataCols.every(th => {
          const r = th.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
      });
      expect(colsVisible).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});

// ── Part 4: cuadro plegable ──
test.describe('Part 4: cuadro de variaciones plegable', () => {
  async function seedUnlockEvol(page, vtPlegado = null) {
    await page.addInitScript(({ sk, pk, pin, data, snk, sndata, vtKey, vtVal }) => {
      localStorage.setItem(sk, JSON.stringify(data));
      localStorage.setItem(pk, JSON.stringify(pin));
      localStorage.setItem(snk, JSON.stringify(sndata));
      if (vtVal !== null) localStorage.setItem(vtKey, JSON.stringify(vtVal));
      else localStorage.removeItem(vtKey);
    }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: buildEstado(), snk: SNAPS_KEY, sndata: buildSnaps(), vtKey: SK_VT_PLEGADO, vtVal: vtPlegado });
    await page.goto(INDEX);
    for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
    await page.waitForTimeout(400);
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForTimeout(600);
  }

  test('(m) por defecto la tabla está desplegada y el botón ▾ es visible', async ({ page }) => {
    await seedUnlockEvol(page);
    const wrap = page.locator('#varTable .vt-wrap');
    await expect(wrap).not.toHaveClass(/vt-wrap-hidden/);
    const btn = page.locator('#varTable .vt-toggle-btn');
    await expect(btn).toBeVisible();
    const text = await btn.textContent();
    expect(text).toBe('▾');
  });

  test('(n) al tocar ▾ la tabla se oculta y aparece la barrita ▸ Variaciones', async ({ page }) => {
    await seedUnlockEvol(page);
    await page.locator('#varTable .vt-toggle-btn').click();
    await page.waitForTimeout(200);
    // Tabla oculta
    const wrap = page.locator('#varTable .vt-wrap');
    await expect(wrap).toHaveClass(/vt-wrap-hidden/);
    // Barrita visible
    const bar = page.locator('#varTable .vt-bar');
    await expect(bar).toBeVisible();
    const barText = await bar.textContent();
    expect(barText).toContain('Variaciones');
  });

  test('(o) al tocar la barrita la tabla vuelve a desplegarse', async ({ page }) => {
    await seedUnlockEvol(page, true);
    const bar = page.locator('#varTable .vt-bar');
    await expect(bar).toBeVisible();
    await bar.click();
    await page.waitForTimeout(200);
    const wrap = page.locator('#varTable .vt-wrap');
    await expect(wrap).not.toHaveClass(/vt-wrap-hidden/);
    await expect(bar).toHaveClass(/vt-bar-hidden/);
  });

  test('(p) estado plegado persiste tras recargar', async ({ page }) => {
    await seedUnlockEvol(page, true);
    const wrap = page.locator('#varTable .vt-wrap');
    await expect(wrap).toHaveClass(/vt-wrap-hidden/);
    // Verify localStorage
    const stored = await page.evaluate(k => localStorage.getItem(k), SK_VT_PLEGADO);
    expect(JSON.parse(stored)).toBe(true);
  });

  test('(q) estado desplegado persiste tras recargar', async ({ page }) => {
    await seedUnlockEvol(page, false);
    const wrap = page.locator('#varTable .vt-wrap');
    await expect(wrap).not.toHaveClass(/vt-wrap-hidden/);
  });

  test('(r) estado se aplica correctamente tras re-render (renderVarTable)', async ({ page }) => {
    await seedUnlockEvol(page, true);
    // Trigger a re-render by toggling ojo
    await page.locator('#btnOjo').click();
    await page.waitForTimeout(200);
    await page.locator('#btnOjo').click();
    await page.waitForTimeout(200);
    // Still collapsed after re-render
    const wrap = page.locator('#varTable .vt-wrap');
    await expect(wrap).toHaveClass(/vt-wrap-hidden/);
  });

  test('(s) ▾ visible cuando desplegado, ▸ visible en el botón de tabla cuando plegado', async ({ page }) => {
    await seedUnlockEvol(page);
    // Expanded: ▾ in toggle button
    expect(await page.locator('#varTable .vt-toggle-btn').textContent()).toBe('▾');
    // Collapse
    await page.locator('#varTable .vt-toggle-btn').click();
    await page.waitForTimeout(200);
    // Bar has ▸
    expect(await page.locator('#varTable .vt-bar').textContent()).toContain('▸');
  });

  test('(t) modo ojo oculta valores en estado desplegado', async ({ page }) => {
    await seedUnlockEvol(page, false);
    await page.locator('#btnOjo').click();
    await page.waitForTimeout(200);
    const hasOcultar = await page.evaluate(() => document.body.classList.contains('ocultar'));
    expect(hasOcultar).toBe(true);
    const amtCount = await page.locator('#varTable span.amt').count();
    expect(amtCount).toBeGreaterThan(0);
  });

  test('(u) modo ojo no rompe en estado plegado', async ({ page }) => {
    await seedUnlockEvol(page, true);
    // Click ojo while collapsed
    await page.locator('#btnOjo').click();
    await page.waitForTimeout(200);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Expand now — table should show hidden values
    await page.locator('#varTable .vt-bar').click();
    await page.waitForTimeout(200);
    const amtCount = await page.locator('#varTable span.amt').count();
    expect(amtCount).toBeGreaterThan(0);
    expect(errors).toHaveLength(0);
  });
});

// ── Part 5: encabezados centrados ──
test.describe('Part 5: encabezados del cuadro — alineación', () => {
  async function seedUnlockEvol(page) {
    await page.addInitScript(({ sk, pk, pin, data, snk, sndata }) => {
      localStorage.setItem(sk, JSON.stringify(data));
      localStorage.setItem(pk, JSON.stringify(pin));
      localStorage.setItem(snk, JSON.stringify(sndata));
    }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: buildEstado(), snk: SNAPS_KEY, sndata: buildSnaps() });
    await page.goto(INDEX);
    for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
    await page.waitForTimeout(400);
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForTimeout(600);
  }

  test('(v) los th de datos (Hoy, Var. 1 día, etc.) están centrados', async ({ page }) => {
    await seedUnlockEvol(page);
    const centered = await page.evaluate(() => {
      const ths = Array.from(document.querySelectorAll('#varTable .vt-tabla thead th'));
      const dataThs = ths.slice(1); // skip first (toggle button)
      return dataThs.every(th => getComputedStyle(th).textAlign === 'center');
    });
    expect(centered).toBe(true);
  });

  test('(w) los th de filas (Patrimonio, Activos, Deudas) están alineados a la izquierda', async ({ page }) => {
    await seedUnlockEvol(page);
    const leftAligned = await page.evaluate(() => {
      const ths = Array.from(document.querySelectorAll('#varTable .vt-tabla tbody th'));
      return ths.every(th => {
        const align = getComputedStyle(th).textAlign;
        return align === 'left' || align === 'start';
      });
    });
    expect(leftAligned).toBe(true);
  });

  test('(x) sin overflow horizontal a 360px con cuadro desplegado', async () => {
    const ctx = await chromium.launch().then(b => b.newContext({ viewport: { width: 360, height: 844 } }));
    await ctx.addInitScript(({ sk, pk, pin, data, snk, sndata }) => {
      localStorage.setItem(sk, JSON.stringify(data));
      localStorage.setItem(pk, JSON.stringify(pin));
      localStorage.setItem(snk, JSON.stringify(sndata));
    }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: buildEstado(), snk: SNAPS_KEY, sndata: buildSnaps() });
    const page = await ctx.newPage();
    await page.goto(INDEX);
    for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
    await page.waitForTimeout(400);
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForTimeout(600);
    try {
      const noHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(noHScroll).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(y) sin overflow horizontal a 412px', async () => {
    const ctx = await chromium.launch().then(b => b.newContext({ viewport: { width: 412, height: 844 } }));
    await ctx.addInitScript(({ sk, pk, pin, data, snk, sndata }) => {
      localStorage.setItem(sk, JSON.stringify(data));
      localStorage.setItem(pk, JSON.stringify(pin));
      localStorage.setItem(snk, JSON.stringify(sndata));
    }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: buildEstado(), snk: SNAPS_KEY, sndata: buildSnaps() });
    const page = await ctx.newPage();
    await page.goto(INDEX);
    for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
    await page.waitForTimeout(400);
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForTimeout(600);
    try {
      const noHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(noHScroll).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(z) sin overflow horizontal a 450px', async () => {
    const ctx = await chromium.launch().then(b => b.newContext({ viewport: { width: 450, height: 844 } }));
    await ctx.addInitScript(({ sk, pk, pin, data, snk, sndata }) => {
      localStorage.setItem(sk, JSON.stringify(data));
      localStorage.setItem(pk, JSON.stringify(pin));
      localStorage.setItem(snk, JSON.stringify(sndata));
    }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: buildEstado(), snk: SNAPS_KEY, sndata: buildSnaps() });
    const page = await ctx.newPage();
    await page.goto(INDEX);
    for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
    await page.waitForTimeout(400);
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForTimeout(600);
    try {
      const noHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(noHScroll).toBe(true);
    } finally { await ctx.close(); }
  });
});
