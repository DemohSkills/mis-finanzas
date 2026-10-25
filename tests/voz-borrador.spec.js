// @ts-check
// Dictado por voz en modo borrador (palabra "borrador"): guarda en estado.borradores sin tocar saldos.
// Sin API real: se intercepta api.anthropic.com. Datos ficticios.
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const APIKEY_KEY = 'finanzas-v1-apikey';
const TEST_PIN = '1234';
const HOY = '2026-10-20';
const URL_API = 'https://api.anthropic.com/v1/messages';

function buildEstado() {
  return {
    iniciales: { 'Banco Santander': 500000, 'Mercado Pago': 100000, 'Efectivo': 20000 },
    gastos: [
      { id: 'g1', monto: 3000, fecha: '2026-10-01', categoria: 'Comida', descripcion: 'almuerzo', tipo: 'gasto', medio: 'Efectivo', creado: 1 },
    ],
    items: [], patrimonioCargado: true, compromisos: [],
  };
}

/** Intercepta la API: devuelve `respuesta` (objeto) como texto de Haiku. */
async function responder(page, respuesta) {
  await page.unroute(URL_API).catch(() => {});
  await page.route(URL_API, route => {
    const text = typeof respuesta === 'string' ? respuesta : JSON.stringify(respuesta);
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text }] }) });
  });
}

