// @ts-check
// Reglas de categorización con subcategoría + subcategoría para ingresos. Datos ficticios.
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const URL_API = 'https://api.anthropic.com/v1/messages';
const HOY = '2026-10-28';

const fmtAR = n => Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function buildMPLineas(rows, saldoInicial, saldoFinal) {
  const lines = [
    { y: 10, text: 'RESUMEN DE CUENTA EN PESOS' },
    { y: 30, text: `Saldo inicial: $ ${fmtAR(saldoInicial)}` },
    { y: 40, text: `Saldo final: $ ${fmtAR(saldoFinal)}` },
    { y: 70, text: 'Fecha Descripción ID de la operación Valor Saldo' },
    { y: 71, text: '1/6' },
  ];
  let y = 80;
  for (const r of rows) {
    lines.push({ y, text: r.desc }); y += 10;
    lines.push({ y, text: `${r.fecha} ${r.id} $ ${fmtAR(r.valor)} $ ${fmtAR(r.saldo)}` }); y += 10;
  }
  return lines;
}

const REGLAS = [
  { patron: 'modo', categoria: 'Reintegros', subcategoria: 'Devolución MODO' },
  { patron: 'ypf', categoria: 'Reintegros', subcategoria: 'Devolución YPF Santander' },
];
function estadoBase() {
  return {
    iniciales: { 'Banco Santander': 0, 'Visa Santander': 0, 'Mercado Pago': 300000, 'Efectivo': 0, 'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0, 'Reservas MP': 0 },
    gastos: [], items: [], patrimonioCargado: true, compromisos: [], importaciones: {},
  };
}
async function abrir(page, { reglas = true, voz = null } = {}) {
  if (voz) await page.route(URL_API, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(voz) }] }) }));
  await page.clock.setFixedTime(new Date(HOY + 'T12:00:00'));
  await page.addInitScript(([s, r]) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(s));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    localStorage.setItem('finanzas-v1-apikey', JSON.stringify('sk-test'));
    localStorage.setItem('finanzas-v1-cats-income', JSON.stringify(['Reintegros']));
    if (r) localStorage.setItem('finanzas-v1-rules', JSON.stringify(r));
  }, [estadoBase(), reglas ? REGLAS : null]);
  await page.goto(INDEX);
  for (const d of ['1', '2', '3', '4']) await page.locator(`[data-d="${d}"]`).click();
  await page.waitForSelector('#pinScr', { state: 'hidden' });
  page.on('dialog', d => d.accept());
}
const estadoActual = page => page.evaluate(() => JSON.parse(JSON.stringify(_getEstado())));

test.describe('reglas con subcategoría', () => {
  test('crear una regla desde Configuración (select agrupado + subcategoría) y verla en la lista', async ({ page }) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await abrir(page, { reglas: false });
    await page.evaluate(() => { mostrarVista('config'); abrirCfg('cfg-reglas', { foco: 'reglaPatron' }); });
    const grupos = await page.locator('#reglaCat optgroup').evaluateAll(l => l.map(g => g.label));
    expect(grupos).toEqual(['Gastos', 'Ingresos']);
    await expect(page.locator('#reglaCat optgroup[label="Ingresos"] option', { hasText: 'Reintegros' })).toHaveCount(1);
    await page.fill('#reglaPatron', 'modo');
    await page.selectOption('#reglaCat', 'Reintegros');
    await page.fill('#reglaSubcat', 'Devolución MODO');
    await page.click('#formRegla button[type="submit"]');
    await expect(page.locator('#reglasLista .rule-row')).toContainText('"modo"');
    await expect(page.locator('#reglasLista .rule-row')).toContainText('Reintegros · Devolución MODO');
    // regla sin subcategoría: sin " · "
    await page.fill('#reglaPatron', 'xyz');
    await page.selectOption('#reglaCat', 'Reintegros');
    await page.click('#formRegla button[type="submit"]');
    const r = await page.evaluate(() => getReglas());
    expect(r[0]).toEqual({ patron: 'modo', categoria: 'Reintegros', subcategoria: 'Devolución MODO' });
    expect(r[1]).toEqual({ patron: 'xyz', categoria: 'Reintegros' });
    expect(errors).toEqual([]);
  });

  test('aplicarRegla devuelve {categoria, subcategoria} o null; el filtro por lista ignora reglas de otro tipo', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(() => ({
      a: aplicarRegla('Devolucion MODO combustible'), b: aplicarRegla('nada'),
      c: aplicarRegla('devolucion ypf', getCats()), d: aplicarRegla('devolucion ypf', getCatsIncome()),
    }));
    expect(r.a).toEqual({ categoria: 'Reintegros', subcategoria: 'Devolución MODO' });
    expect(r.b).toBeNull();
    expect(r.c).toBeNull();
    expect(r.d).toEqual({ categoria: 'Reintegros', subcategoria: 'Devolución YPF Santander' });
  });
});

