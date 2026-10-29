// Informe: incluye lo que «te debe» el cobro semanal y su total de activos coincide con Patrimonio
const { test, expect } = require('@playwright/test');
const path = require('path');
const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const estado = {
  iniciales: { 'Banco Santander': 100000, 'Mercado Pago': 50000, 'Efectivo': 10000 },
  gastos: [], compromisos: [], patrimonioCargado: true,
  items: [{ id: 'i1', nombre: 'Cobro suelto', monto: 7000, tipo: 'activo', grupo: 'Cobros pendientes', persona: 'Ana' },
          { id: 'i2', nombre: 'Préstamo', monto: 3000, tipo: 'deuda', grupo: 'Otros' }],
  cobrosSemanales: [{ id: 'cs1', nombre: 'Meli Extra', persona: 'Meli Envíos', medioCobro: 'Mercado Pago',
    entradas: [{ id: 'e1', fecha: '2026-10-13', monto: 60000, tipo: 'dia' }, { id: 'e2', fecha: '2026-10-21', monto: 40000, tipo: 'dia' }, { id: 'e3', fecha: '2026-10-26', monto: 5000, tipo: 'dia' }], cobradas: [] }],
};
async function abrir(page, est) {
  await page.clock.setFixedTime(new Date('2026-10-27T12:00:00'));
  await page.addInitScript(e => {
    localStorage.setItem('finanzas-v1', JSON.stringify(e));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
  }, est);
  await page.goto(INDEX);
  for (const d of '1234') await page.click(`button[data-d="${d}"]`);
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}
const informe = page => page.evaluate(() => {
  const html = window.buildInformeHTML({ desde: '2026-10-01', hasta: '2026-10-31', detalle: 'ninguno', inclTransf: false, ocultarNombres: false, otrosNombres: '' });
  const d = document.createElement('div'); d.innerHTML = html;
  const filas = [...d.querySelectorAll('tr')].map(tr => tr.textContent.replace(/\s+/g, ' ').trim());
  return { totalAct: d.querySelector('.inf-tot-activos').textContent, totalV: Number(d.querySelector('.inf-tot-activos').dataset.v) / 100,
    filas, debe: cwDebeTotal(), activos: totales().activos };
});

test('el informe lista el «te debe» del cobro semanal y su total de activos == Patrimonio', async ({ page }) => {
  await abrir(page, estado);
  const r = await informe(page);
  expect(r.debe).toBeGreaterThan(0);
  expect(r.totalV).toBe(r.activos);
  await page.locator('[role=tab]', { hasText: 'Patrimonio' }).click();
  const pat = await page.locator('#totActivos').textContent();
  expect(r.totalAct.replace(/\D/g, '')).toBe(pat.replace(/\D/g, ''));
  // una línea con el monto de cwDebeTotal en el listado de activos y otra en «Cobros pendientes»
  const montoTxt = await page.evaluate(() => fmt(cwDebeTotal()));
  const lineas = r.filas.filter(f => f.includes('Meli Extra (te debe)'));
  expect(lineas.length).toBe(2);
  for (const l of lineas) expect(l).toContain(montoTxt.replace(/\s/g, ' ').trim());
});

test('sin cobros semanales el informe sigue igual y el total coincide', async ({ page }) => {
  await abrir(page, { ...estado, cobrosSemanales: [] });
  const r = await informe(page);
  expect(r.filas.some(f => f.includes('(te debe)'))).toBe(false);
  expect(r.totalV).toBe(r.activos);
});
