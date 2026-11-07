// @ts-check
// Dictado de un pago recibido (modo «🤝 Cobro»): ingreso + descuento del ítem de Cobros pendientes en un solo paso.
// Sin API real: se intercepta api.anthropic.com. Datos ficticios.
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1', PIN_KEY = 'finanzas-v1-pin', APIKEY_KEY = 'finanzas-v1-apikey', TEST_PIN = '1234';
const HOY = '2026-10-28';
const URL_API = 'https://api.anthropic.com/v1/messages';

const item = (id, nombre, persona, monto) => ({ id, nombre, persona, tipo: 'activo', monto, grupo: 'Cobros pendientes', historial: [] });
function buildEstado(items) {
  return { iniciales: { 'Banco Santander': 500000, 'Mercado Pago': 100000, 'Efectivo': 20000 }, gastos: [], items, patrimonioCargado: true, compromisos: [] };
}
const base = (o = {}) => ({ monto: 341600, medio: 'Mercado Pago', descripcion: 'pago', tipo: 'ingreso', categoria: 'Otros ingresos', cuotas: 0, dias_atras: 0, fecha: '', ...o });
async function setup(page, respuesta, estado) {
  await page.route(URL_API, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(respuesta) }] }) }));
  await page.clock.setFixedTime(new Date(HOY + 'T12:00:00'));
  await page.addInitScript(({ sk, pk, ak, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    localStorage.setItem(ak, JSON.stringify('sk-test'));
  }, { sk: SK, pk: PIN_KEY, ak: APIKEY_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}
const dictar = (page, t) => page.evaluate(x => parsearVoz(x, 'sk-test'), t);
const estadoDe = page => page.evaluate(() => JSON.parse(JSON.stringify(window._getEstado())));
const tipoActivo = page => page.locator('.vc-tipos button[aria-pressed="true"]').getAttribute('data-tipo');

test.describe('dictado de cobro de una deuda', () => {
  test('"Cristina me pagó…" preselecciona su ítem y confirmar crea el ingreso y descuenta en un paso', async ({ page }) => {
    await setup(page, base(), buildEstado([item('c1', 'Préstamo Cristina', 'Cristina', 341600), item('o1', 'Otro', 'Pedro', 50000)]));
    await dictar(page, 'Cristina me pagó trescientos cuarenta y un mil seiscientos');
    expect(await tipoActivo(page)).toBe('cobro');
    await expect(page.locator('#vozItem')).toHaveValue('c1');
    await expect(page.locator('#vozBorrMonto')).toHaveValue('341.600');
    await expect(page.locator('#vozCat')).toHaveCount(0);
    await page.click('#btnVozOk');
    const e = await estadoDe(page);
    expect(e.gastos).toHaveLength(1);
    expect(e.gastos[0]).toMatchObject({ tipo: 'ingreso', monto: 341600, medio: 'Mercado Pago', fecha: HOY });
    expect(e.items.find(i => i.id === 'c1').monto).toBe(0);
    expect(e.items.find(i => i.id === 'c1').historial[0]).toMatchObject({ accion: 'cobre', monto: 341600, gastoId: e.gastos[0].id });
    expect(e.items.find(i => i.id === 'o1').monto).toBe(50000);
  });

  test('pago parcial deja el saldo restante', async ({ page }) => {
    await setup(page, base({ monto: 100000 }), buildEstado([item('c1', 'Préstamo Cristina', 'Cristina', 341600)]));
    await dictar(page, 'Cristina me pagó cien mil');
    await page.click('#btnVozOk');
    const e = await estadoDe(page);
    expect(e.gastos).toHaveLength(1);
    expect(e.items[0].monto).toBe(241600);
  });

  test('nombre ambiguo (dos ítems) no preselecciona y exige elegir', async ({ page }) => {
    await setup(page, base(), buildEstado([item('a', 'Deuda Ana López', 'Ana López', 1000), item('b', 'Deuda Ana Pérez', 'Ana Pérez', 2000)]));
    await dictar(page, 'Ana me pagó cien mil');
    expect(await tipoActivo(page)).toBe('cobro');
    await expect(page.locator('#vozItem')).toHaveValue('');
    await page.click('#btnVozOk');
    await expect(page.locator('#vozMsg')).toHaveText('Elegí quién te pagó.');
    expect((await estadoDe(page)).gastos).toHaveLength(0);
  });

  test('sin coincidencia de nombre queda en ingreso normal, y el modo Cobro está disponible a mano', async ({ page }) => {
    await setup(page, base(), buildEstado([item('c1', 'Préstamo Cristina', 'Cristina', 1000)]));
    await dictar(page, 'Roberto me pagó cien mil');
    expect(await tipoActivo(page)).toBe('ingreso');
    await expect(page.locator('.vc-tipos button[data-tipo="cobro"]')).toHaveCount(1);
  });

  test('sin ítems con saldo no aparece el modo Cobro', async ({ page }) => {
    await setup(page, base(), buildEstado([item('c1', 'Préstamo Cristina', 'Cristina', 0)]));
    await dictar(page, 'Cristina me pagó cien mil');
    expect(await tipoActivo(page)).toBe('ingreso');
    await expect(page.locator('.vc-tipos button[data-tipo="cobro"]')).toHaveCount(0);
  });

  test('monto mayor a lo que debe con hermanos abre el reparto', async ({ page }) => {
    await setup(page, base({ monto: 150000 }), buildEstado([item('a', 'Cobro uno', 'Cristina', 100000), item('b', 'Cobro dos', 'Cristina', 80000)]));
    await dictar(page, 'Cristina me pagó ciento cincuenta mil');
    await page.selectOption('#vozItem', 'a');
    await page.click('#btnVozOk');
    await expect(page.locator('#voiceConfirm')).toBeHidden();
    await expect(page.locator('#repartoModal')).toBeVisible();
    expect((await estadoDe(page)).gastos).toHaveLength(0);
  });
});
