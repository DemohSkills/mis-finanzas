// Relleno de huecos del historial de patrimonio: snapshots estimados (estimado:true) para los días sin abrir la app
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');

async function abrir(page) {
  const err = [];
  page.on('pageerror', e => err.push(String(e)));
  await page.addInitScript(() => {
    localStorage.setItem('finanzas-v1', JSON.stringify({ iniciales: {}, gastos: [], items: [], patrimonioCargado: true }));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
  });
  await page.goto(INDEX);
  for (const d of '1234') await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(300);
  return err;
}

// Escenario de prueba (off = días atrás respecto de hoy):
//  Efectivo inicial 1000 · gasto 100 en D-4 · ingreso 50 en D-2
//  Visa Santander inicial 0 · gasto 300 en D-3
//  ítems actuales: activo 10000 y deuda 2000
// Devuelve las snaps resultantes tras guardarSnap(), con `off` agregado.
async function correr(page, { snapsPrevios, items = true, gastos = true } = {}) {
  return page.evaluate(({ snapsPrevios, items, gastos }) => {
    const dia = n => _diaMas(hoy(), -n);
    estado.iniciales = Object.fromEntries(MEDIOS.map(m => [m, 0]));
    estado.iniciales['Efectivo'] = 1000;
    estado.gastos = gastos ? [
      { id: 'g1', fecha: dia(4), monto: 100, medio: 'Efectivo', categoria: 'Varios', descripcion: 'a', tipo: 'gasto' },
      { id: 'g2', fecha: dia(2), monto: 50, medio: 'Efectivo', categoria: 'Varios', descripcion: 'b', tipo: 'ingreso' },
      { id: 'g3', fecha: dia(3), monto: 300, medio: 'Visa Santander', categoria: 'Varios', descripcion: 'c', tipo: 'gasto' },
    ] : [];
    estado.items = items ? [
      { id: 'i1', nombre: 'Activo X', tipo: 'activo', monto: 10000, grupo: 'Otros' },
      { id: 'i2', nombre: 'Deuda Y', tipo: 'deuda', monto: 2000, grupo: 'Otros' },
    ] : [];
    localStorage.setItem('finanzas-v1-snaps', JSON.stringify(snapsPrevios.map(s => ({ ...s, d: dia(s.off) }))));
    guardarSnap();
    const hoyS = hoy();
    return JSON.parse(localStorage.getItem('finanzas-v1-snaps')).map(s => ({ ...s, off: Math.round((new Date(hoyS) - new Date(s.d)) / 86400000) }));
  }, { snapsPrevios, items, gastos });
}
const porOff = (snaps, off) => snaps.find(s => s.off === off);

test('un hueco de varios días se rellena con snapshots estimados y saldos de medios correctos a cada fecha', async ({ page }) => {
  const err = await abrir(page);
  const snaps = await correr(page, { snapsPrevios: [{ off: 5, a: 1, dv: 1, n: 0 }] });
  expect(snaps.map(s => s.off)).toEqual([5, 4, 3, 2, 1, 0]);
  // D-4: Efectivo 900 → A 10900, D 2000
  expect(porOff(snaps, 4)).toMatchObject({ a: 10900, dv: 2000, n: 8900, estimado: true });
  // D-3: Visa -300 (deuda) → D 2300
  expect(porOff(snaps, 3)).toMatchObject({ a: 10900, dv: 2300, n: 8600, estimado: true });
  expect(porOff(snaps, 3).dd.vs).toBe(300);
  // D-2: ingreso de 50 → Efectivo 950
  expect(porOff(snaps, 2)).toMatchObject({ a: 10950, dv: 2300, n: 8650, estimado: true });
  expect(porOff(snaps, 1)).toMatchObject({ a: 10950, dv: 2300, n: 8650, estimado: true });
  // el de hoy no es estimado y el previo no se tocó
  expect(porOff(snaps, 0).estimado).toBeUndefined();
  expect(porOff(snaps, 0)).toMatchObject({ a: 10950, dv: 2300, n: 8650 });
  expect(porOff(snaps, 5)).toMatchObject({ a: 1, dv: 1, n: 0 });
  expect(err).toEqual([]);
});

test('un día que ya tenía snapshot dentro del hueco no se pisa', async ({ page }) => {
  await abrir(page);
  const snaps = await correr(page, { snapsPrevios: [{ off: 5, a: 1, dv: 1, n: 0 }, { off: 3, a: 777, dv: 7, n: 770 }] });
  // el último existente es D-3: solo faltan D-2 y D-1
  expect(snaps.map(s => s.off)).toEqual([5, 3, 2, 1, 0]);
  expect(porOff(snaps, 3)).toMatchObject({ a: 777, dv: 7, n: 770 });
  expect(porOff(snaps, 3).estimado).toBeUndefined();
  expect(porOff(snaps, 2).estimado).toBe(true);
  expect(porOff(snaps, 4)).toBeUndefined(); // no se rellena hacia atrás del último snapshot
});

