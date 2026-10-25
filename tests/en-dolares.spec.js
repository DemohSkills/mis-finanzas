// @ts-check
// Categoría "En dólares": débito "titulos publicos" del Santander (compra de USD MEP)
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

const BASE_STATE = {
  iniciales: { 'Banco Santander': 500000, 'Visa Santander': 0, 'Mercado Pago': 0, 'Efectivo': 0, 'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0 },
  gastos: [], items: [], patrimonioCargado: true, compromisos: [], importaciones: {},
};

function buildSantanderAoa(rows) {
  return [
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['', 'Fecha', 'Sucursal origen', 'Descripción', 'Referencia', 'Caja de Ahorro', 'Cuenta Corriente', 'Saldo'],
    ...[...rows].reverse().map(r => ['', r.fecha, 'SUC 001', r.desc, r.ref || '', String(r.ca ?? 0), String(r.cc ?? 0), String(r.saldo)]),
  ];
}

async function arrancar(page, rules) {
  await page.addInitScript(({ s, rules }) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(s));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    if (rules) localStorage.setItem('finanzas-v1-rules', JSON.stringify(rules));
  }, { s: BASE_STATE, rules });
  await page.goto(INDEX);
  for (const d of ['1', '2', '3', '4']) await page.locator(`[data-d="${d}"]`).click();
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

test.describe('en-dolares', () => {
  test('(a) débito "titulos publicos" → gasto En dólares sin paraRevisar', async ({ page }) => {
    await arrancar(page);
    const r = await page.evaluate(() => window._categorizarSant('Liquidacion titulos publicos debi', -60000));
    expect(r.tipo).toBe('gasto');
    expect(r.cat).toBe('En dólares');
    expect(r.paraRevisar).toBe(false);
    expect(r.descFija).toBeNull();
  });

  test('(b) mismo texto con monto positivo → no es En dólares', async ({ page }) => {
    await arrancar(page);
    const r = await page.evaluate(() => window._categorizarSant('Liquidacion titulos publicos debi', 60000));
    expect(r.cat).not.toBe('En dólares');
    expect(r.tipo).toBe('ingreso');
    expect(r.paraRevisar).toBe(true);
  });

  test('(c) una regla del usuario sigue ganando', async ({ page }) => {
    await arrancar(page, [{ patron: 'titulos publicos', categoria: 'Otros/Varios' }]);
    const r = await page.evaluate(() => window._categorizarSant('Liquidacion titulos publicos debi', -60000));
    expect(r.cat).toBe('Otros/Varios');
  });

  test('(d) importación: fila de débito → En dólares; fila de crédito → no', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await arrancar(page);
    const aoa = buildSantanderAoa([
      { fecha: '05/10/2026', desc: 'Liquidacion titulos publicos debi', ref: 'T1', ca: -60000, cc: 0, saldo: 440000 },
      { fecha: '06/10/2026', desc: 'Liquidacion titulos publicos credi', ref: 'T2', ca: 50, cc: 0, saldo: 440050 },
    ]);
    const res = await page.evaluate((aoa) => {
      const parsed = window.parseSantander(aoa);
      return parsed.map(f => ({ monto: f.monto, ...window._categorizarSant(f.desc, f.monto) }));
    }, aoa);
    const deb = res.find(r => r.monto < 0);
    const cre = res.find(r => r.monto > 0);
    expect(deb.cat).toBe('En dólares');
    expect(deb.tipo).toBe('gasto');
    expect(cre.cat).not.toBe('En dólares');
    expect(errors).toHaveLength(0);
  });

  test('(e) la categoría existe, es gasto normal en análisis y sin ids duplicados', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await arrancar(page);
    const hasCat = await page.evaluate(() =>
      Array.from(document.getElementById('categoria').options).some(o => o.value === 'En dólares'));
    expect(hasCat).toBe(true);
    const dup = await page.evaluate(() => {
      const seen = {}, d = [];
      document.querySelectorAll('[id]').forEach(el => { if (seen[el.id]) d.push(el.id); seen[el.id] = 1; });
      return d;
    });
    expect(dup).toEqual([]);
    expect(errors).toHaveLength(0);
  });
});
