// @ts-check
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

// Pre-set PIN so the app unlocks without user interaction
async function openApp(browser, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(() => {
    // ls.get/set use JSON.parse/stringify, so values must be JSON-encoded
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    // Mark wizard as complete so arrancarApp() goes straight to the app
    localStorage.setItem('finanzas-v1', JSON.stringify({ iniciales:{}, gastos:[], items:[], patrimonioCargado:true }));
  });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(FILE_URL);

  // Click PIN digits 1 2 3 4
  const digits = page.locator('#pinPad button, .pin-pad button');
  for (const d of ['1','2','3','4']) {
    await page.locator('.pin-pad button').filter({ hasText: d }).first().click();
  }

  // Wait for main app to appear
  await expect(page.locator('#app')).not.toBeHidden({ timeout: 3000 });

  return { page, errors };
}

test.describe('Reorganización de pantalla principal', () => {
  let browser;

  test.beforeAll(async () => {
    browser = await chromium.launch();
  });

  test.afterAll(async () => {
    await browser.close();
  });

  test('(a) sin errores de JS al cargar', async () => {
    const { errors } = await openApp(browser);
    expect(errors).toEqual([]);
  });

  test('(b) existen las 7 solapas en una sola barra .tabs', async () => {
    const { page } = await openApp(browser);
    const tabsNavs = page.locator('nav.tabs');
    await expect(tabsNavs).toHaveCount(1);
    const buttons = tabsNavs.locator('button[data-vista]');
    await expect(buttons).toHaveCount(7);
  });

  test('(c) al cargar la solapa visible es Inicio con #saldos y #totNeto', async () => {
    const { page } = await openApp(browser);
    const inicioVista = page.locator('#vista-inicio');
    await expect(inicioVista).toBeVisible();
    await expect(page.locator('#saldos')).toBeVisible();
    await expect(page.locator('#totNeto')).toBeVisible();
  });

  test('(d) en Movim. #saldos y #totNeto NO son visibles', async () => {
    const { page } = await openApp(browser);
    await page.locator('.tabs button[data-vista="gastos"]').click();
    await expect(page.locator('#saldos')).not.toBeVisible();
    await expect(page.locator('#totNeto')).not.toBeVisible();
  });

  test('(e) todas las solapas se pueden abrir sin error', async () => {
    const { page, errors } = await openApp(browser);
    const vistas = ['inicio','gastos','vinculos','patrimonio','evolucion','config','compromisos'];
    for (const v of vistas) {
      await page.locator(`.tabs button[data-vista="${v}"]`).click();
      await expect(page.locator(`#vista-${v}`)).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('(f) "Vínculos Comerciales" figura en la barra de solapas', async () => {
    const { page } = await openApp(browser);
    const btn = page.locator('.tabs button[data-vista="vinculos"]');
    await expect(btn).toHaveText('Vínculos Comerciales');
  });

  test('(g) en viewport 390px el texto de #totNeto no se parte en dos líneas', async () => {
    const { page } = await openApp(browser, { width: 390, height: 844 });
    const el = page.locator('#totNeto');
    const box = await el.boundingBox();
    // A single line of text at any reasonable font size should be under 40px tall
    expect(box.height).toBeLessThan(40);
  });
});
