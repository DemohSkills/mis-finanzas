/**
 * Tests Tarea 2: bug "Conciliado hasta" — al marcar un banco no se pierde la fecha del otro.
 */
// @ts-check
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

const BASE_STATE = {
  iniciales: { 'Banco Santander': 50000, 'Mercado Pago': 5000, 'Efectivo': 0, 'Visa Santander': 0, 'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0 },
  gastos: [], items: [], patrimonioCargado: true, compromisos: [], importaciones: {},
};

async function seedAndLoad(page, state = BASE_STATE) {
  await page.addInitScript((s) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(s));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
  }, state);
  await page.goto(FILE_URL);
}

async function enterPIN(page) {
  for (const d of ['1','2','3','4'])
    await page.locator(`[data-d="${d}"]`).click();
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

test.describe('Bug Conciliado hasta — preservar fecha del otro banco', () => {
  let browser;
  test.beforeAll(async () => { browser = await chromium.launch(); });
  test.afterAll(async () => { await browser.close(); });

  // (a) Marcar Santander no borra la fecha que se escribió en MP
  test('(a) al marcar Santander, el input de fecha de MP se conserva', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndLoad(page);
    await enterPIN(page);

    // Open the import modal via JS (avoid file picker)
    await page.evaluate(() => window.abrirImportModal());
    await expect(page.locator('#impModal')).toBeVisible({ timeout: 3000 });

    // Expand the "Marcar conciliado" details
    const det = page.locator('#impModal details').first();
    await det.evaluate(el => el.setAttribute('open', ''));

    // Type a date in the MP input
    await page.evaluate(() => {
      const el = document.getElementById('concilFechaMP');
      if (el) el.value = '2026-10-20';
    });

    // Mark Santander via JS (same as clicking the button)
    await page.evaluate(() => window._marcarConciliadoHasta('Banco Santander', '2026-10-18'));

    // The MP input should still have the value we typed
    const mpVal = await page.evaluate(() => document.getElementById('concilFechaMP')?.value);
    expect(mpVal).toBe('2026-10-20');

    expect(errors).toHaveLength(0);
    await ctx.close();
  });

  // (b) Marcar MP no borra la fecha escrita en Santander
  test('(b) al marcar MP, el input de fecha de Santander se conserva', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndLoad(page);
    await enterPIN(page);

    await page.evaluate(() => window.abrirImportModal());
    await expect(page.locator('#impModal')).toBeVisible({ timeout: 3000 });
    const det = page.locator('#impModal details').first();
    await det.evaluate(el => el.setAttribute('open', ''));

    // Type a date in the Santander input
    await page.evaluate(() => {
      const el = document.getElementById('concilFechaSant');
      if (el) el.value = '2026-10-15';
    });

    // Mark MP
    await page.evaluate(() => window._marcarConciliadoHasta('Mercado Pago', '2026-10-19'));

    const santVal = await page.evaluate(() => document.getElementById('concilFechaSant')?.value);
    expect(santVal).toBe('2026-10-15');

    expect(errors).toHaveLength(0);
    await ctx.close();
  });

  // (c) Marcar un banco guarda correctamente en estado
  test('(c) _marcarConciliadoHasta guarda la fecha correcta en estado.importaciones', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndLoad(page);
    await enterPIN(page);

    await page.evaluate(() => window.abrirImportModal());
    await page.evaluate(() => window._marcarConciliadoHasta('Banco Santander', '2026-10-18'));

    const imp = await page.evaluate(() => window._getEstado().importaciones['Banco Santander']);
    expect(imp).toBeDefined();
    expect(imp.hasta).toBe('2026-10-18');
    expect(imp.lote).toBeNull();

    expect(errors).toHaveLength(0);
    await ctx.close();
  });

  // (d) Marcar ambos bancos en secuencia guarda ambos
  test('(d) marcar ambos bancos en secuencia — ambas marcas se guardan', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndLoad(page);
    await enterPIN(page);

    await page.evaluate(() => window.abrirImportModal());
    await page.evaluate(() => window._marcarConciliadoHasta('Banco Santander', '2026-10-18'));
    await page.evaluate(() => window._marcarConciliadoHasta('Mercado Pago', '2026-10-19'));

    const imps = await page.evaluate(() => {
      const est = window._getEstado();
      return {
        sant: est.importaciones['Banco Santander']?.hasta,
        mp: est.importaciones['Mercado Pago']?.hasta,
      };
    });
    expect(imps.sant).toBe('2026-10-18');
    expect(imps.mp).toBe('2026-10-19');

    expect(errors).toHaveLength(0);
    await ctx.close();
  });
});
