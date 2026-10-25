// @ts-check
// Importador del resumen de Mastercard MP (PDF). Datos 100 % ficticios.
// Se prueba el parser con líneas de texto sintéticas (la misma estructura que deja _extraerLineasPDF)
// y el resto del flujo cargando el resultado en la vista previa.
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';
const HOY = '2026-10-28';
const MC = 'Mastercard MP';

const ar = n => { const [e, d] = n.toFixed(2).split('.'); return e.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d; };
const pesos = n => `$ ${ar(n)}`;

/**
 * consumos: [{ f:'15/ago', desc, cuota:'2 de 6'|'', op:'123456', pesos?:n, usd?:n }]
 * impuestos: [{ f:'27/sep', desc, pesos }]
 */
function lineas({ mes = 'septiembre', cierre = '27 de septiembre', venc = '2 de octubre', total, minimo = 55304.41, minimoLinea,
  consumos = [], impuestos = [], pagosAnt = 0, ajustes = 0, composicion = true }) {
  const sumC = consumos.reduce((s, c) => s + (c.pesos || 0), 0);
  const sumI = impuestos.reduce((s, c) => s + c.pesos, 0);
  if (total === undefined) total = Math.round((sumC + sumI) * 100) / 100;
  const L = [
    `Este es tu resumen de ${mes}`,
    'Total a pagar $ 213.618 54',
    'Fecha de cierre Fecha de vencimiento',
    `${cierre} ${venc}`,
    minimoLinea || `El mínimo a pagar es ${pesos(minimo)}`,
    'Consolidado',
    `Saldo del periodo anterior ${pesos(0)} US$ 0,00`,
    `Consumos ${pesos(sumC)} US$ 0,00`,
    `Impuestos e intereses ${pesos(sumI)} US$ 0,00`,
    `Pagos anticipados ${pagosAnt ? '-' : ''}${pesos(pagosAnt)} US$ 0,00`,
    `Ajustes y reembolsos ${pesos(ajustes)} US$ 0,00`,
    `Total a pagar ${pesos(total)} US$ 0,00`,
    'DETALLE DE MOVIMIENTOS',
  ];
  if (composicion) L.push('Composición del saldo del periodo anterior', `28/ago Pago del resumen -${pesos(183122.12)}`, '27/ago Total a pagar del periodo anterior');
  L.push('Consumos', 'Con tarjeta virtual', 'Fecha Descripción Cuota Operación Pesos Dólares');
  for (const c of consumos) {
    L.push(`${c.f} ${c.desc} ${c.cuota || ''} ${c.op || '100001'} ${c.pesos ? pesos(c.pesos) : ''} ${c.usd ? 'US$ ' + ar(c.usd) : 'US$ 0,00'}`.replace(/\s+/g, ' '));
  }
  L.push(`Subtotal ${pesos(sumC)}`, 'Impuestos e intereses');
  for (const i of impuestos) L.push(`${i.f} ${i.desc} ${pesos(i.pesos)}`);
  L.push('¹ Nota al pie sin fecha', 'Pagos anticipados', 'Ajustes y reembolsos');
  return L;
}

function buildEstado(extra = {}) {
  return {
    iniciales: { 'Banco Santander': 500000, 'Mercado Pago': 100000, [MC]: -50000 },
    gastos: [], items: [], patrimonioCargado: true, compromisos: [], ...extra,
  };
}

async function seedAndUnlock(page, estado, hoy = HOY) {
  await page.clock.setFixedTime(new Date(hoy + 'T12:00:00'));
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.alert = () => {}; window.confirm = () => true; });
}
const estadoDe = page => page.evaluate(() => JSON.parse(JSON.stringify(window._getEstado())));
const parse = (page, L, hoy = HOY) => page.evaluate(([l, h]) => window.parseMastercardMP(l, h), [L, hoy]);
/** parsea, abre la vista previa y devuelve nada; opciones: cats = {índice de movimiento: categoría} */
async function preview(page, L, cats = {}) {
  await page.evaluate(([l, h, cs]) => {
    const data = window.parseMastercardMP(l, h);
    for (const [i, c] of Object.entries(cs)) data.movs[+i]._catOverride = c;
    document.getElementById('impModal').hidden = false;
    window._renderMcPreview(data);
  }, [L, HOY, cats]);
}
const importar = async (page) => { await page.click('#btnConfirmarMcImp'); await page.waitForTimeout(150); };

