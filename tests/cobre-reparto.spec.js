// Reparto de un cobro entre ítems de la misma persona (modal "Cobré" en Vínculos)
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN = '1234';
const TEMAS = ['auto', 'claro', 'oscuro', 'negro', 'neon-azul', 'neon-turquesa', 'neon-violeta'];

const item = (id, nombre, monto, extra = {}) => ({ id, nombre, tipo: 'activo', monto, grupo: 'Cobros pendientes', persona: 'Delux', historial: [], ...extra });
function estadoBase(items) {
  return { iniciales: { 'Mercado Pago': 0, 'Banco Santander': 0, 'Efectivo': 0 }, gastos: [], items, compromisos: [], patrimonioCargado: true };
}
const ITEMS = () => [item('adeu', 'Delux sueldo adeudado', 529000), item('peaje', 'Delux peajes', 40000), item('prox', 'Delux próximo sueldo', 2729000)];

async function abrir(page, estado) {
  await page.clock.setFixedTime(new Date('2026-10-27T12:00:00'));
  await page.addInitScript(({ sk, est, pin }) => {
    localStorage.setItem(sk, JSON.stringify(est));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify(pin));
  }, { sk: SK, est: estado, pin: PIN });
  await page.goto(INDEX);
  for (const d of PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForSelector('#pinScr', { state: 'hidden' });
  await page.locator('[role=tab]', { hasText: 'Vínculos' }).click();
  await page.waitForSelector('#vinculos details.persona');
}
const getEstado = page => page.evaluate(sk => JSON.parse(localStorage.getItem(sk)), SK);
const monto = (e, id) => e.items.find(i => i.id === id).monto;
async function cobrar(page, nombre, bruto, neto) {
  await page.locator('#vinculos li', { hasText: nombre }).locator('button', { hasText: 'Cobré' }).first().click();
  await page.fill('#cobreBruto', String(bruto));
  if (neto != null) await page.fill('#cobreNeto', String(neto));
  await page.click('#btnGuardarCobre');
}

