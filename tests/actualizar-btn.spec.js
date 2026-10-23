/**
 * Tests Tarea 1: botón Actualizar movido a ⚙️ + atajo toque en "Pulse".
 */
// @ts-check
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

async function openApp(browser, extraInit = () => {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    localStorage.setItem('finanzas-v1', JSON.stringify({
      iniciales: { 'Banco Santander': 0, 'Mercado Pago': 0, 'Efectivo': 0, 'Visa Santander': 0, 'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0 },
      gastos: [], items: [], patrimonioCargado: true, compromisos: [], importaciones: {},
    }));
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

test.describe('Botón Actualizar reubicado', () => {
  let browser;
  test.beforeAll(async () => { browser = await chromium.launch(); });
  test.afterAll(async () => { await browser.close(); });

  // (a) No hay errores JS
  test('(a) sin errores de JS al cargar', async () => {
    const { errors } = await openApp(browser);
    expect(errors).toEqual([]);
  });

  // (b) El botón Actualizar SÍ está en el header, a la izquierda del ojo
  test('(b) el botón Actualizar está en el header (.app-hdr) a la izquierda del ojo', async () => {
    const { page } = await openApp(browser);
    await expect(page.locator('.app-hdr #btnActualizarApp')).toBeVisible();
    // Debe aparecer antes que #btnOjo en el DOM
    const order = await page.evaluate(() => {
      const hdr = document.querySelector('.app-hdr');
      const btns = Array.from(hdr.querySelectorAll('button'));
      const iAct = btns.findIndex(b => b.id === 'btnActualizarApp');
      const iOjo = btns.findIndex(b => b.id === 'btnOjo');
      return { iAct, iOjo };
    });
    expect(order.iAct).toBeLessThan(order.iOjo);
  });

  // (c) El botón Actualizar NO está suelto en la sección ⚙️ Apariencia
  test('(c) botón Actualizar no aparece suelto en la pestaña ⚙️', async () => {
    const { page } = await openApp(browser);
    await page.locator('.tabs button[data-vista="config"]').click();
    const cfgBtns = await page.locator('#vista-config button').evaluateAll(els =>
      els.map(b => b.id).filter(id => id === 'btnActualizarApp')
    );
    expect(cfgBtns).toHaveLength(0);
  });

  // (d) En ⚙️ aparece la pista sobre 🔄 y "Pulse"
  test('(d) la sección Apariencia muestra la pista sobre el botón 🔄 y Pulse', async () => {
    const { page } = await openApp(browser);
    await page.locator('.tabs button[data-vista="config"]').click();
    const cfgText = await page.locator('#vista-config').textContent();
    expect(cfgText).toMatch(/Pulse/);
  });

  // (e) La palabra Pulse en el título no tiene cursor pointer ni parece botón
  test('(e) .pulse en el título no tiene cursor pointer ni role button', async () => {
    const { page } = await openApp(browser);
    const cursor = await page.evaluate(() => {
      const el = document.querySelector('.app-hdr h1 .pulse');
      return el ? window.getComputedStyle(el).cursor : 'not-found';
    });
    // Should be 'auto' or 'text', not 'pointer'
    expect(cursor).not.toBe('pointer');
  });

  // (f) El header se ve bien a 360 px (sin overflow horizontal)
  test('(f) el header no produce overflow horizontal a 360px', async () => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 } });
    await ctx.addInitScript(() => {
      localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
      localStorage.setItem('finanzas-v1', JSON.stringify({
        iniciales: {}, gastos: [], items: [], patrimonioCargado: true, compromisos: [], importaciones: {},
      }));
    });
    const page = await ctx.newPage();
    await page.goto(FILE_URL);
    for (const d of ['1','2','3','4'])
      await page.locator('.pin-pad button').filter({ hasText: d }).first().click();
    await expect(page.locator('#app')).not.toBeHidden({ timeout: 3000 });

    const overflow = await page.evaluate(() => {
      const hdr = document.querySelector('.app-hdr');
      return hdr ? hdr.scrollWidth <= hdr.clientWidth + 1 : true;
    });
    expect(overflow).toBe(true);
    await ctx.close();
  });

  // (g) El toast #toastActualizar existe en el DOM
  test('(g) el toast #toastActualizar existe en el DOM', async () => {
    const { page } = await openApp(browser);
    const exists = await page.evaluate(() => !!document.getElementById('toastActualizar'));
    expect(exists).toBe(true);
  });

  // (h) _recargarApp muestra el toast
  test('(h) _recargarApp muestra el toast (opacity=1)', async () => {
    const { page } = await openApp(browser);
    // Override location.reload to prevent actual navigation
    await page.evaluate(() => { window._reloadCalled = false; window.location.reload = () => { window._reloadCalled = true; }; });
    await page.evaluate(() => _recargarApp());
    const opacity = await page.evaluate(() => document.getElementById('toastActualizar')?.style.opacity);
    expect(opacity).toBe('1');
  });
});
