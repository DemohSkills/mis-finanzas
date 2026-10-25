// @ts-check
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

const META = 'meta[name="theme-color"]';
const leerMeta = page => page.evaluate(sel => document.querySelector(sel).content, META);

async function abrir(browser, tema, scheme, pin = true) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme || 'light' });
  await ctx.addInitScript(t => {
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    localStorage.setItem('finanzas-v1', JSON.stringify({ iniciales: {}, gastos: [], items: [], patrimonioCargado: true }));
    if (t) localStorage.setItem('finanzas-v1-tema', JSON.stringify(t));
  }, tema);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // Antes de que corra el JS principal: se lee el meta apenas termina el script inline del <head>
  await page.goto(FILE_URL, { waitUntil: 'commit' });
  return { page, ctx, errors };
}

async function desbloquear(page) {
  for (const d of ['1', '2', '3', '4']) {
    await page.locator('.pin-pad button').filter({ hasText: d }).first().click();
  }
  await expect(page.locator('#app')).not.toBeHidden({ timeout: 3000 });
}

test.describe('theme-color al arrancar', () => {
  let browser;
  test.beforeAll(async () => { browser = await chromium.launch(); });
  test.afterAll(async () => { await browser.close(); });

  const casos = [['negro', '#000'], ['claro', '#f4f6fa'], ['oscuro', '#0f172a']];
  for (const [tema, color] of casos) {
    test(`tema guardado ${tema}: meta ${color} apenas carga (sin PIN)`, async () => {
      const { page, ctx, errors } = await abrir(browser, tema, tema === 'claro' ? 'dark' : 'light');
      await page.waitForSelector('.pin-pad button');
      expect(await leerMeta(page)).toBe(color);
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }

  for (const [scheme, color] of [['dark', '#0f172a'], ['light', '#f4f6fa']]) {
    test(`tema auto con prefers-color-scheme ${scheme}: meta ${color}`, async () => {
      const { page, ctx, errors } = await abrir(browser, 'auto', scheme);
      await page.waitForSelector('.pin-pad button');
      expect(await leerMeta(page)).toBe(color);
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }

  test('sin tema guardado se comporta como auto', async () => {
    const { page, ctx } = await abrir(browser, null, 'light');
    await page.waitForSelector('.pin-pad button');
    expect(await leerMeta(page)).toBe('#f4f6fa');
    await ctx.close();
  });

  test('auto: reacciona al cambio de prefers-color-scheme', async () => {
    const { page, ctx } = await abrir(browser, 'auto', 'light');
    await page.waitForSelector('.pin-pad button');
    expect(await leerMeta(page)).toBe('#f4f6fa');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => leerMeta(page)).toBe('#0f172a');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => leerMeta(page)).toBe('#f4f6fa');
    await ctx.close();
  });

  test('tema fijo: el cambio de prefers-color-scheme no pisa el meta', async () => {
    const { page, ctx } = await abrir(browser, 'negro', 'light');
    await page.waitForSelector('.pin-pad button');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await leerMeta(page)).toBe('#000');
    await ctx.close();
  });

  test('cambiar de tema con los botones sigue actualizando el meta', async () => {
    const { page, ctx, errors } = await abrir(browser, 'negro', 'light');
    await desbloquear(page);
    await page.locator('.tabs button[data-vista="config"]').click();
    const esperado = { claro: '#f4f6fa', oscuro: '#0f172a', negro: '#000', auto: '#f4f6fa' };
    for (const t of ['claro', 'oscuro', 'negro', 'auto']) {
      await page.locator(`.tema-btn[data-tema="${t}"]`).click();
      expect(await leerMeta(page)).toBe(esperado[t]);
    }
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