const C1 = { f: '15/ago', desc: 'COMERCIO UNO', cuota: '4 de 6', op: '555001', pesos: 9728.82 };
const PU = { f: '03/sep', desc: 'COMERCIO DOS', cuota: '', op: '555002', pesos: 4500 };
const SELLO = { f: '27/sep', desc: 'Impuesto al sello Buenos Aires', pesos: 2533.03 };
const USD = { f: '10/sep', desc: 'SERVICIO EXTERIOR', cuota: '', op: '555003', usd: 12.5 };

test.describe('Mastercard MP (PDF): parseo', () => {
  test('(a) cuota "4 de 6", pago único, impuesto al sello y USD omitida', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const d = await parse(page, lineas({ consumos: [C1, PU, USD], impuestos: [SELLO] }));
    expect(d.movs).toHaveLength(2);
    expect(d.movs[0]).toMatchObject({ desc: 'COMERCIO UNO', cuota: { n: 4, m: 6 }, operacion: '555001', pesos: 9728.82, fecha: '2026-08-15' });
    expect(d.movs[1]).toMatchObject({ desc: 'COMERCIO DOS', cuota: null, pesos: 4500, fecha: '2026-09-03' });
    expect(d.impuestos).toEqual([{ fecha: '2026-09-27', desc: 'Impuesto al sello Buenos Aires', pesos: 2533.03 }]);
    expect(d.omitidasUsd).toBe(1);
    expect(d.minimo).toBe(55304.41);
    expect(d.cierre).toBe('2026-09-27');
    expect(d.vencimiento).toBe('2026-10-02');
    expect(d.totalPesos).toBe(16761.85);
  });

  test('(a2) mínimo a pagar: con coma, con centavos separados por espacio y sin centavos (seguido de la fecha)', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const con = async l => (await parse(page, lineas({ consumos: [C1], minimoLinea: l }))).minimo;
    expect(await con('El mínimo a pagar es $ 55.304,41')).toBe(55304.41);
    expect(await con('El mínimo a pagar es $ 55.304 41')).toBe(55304.41);
    expect(await con('El mínimo a pagar es $ 55.304 2 de octubre')).toBe(55304);
    expect(await con('El mínimo a pagar es $ 55.304 12 de octubre')).toBe(55304);
    expect(await con('El mínimo a pagar es $ 55.304')).toBe(55304);
    expect(await con('El mínimo a pagar es')).toBeNull();
  });

  test('(b) año inferido: fecha posterior al cierre → año anterior; cierre muy a futuro → año anterior', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const L = lineas({ cierre: '9 de enero', venc: '16 de enero', consumos: [
      { f: '28/dic', desc: 'COMERCIO UNO', op: '100001', pesos: 100 },
      { f: '03/ene', desc: 'COMERCIO DOS', op: '100002', pesos: 200 },
    ] });
    const d = await parse(page, L, '2026-01-15');
    expect(d.cierre).toBe('2026-01-09');
    expect(d.vencimiento).toBe('2026-01-16');
    expect(d.movs.map(m => m.fecha)).toEqual(['2025-12-28', '2026-01-03']);
    // cierre de octubre visto desde enero: más de 2 meses a futuro → 2025
    const d2 = await parse(page, lineas({ cierre: '27 de octubre', venc: '2 de noviembre', consumos: [{ f: '20/oct', desc: 'COMERCIO UNO', op: '100003', pesos: 100 }] }), '2026-01-15');
    expect(d2.cierre).toBe('2025-10-27');
    expect(d2.vencimiento).toBe('2025-11-02');
    // vencimiento en el año siguiente al cierre
    const d3 = await parse(page, lineas({ cierre: '27 de diciembre', venc: '2 de enero', consumos: [{ f: '20/dic', desc: 'X', op: '100004', pesos: 100 }] }), '2026-12-28');
    expect(d3.cierre).toBe('2026-12-27');
    expect(d3.vencimiento).toBe('2027-01-02');
  });

  test('(c) fecha del gasto: compra para cuota 1 / pago único, cierre para cuota > 1', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const d = await parse(page, lineas({ consumos: [
      { f: '15/ago', desc: 'COMERCIO UNO', cuota: '1 de 3', op: '200100', pesos: 1000 },
      { f: '16/ago', desc: 'COMERCIO DOS', cuota: '2 de 3', op: '200200', pesos: 2000 },
      { f: '17/ago', desc: 'COMERCIO TRES', cuota: '', op: '200300', pesos: 3000 },
    ] }));
    const cands = await page.evaluate(d => window._mcArmarCandidatos(d, 'Mastercard MP').map(c => ({ f: c.fecha, desc: c.desc, plan: c.plan })), d);
    expect(cands[0].f).toBe('2026-08-15');
    expect(cands[1].f).toBe('2026-09-27');
    expect(cands[1].desc).toBe('COMERCIO DOS (cuota 2/3)');
    expect(cands[1].plan).toEqual({ desc: 'COMERCIO DOS', fecha: '2026-08-16', m: 3 });
    expect(cands[2].f).toBe('2026-08-17');
    expect(cands[2].plan).toBeNull();
  });

  test('(d) la composición del saldo anterior y los pagos no se importan', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const d = await parse(page, lineas({ consumos: [C1], pagosAnt: 1500 }));
    expect(d.movs).toHaveLength(1);
    expect(d.impuestos).toHaveLength(0);
    expect(JSON.stringify(d)).not.toContain('Pago del resumen');
    expect(d.avisoPagos).toBe(true);
    await preview(page, lineas({ consumos: [C1], pagosAnt: 1500 }), { 0: 'Salud' });
    await expect(page.locator('#mcAvisoPagos')).toContainText('pagos/ajustes que no se importan');
    const sin = await parse(page, lineas({ consumos: [C1] }));
    expect(sin.avisoPagos).toBe(false);
  });

  test('(e) verificación de suma: OK y con diferencia', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await preview(page, lineas({ consumos: [C1, PU], impuestos: [SELLO] }), { 0: 'Salud', 1: 'Salud' });
    await expect(page.locator('#mcSumaOk')).toContainText('Suma verificada');
    await expect(page.locator('#mcAvisoSuma')).toHaveCount(0);
    await preview(page, lineas({ consumos: [C1, PU], impuestos: [SELLO], total: 20000 }), { 0: 'Salud', 1: 'Salud' });
    await expect(page.locator('#mcAvisoSuma')).toContainText('no coincide con el total del resumen');
    await expect(page.locator('#mcAvisoSuma')).toContainText('3.238');
    await expect(page.locator('#btnConfirmarMcImp')).toBeEnabled();
  });
});

