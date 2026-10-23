// @ts-check
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

async function openApp(browser, extraInit = () => {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    localStorage.setItem('finanzas-v1', JSON.stringify({ iniciales:{}, gastos:[], items:[], patrimonioCargado:true }));
  });
  await ctx.addInitScript(extraInit);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE_URL);
  for (const d of ['1','2','3','4']) {
    await page.locator('.pin-pad button').filter({ hasText: d }).first().click();
  }
  await expect(page.locator('#app')).not.toBeHidden({ timeout: 3000 });
  return { page, ctx, errors };
}

test.describe('Selector de tema', () => {
  let browser;
  test.beforeAll(async () => { browser = await chromium.launch(); });
  test.afterAll(async () => { await browser.close(); });

  test('(a) sin errores de JS al cargar', async () => {
    const { errors } = await openApp(browser);
    expect(errors).toEqual([]);
  });

  test('(b) los 4 botones de tema existen en la pestaña Config', async () => {
    const { page } = await openApp(browser);
    await page.locator('.tabs button[data-vista="config"]').click();
    await expect(page.locator('#vista-config')).toBeVisible();
    for (const t of ['auto','claro','oscuro','negro']) {
      await expect(page.locator(`.tema-btn[data-tema="${t}"]`)).toBeVisible();
    }
  });

  test('(c) al seleccionar "oscuro" se aplica data-theme en <html>', async () => {
    const { page } = await openApp(browser);
    await page.locator('.tabs button[data-vista="config"]').click();
    await page.locator('.tema-btn[data-tema="oscuro"]').click();
    const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(attr).toBe('oscuro');
  });

  test('(d) el tema persiste tras recargar la página', async () => {
    const { page, ctx } = await openApp(browser);
    await page.locator('.tabs button[data-vista="config"]').click();
    await page.locator('.tema-btn[data-tema="negro"]').click();
    // Reload — the early inline script should restore data-theme before body renders
    await page.reload();
    // Enter PIN again
    for (const d of ['1','2','3','4']) {
      await page.locator('.pin-pad button').filter({ hasText: d }).first().click();
    }
    await expect(page.locator('#app')).not.toBeHidden({ timeout: 3000 });
    const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(attr).toBe('negro');
  });

  test('(e) el informe sigue con fondo blanco en tema Negro', async () => {
    const { page } = await openApp(browser);
    await page.locator('.tabs button[data-vista="config"]').click();
    await page.locator('.tema-btn[data-tema="negro"]').click();
    // Open informe
    await page.locator('#btnInformeConfig').click();
    const inf = page.locator('#informeView');
    await expect(inf).toBeVisible();
    const bg = await inf.evaluate(el => getComputedStyle(el).backgroundColor);
    // rgb(255, 255, 255) = white
    expect(bg).toBe('rgb(255, 255, 255)');
  });

  test('(f) el botón activo tiene clase "primary"', async () => {
    const { page } = await openApp(browser);
    await page.locator('.tabs button[data-vista="config"]').click();
    await page.locator('.tema-btn[data-tema="claro"]').click();
    await expect(page.locator('.tema-btn[data-tema="claro"]')).toHaveClass(/primary/);
    await expect(page.locator('.tema-btn[data-tema="oscuro"]')).not.toHaveClass(/primary/);
  });

  test('(g) "auto" restaura el comportamiento sin data-theme', async () => {
    const { page } = await openApp(browser);
    await page.locator('.tabs button[data-vista="config"]').click();
    await page.locator('.tema-btn[data-tema="oscuro"]').click();
    await page.locator('.tema-btn[data-tema="auto"]').click();
    const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(attr).toBeNull();
  });

  test('(h) en tema Negro --grid-color usa color tenue; Oscuro y Claro usan sus valores de borde', async () => {
    const { page } = await openApp(browser);
    await page.locator('.tabs button[data-vista="config"]').click();

    await page.locator('.tema-btn[data-tema="negro"]').click();
    const gridNegro = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--grid-color').trim()
    );
    expect(gridNegro).toBe('rgba(255,255,255,.08)');

    await page.locator('.tema-btn[data-tema="oscuro"]').click();
    const gridOscuro = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--grid-color').trim()
    );
    expect(gridOscuro).toBe('#334155');

    await page.locator('.tema-btn[data-tema="claro"]').click();
    const gridClaro = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--grid-color').trim()
    );
    expect(gridClaro).toBe('#e2e8f0');
  });
});

