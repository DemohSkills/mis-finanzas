const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');

async function abrir(page, gastos = []) {
  const estado = { iniciales: { 'Banco Santander': 100000 }, gastos, items: [], patrimonioCargado: true, compromisos: [] };
  await page.addInitScript(({ estado }) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(estado));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    window.confirm = () => true;
    window._alerts = [];
    window.alert = m => { window._alerts.push(String(m)); };
  }, { estado });
  await page.goto(INDEX);
  for (const d of '1234') await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}

// Carga una división desde el formulario real
const dividir = (page, { monto, partes, desc = 'Super y farmacia' }) => page.evaluate(({ monto, partes, desc }) => {
  mostrarVista('gastos'); resetForm();
  document.getElementById('monto').value = monto;
  document.getElementById('descripcion').value = desc;
  document.getElementById('btnDividir').click();
  while (document.querySelectorAll('#divFilas .div-fila').length < partes.length) document.getElementById('btnDivAgregar').click();
  const filas = [...document.querySelectorAll('#divFilas .div-fila')];
  partes.forEach(([cat, m], i) => { filas[i].querySelector('.div-cat').value = cat; const inp = filas[i].querySelector('.div-monto'); inp.value = m; inp.dispatchEvent(new Event('input')); });
  document.getElementById('form').requestSubmit();
}, { monto, partes, desc });

test('crear una división de 3 categorías: N gastos con mismo grupo y suma correcta', async ({ page }) => {
  await abrir(page);
  await dividir(page, { monto: '1000', partes: [['Comida y Delivery', '600'], ['Salud', '300'], ['Hogar y Materiales', '100']] });
  const r = await page.evaluate(() => ({ g: estado.gastos.map(g => ({ c: g.categoria, m: g.monto, gr: g.grupoDivision, t: g.tipo, d: g.descripcion, s: g.subcategoria })), alerts: window._alerts }));
  expect(r.g).toHaveLength(3);
  expect(new Set(r.g.map(x => x.gr)).size).toBe(1);
  expect(r.g[0].gr).toBeTruthy();
  expect(r.g.reduce((s, x) => s + x.m, 0)).toBe(1000);
  expect(r.g.every(x => x.t === 'gasto' && x.d === 'Super y farmacia' && x.s === undefined)).toBe(true);
  expect(r.alerts).toEqual([]);
});

test('no deja guardar si la suma no coincide', async ({ page }) => {
  await abrir(page);
  await dividir(page, { monto: '1000', partes: [['Comida y Delivery', '600'], ['Salud', '300']] });
  const r = await page.evaluate(() => ({ n: estado.gastos.length, alerts: window._alerts }));
  expect(r.n).toBe(0);
  expect(r.alerts[0]).toMatch(/no coincide/);
});

test('el botón solo aparece con tipo gasto', async ({ page }) => {
  await abrir(page);
  const r = await page.evaluate(() => {
    const t = document.getElementById('tipo'); const out = {};
    for (const v of ['gasto', 'ingreso', 'transferir', 'gasto']) { t.value = v; t.dispatchEvent(new Event('change')); out[v] = document.getElementById('divBox').hidden; }
    return out;
  });
  expect(r).toEqual({ gasto: false, ingreso: true, transferir: true });
});

test('Movimientos: una fila agrupada plegada, con y sin búsqueda', async ({ page }) => {
  await abrir(page);
  await dividir(page, { monto: '1000', partes: [['Comida y Delivery', '700'], ['Salud', '300']] });
  const sin = await page.evaluate(() => {
    renderHistorial();
    const f = document.querySelectorAll('#historial .gasto-div');
    return { n: f.length, filas: document.querySelectorAll('#historial .gasto').length, abierto: f[0].querySelector('details').open, tag: f[0].querySelector('.chip').textContent, partes: f[0].querySelectorAll('li').length, importe: f[0].querySelector('.importe').textContent };
  });
  expect(sin).toMatchObject({ n: 1, filas: 1, abierto: false, tag: 'dividido · 2', partes: 2 });
  expect(sin.importe).toContain('1.000');
  const con = await page.evaluate(() => {
    document.getElementById('busqMov').value = 'Salud';
    renderHistorial();
    const f = document.querySelectorAll('#historial .gasto-div');
    return { n: f.length, partes: f[0] && f[0].querySelectorAll('li').length, importe: f[0] && f[0].querySelector('.importe').textContent };
  });
  expect(con.n).toBe(1);
  expect(con.partes).toBe(2);
  expect(con.importe).toContain('1.000');
});

test('editar el grupo reemplaza todas las partes', async ({ page }) => {
  await abrir(page);
  await dividir(page, { monto: '1000', partes: [['Comida y Delivery', '700'], ['Salud', '300']] });
  const r = await page.evaluate(() => {
    const gr = estado.gastos[0].grupoDivision;
    empezarEdicionDivision(gr);
    const pre = [...document.querySelectorAll('#divFilas .div-fila')].map(f => [f.querySelector('.div-cat').value, f.querySelector('.div-monto').value]);
    document.getElementById('monto').value = '1200';
    document.getElementById('btnDivAgregar').click();
    const filas = [...document.querySelectorAll('#divFilas .div-fila')];
    filas[0].querySelector('.div-monto').value = '800'; filas[1].querySelector('.div-monto').value = '300';
    filas[2].querySelector('.div-cat').value = 'Otros/Varios'; filas[2].querySelector('.div-monto').value = '100';
    document.getElementById('form').requestSubmit();
    return { pre, post: estado.gastos.map(g => [g.categoria, g.monto]), grupos: new Set(estado.gastos.map(g => g.grupoDivision)).size, viejo: estado.gastos.some(g => g.grupoDivision === gr), alerts: window._alerts };
  });
  expect(r.pre).toEqual([['Comida y Delivery', '700'], ['Salud', '300']]);
  expect(r.post).toHaveLength(3);
  expect(r.post.reduce((s, x) => s + x[1], 0)).toBe(1200);
  expect(r.grupos).toBe(1);
  expect(r.viejo).toBe(false);
  expect(r.alerts).toEqual([]);
});

test('borrar el grupo borra todas las partes (y no toca otros gastos)', async ({ page }) => {
  await abrir(page, [{ id: 'x', creado: 1, tipo: 'gasto', fecha: '2026-11-01', monto: 50, categoria: 'Salud', medio: 'Banco Santander', descripcion: 'suelto' }]);
  await dividir(page, { monto: '1000', partes: [['Comida y Delivery', '700'], ['Salud', '300']] });
  const r = await page.evaluate(() => {
    renderHistorial();
    document.querySelector('#historial .gasto-div [data-a=borrar-div]').click();
    return estado.gastos.map(g => g.id);
  });
  expect(r).toEqual(['x']);
});

test('los totales por categoría suman las partes en otras pantallas', async ({ page }) => {
  await abrir(page);
  await dividir(page, { monto: '1000', partes: [['Comida y Delivery', '700'], ['Salud', '300']] });
  const r = await page.evaluate(() => {
    const hoyS = new Date().toLocaleDateString('sv');
    const html = buildInformeHTML({ desde: hoyS, hasta: hoyS, detalle: 'categoria', inclTransf: false, ocultarNombres: false, otrosNombres: '' });
    return { html, saldo: saldoDe('Banco Santander') };
  });
  expect(r.saldo).toBe(99000);
  expect(r.html).toMatch(/Comida y Delivery[\s\S]*700/);
  expect(r.html).toMatch(/Salud[\s\S]*300/);
});
