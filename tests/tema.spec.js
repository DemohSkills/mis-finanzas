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
});