test.describe('reparto de cobro', () => {
  test('(a) 581.500 con adeudado 529.000 y próximo 2.729.000: un ingreso, adeudado 0, próximo 2.676.500', async ({ page }) => {
    await abrir(page, estadoBase(ITEMS()));
    await cobrar(page, 'Delux sueldo adeudado', 581500);
    await expect(page.locator('#repartoModal')).toBeVisible();
    await expect(page.locator('#repartoTit')).toContainText('Repartir cobro de Delux');
    await expect(page.locator('#repartoSub')).toContainText('Se registra como un solo ingreso');
    await expect(page.locator('#repartoFilas .rep-fila')).toHaveCount(2); // peajes no aparece
    await expect(page.locator('#repartoFilas .rep-res').nth(0)).toContainText('queda cancelado');
    await expect(page.locator('#repartoFilas .rep-res').nth(1)).toContainText('2.676.500');
    await page.click('#btnRepartoOk');
    const e = await getEstado(page);
    expect(e.gastos).toHaveLength(1);
    expect(e.gastos[0]).toMatchObject({ monto: 581500, tipo: 'ingreso', categoria: 'Sueldo/Honorarios', medio: 'Mercado Pago' });
    expect(monto(e, 'adeu')).toBe(0);
    expect(monto(e, 'prox')).toBe(2676500);
    expect(monto(e, 'peaje')).toBe(40000);
    const ha = e.items.find(i => i.id === 'adeu').historial[0], hp = e.items.find(i => i.id === 'prox').historial[0];
    expect(ha).toMatchObject({ accion: 'cobre', monto: 529000, gastoId: e.gastos[0].id });
    expect(hp).toMatchObject({ accion: 'cobre', monto: 52500, gastoId: e.gastos[0].id });
    expect(ha.repartoId).toBeTruthy();
    expect(hp.repartoId).toBe(ha.repartoId);
  });

  test('(b) editar el reparto a mano; el total debe dar el bruto', async ({ page }) => {
    await abrir(page, estadoBase(ITEMS()));
    await cobrar(page, 'Delux sueldo adeudado', 581500);
    const ins = page.locator('#repartoFilas .rep-in');
    await ins.nth(0).fill('500000');
    await expect(page.locator('#repartoTot')).toContainText('faltan');
    await page.click('#btnRepartoOk');
    await expect(page.locator('#repartoMsg')).toContainText('total tiene que dar');
    expect((await getEstado(page)).gastos).toHaveLength(0);
    await ins.nth(1).fill('81500');
    await expect(page.locator('#repartoFilas .rep-res').nth(0)).toContainText('queda en');
    await page.click('#btnRepartoOk');
    const e = await getEstado(page);
    expect(monto(e, 'adeu')).toBe(29000);
    expect(monto(e, 'prox')).toBe(2647500);
  });

  test('(b2) una parte mayor a lo que debía se rechaza', async ({ page }) => {
    await abrir(page, estadoBase(ITEMS()));
    await cobrar(page, 'Delux sueldo adeudado', 581500);
    await page.locator('#repartoFilas .rep-in').nth(0).fill('600000');
    await page.locator('#repartoFilas .rep-in').nth(1).fill('0');
    await page.click('#btnRepartoOk');
    await expect(page.locator('#repartoMsg')).toContainText('supera');
    expect((await getEstado(page)).gastos).toHaveLength(0);
  });

  test('(c) monto menor al pendiente no muestra cuadro', async ({ page }) => {
    await abrir(page, estadoBase(ITEMS()));
    await cobrar(page, 'Delux sueldo adeudado', 100000);
    await expect(page.locator('#repartoModal')).toBeHidden();
    const e = await getEstado(page);
    expect(e.gastos).toHaveLength(1);
    expect(monto(e, 'adeu')).toBe(429000);
    expect(e.items.find(i => i.id === 'adeu').historial[0].repartoId).toBeUndefined();
  });

  test('(d) el peaje se salta aunque esté entre medio', async ({ page }) => {
    await abrir(page, estadoBase([item('adeu', 'Delux sueldo adeudado', 1000), item('peaje', 'PEAJES Delux', 5000), item('prox', 'Próximo', 10000)]));
    await cobrar(page, 'Delux sueldo adeudado', 3000);
    await page.click('#btnRepartoOk');
    const e = await getEstado(page);
    expect(monto(e, 'peaje')).toBe(5000);
    expect(monto(e, 'prox')).toBe(8000);
    // sin otros ítems que no sean peaje: no hay cuadro
  });

  test('(d2) si solo hay peaje de hermano no hay cuadro (como hoy)', async ({ page }) => {
    await abrir(page, estadoBase([item('adeu', 'Sueldo', 1000), item('peaje', 'Peaje', 5000)]));
    await cobrar(page, 'Sueldo', 3000);
    await expect(page.locator('#repartoModal')).toBeHidden();
    const e = await getEstado(page);
    expect(monto(e, 'adeu')).toBe(0);
    expect(monto(e, 'peaje')).toBe(5000);
  });

  test('(e) deshacer revierte todas las partes y borra un solo ingreso', async ({ page }) => {
    await abrir(page, estadoBase(ITEMS()));
    await cobrar(page, 'Delux sueldo adeudado', 581500);
    await page.click('#btnRepartoOk');
    const dialogos = [];
    page.on('dialog', d => { dialogos.push(d.message()); d.accept(); });
    const li = page.locator('#vinculos li', { hasText: 'Delux próximo sueldo' });
    await li.locator('summary').click();
    await li.locator('.danger').click();
    expect(dialogos[0]).toContain('todas las partes');
    const e = await getEstado(page);
    expect(e.gastos).toHaveLength(0);
    expect(monto(e, 'adeu')).toBe(529000);
    expect(monto(e, 'prox')).toBe(2729000);
    expect(e.items.every(i => i.historial.length === 0)).toBe(true);
  });

  test('(f) "Todo a sueldo adeudado" se comporta como hoy', async ({ page }) => {
    await abrir(page, estadoBase(ITEMS()));
    await cobrar(page, 'Delux sueldo adeudado', 581500);
    await page.click('#btnRepartoTodo');
    const e = await getEstado(page);
    expect(e.gastos).toHaveLength(1);
    expect(e.gastos[0].monto).toBe(581500);
    expect(monto(e, 'adeu')).toBe(0);
    expect(monto(e, 'prox')).toBe(2729000);
    expect(e.items.find(i => i.id === 'adeu').historial[0].repartoId).toBeUndefined();
  });

  test('(g) importar un Santander con 581.500 el mismo día no duplica', async ({ page }) => {
    await abrir(page, estadoBase(ITEMS()));
    await page.locator('#vinculos li', { hasText: 'Delux sueldo adeudado' }).locator('button', { hasText: 'Cobré' }).first().click();
    await page.selectOption('#cobreMedio', 'Banco Santander');
    await page.fill('#cobreBruto', '581500');
    await page.click('#btnGuardarCobre');
    await page.click('#btnRepartoOk');
    const r = await page.evaluate(() => {
      const mk = (fecha) => ({ monto: 581500, fecha, catInfo: { tipo: 'ingreso' }, ref: null });
      return _deduplicarImp([mk('2026-10-27'), mk('2026-10-27')], 'Banco Santander').map(c => c.yaExiste);
    });
    expect(r).toEqual([true, false]);
  });

  test('390 px sin scroll horizontal en los 7 temas', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await abrir(page, estadoBase([item('adeu', 'Delux sueldo adeudado con nombre bien largo', 529000), item('prox', 'Delux próximo sueldo también largo', 2729000)]));
    await cobrar(page, 'Delux sueldo adeudado', 99999999);
    for (const t of TEMAS) {
      await page.evaluate(x => aplicarTema(x), t);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), t).toBe(true);
      const c = await page.locator('#repartoModal .wiz-box').boundingBox();
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x + c.width).toBeLessThanOrEqual(390);
    }
    await page.evaluate(() => aplicarTema('neon-azul'));
    await page.locator('#repartoModal .wiz-box').screenshot({ path: 'capturas-tmp/reparto-neon-azul.png' });
  });
});
