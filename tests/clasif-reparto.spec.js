// Reparto de una transferencia recibida entre ítems de Delux al clasificarla como "Sueldo Delux"
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN = '1234';
const TEMAS = ['auto', 'claro', 'oscuro', 'negro', 'neon-azul', 'neon-turquesa', 'neon-violeta'];

const item = (id, nombre, monto, extra = {}) => ({ id, nombre, tipo: 'activo', monto, grupo: 'Cobros pendientes', persona: 'Delux', historial: [], ...extra });
const ITEMS = () => [item('adeu', 'Delux sueldo adeudado', 529000), item('peaje', 'Delux peajes', 40000), item('prox', 'Delux próximo sueldo', 2729000)];
const transf = (id, monto, fecha, extra = {}) => ({ id, creado: 1, monto, fecha, categoria: 'Transferencia recibida', medio: 'Mercado Pago', tipo: 'ingreso', descripcion: 'Transferencia recibida Tercero ' + id, ...extra });
const estadoBase = (items, gastos) => ({ iniciales: { 'Mercado Pago': 0, 'Banco Santander': 0, 'Efectivo': 0 }, gastos, items, compromisos: [], patrimonioCargado: true });

async function abrir(page, estado) {
  await page.clock.setFixedTime(new Date('2026-10-27T12:00:00'));
  await page.addInitScript(({ sk, est, pin }) => {
    localStorage.setItem(sk, JSON.stringify(est));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify(pin));
  }, { sk: SK, est: estado, pin: PIN });
  await page.goto(INDEX);
  for (const d of PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}
const getEstado = page => page.evaluate(sk => JSON.parse(localStorage.getItem(sk)), SK);
const monto = (e, id) => e.items.find(i => i.id === id).monto;
async function clasificar(page, prop, fila = 0) {
  if (await page.locator('#clasifModal').isHidden()) await page.evaluate(() => abrirClasifTransf());
  await page.locator('#clasifLista .clasif-row').nth(fila).locator(`.prop-chip[data-p="${prop}"]`).click();
}
const guardar = page => page.click('#btnClasifGuardar');

