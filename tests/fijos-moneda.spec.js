const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const mk = (id, nombre, monto, extra = {}) => ({ id, tipo: 'fijo', nombre, categoria: 'Otros/Varios', monto, estimado: true, diaMes: 5, medioPago: null, palabrasClave: '', activo: true, pagos: {}, ...extra });

async function abrir(page, compromisos) {
  const estado = { iniciales: { 'Banco Santander': 100000 }, gastos: [], items: [], patrimonioCargado: true, compromisos };
  await page.addInitScript(({ estado }) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(estado));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    window.confirm = () => true; window.alert = () => {};
  }, { estado });
  await page.goto(INDEX);
  for (const d of '1234') await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}

test('guardar un fijo en USD persiste moneda; ARS no guarda el campo', async ({ page }) => {
  await abrir(page, []);
  const r = await page.evaluate(() => {
    const alta = (nombre, monto, mon) => {
      abrirFijoModal();
      document.getElementById('fijoNombre').value = nombre;
      document.getElementById('fijoMonto').value = monto;
      document.getElementById('fijoMoneda').value = mon;
      document.getElementById('fijoForm').requestSubmit();
    };
    const porDefecto = (abrirFijoModal(), document.getElementById('fijoMoneda').value);
    cerrarFijoModal();
    alta('Netflix', '15', 'USD'); alta('Alquiler', '1000', 'ARS');
    const guardado = JSON.parse(localStorage.getItem('finanzas-v1')).compromisos;
    const nf = estado.compromisos.find(c => c.nombre === 'Netflix');
    abrirFijoModal(nf.id);
    const precarga = document.getElementById('fijoMoneda').value;
    document.getElementById('fijoMoneda').value = 'ARS';
    document.getElementById('fijoForm').requestSubmit();
    return {
      porDefecto, precarga,
      usd: guardado.find(c => c.nombre === 'Netflix').moneda,
      ars: 'moneda' in guardado.find(c => c.nombre === 'Alquiler'),
      trasEditar: 'moneda' in estado.compromisos.find(c => c.nombre === 'Netflix'),
    };
  });
  expect(r.porDefecto).toBe('ARS');
  expect(r.usd).toBe('USD');
  expect(r.ars).toBe(false);
  expect(r.precarga).toBe('USD');
  expect(r.trasEditar).toBe(false);
});

test('la fila muestra US$ para fijos en dólares y $ para pesos', async ({ page }) => {
  await abrir(page, [mk('a', 'Netflix', 15, { moneda: 'USD' }), mk('b', 'Alquiler', 50000)]);
  const r = await page.evaluate(() => ({ usd: _fijoRowHtml(estado.compromisos[0], hoy().slice(0, 7)), ars: _fijoRowHtml(estado.compromisos[1], hoy().slice(0, 7)) }));
  expect(r.usd).toContain('US$ 15<');
  expect(r.ars).not.toContain('US$');
});

test('el fijo en USD queda fuera del total ARS y la nota muestra el total en USD', async ({ page }) => {
  await abrir(page, [mk('a', 'Netflix', 15, { moneda: 'USD' }), mk('c', 'Spotify', 20, { moneda: 'USD' }), mk('b', 'Alquiler', 50000)]);
  await page.locator('nav.tabs button[data-vista="evolucion"]').click();
  await page.waitForFunction(() => typeof Chart !== 'undefined' && window._ci && window._ci['cF'], null, { timeout: 15000 });
  const r = await page.evaluate(() => ({ data: window._ci['cF'].data.datasets[0].data, badge: document.getElementById('evBadgeF').textContent, nota: document.getElementById('evFinNota').textContent }));
  expect(r.data).toEqual([50000]);
  expect(r.badge).toBe('$50k/mes');
  expect(r.nota).toBe('2 fijos en USD no incluidos (US$ 35/mes)');
});
