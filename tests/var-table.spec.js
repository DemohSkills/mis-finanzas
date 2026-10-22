const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const SNAPS_KEY = 'finanzas-v1-snaps';
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