test.describe('reparto desde la clasificación', () => {
  test('(a) 581.500 como sueldo-delux: cuadro 529.000 / 52.500, un solo movimiento', async ({ page }) => {
    await abrir(page, estadoBase(ITEMS(), [transf('t1', 581500, '2026-10-26')]));
    await clasificar(page, 'sueldo-delux');
    await guardar(page);
    await expect(page.locator('#repartoModal')).toBeVisible();
    await expect(page.locator('#repartoSub')).toContainText('No se crea otro ingreso');
    await expect(page.locator('#repartoFilas .rep-fila')).toHaveCount(2);
    await expect(page.locator('#repartoFilas .rep-in').nth(0)).toHaveValue(/529\.000/);
    await expect(page.locator('#repartoFilas .rep-in').nth(1)).toHaveValue(/52\.500/);
    await expect(page.locator('#btnRepartoTodo')).toBeHidden();
    await page.click('#btnRepartoOk');
    await expect(page.locator('#repartoModal')).toBeHidden();
    const e = await getEstado(page);
    expect(e.gastos).toHaveLength(1);
    expect(e.gastos[0]).toMatchObject({ monto: 581500, proposito: 'sueldo-delux', repartido: true });
    expect(monto(e, 'adeu')).toBe(0);
    expect(monto(e, 'prox')).toBe(2676500);
    expect(monto(e, 'peaje')).toBe(40000);
    const ha = e.items.find(i => i.id === 'adeu').historial[0], hp = e.items.find(i => i.id === 'prox').historial[0];
    expect(ha).toMatchObject({ accion: 'cobre', monto: 529000, gastoId: 't1', deImport: true });
    expect(hp).toMatchObject({ accion: 'cobre', monto: 52500, gastoId: 't1', deImport: true });
    expect(hp.repartoId).toBe(ha.repartoId);
    expect(ha.repartoId).toBeTruthy();
  });

  test('(b) "No repartir" guarda la clasificación y deja los ítems intactos', async ({ page }) => {
    await abrir(page, estadoBase(ITEMS(), [transf('t1', 581500, '2026-10-26')]));
    await clasificar(page, 'sueldo-delux');
    await guardar(page);
    await page.click('#btnRepartoNo');
    await expect(page.locator('#repartoModal')).toBeHidden();
    await expect(page.locator('#clasifModal')).toBeHidden();
    const e = await getEstado(page);
    expect(e.gastos[0].proposito).toBe('sueldo-delux');
    expect(e.gastos[0].repartido).toBeUndefined();
    expect(monto(e, 'adeu')).toBe(529000);
    expect(monto(e, 'prox')).toBe(2729000);
    expect(e.items.every(i => i.historial.length === 0)).toBe(true);
  });

  test('(b2) "Cancelar" vuelve a la clasificación sin guardar nada', async ({ page }) => {
    await abrir(page, estadoBase(ITEMS(), [transf('t1', 581500, '2026-10-26')]));
    await clasificar(page, 'sueldo-delux');
    await guardar(page);
    await page.click('#btnRepartoCerrar');
    await expect(page.locator('#repartoModal')).toBeHidden();
    await expect(page.locator('#clasifModal')).toBeVisible();
    const e = await getEstado(page);
    expect(e.gastos[0].proposito).toBeUndefined();
    expect(monto(e, 'adeu')).toBe(529000);
  });

  test('(c) monto menor al adeudado: todo al primero', async ({ page }) => {
    await abrir(page, estadoBase(ITEMS(), [transf('t1', 100000, '2026-10-26')]));
    await clasificar(page, 'sueldo-delux');
    await guardar(page);
    await expect(page.locator('#repartoModal')).toBeVisible();
    await expect(page.locator('#repartoFilas .rep-in').nth(1)).toHaveValue(/^0(,00)?$/);
    await page.click('#btnRepartoOk');
    const e = await getEstado(page);
    expect(monto(e, 'adeu')).toBe(429000);
    expect(monto(e, 'prox')).toBe(2729000);
    expect(e.items.find(i => i.id === 'adeu').historial[0].repartoId).toBeUndefined();
  });

  test('(d) el peaje no aparece', async ({ page }) => {
    await abrir(page, estadoBase(ITEMS(), [transf('t1', 581500, '2026-10-26')]));
    await clasificar(page, 'sueldo-delux');
    await guardar(page);
    await expect(page.locator('#repartoFilas')).not.toContainText('peaje');
  });

  for (const prop of ['reembolso', 'familia']) {
    test(`(e) ${prop} no abre el cuadro`, async ({ page }) => {
      await abrir(page, estadoBase(ITEMS(), [transf('t1', 581500, '2026-10-26')]));
      await clasificar(page, prop);
      await guardar(page);
      await expect(page.locator('#repartoModal')).toBeHidden();
      const e = await getEstado(page);
      expect(e.gastos[0].proposito).toBe(prop);
      expect(monto(e, 'adeu')).toBe(529000);
    });
  }

  test('(f) deshacer restaura montos y NO borra el movimiento importado', async ({ page }) => {
    await abrir(page, estadoBase(ITEMS(), [transf('t1', 581500, '2026-10-26')]));
    await clasificar(page, 'sueldo-delux');
    await guardar(page);
    await page.click('#btnRepartoOk');
    const dialogos = [];
    page.on('dialog', d => { dialogos.push(d.message()); d.accept(); });
    await page.locator('[role=tab]', { hasText: 'Vínculos' }).click();
    const li = page.locator('#vinculos li', { hasText: 'Delux próximo sueldo' });
    await li.locator('summary').click();
    await li.locator('.danger').click();
    expect(dialogos[0]).toBe('Se restauran los montos pendientes. El movimiento importado no se borra.');
    const e = await getEstado(page);
    expect(e.gastos).toHaveLength(1);
    expect(e.gastos[0].repartido).toBeUndefined();
    expect(monto(e, 'adeu')).toBe(529000);
    expect(monto(e, 'prox')).toBe(2729000);
    expect(e.items.every(i => i.historial.length === 0)).toBe(true);
  });

  test('(g) re-editar la clasificación no vuelve a ofrecer el reparto; al reclasificar avisa', async ({ page }) => {
    await abrir(page, estadoBase(ITEMS(), [transf('t1', 581500, '2026-10-26')]));
    await clasificar(page, 'sueldo-delux');
    await guardar(page);
    await page.click('#btnRepartoOk');
    await page.evaluate(() => abrirClasifTransf());
    const fila = page.locator('#clasifLista .clasif-row').first();
    await fila.locator('.prop-chip[data-p="reembolso"]').click();
    await expect(fila.locator('.clasif-rep-nota')).toContainText('sigue vigente');
    await guardar(page);
    await expect(page.locator('#repartoModal')).toBeHidden();
    let e = await getEstado(page);
    expect(e.gastos[0].proposito).toBe('reembolso');
    expect(monto(e, 'prox')).toBe(2676500); // no se tocó
    await page.evaluate(() => abrirClasifTransf());
    await page.locator('#clasifLista .clasif-row').first().locator('.prop-chip[data-p="sueldo-delux"]').click();
    await guardar(page);
    await expect(page.locator('#repartoModal')).toBeHidden();
    e = await getEstado(page);
    expect(monto(e, 'prox')).toBe(2676500);
    expect(e.items.find(i => i.id === 'prox').historial).toHaveLength(1);
  });

  test('varias transferencias Delux: el cuadro se ofrece de a una, en orden', async ({ page }) => {
    await abrir(page, estadoBase(ITEMS(), [transf('t1', 300000, '2026-10-20'), transf('t2', 300000, '2026-10-26')]));
    await page.evaluate(() => abrirClasifTransf());
    await page.locator('#btnClasifDelux').click();
    await guardar(page);
    await expect(page.locator('#repartoFilas .rep-in').nth(0)).toHaveValue(/300\.000/);
    await page.click('#btnRepartoOk');
    // segunda: adeudado queda en 229.000
    await expect(page.locator('#repartoModal')).toBeVisible();
    await expect(page.locator('#repartoFilas .rep-in').nth(0)).toHaveValue(/229\.000/);
    await expect(page.locator('#repartoFilas .rep-in').nth(1)).toHaveValue(/71\.000/);
    await page.click('#btnRepartoOk');
    const e = await getEstado(page);
    expect(e.gastos).toHaveLength(2);
    expect(monto(e, 'adeu')).toBe(0);
    expect(monto(e, 'prox')).toBe(2658000);
  });

  test('(h) 390 px sin desborde en los 7 temas', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await abrir(page, estadoBase([item('adeu', 'Delux sueldo adeudado con nombre bien largo', 529000), item('prox', 'Delux próximo sueldo también largo', 2729000)], [transf('t1', 581500, '2026-10-26')]));
    await clasificar(page, 'sueldo-delux');
    await guardar(page);
    for (const t of TEMAS) {
      await page.evaluate(x => aplicarTema(x), t);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), t).toBe(true);
      const c = await page.locator('#repartoModal .wiz-box').boundingBox();
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x + c.width).toBeLessThanOrEqual(390);
      await expect(page.locator('#btnRepartoNo')).toBeVisible();
    }
  });
});