test.describe('Mastercard MP (PDF): importación', () => {
  test('(f) herencia de categoría entre dos importaciones (operación e importe cambian)', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const m1 = { f: '15/ago', desc: 'COMERCIO UNO', cuota: '1 de 6', op: '777001', pesos: 131138.2 };
    await preview(page, lineas({ consumos: [m1] }));
    await expect(page.locator('.mc-cat-sel')).toHaveCount(1); // sin regla ni herencia: para revisar
    await expect(page.locator('#btnConfirmarMcImp')).toBeDisabled();
    await preview(page, lineas({ consumos: [m1] }), { 0: 'Salud' });
    await importar(page);
    let e = await estadoDe(page);
    const g1 = e.gastos.find(g => g.medio === MC);
    expect(g1).toMatchObject({ categoria: 'Salud', fecha: '2026-08-15', cuota: { n: 1, m: 6 }, plan: { desc: 'COMERCIO UNO', fecha: '2026-08-15', m: 6 }, soloHistorial: false });
    const m2 = { f: '15/ago', desc: 'COMERCIO UNO', cuota: '2 de 6', op: '888002', pesos: 131138.1 };
    await preview(page, lineas({ mes: 'octubre', cierre: '27 de octubre', venc: '3 de noviembre', consumos: [m2] }));
    await expect(page.locator('.mc-cat-sel')).toHaveCount(0);
    await expect(page.locator('#impModalBody')).toContainText('↺ categoría heredada de la cuota anterior');
    await importar(page);
    e = await estadoDe(page);
    const g2 = e.gastos.find(g => g.medio === MC && g.cuota.n === 2);
    expect(g2).toMatchObject({ categoria: 'Salud', fecha: '2026-10-27' });
  });

  test('(g) dos planes con misma descripción y fecha pero distinto importe no se mezclan', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const a1 = { f: '15/ago', desc: 'MERPAGO*TIENDA', cuota: '1 de 3', op: '600001', pesos: 10000 };
    const b1 = { f: '15/ago', desc: 'MERPAGO*TIENDA', cuota: '1 de 3', op: '600002', pesos: 50000 };
    await preview(page, lineas({ consumos: [a1, b1] }), { 0: 'Salud', 1: 'Transporte' });
    await importar(page);
    const a2 = { ...a1, cuota: '2 de 3', op: '600008', pesos: 10000.1 };
    const b2 = { ...b1, cuota: '2 de 3', op: '600009', pesos: 49999.9 };
    await preview(page, lineas({ mes: 'octubre', cierre: '27 de octubre', venc: '3 de noviembre', consumos: [b2, a2] }));
    await page.click('#btnConfirmarMcImp');
    await page.waitForTimeout(150);
    const e = await estadoDe(page);
    const cat = (n, monto) => e.gastos.find(g => g.cuota && g.cuota.n === n && Math.abs(g.monto - monto) < 1).categoria;
    expect(cat(2, 10000.1)).toBe('Salud');
    expect(cat(2, 49999.9)).toBe('Transporte');
  });

  test('(h) borrador con 3 cuotas cruza con la cuota 1 de 3', async ({ page }) => {
    const bor = { id: 'b1', creado: 1, fecha: '2026-08-14', monto: 30000, medio: MC, categoria: 'Salud', nota: 'consulta', cuotas: 3 };
    await seedAndUnlock(page, buildEstado({ borradores: [bor] }));
    const c1 = { f: '15/ago', desc: 'COMERCIO CUATRO', cuota: '1 de 3', op: '300100', pesos: 10000 };
    await preview(page, lineas({ consumos: [c1] }));
    await expect(page.locator('.imp-borr-tag')).toContainText('cruzó con borrador: Salud (cuota 1/3)');
    await expect(page.locator('#impBorrSin')).toHaveCount(0);
    await importar(page);
    let e = await estadoDe(page);
    expect(e.borradores).toHaveLength(0);
    expect(e.gastos.find(g => g.medio === MC).categoria).toBe('Salud');
  });

  test('(h2) borrador que no cruza queda en QUEDARON SIN CRUZAR y no se consume', async ({ page }) => {
    const bor = { id: 'b2', creado: 1, fecha: '2026-08-14', monto: 777, medio: MC, categoria: 'Salud', nota: 'x' };
    await seedAndUnlock(page, buildEstado({ borradores: [bor] }));
    await preview(page, lineas({ consumos: [C1] }), { 0: 'Salud' });
    await expect(page.locator('#impBorrSin')).toContainText('QUEDARON SIN CRUZAR');
    await importar(page);
    expect((await estadoDe(page)).borradores).toHaveLength(1);
  });

  test('(i) reimportar el mismo archivo no duplica', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const L = lineas({ consumos: [C1, PU], impuestos: [SELLO] });
    await preview(page, L, { 0: 'Salud', 1: 'Salud' });
    await importar(page);
    const n1 = (await estadoDe(page)).gastos.length;
    expect(n1).toBe(3);
    await preview(page, L, { 0: 'Salud', 1: 'Salud' });
    await expect(page.locator('#btnConfirmarMcImp')).toContainText('Importar 0 movimientos');
    await importar(page);
    expect((await estadoDe(page)).gastos.length).toBe(n1);
  });

  test('(j) deshacer revierte gastos, compromiso, marca y restaura borradores', async ({ page }) => {
    const bor = { id: 'b3', creado: 1, fecha: '2026-09-03', monto: 4500, medio: MC, categoria: 'Salud', nota: 'x' };
    const comp = { id: 'cm1', nombre: 'Mastercard MP', entidad: MC, monto: 1000, pagoMinimo: 100, pendientes: 1, proxVenc: '2026-09-02', tipo: 'resumen', cierre: '2026-08-27', estimado: false, usd: 0 };
    await seedAndUnlock(page, buildEstado({ borradores: [bor], compromisos: [comp] }));
    await preview(page, lineas({ consumos: [C1, PU] }), { 0: 'Salud' });
    await importar(page);
    let e = await estadoDe(page);
    expect(e.gastos.filter(g => g.medio === MC)).toHaveLength(2);
    expect(e.borradores).toHaveLength(0);
    await page.evaluate(() => window._deshacerUltimaImpMC());
    e = await estadoDe(page);
    expect(e.gastos.filter(g => g.medio === MC)).toHaveLength(0);
    expect(e.borradores.map(b => b.id)).toEqual(['b3']);
    expect(e.importaciones && e.importaciones[MC]).toBeUndefined();
    const c = e.compromisos.find(x => x.entidad === MC);
    expect(c).toMatchObject({ monto: 1000, cierre: '2026-08-27', proxVenc: '2026-09-02', pagoMinimo: 100 });
  });

  test('(k) compromiso resumen: se actualiza con cierre, vencimiento, total y mínimo', async ({ page }) => {
    const comp = { id: 'cm1', nombre: 'Mastercard MP', entidad: MC, monto: 1000, pagoMinimo: 100, pendientes: 1, proxVenc: '2026-09-02', tipo: 'resumen', cierre: '2026-08-27', estimado: false, usd: 0 };
    await seedAndUnlock(page, buildEstado({ compromisos: [comp] }));
    await preview(page, lineas({ consumos: [C1, PU], impuestos: [SELLO] }), { 0: 'Salud', 1: 'Salud' });
    await importar(page);
    const e = await estadoDe(page);
    const cs = e.compromisos.filter(x => x.tipo === 'resumen' && x.entidad === MC);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ id: 'cm1', monto: 16761.85, cierre: '2026-09-27', proxVenc: '2026-10-02', pagoMinimo: 55304.41 });
    expect(e.importaciones[MC].hasta).toBe('2026-09-27');
    // impuesto con su categoría
    expect(e.gastos.find(g => g.descripcion.startsWith('Impuesto al sello')).categoria).toBe('Impuestos e Intereses');
  });

  test('(k2) sin compromiso previo se crea; deshacer lo quita', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await preview(page, lineas({ consumos: [C1] }), { 0: 'Salud' });
    await importar(page);
    let e = await estadoDe(page);
    expect(e.compromisos.filter(x => x.tipo === 'resumen' && x.entidad === MC)).toHaveLength(1);
    await page.evaluate(() => window._deshacerUltimaImpMC());
    e = await estadoDe(page);
    expect(e.compromisos.filter(x => x.entidad === MC)).toHaveLength(0);
  });

  test('botón en Configuración', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await expect(page.locator('#btnImportarMC')).toHaveText('📥 Importar Mastercard MP (PDF)');
  });
});
