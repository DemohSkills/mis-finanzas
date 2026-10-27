// Cobro semanal: resumen plegable + "Cargar semanas anteriores" (historial informativo)
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN = '1234';
const TEMAS = ['auto', 'claro', 'oscuro', 'negro', 'neon-azul', 'neon-turquesa', 'neon-violeta'];

const ent = (id, fecha, monto, tipo = 'dia') => ({ id, fecha, monto, tipo });
function cobro(extra = {}) {
  return { id: 'cs1', nombre: 'Meli Extra', persona: 'Meli Envíos', medioCobro: 'Mercado Pago',
    entradas: [ent('e1', '2026-10-19', 60000), ent('e2', '2026-10-25', 40000)], cobradas: [], ...extra };
}
const estadoBase = (cs, extra = {}) => ({ iniciales: { 'Mercado Pago': 0, 'Banco Santander': 0, 'Efectivo': 0 }, gastos: [], items: [], compromisos: [],
  patrimonioCargado: true, cobrosSemanales: cs ? [cs] : [], ...extra });
async function abrir(page, hoyStr, estado) {
  await page.clock.setFixedTime(new Date(hoyStr + 'T12:00:00'));
  await page.addInitScript(({ sk, est, pin }) => {
    localStorage.setItem(sk, JSON.stringify(est));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify(pin));
  }, { sk: SK, est: estado, pin: PIN });
  await page.goto(INDEX);
  for (const d of PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForSelector('#pinScr', { state: 'hidden' });
  await page.locator('[role=tab]', { hasText: 'Patrimonio' }).click();
  await page.waitForSelector('#listaActivos');
}
const getEstado = page => page.evaluate(sk => JSON.parse(localStorage.getItem(sk)), SK);
const card = page => page.locator('#listaActivos details[data-cw-id="cs1"]');

async function cargarFilas(page, filas) {
  await card(page).locator('.cw-hist-btn').click();
  await expect(page.locator('#cwHistModal')).toBeVisible();
  for (let i = 0; i < filas.length; i++) {
    if (i > 0) await page.click('#btnCwHistMas');
    const f = page.locator('#cwHistFilas .cw-hrow').nth(i);
    await f.locator('.cw-h-desde').fill(filas[i][0]);
    await f.locator('.cw-h-bruto').fill(String(filas[i][1]));
    if (filas[i][2] != null) await f.locator('.cw-h-dep').fill(String(filas[i][2]));
  }
  await page.click('#btnCwHistGuardar');
}
const TRES = [['2026-09-14', 100000, 90000], ['2026-09-21', 50000, 40000], ['2026-09-28', 30000, null]];

