const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';
const SK_TICKER = 'finanzas-v1-ticker-mode';
const SK_OJO = 'finanzas-v1-ocultar';

function buildEstado() {
  return {
    iniciales: {},
    gastos: [],
    items: [{ id: 'ia1', nombre: 'Efectivo', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 50000 }],
    patrimonioCargado: true,
    compromisos: [],
  };
}

async function seedAndUnlock(page, opts = {}) {
  await page.addInitScript(({ sk, pk, pin, data, ojoKey, ojoVal, tkKey, tkVal }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    if (ojoVal !== null) localStorage.setItem(ojoKey, JSON.stringify(ojoVal));
    if (tkVal !== null) localStorage.setItem(tkKey, tkVal);
  }, {
    sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: buildEstado(),
    ojoKey: SK_OJO, ojoVal: opts.ojoActivo ? true : null,
    tkKey: SK_TICKER, tkVal: opts.tickerMode || null,
  });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
  await page.locator('nav.tabs button[data-vista="evolucion"]').click();
  await page.waitForTimeout(600);
}

test.describe('ticker-evol: cinta de indicadores en Evolución', () => {
  test('(a) #tickerEvol existe y tiene ítems en la vista Evolución', async ({ page }) => {
    await seedAndUnlock(page);
    await expect(page.locator('#tickerEvol')).toBeVisible();
    const count = await page.locator('#tickerEvol .tk-item').count();
    expect(count).toBeGreaterThan(0);
  });

  test('(b) la cinta muestra los 5 indicadores (Patrimonio, Activos, Deudas, Gastos, Ingresos)', async ({ page }) => {
    await seedAndUnlock(page);
    const labels = await page.locator('#tickerEvol .tk-lbl').allTextContents();
    const unique = [...new Set(labels)];
    expect(unique.some(l => /patrimonio/i.test(l))).toBe(true);
    expect(unique.some(l => /activo/i.test(l))).toBe(true);
    expect(unique.some(l => /deuda/i.test(l))).toBe(true);
    expect(unique.some(l => /gasto/i.test(l))).toBe(true);
    expect(unique.some(l => /ingreso/i.test(l))).toBe(true);
  });

  test('(c) el botón de modo #tkModeBtn existe dentro del ticker', async ({ page }) => {
    await seedAndUnlock(page);
    await expect(page.locator('#tickerEvol #tkModeBtn')).toBeVisible();
  });

  test('(d) al cargar sin preferencia guardada la cinta arranca en modo desplazándose', async ({ page }) => {
    await seedAndUnlock(page);
    const hasSc = await page.evaluate(() => !!document.querySelector('#tickerEvol .tk-scroll'));
    expect(hasSc).toBe(true);
  });

  test('(e) el botón alterna de modo desplazándose a fijo', async ({ page }) => {
    await seedAndUnlock(page, { tickerMode: 'scroll' });
    await page.locator('#tickerEvol #tkModeBtn').click();
    await page.waitForTimeout(200);
    const hasFixed = await page.evaluate(() => !!document.querySelector('#tickerEvol .tk-fixed'));
    expect(hasFixed).toBe(true);
  });

  test('(f) el botón alterna de modo fijo a desplazándose', async ({ page }) => {
    await seedAndUnlock(page, { tickerMode: 'fixed' });
    await page.locator('#tickerEvol #tkModeBtn').click();
    await page.waitForTimeout(200);
    const hasSc = await page.evaluate(() => !!document.querySelector('#tickerEvol .tk-scroll'));
    expect(hasSc).toBe(true);
  });

  test('(g) el modo persiste tras recargar — fixed', async ({ page }) => {
    await seedAndUnlock(page, { tickerMode: 'fixed' });
    const hasFixed = await page.evaluate(() => !!document.querySelector('#tickerEvol .tk-fixed'));
    expect(hasFixed).toBe(true);
  });

  test('(h) el modo persiste tras recargar — scroll', async ({ page }) => {
    await seedAndUnlock(page, { tickerMode: 'scroll' });
    const hasSc = await page.evaluate(() => !!document.querySelector('#tickerEvol .tk-scroll'));
    expect(hasSc).toBe(true);
  });

  test('(i) con modo ojo activo los importes (.tk-val) no son visibles', async ({ page }) => {
    await seedAndUnlock(page, { ojoActivo: true });
    const anyVisible = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#tickerEvol .tk-val')).some(el =>
        getComputedStyle(el).display !== 'none'
      )
    );
    expect(anyVisible).toBe(false);
  });

  test('(j) con modo ojo activo los porcentajes (.tk-pct) siguen presentes', async ({ page }) => {
    await seedAndUnlock(page, { ojoActivo: true });
    const pctCount = await page.locator('#tickerEvol .tk-pct').count();
    expect(pctCount).toBeGreaterThan(0);
  });

  test('(k) importes ocultos tras cambiar de tema con ojo activo', async ({ page }) => {
    await seedAndUnlock(page);
    await page.locator('#btnOjo').click();
    await page.waitForTimeout(200);
    await page.locator('nav.tabs button[data-vista="config"]').click();
    await page.locator('.tema-btn[data-tema="oscuro"]').click();
    await page.waitForTimeout(200);
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForTimeout(600);
    const anyVisible = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#tickerEvol .tk-val')).some(el =>
        getComputedStyle(el).display !== 'none'
      )
    );
    expect(anyVisible).toBe(false);
  });

  test('(l) importes ocultos tras recargar con ojo activo persistido', async ({ page }) => {
    await seedAndUnlock(page, { ojoActivo: true });
    const anyVisible = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#tickerEvol .tk-val')).some(el =>
        getComputedStyle(el).display !== 'none'
      )
    );
    expect(anyVisible).toBe(false);
  });
});

test.describe('ticker-evol: layout responsive sin scroll horizontal', () => {
  let browser;
  test.beforeAll(async () => { browser = await chromium.launch(); });
  test.afterAll(async () => { await browser.close(); });

  async function openAt(width, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 } });
    await ctx.addInitScript(({ sk, pk, pin, data, tkKey, tkVal }) => {
      localStorage.setItem(sk, JSON.stringify(data));
      localStorage.setItem(pk, JSON.stringify(pin));
      if (tkVal) localStorage.setItem(tkKey, tkVal);
    }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: buildEstado(), tkKey: SK_TICKER, tkVal: opts.mode || null });
    const page = await ctx.newPage();
    await page.goto(INDEX);
    for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
    await page.waitForTimeout(400);
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForTimeout(600);
    return { page, ctx };
  }

  test('(m) a 360 px modo scroll: sin scroll horizontal de la página', async () => {
    const { page, ctx } = await openAt(360, { mode: 'scroll' });
    try {
      const noHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(noHScroll).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(n) a 360 px modo fixed: sin scroll horizontal de la página', async () => {
    const { page, ctx } = await openAt(360, { mode: 'fixed' });
    try {
      const noHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(noHScroll).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(o) a 390 px modo scroll: sin scroll horizontal de la página', async () => {
    const { page, ctx } = await openAt(390, { mode: 'scroll' });
    try {
      const noHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(noHScroll).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(p) a 390 px modo fixed: sin scroll horizontal de la página', async () => {
    const { page, ctx } = await openAt(390, { mode: 'fixed' });
    try {
      const noHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(noHScroll).toBe(true);
    } finally { await ctx.close(); }
  });
});
