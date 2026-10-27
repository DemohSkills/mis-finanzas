/** Modal «Clasificar transferencias recibidas»: muestra la cuenta de cada ingreso. Datos FICTICIOS. */
const { test, expect } = require('@playwright/test');
const path = require('path');
const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const TEMAS = ['auto', 'claro', 'oscuro', 'negro', 'neon-azul', 'neon-turquesa', 'neon-violeta'];

const estado = {
  iniciales: { 'Banco Santander': 0, 'Mercado Pago': 0, 'Efectivo': 0, 'Visa Santander': 0, 'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0, 'Reservas MP': 0 },
  gastos: [
    { id: 'i1', creado: 1, monto: 1000, fecha: '2026-10-26', categoria: 'Transferencia recibida', medio: 'Mercado Pago', tipo: 'ingreso', descripcion: 'Transferencia recibida Pepe Ficticio' },
    { id: 'i2', creado: 2, monto: 2000, fecha: '2026-10-25', categoria: 'Transferencia recibida', medio: 'Banco Santander', tipo: 'ingreso', descripcion: 'Transferencia recibida Ana Ficticia' },
    { id: 'i3', creado: 3, monto: 3000, fecha: '2026-10-24', categoria: 'Transferencia recibida', tipo: 'ingreso', descripcion: 'Transferencia recibida Sin Cuenta' },
    { id: 'i4', creado: 4, monto: 4000, fecha: '2026-10-23', categoria: 'Transferencia recibida', medio: 'Mercado Pago', tipo: 'ingreso', descripcion: 'Transferencia recibida Ya Hecha', proposito: 'otro' },
  ],
  items: [], patrimonioCargado: true, compromisos: [], importaciones: {},
};

async function abrir(page) {
  await page.addInitScript(s => {
    localStorage.setItem('finanzas-v1', JSON.stringify(s));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
  }, estado);
  await page.goto(INDEX);
  for (const d of ['1', '2', '3', '4']) await page.locator(`[data-d="${d}"]`).click();
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

test('cada fila muestra su cuenta; sin medio solo la fecha', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await abrir(page);
  await page.evaluate(() => { abrirClasifTransf(); document.querySelector('.clasif-hechas').open = true; });
  const meta = id => page.evaluate(i => {
    const idx = [...document.querySelectorAll('.clasif-row')].findIndex(r => r.textContent.includes(i));
    return document.querySelectorAll('.clasif-row')[idx].querySelector('.imp-row-meta').textContent.trim();
  }, id);
  expect(await meta('Pepe Ficticio')).toMatch(/ · Mercado Pago$/);
  expect(await meta('Ana Ficticia')).toMatch(/ · Banco Santander$/);
  const sin = await meta('Sin Cuenta');
  expect(sin).not.toContain('·');
  expect(sin.length).toBeGreaterThan(0);
  expect(await meta('Ya Hecha')).toMatch(/ · Mercado Pago$/);
  expect(errs).toEqual([]);
});

test('390 px sin scroll horizontal en los 7 temas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await abrir(page);
  await page.evaluate(() => { abrirClasifTransf(); document.querySelector('.clasif-hechas').open = true; });
  for (const t of TEMAS) {
    await page.evaluate(x => aplicarTema(x), t);
    const r = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth > window.innerWidth + 1,
      lista: (l => l.scrollWidth > l.clientWidth + 1)(document.getElementById('clasifLista')) }));
    expect(r, t).toEqual({ doc: false, lista: false });
  }
});
