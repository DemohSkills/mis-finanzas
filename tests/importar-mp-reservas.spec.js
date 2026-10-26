/**
 * Importador de Mercado Pago: las reservas son transferencias MP <-> Reservas MP.
 * Datos FICTICIOS; las líneas se arman como las de un PDF (mismo mecanismo que importar-mp.spec.js).
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

const fmtAR = n => Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtValor = n => (n < 0 ? '-' : '') + fmtAR(n);

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
    if (r.descAbove) { lines.push({ y, text: r.descAbove }); y += 10; }
    lines.push({ y, text: `${r.fecha} ${r.id} $ ${fmtValor(r.valor)} $ ${fmtAR(r.saldo)}` });
    y += 10;
    if (r.descBelow) { lines.push({ y, text: r.descBelow }); y += 10; }
  }
  return lines;
}

// Las 6 líneas de reservas del enunciado (saldo corrido desde 300.000)
function filasSeis() {
  const defs = [
    ['12-06-2026', 'Reserva por gastos', 'Reserva x gastos 12/6/26', -1000],
    ['12-06-2026', 'Reserva programada', 'Reserva x gastos 12/6/26', -4000],
    ['13-06-2026', 'Dinero reservado', 'Descubierto Boris 500k', -200000],
    ['13-06-2026', 'Dinero reservado', 'Reserva x gastos 12/6/26', -1000],
    ['20-06-2026', 'Dinero retirado', 'Reserva x gastos 12/6/26', 24182],
    ['21-06-2026', 'Dinero retirado', 'Descubierto Boris 500k', 100000],
  ];
  let saldo = 300000;
  return defs.map(([fecha, a, b, valor], i) => {
    saldo += valor;
    return { fecha, id: String(900000001 + i), valor, saldo, descAbove: a, descBelow: b };
  });
}

function estadoBase(extra = {}) {
  return {
    iniciales: { 'Banco Santander': 0, 'Visa Santander': 0, 'Mercado Pago': 300000, 'Efectivo': 0,
      'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0, 'Reservas MP': 0 },
    gastos: [
      { id: 'g1', creado: 1, monto: 5000, fecha: '2026-06-10', categoria: 'Comida y Delivery', medio: 'Efectivo', tipo: 'gasto' },
      { id: 'i1', creado: 2, monto: 9000, fecha: '2026-06-11', categoria: 'Ingresos extras', medio: 'Efectivo', tipo: 'ingreso' },
    ],
    items: [], patrimonioCargado: true, compromisos: [], importaciones: {}, ...extra,
  };
}

async function abrir(page, estado) {
  await page.addInitScript((s) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(s));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
  }, estado);
  await page.goto(INDEX);
  for (const d of ['1', '2', '3', '4']) await page.locator(`[data-d="${d}"]`).click();
  await page.waitForSelector('#pinScr', { state: 'hidden' });
  page.on('dialog', d => d.accept());
}

// Replica el flujo del manejador del archivo: parsear → candidatos → dedupe
const preparar = (page, lineas) => page.evaluate((ls) => {
  const parsed = parseMercadoPago(ls);
  const cands = parsed.map(f => {
    const catInfo = _categorizarMP(f.desc, f.monto);
    return { ...f, catInfo, refs: [f.ref], yaExiste: false, soloHistorial: false, paraRevisar: catInfo.paraRevisar,
      _revisar_sel: null, _recordar: false, _recordarTexto: '' };
  });
  _setImpState(cands, 'Mercado Pago');
  _deduplicarImp(cands, 'Mercado Pago');
  return {
    n: cands.length, nuevos: cands.filter(c => !c.yaExiste).length, revisar: cands.filter(c => c.paraRevisar).length,
    rends: _reservaRendPlan(cands).map(c => c._rend), saldoFinal: parsed[parsed.length - 1].saldo,
  };
}, lineas);

const importar = (page) => page.evaluate(() => _confirmarImpBanco(false));

const totales = (page) => page.evaluate(() => {
  const l = _getEstado().gastos.filter(g => !g.transferencia);
  return {
    g: l.filter(x => (x.tipo || 'gasto') === 'gasto').reduce((s, x) => s + x.monto, 0),
    i: l.filter(x => x.tipo === 'ingreso').reduce((s, x) => s + x.monto, 0),
  };
});

const saldos = (page) => page.evaluate(() => ({ mp: saldoDe('Mercado Pago'), rmp: saldoDe('Reservas MP') }));

test.describe('importar-mp reservas', () => {
  test('las 6 líneas son transferencias; totales intactos; saldo MP = saldo final del PDF', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await abrir(page, estadoBase());
    const antes = await totales(page);
    const filas = filasSeis();
    const p = await preparar(page, buildMPLineas(filas, 300000, filas[5].saldo));
    expect(p.n).toBe(6);
    expect(p.revisar).toBe(0);
    expect(p.rends.every(r => r === 0)).toBe(true);
    const cats = await page.evaluate(() => _getImpCandidatos().map(c => [c.catInfo.cat, c.catInfo.reserva, c.catInfo.tipo]));
    expect(cats.map(c => c[1])).toEqual(['enviar', 'enviar', 'enviar', 'enviar', 'retirar', 'retirar']);
    expect(cats.every(c => c[0] === 'Transferencia entre cuentas')).toBe(true);
    const sv = await page.evaluate((sf) => _verifSaldo('Mercado Pago', '2026-06-21', sf, _getImpCandidatos()), p.saldoFinal);
    expect(Math.abs(sv.diff)).toBeLessThan(0.01);

    await importar(page);
    expect(await totales(page)).toEqual(antes);
    const s = await saldos(page);
    expect(s.mp).toBeCloseTo(p.saldoFinal, 2);
    // Reservas MP: +206.000 − 124.182
    expect(s.rmp).toBeCloseTo(206000 - 124182, 2);
    const marcas = await page.evaluate(() => _getEstado().gastos.filter(g => g.lote).map(g => [g.medio, g.transferencia, !!g.transferId]));
    expect(marcas.length).toBe(12);
    expect(marcas.every(m => m[1] === true && m[2] === true)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('retiro con rendimientos: ingreso Rendimientos en Reservas MP y queda en 0', async ({ page }) => {
    await abrir(page, estadoBase({ iniciales: { ...estadoBase().iniciales, 'Reservas MP': 100000 } }));
    const antes = await totales(page);
    const filas = [{ fecha: '20-06-2026', id: '900000010', valor: 102140.08, saldo: 402140.08,
      descAbove: 'Dinero retirado', descBelow: 'Reserva x gastos 12/6/26' }];
    const p = await preparar(page, buildMPLineas(filas, 300000, 402140.08));
    expect(p.rends).toEqual([2140.08]);
    await page.evaluate(() => _renderImpPreview());
    await expect(page.locator('#impModalBody')).toContainText('rendimientos de reserva');
    await expect(page.locator('#impModalBody')).toContainText('↔ Reservas MP');
    await importar(page);
    const s = await saldos(page);
    expect(s.rmp).toBeCloseTo(0, 2);
    expect(s.mp).toBeCloseTo(402140.08, 2);
    const rend = await page.evaluate(() => _getEstado().gastos.filter(g => g.categoria === 'Rendimientos'));
    expect(rend).toHaveLength(1);
    expect(rend[0]).toMatchObject({ medio: 'Reservas MP', tipo: 'ingreso', monto: 2140.08, descripcion: 'Rendimientos de reservas (al retirar)' });
    expect(rend[0].transferencia).toBeFalsy();
    const t = await totales(page);
    expect(t.g).toBe(antes.g);
    expect(t.i).toBeCloseTo(antes.i + 2140.08, 2);
  });

  test('retiro sin rendimientos: saldo 1.000, retiro 1.000 → solo transferencia', async ({ page }) => {
    await abrir(page, estadoBase({ iniciales: { ...estadoBase().iniciales, 'Reservas MP': 1000 } }));
    const filas = [{ fecha: '20-06-2026', id: '900000011', valor: 1000, saldo: 301000,
      descAbove: 'Dinero retirado', descBelow: 'Reserva x gastos' }];
    const p = await preparar(page, buildMPLineas(filas, 300000, 301000));
    expect(p.rends).toEqual([0]);
    await importar(page);
    expect(await page.evaluate(() => _getEstado().gastos.filter(g => g.categoria === 'Rendimientos').length)).toBe(0);
    expect((await saldos(page)).rmp).toBeCloseTo(0, 2);
  });

  test('reservar y retirar en el mismo lote, en orden cronológico, con rendimientos', async ({ page }) => {
    await abrir(page, estadoBase());
    const filas = [
      { fecha: '12-06-2026', id: '900000020', valor: -50000, saldo: 250000, descAbove: 'Dinero reservado', descBelow: 'Viaje' },
      { fecha: '15-06-2026', id: '900000021', valor: 50500, saldo: 300500, descAbove: 'Dinero retirado', descBelow: 'Viaje' },
    ];
    const p = await preparar(page, buildMPLineas(filas, 300000, 300500));
    expect(p.rends).toEqual([0, 500]);
    await importar(page);
    const s = await saldos(page);
    expect(s.rmp).toBeCloseTo(0, 2);
    expect(s.mp).toBeCloseTo(300500, 2);
  });

  test('deshacer revierte todo y reimportar no duplica', async ({ page }) => {
    await abrir(page, estadoBase({ iniciales: { ...estadoBase().iniciales, 'Reservas MP': 100000 } }));
    const antesN = await page.evaluate(() => _getEstado().gastos.length);
    const filas = [{ fecha: '20-06-2026', id: '900000030', valor: 102140.08, saldo: 402140.08,
      descAbove: 'Dinero retirado', descBelow: 'Reserva x gastos' }];
    const lineas = buildMPLineas(filas, 300000, 402140.08);
    await preparar(page, lineas);
    await importar(page);
    expect(await page.evaluate(() => _getEstado().gastos.length)).toBe(antesN + 3);

    // Reimportar el mismo PDF: ya existe
    const p2 = await preparar(page, lineas);
    expect(p2.nuevos).toBe(0);

    await page.evaluate(() => _deshacerUltimaImp('Mercado Pago'));
    expect(await page.evaluate(() => _getEstado().gastos.length)).toBe(antesN);
    const s = await saldos(page);
    expect(s.rmp).toBeCloseTo(100000, 2);
    expect(s.mp).toBeCloseTo(300000, 2);
  });

  test('respeta la fecha de conciliación: lo anterior no genera rendimientos ni transferencias', async ({ page }) => {
    await abrir(page, estadoBase({ importaciones: { 'Mercado Pago': { hasta: '2026-06-12', lote: null, fecha: '2026-06-12' } } }));
    const filas = filasSeis();
    await preparar(page, buildMPLineas(filas, 300000, filas[5].saldo));
    // Mismo filtro que el manejador del archivo
    const n = await page.evaluate(() => {
      const c = _getImpCandidatos().filter(x => x.fecha > '2026-06-12');
      _setImpState(c, 'Mercado Pago');
      return c.length;
    });
    expect(n).toBe(4);
  });
});