test.describe('cobro semanal: historial y resumen', () => {
  test('3 semanas de historial: resumen con totales y promedio; cuentas y ganancia no cambian', async ({ page }) => {
    await abrir(page, '2026-10-27', estadoBase(cobro()));
    const antes = await page.evaluate(() => ({ t: totales(), mp: saldoDe('Mercado Pago'), g: estado.gastos.length, debe: cwDebeTotal() }));
    await cargarFilas(page, TRES);
    await expect(page.locator('#cwHistModal')).toBeHidden();
    const despues = await page.evaluate(() => ({ t: totales(), mp: saldoDe('Mercado Pago'), g: estado.gastos.length, debe: cwDebeTotal() }));
    expect(despues).toEqual(antes);
    const e = await getEstado(page);
    expect(e.cobrosSemanales[0].cobradas).toHaveLength(3);
    expect(e.cobrosSemanales[0].cobradas.every(c => c.historial === true && !c.movId)).toBe(true);
    expect(e.cobrosSemanales[0].cobradas.find(c => c.desde === '2026-09-28')).toMatchObject({ hasta: '2026-10-04', neto: null, retencion: null });
    expect(e.cobrosSemanales[0].cobradas.find(c => c.desde === '2026-09-14')).toMatchObject({ neto: 90000, retencion: 10000 });
    const res = card(page).locator('details.cw-res');
    await res.locator('summary').click();
    await expect(res.locator('.cw-r-bruto')).toContainText('280.000'); // 100.000 pendiente + 180.000 historial
    await expect(res.locator('.cw-r-sem')).toHaveText('4');
    await expect(res.locator('.cw-r-dep')).toContainText('130.000');
    await expect(res.locator('.cw-r-ret')).toContainText('15,0 %');
    await expect(res.locator('.cw-r-ret')).toContainText('(2 semanas con dato)');
    // lista: más nueva primero, con "sin dato"
    const cob = card(page).locator('details.cw-cob');
    await cob.locator('summary').click();
    await expect(cob.locator('summary')).toContainText('(3)');
    const filas = cob.locator('.cw-cobrow');
    await expect(filas.nth(0)).toContainText('28/09 al 04/10');
    await expect(filas.nth(0)).toContainText('sin dato');
    await expect(filas.nth(2)).toContainText('14/09 al 20/09');
    await expect(filas.nth(2)).toContainText('→');
    await expect(filas.nth(2)).toContainText('10,0 %');
  });

  test('validaciones: lunes, futuras, solapadas, bruto y depositado', async ({ page }) => {
    const cs = cobro({ cobradas: [{ desde: '2026-09-07', hasta: '2026-09-13', bruto: 1000, neto: 900, retencion: 100, historial: true }] });
    await abrir(page, '2026-10-27', estadoBase(cs));
    const casos = [
      [[['2026-09-29', 1000, null]], 'lunes'],
      [[['2026-10-26', 1000, null]], 'no fechas futuras'],
      [[['2026-11-02', 1000, null]], 'no fechas futuras'],
      [[['2026-09-07', 1000, null]], 'superpone'],
      [[['2026-10-19', 1000, null]], 'superpone'],
      [[['2026-09-14', 1000, null], ['2026-09-14', 2000, null]], 'superpone'],
      [[['2026-09-14', 0, null]], 'bruto'],
      [[['2026-09-14', 1000, 1001]], 'no puede ser mayor'],
    ];
    for (const [filas, txt] of casos) {
      await cargarFilas(page, filas);
      await expect(page.locator('#cwHistMsg')).toContainText(txt);
      await expect(page.locator('#cwHistModal')).toBeVisible();
      await page.click('#btnCwHistCerrar');
    }
    expect((await getEstado(page)).cobrosSemanales[0].cobradas).toHaveLength(1);
    await card(page).locator('.cw-hist-btn').click();
    await expect(page.locator('#cwHistModal')).toContainText('Solo informativo: no toca cuentas ni la ganancia del mes.');
  });

  test('el resumen arranca plegado y recuerda su estado', async ({ page }) => {
    await abrir(page, '2026-10-27', estadoBase(cobro()));
    const res = card(page).locator('details.cw-res');
    expect(await res.evaluate(d => d.open)).toBe(false);
    await res.locator('summary').click();
    expect(await res.evaluate(d => d.open)).toBe(true);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('finanzas-v1-det-cw-res-cs1'))).toBe('true');
    await page.evaluate(() => render());
    expect(await card(page).locator('details.cw-res').evaluate(d => d.open)).toBe(true);
  });

  test('backup/restore conserva el historial', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await abrir(page, '2026-10-27', estadoBase(cobro()));
    await cargarFilas(page, TRES);
    const json = await page.evaluate(() => buildBackupJson());
    expect(JSON.parse(json).estado.cobrosSemanales[0].cobradas.filter(c => c.historial)).toHaveLength(3);
    await page.evaluate(() => { estado.cobrosSemanales[0].cobradas = []; });
    await page.evaluate(j => restaurarBackup(new File([j], 'b.json', { type: 'application/json' })), json);
    await expect.poll(() => page.evaluate(() => estado.cobrosSemanales[0].cobradas.length)).toBe(3);
  });

  test('Deshacer último cobro ignora el historial; sin cobros reales no hay botón', async ({ page }) => {
    page.on('dialog', d => d.accept());
    const hist = { desde: '2026-10-12', hasta: '2026-10-18', bruto: 1000, neto: null, retencion: null, historial: true };
    const real = { desde: '2026-09-28', hasta: '2026-10-04', bruto: 20000, neto: 19000, retencion: 1000, fechaCobro: '2026-10-07', movId: 'm1' };
    const gasto = { id: 'm1', creado: 1, monto: 19000, fecha: '2026-10-07', categoria: 'Sueldo/Honorarios', medio: 'Mercado Pago', descripcion: 'x', tipo: 'ingreso', soloHistorial: false };
    await abrir(page, '2026-10-27', estadoBase(cobro({ cobradas: [real, hist] }), { gastos: [gasto] }));
    const cob = card(page).locator('details.cw-cob');
    await cob.locator('summary').click();
    await cob.locator('.cw-undo').click();
    const e = await getEstado(page);
    expect(e.gastos).toHaveLength(0);
    expect(e.cobrosSemanales[0].cobradas).toEqual([hist]);
    await expect(card(page).locator('.cw-undo')).toHaveCount(0);
  });

  test('borrar una semana de historial pide confirmación y no toca nada más', async ({ page }) => {
    await abrir(page, '2026-10-27', estadoBase(cobro()));
    await cargarFilas(page, TRES);
    const cob = card(page).locator('details.cw-cob');
    await cob.locator('summary').click();
    page.once('dialog', d => d.dismiss());
    await cob.locator('.cw-cobrow').first().locator('.cw-h-del').click();
    expect((await getEstado(page)).cobrosSemanales[0].cobradas).toHaveLength(3);
    page.once('dialog', d => d.accept());
    await cob.locator('.cw-cobrow').first().locator('.cw-h-del').click();
    const e = await getEstado(page);
    expect(e.cobrosSemanales[0].cobradas.map(c => c.desde).sort()).toEqual(['2026-09-14', '2026-09-21']);
    expect(e.gastos).toHaveLength(0);
  });

  test('el promedio del modal Cobré incluye el historial con neto', async ({ page }) => {
    const hist = [{ desde: '2026-09-14', hasta: '2026-09-20', bruto: 100000, neto: 90000, retencion: 10000, historial: true },
      { desde: '2026-09-21', hasta: '2026-09-27', bruto: 50000, neto: 40000, retencion: 10000, historial: true },
      { desde: '2026-09-28', hasta: '2026-10-04', bruto: 30000, neto: null, retencion: null, historial: true }];
    await abrir(page, '2026-10-27', estadoBase(cobro({ cobradas: hist })));
    await card(page).locator('.cw-sem button', { hasText: 'Cobré' }).click();
    await expect(page.locator('#cwCobProm')).toContainText('15,0 %');
  });

  test('390 px sin scroll horizontal en los 7 temas (resumen abierto y modal)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await abrir(page, '2026-10-27', estadoBase(cobro({ cobradas: TRES.map(f => ({ desde: f[0], hasta: f[0], bruto: f[1], neto: f[2], retencion: f[2] == null ? null : f[1] - f[2], historial: true })) })));
    await card(page).locator('details.cw-res summary').click();
    await card(page).locator('details.cw-cob summary').click();
    for (const t of TEMAS) {
      await page.evaluate(x => aplicarTema(x), t);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), t).toBe(true);
    }
    await card(page).locator('.cw-hist-btn').click();
    await page.click('#btnCwHistMas');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const caja = await page.locator('#cwHistModal .wiz-box').boundingBox();
    expect(caja.x).toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width).toBeLessThanOrEqual(390);
  });
});
