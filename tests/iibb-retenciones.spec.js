/**
 * Tests para la categoría "Ingresos brutos (retenciones)".
 * Verifica que esté en el catálogo por defecto y que las reglas
 * de los importadores Santander y Mercado Pago la asignen correctamente.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

const BASE_STATE = {
  iniciales: { 'Banco Santander': 0, 'Visa Santander': 0, 'Mercado Pago': 0, 'Efectivo': 0, 'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0 },
  gastos: [],
  items: [],
  patrimonioCargado: true,
  compromisos: [],
  importaciones: {},
};

async function seedAndLoad(page) {
  await page.addInitScript((s) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(s));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
  }, BASE_STATE);
  await page.goto(INDEX);
}

async function enterPIN(page) {
  for (const d of ['1', '2', '3', '4']) await page.locator(`[data-d="${d}"]`).click();
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

test.describe('Ingresos brutos (retenciones) — categoría y reglas', () => {

  test('(a) la categoría está en CATS_DEFAULT', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const cats = await page.evaluate(() => window.getCats ? window.getCats() : null);
    // getCats is not exposed; check via the select options
    const opts = await page.evaluate(() => {
      const sel = document.getElementById('categoria');
      return sel ? Array.from(sel.options).map(o => o.value) : null;
    });
    // If the select is not visible we can evaluate getCats via a workaround
    const hasCat = await page.evaluate(() => {
      // CATS_DEFAULT is not window-exposed, but getCats() reads from it
      // We can check by trying to add a movement and seeing options
      // Simpler: check that the category doesn't get added to custom cats
      // (it's built-in, so getCats returns it without localStorage entry)
      const sel = document.getElementById('categoria');
      if (!sel) return false;
      return Array.from(sel.options).some(o => o.value === 'Ingresos brutos (retenciones)');
    });
    expect(hasCat).toBe(true);
  });

  test('(b) Santander SIRCREB → cat Ingresos brutos (retenciones) + agrupable', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const result = await page.evaluate(() =>
      window._categorizarSant('SIRCREB retencion semana 1', -1500)
    );
    expect(result.tipo).toBe('gasto');
    expect(result.cat).toBe('Ingresos brutos (retenciones)');
    expect(result.agrupable).toMatch(/Retenciones SIRCREB/);
  });

  test('(c) Santander IIBB Tucumán → cat Ingresos brutos (retenciones) + agrupable', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const result = await page.evaluate(() =>
      window._categorizarSant('Sircreb Ret IIBB\tTucuman', -800)
    );
    expect(result.tipo).toBe('gasto');
    expect(result.cat).toBe('Ingresos brutos (retenciones)');
    expect(result.agrupable).toMatch(/Retenciones SIRCREB/);
  });

  test('(d) Santander descripción genérica con "iibb" → cat Ingresos brutos (retenciones)', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const result = await page.evaluate(() =>
      window._categorizarSant('Retención IIBB provincia', -300)
    );
    expect(result.tipo).toBe('gasto');
    expect(result.cat).toBe('Ingresos brutos (retenciones)');
    expect(result.agrupable).toBeNull();
  });

  test('(e) Santander descripción con "ingresos brutos" → cat Ingresos brutos (retenciones)', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const result = await page.evaluate(() =>
      window._categorizarSant('Debito ingresos brutos Cordoba', -200)
    );
    expect(result.tipo).toBe('gasto');
    expect(result.cat).toBe('Ingresos brutos (retenciones)');
  });

  test('(f) Santander ARCA sigue siendo Impuestos e Intereses (no afectado)', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const result = await page.evaluate(() =>
      window._categorizarSant('Debito automatico\tARCA monotributo', -5000)
    );
    expect(result.cat).toBe('Impuestos e Intereses');
  });

  test('(g) Mercado Pago IIBB Bs. As. → cat Ingresos brutos (retenciones)', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const result = await page.evaluate(() =>
      window._categorizarMP('Pago de impuesto IIBB Bs. As.', -2000)
    );
    expect(result.tipo).toBe('gasto');
    expect(result.cat).toBe('Ingresos brutos (retenciones)');
    expect(result.descFija).toMatch(/Bs\. As\./);
  });

  test('(h) Mercado Pago IIBB CABA → cat Ingresos brutos (retenciones)', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const result = await page.evaluate(() =>
      window._categorizarMP('Pago de impuesto IIBB CABA', -1500)
    );
    expect(result.tipo).toBe('gasto');
    expect(result.cat).toBe('Ingresos brutos (retenciones)');
    expect(result.descFija).toMatch(/CABA/);
  });

  test('(i) Mercado Pago IIBB genérico → cat Ingresos brutos (retenciones)', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const result = await page.evaluate(() =>
      window._categorizarMP('Retención IIBB', -500)
    );
    expect(result.tipo).toBe('gasto');
    expect(result.cat).toBe('Ingresos brutos (retenciones)');
  });

  test('(j) Mercado Pago descripción con "ingresos brutos" → cat Ingresos brutos (retenciones)', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const result = await page.evaluate(() =>
      window._categorizarMP('Pago ingresos brutos mensual', -400)
    );
    expect(result.tipo).toBe('gasto');
    expect(result.cat).toBe('Ingresos brutos (retenciones)');
  });

  test('(k) otras categorías Mercado Pago no afectadas (peajes → Transporte/Auto)', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const result = await page.evaluate(() =>
      window._categorizarMP('Pago AUSA peaje', -150)
    );
    expect(result.cat).toBe('Transporte/Auto');
  });

});