test('sin hueco (se abrió la app todos los días) no cambia nada', async ({ page }) => {
  await abrir(page);
  const previos = [{ off: 3, a: 5, dv: 1, n: 4 }, { off: 2, a: 6, dv: 1, n: 5 }, { off: 1, a: 7, dv: 1, n: 6 }];
  const snaps = await correr(page, { snapsPrevios: previos });
  expect(snaps.map(s => s.off)).toEqual([3, 2, 1, 0]);
  expect(snaps.filter(s => s.estimado)).toEqual([]);
  expect(porOff(snaps, 1)).toMatchObject({ a: 7, n: 6 });
});

test('si el último snapshot es el de hoy, solo se actualiza el de hoy', async ({ page }) => {
  await abrir(page);
  const snaps = await correr(page, { snapsPrevios: [{ off: 0, a: 1, dv: 1, n: 0 }] });
  expect(snaps.map(s => s.off)).toEqual([0]);
  expect(porOff(snaps, 0)).toMatchObject({ a: 10950, n: 8650 });
});

test('sin ningún snapshot previo no rellena nada y no rompe', async ({ page }) => {
  const err = await abrir(page);
  const snaps = await correr(page, { snapsPrevios: [] });
  expect(snaps.map(s => s.off)).toEqual([0]);
  expect(snaps[0].estimado).toBeUndefined();
  expect(err).toEqual([]);
});

test('los ítems en los días rellenados usan el valor ACTUAL (no se reconstruyen)', async ({ page }) => {
  await abrir(page);
  // el snapshot previo tenía otro valor de ítems; los días rellenados igual usan los ítems de hoy
  const sin = await correr(page, { snapsPrevios: [{ off: 3, a: 123456, dv: 999, n: 122457 }], items: false, gastos: false });
  expect(porOff(sin, 2)).toMatchObject({ a: 1000, dv: 0, n: 1000 }); // solo Efectivo inicial
  const con = await correr(page, { snapsPrevios: [{ off: 3, a: 123456, dv: 999, n: 122457 }], gastos: false });
  expect(porOff(con, 2)).toMatchObject({ a: 11000, dv: 2000, n: 9000 });
  expect(porOff(con, 1)).toMatchObject({ a: 11000, dv: 2000, n: 9000 });
});

test('tope de días: un hueco enorme se limita a 400 snapshots en total', async ({ page }) => {
  await abrir(page);
  const snaps = await correr(page, { snapsPrevios: [{ off: 700, a: 1, dv: 1, n: 0 }] });
  expect(snaps.length).toBe(400);
  expect(snaps[snaps.length - 1].off).toBe(0);
  expect(snaps[snaps.length - 2].estimado).toBe(true);
  expect(snaps.filter(s => s.estimado).length).toBe(399);
  expect(snaps.every((s, i) => i === 0 || snaps[i - 1].d < s.d)).toBe(true);
});

test('totalesMediosA respeta la fecha; totales() sigue sumando todos los gastos', async ({ page }) => {
  await abrir(page);
  const r = await page.evaluate(() => {
    estado.iniciales = Object.fromEntries(MEDIOS.map(m => [m, 0]));
    estado.iniciales['Efectivo'] = 1000;
    estado.items = [];
    estado.gastos = [
      { id: 'g1', fecha: hoy(), monto: 300, medio: 'Visa Santander', categoria: 'Varios', descripcion: 'c', tipo: 'gasto' },
      { id: 'g2', fecha: _diaMas(hoy(), 10), monto: 70, medio: 'Efectivo', categoria: 'Varios', descripcion: 'futuro', tipo: 'gasto' },
    ];
    return { hoy: totalesMediosA(hoy()), t: totales(), ayer: totalesMediosA(_diaMas(hoy(), -1)), futuro: totalesMediosA(_diaMas(hoy(), 10)) };
  });
  expect(r.hoy.activos).toBe(1000);
  expect(r.hoy.deudas).toBe(300);
  expect(r.ayer.deudas).toBe(0);      // la compra de hoy aún no existía
  expect(r.futuro.activos).toBe(930); // el gasto fechado a futuro cuenta recién en su día
  expect(r.t.activos).toBe(930);      // totales() no cambió: suma todo
});
