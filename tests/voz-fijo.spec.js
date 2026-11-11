// @ts-check
// Dictado de un gasto fijo (modo «🧾 Pagar fijo»): un solo gasto + el fijo marcado pagado ese mes. Sin API real. Datos ficticios.
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1', PIN_KEY = 'finanzas-v1-pin', APIKEY_KEY = 'finanzas-v1-apikey', TEST_PIN = '1234';
const HOY = '2026-10-28', MES = '2026-10';
const URL_API = 'https://api.anthropic.com/v1/messages';

const fijo = (extra = {}) => ({ id: 'f1', tipo: 'fijo', nombre: 'Cochera', monto: 150000, diaMes: 5, categoria: 'Transporte/Auto', palabrasClave: 'cochera,gol trend', activo: true, pagos: {}, ...extra });
const estadoCon = (comps) => ({ iniciales: { 'Banco Santander': 500000, 'Mercado Pago': 100000, 'Efectivo': 400000 }, gastos: [], items: [], patrimonioCargado: true, compromisos: comps });
const base = (o = {}) => ({ monto: 170000, medio: 'Efectivo', descripcion: 'cochera', tipo: 'gasto', categoria: 'Hogar y Materiales', cuotas: 0, dias_atras: 0, fecha: '', ...o });
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

test.describe('dictado de gastos fijos', () => {
  test('"pagué 170000 a la cochera en efectivo" abre Pagar fijo y confirmar crea UN gasto y marca el fijo pagado', async ({ page }) => {
    await setup(page, base(), estadoCon([fijo()]));
    await dictar(page, 'pagué 170000 a la cochera en efectivo');
    expect(await tipoActivo(page)).toBe('fijo');
    await expect(page.locator('#vozFijoNom')).toContainText('Cochera');
    await expect(page.locator('#vozCat')).toHaveCount(0);
    await expect(page.locator('#vozDesc')).toHaveCount(0);
    await expect(page.locator('#vozBorrMonto')).toHaveValue('170.000');
    await expect(page.locator('#vozBorrMedio')).toHaveValue('Efectivo');
    await page.click('#btnVozOk');
    const e = await estadoDe(page);
    expect(e.gastos).toHaveLength(1);
    expect(e.gastos[0]).toMatchObject({ tipo: 'gasto', monto: 170000, medio: 'Efectivo', categoria: 'Transporte/Auto', fecha: HOY });
    const f = e.compromisos.find(c => c.id === 'f1');
    expect(f.pagos[MES]).toMatchObject({ monto: 170000, fecha: HOY, gastoId: e.gastos[0].id });
    // En A pagar el fijo figura pagado (no se puede volver a pagar)
    await page.locator('[role=tab]', { hasText: 'A pagar' }).click();
    await expect(page.locator('.comp-row--fijo[data-fijo-id="f1"][data-mes="' + MES + '"]')).toBeVisible();
    await expect(page.locator('.comp-row--fijo[data-fijo-id="f1"][data-mes="' + MES + '"] button', { hasText: 'Pagué' })).toHaveCount(0);
  });

  test('usa la categoría del fijo, no la de la IA', async ({ page }) => {
    await setup(page, base({ categoria: 'Hogar y Materiales' }), estadoCon([fijo({ categoria: 'Servicios' })]));
    await dictar(page, 'pagué 170000 a la cochera en efectivo');
    await page.click('#btnVozOk');
    expect((await estadoDe(page)).gastos[0].categoria).toBe('Servicios');
  });

  test('dos fijos que coinciden → ambiguo: gasto normal', async ({ page }) => {
    await setup(page, base(), estadoCon([fijo(), fijo({ id: 'f2', nombre: 'Cochera 2', palabrasClave: 'cochera' })]));
    await dictar(page, 'pagué 170000 a la cochera en efectivo');
    expect(await tipoActivo(page)).toBe('gasto');
  });

  test('fijo ya pagado este mes → gasto normal', async ({ page }) => {
    await setup(page, base(), estadoCon([fijo({ pagos: { [MES]: { fecha: HOY, monto: 1, gastoId: null } } })]));
    await dictar(page, 'pagué 170000 a la cochera en efectivo');
    expect(await tipoActivo(page)).toBe('gasto');
    await expect(page.locator('.vc-tipos button[data-tipo="fijo"]')).toHaveCount(0);
  });

  test('sin coincidencia queda gasto normal; el modo se puede elegir a mano con selector de fijo', async ({ page }) => {
    await setup(page, base({ descripcion: 'pizza' }), estadoCon([fijo()]));
    await dictar(page, 'pagué 5000 de pizza');
    expect(await tipoActivo(page)).toBe('gasto');
    await page.click('.vc-tipos button[data-tipo="fijo"]');
    await expect(page.locator('#vozFijo')).toHaveValue('');
    await page.click('#btnVozOk');
    await expect(page.locator('#vozMsg')).toHaveText('Elegí el fijo.');
    await page.selectOption('#vozFijo', 'f1');
    await page.click('#btnVozOk');
    const e = await estadoDe(page);
    expect(e.gastos).toHaveLength(1);
    expect(e.compromisos[0].pagos[MES]).toBeTruthy();
  });

  test('un ingreso no abre Pagar fijo', async ({ page }) => {
    await setup(page, base({ tipo: 'ingreso' }), estadoCon([fijo()]));
    await dictar(page, 'me pagaron por la cochera 170000');
    expect(await tipoActivo(page)).toBe('ingreso');
  });

  test('el modal manual «Pagué» sigue creando un solo gasto y marcando el pago', async ({ page }) => {
    await setup(page, base(), estadoCon([fijo()]));
    await page.evaluate(() => abrirFijoPagoModal('f1', '2026-10'));
    await page.click('#btnConfirmarFijoPago');
    const e = await estadoDe(page);
    expect(e.gastos).toHaveLength(1);
    expect(e.compromisos[0].pagos['2026-10'].gastoId).toBe(e.gastos[0].id);
  });
});