test.describe('Pulse — ciclo de temas', () => {
  let browser;
  test.beforeAll(async () => { browser = await chromium.launch(); });
  test.afterAll(async () => { await browser.close(); });

  async function openWithTema(temaVal) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript((temaVal) => {
      localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
      localStorage.setItem('finanzas-v1', JSON.stringify({ iniciales:{}, gastos:[], items:[], patrimonioCargado:true }));
      if (temaVal) localStorage.setItem('finanzas-v1-tema', temaVal);
      else localStorage.removeItem('finanzas-v1-tema');
    }, temaVal);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(FILE_URL);
    for (const d of ['1','2','3','4']) {
      await page.locator('.pin-pad button').filter({ hasText: d }).first().click();
    }
    await expect(page.locator('#app')).not.toBeHidden({ timeout: 3000 });
    return { page, ctx, errors };
  }

  async function clickPulse(page) {
    await page.locator('.app-hdr h1 .pulse').click();
    await page.waitForTimeout(150);
  }

  test('(i) un clic en Pulse cicla Auto→Claro', async () => {
    const { page, ctx } = await openWithTema(null);
    try {
      await clickPulse(page);
      const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      expect(attr).toBe('claro');
    } finally { await ctx.close(); }
  });

  test('(j) ciclo completo: Auto→Claro→Oscuro→Negro→Auto en 4 toques', async () => {
    const { page, ctx } = await openWithTema(null);
    try {
      await clickPulse(page); // → claro
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('claro');
      await clickPulse(page); // → oscuro
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('oscuro');
      await clickPulse(page); // → negro
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('negro');
      await clickPulse(page); // → auto (null)
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBeNull();
    } finally { await ctx.close(); }
  });

  test('(k) el tema persiste en finanzas-v1-tema después de ciclar', async () => {
    const { page, ctx } = await openWithTema(null);
    try {
      await clickPulse(page); // → claro
      const stored = await page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('finanzas-v1-tema')); } catch { return null; }
      });
      expect(stored).toBe('claro');
    } finally { await ctx.close(); }
  });

  test('(l) Pulse NO recarga la página', async () => {
    const { page, ctx } = await openWithTema(null);
    try {
      const navCount = await page.evaluate(() => performance.getEntriesByType('navigation').length);
      await clickPulse(page);
      await page.waitForTimeout(600);
      const navCountAfter = await page.evaluate(() => performance.getEntriesByType('navigation').length);
      // If reload happened, navigation entries would increase or href would reload
      expect(navCountAfter).toBe(navCount);
      // Also verify the app is still visible (not reloaded to PIN screen)
      await expect(page.locator('#app')).toBeVisible();
    } finally { await ctx.close(); }
  });

  test('(m) el toast muestra el nombre del tema ("Tema: Claro")', async () => {
    const { page, ctx } = await openWithTema(null);
    try {
      await clickPulse(page);
      const text = await page.evaluate(() => document.getElementById('toastActualizar')?.textContent);
      expect(text).toContain('Tema:');
      expect(text).toContain('Claro');
    } finally { await ctx.close(); }
  });

  test('(n) navigator.vibrate(25) es llamado al ciclar', async () => {
    const { page, ctx } = await openWithTema(null);
    try {
      await page.evaluate(() => {
        window._vibrateCalls = [];
        navigator.vibrate = (ms) => { window._vibrateCalls.push(ms); return true; };
      });
      await clickPulse(page);
      const calls = await page.evaluate(() => window._vibrateCalls);
      expect(calls).toContain(25);
    } finally { await ctx.close(); }
  });

  test('(o) el selector .tema-btn en ⚙️ queda sincronizado tras ciclar', async () => {
    const { page, ctx } = await openWithTema(null);
    try {
      await clickPulse(page); // → claro
      await page.locator('.tabs button[data-vista="config"]').click();
      await page.waitForTimeout(200);
      await expect(page.locator('.tema-btn[data-tema="claro"]')).toHaveClass(/primary/);
      await expect(page.locator('.tema-btn[data-tema="auto"]')).not.toHaveClass(/primary/);
    } finally { await ctx.close(); }
  });

  test('(p) sin errores de consola al ciclar todos los temas', async () => {
    const { page, ctx, errors } = await openWithTema(null);
    try {
      for (let i = 0; i < 4; i++) await clickPulse(page);
      expect(errors).toEqual([]);
    } finally { await ctx.close(); }
  });
});