async function setup(page, respuesta) {
  await responder(page, respuesta);
  await page.clock.setFixedTime(new Date(HOY + 'T12:00:00'));
  await page.addInitScript(({ sk, pk, ak, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    localStorage.setItem(ak, JSON.stringify('sk-test'));
  }, { sk: SK, pk: PIN_KEY, ak: APIKEY_KEY, pin: TEST_PIN, data: buildEstado() });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}
const dictar = (page, texto) => page.evaluate(t => parsearVoz(t, 'sk-test'), texto);
const estadoDe = page => page.evaluate(() => JSON.parse(JSON.stringify(window._getEstado())));
const totalesDe = page => page.evaluate(() => JSON.stringify(totales()));
const base = (over = {}) => ({ monto: 4500, medio: 'Banco Santander', descripcion: 'pizza', tipo: 'gasto', categoria: 'Salud', cuotas: 0, dias_atras: 0, ...over });

test('(a) con "borrador" aparece el panel y se guarda un borrador sin tocar gastos ni saldos', async ({ page }) => {
  await setup(page, base());
  const antes = await estadoDe(page);
  const totAntes = await totalesDe(page);
  await dictar(page, 'anotar en borrador pizza 4500 con santander');
  await expect(page.locator('#voiceConfirm')).toContainText('¿Confirmás este borrador?');
  await expect(page.locator('#voiceConfirm')).toContainText('📝 Borrador (no toca saldos)');
  await page.click('#btnVozOk');
  const d = await estadoDe(page);
  expect(d.borradores).toHaveLength(1);
  expect(d.borradores[0]).toMatchObject({ fecha: HOY, monto: 4500, medio: 'Banco Santander', categoria: 'Salud', nota: 'pizza' });
  expect(d.borradores[0].id).toBeTruthy();
  expect(d.gastos).toEqual(antes.gastos);
  expect(await totalesDe(page)).toBe(totAntes);
  await expect(page.locator('#voiceStatus')).toHaveText('✅ Borrador guardado.');
  await expect(page.locator('#voiceConfirm')).toBeHidden();
});

test('(b) sin "borrador" el flujo es el de siempre y crea el gasto', async ({ page }) => {
  await setup(page, base({ medio: 'Efectivo' }));
  await dictar(page, 'pizza 4500 en efectivo');
  await expect(page.locator('#voiceConfirm')).toContainText('¿Confirmás este movimiento?');
  await page.click('#btnVozOk');
  const d = await estadoDe(page);
  expect(d.gastos).toHaveLength(2);
  expect(d.gastos[1]).toMatchObject({ monto: 4500, medio: 'Efectivo', tipo: 'gasto', fecha: HOY });
  expect(d.borradores || []).toHaveLength(0);
});

test('(c) cuotas=3 agrega " · 3 cuotas" y el aviso; cuotas 0/1 no', async ({ page }) => {
  await setup(page, base({ cuotas: 3 }));
  await dictar(page, 'borrador pizza en 3 cuotas');
  await expect(page.locator('#vozBorrCuotas')).toContainText('Ojo: con cuotas el banco cobra cada cuota por separado');
  await page.click('#btnVozOk');
  expect((await estadoDe(page)).borradores[0].nota).toBe('pizza · 3 cuotas');

  for (const c of [0, 1]) {
    await responder(page, base({ cuotas: c }));
    await dictar(page, 'borrador pizza');
    await expect(page.locator('#vozBorrCuotas')).toHaveCount(0);
    await page.click('#btnVozOk');
    const bs = (await estadoDe(page)).borradores;
    expect(bs[bs.length - 1].nota).toBe('pizza');
  }
});

test('(d) dias_atras=1 pone la fecha de ayer', async ({ page }) => {
  await setup(page, base({ dias_atras: 1 }));
  await dictar(page, 'borrador pizza ayer');
  await expect(page.locator('#voiceConfirm')).toContainText('19/10/2026');
  await page.click('#btnVozOk');
  expect((await estadoDe(page)).borradores[0].fecha).toBe('2026-10-19');
});

test('(e) borrador + tipo ingreso sigue el flujo normal de ingreso', async ({ page }) => {
  await setup(page, base({ tipo: 'ingreso', categoria: 'Ingresos extras', descripcion: 'regalo' }));
  await dictar(page, 'me regalaron 4500, dejalo en borrador');
  await expect(page.locator('#voiceConfirm')).toContainText('¿Confirmás este movimiento?');
  await expect(page.locator('#voiceConfirm')).toContainText('Ingreso');
  await page.click('#btnVozOk');
  const d = await estadoDe(page);
  expect(d.gastos[d.gastos.length - 1].tipo).toBe('ingreso');
  expect(d.borradores || []).toHaveLength(0);
});

test('(f) el select de cuenta permite cambiar el medio antes de guardar', async ({ page }) => {
  await setup(page, base());
  await dictar(page, 'borrador pizza');
  await expect(page.locator('#vozBorrMedio')).toHaveValue('Banco Santander');
  await page.selectOption('#vozBorrMedio', 'Mercado Pago');
  await page.click('#btnVozOk');
  expect((await estadoDe(page)).borradores[0].medio).toBe('Mercado Pago');
});

test('medio no válido: coincidencia parcial o primer medio', async ({ page }) => {
  await setup(page, base({ medio: 'mercado' }));
  await dictar(page, 'borrador pizza');
  await expect(page.locator('#vozBorrMedio')).toHaveValue('Mercado Pago');
  await responder(page, base({ medio: 'Banco Inventado' }));
  await dictar(page, 'borrador pizza');
  await expect(page.locator('#vozBorrMedio')).toHaveValue('Banco Santander');
});

test('(g) cancelar no guarda nada', async ({ page }) => {
  await setup(page, base());
  const antes = await estadoDe(page);
  await dictar(page, 'borrador pizza');
  await page.click('#btnVozCancel');
  await expect(page.locator('#voiceConfirm')).toBeHidden();
  const d = await estadoDe(page);
  expect(d.borradores || []).toHaveLength(0);
  expect(d.gastos).toEqual(antes.gastos);
});

test('(h) respuesta sin los campos nuevos no rompe', async ({ page }) => {
  await setup(page, { monto: 800, medio: 'Efectivo', descripcion: 'café', tipo: 'gasto', categoria: 'Comida' });
  await dictar(page, 'anotá un borrador de café');
  await expect(page.locator('#vozBorrCuotas')).toHaveCount(0);
  await page.click('#btnVozOk');
  expect((await estadoDe(page)).borradores[0]).toMatchObject({ fecha: HOY, monto: 800, nota: 'café', medio: 'Efectivo' });
});

test('(i) monto inválido no guarda y avisa', async ({ page }) => {
  await setup(page, base({ monto: 0 }));
  for (const monto of [0, 'abc', -5]) {
    await responder(page, base({ monto }));
    await dictar(page, 'borrador algo');
    await expect(page.locator('#voiceStatus')).toContainText('Error al procesar');
    await expect(page.locator('#voiceConfirm')).toBeHidden();
    expect((await estadoDe(page)).borradores || []).toHaveLength(0);
  }
});

test('(j) variantes "borradores" y "Borrador" activan el modo', async ({ page }) => {
  await setup(page, base());
  for (const t of ['dejalo en borradores pizza', 'Borrador pizza', 'BORRADORES pizza']) {
    await dictar(page, t);
    await expect(page.locator('#voiceConfirm')).toContainText('¿Confirmás este borrador?');
  }
  await dictar(page, 'pizza sin la palabra');
  await expect(page.locator('#voiceConfirm')).toContainText('¿Confirmás este movimiento?');
});