test.describe('formulario: ingresos con subcategoría', () => {
  test('ingreso manual que matchea la regla autocompleta categoría y subcategoría, y se guarda', async ({ page }) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await abrir(page);
    await page.evaluate(() => { mostrarVista('gastos'); const d = document.getElementById('det-form'); if (d) d.open = true; });
    await expect(page.locator('#subcatLabel')).toBeVisible();
    await page.selectOption('#tipo', 'ingreso');
    await expect(page.locator('#subcatLabel')).toBeVisible();
    await page.fill('#monto', '1500');
    await page.fill('#descripcion', 'Devolución MODO 20%');
    await expect(page.locator('#categoria')).toHaveValue('Reintegros');
    await expect(page.locator('#subcategoria')).toHaveValue('Devolución MODO');
    await page.click('#btnGuardar');
    const g = (await estadoActual(page)).gastos[0];
    expect(g).toMatchObject({ tipo: 'ingreso', categoria: 'Reintegros', subcategoria: 'Devolución MODO', monto: 1500 });
    // sugerencia de historial en ingresos (chips)
    await page.selectOption('#tipo', 'ingreso');
    await page.selectOption('#categoria', 'Reintegros');
    await expect(page.locator('#subcatSug .subcat-chip')).toContainText('Devolución MODO · 1 vez');
    // la etiqueta aparece en la fila del ingreso
    await expect(page.locator('.subcat-tag', { hasText: 'Devolución MODO' }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('un gasto con "modo" en la descripción NO toma la regla de ingreso', async ({ page }) => {
    await abrir(page);
    await page.evaluate(() => { mostrarVista('gastos'); const d = document.getElementById('det-form'); if (d) d.open = true; });
    await page.fill('#descripcion', 'Pago modo');
    await expect(page.locator('#categoria')).not.toHaveValue('Reintegros');
    await expect(page.locator('#subcategoria')).toHaveValue('');
  });

  test('editar un ingreso carga su subcategoría', async ({ page }) => {
    await abrir(page);
    await page.evaluate(() => { _getEstado().gastos.push({ id: 'i1', creado: 1, monto: 10, fecha: '2026-10-01', categoria: 'Reintegros', medio: 'Efectivo', descripcion: 'x', tipo: 'ingreso', subcategoria: 'Devolución YPF Santander' }); mostrarVista('gastos'); empezarEdicion('i1'); });
    await expect(page.locator('#subcategoria')).toHaveValue('Devolución YPF Santander');
    await expect(page.locator('#subcatLabel')).toBeVisible();
  });
});

test.describe('dictado por voz', () => {
  test('ingreso dictado que matchea la regla guarda categoría + subcategoría', async ({ page }) => {
    await abrir(page, { voz: { monto: 2500, medio: 'Mercado Pago', descripcion: 'devolución ypf', tipo: 'ingreso', categoria: 'Otros ingresos', cuotas: 0, dias_atras: 0, fecha: '' } });
    await page.evaluate(() => parsearVoz('devolución ypf dos mil quinientos', 'sk-test'));
    await expect(page.locator('#vozCat')).toHaveValue('Reintegros');
    await page.click('#btnVozOk');
    const g = (await estadoActual(page)).gastos[0];
    expect(g).toMatchObject({ tipo: 'ingreso', categoria: 'Reintegros', subcategoria: 'Devolución YPF Santander', monto: 2500 });
  });

  test('si el usuario cambia la categoría en la tarjeta, la subcategoría de la regla no se guarda', async ({ page }) => {
    await abrir(page, { voz: { monto: 100, medio: 'Mercado Pago', descripcion: 'devolución modo', tipo: 'ingreso', categoria: '', cuotas: 0, dias_atras: 0, fecha: '' } });
    await page.evaluate(() => parsearVoz('devolución modo cien', 'sk-test'));
    await expect(page.locator('#vozCat')).toHaveValue('Reintegros');
    await page.selectOption('#vozCat', 'Otros ingresos');
    await page.click('#btnVozOk');
    const g = (await estadoActual(page)).gastos[0];
    expect(g.categoria).toBe('Otros ingresos');
    expect(g.subcategoria).toBeUndefined();
  });
});

test.describe('importador', () => {
  test('MP: la descripción que matchea queda como ingreso con categoría y subcategoría de la regla', async ({ page }) => {
    await abrir(page);
    const filas = [['Devolucion YPF estacion', 4000], ['Reintegro MODO compra', 2000], ['Abono varios luz', 3000]];
    let saldo = 300000;
    const rows = filas.map(([desc, valor], i) => { saldo += valor; return { desc, fecha: `1${i + 1}-06-2026`, id: String(800000001 + i), valor, saldo }; });
    const lineas = buildMPLineas(rows, 300000, saldo);
    await page.evaluate((ls) => {
      const parsed = parseMercadoPago(ls);
      const cands = parsed.map(f => {
        const catInfo = _categorizarMP(f.desc, f.monto);
        return { ...f, catInfo, refs: [f.ref], yaExiste: false, soloHistorial: false, paraRevisar: catInfo.paraRevisar, _revisar_sel: null, _recordar: false, _recordarTexto: '' };
      });
      _setImpState(cands, 'Mercado Pago');
      _deduplicarImp(cands, 'Mercado Pago');
      _confirmarImpBanco(false);
    }, lineas);
    const gs = (await estadoActual(page)).gastos;
    const ypf = gs.find(g => g.descripcion.includes('YPF'));
    const modo = gs.find(g => g.descripcion.includes('MODO'));
    const luz = gs.find(g => g.descripcion.includes('luz'));
    expect(ypf).toMatchObject({ tipo: 'ingreso', categoria: 'Reintegros', subcategoria: 'Devolución YPF Santander', monto: 4000 });
    expect(modo).toMatchObject({ tipo: 'ingreso', categoria: 'Reintegros', subcategoria: 'Devolución MODO', monto: 2000 });
    expect(luz.subcategoria).toBeUndefined();
  });

  test('Santander: _categorizarSant devuelve la subcategoría; cambiar la categoría en la vista previa la descarta', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(() => {
      const ci = _categorizarSant('Credito YPF reintegro', 3000);
      const cand = { fecha: '2026-10-05', desc: 'Credito YPF reintegro', monto: 3000, catInfo: { ...ci }, refs: ['r1'], yaExiste: false, soloHistorial: false, paraRevisar: false, _revisar_sel: null, _recordar: false, _recordarTexto: '' };
      const cand2 = { ...cand, fecha: '2026-10-06', refs: ['r2'], catInfo: { ...ci, cat: 'Otros ingresos' } };
      _setImpState([cand, cand2], 'Banco Santander');
      _confirmarImpBanco(false);
      return { ci, gs: JSON.parse(JSON.stringify(_getEstado().gastos)) };
    });
    expect(r.ci).toMatchObject({ tipo: 'ingreso', cat: 'Reintegros', subcategoria: 'Devolución YPF Santander' });
    expect(r.gs.find(g => g.fecha === '2026-10-05').subcategoria).toBe('Devolución YPF Santander');
    expect(r.gs.find(g => g.fecha === '2026-10-06').subcategoria).toBeUndefined();
  });

  test('tarjetas: una regla de ingreso ("ypf") no pisa la categorización de compras de Visa', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(() => _categorizarVisa('MERCPAGO*APPYPFCOMB', 5000));
    expect(r).toMatchObject({ tipo: 'gasto', cat: 'Transporte/Auto' });
  });
});
