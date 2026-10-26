// @ts-check
// Tarjeta unificada del dictado (selector Gasto/Ingreso/Borrador), fecha hablada y orden de borradores.
// Sin API real: se intercepta api.anthropic.com. Datos ficticios.
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1', PIN_KEY = 'finanzas-v1-pin', APIKEY_KEY = 'finanzas-v1-apikey', TEST_PIN = '1234';
const HOY = '2026-10-26';
const URL_API = 'https://api.anthropic.com/v1/messages';

function buildEstado(extra = {}) {
  return {
    iniciales: { 'Banco Santander': 500000, 'Mercado Pago': 100000, 'Efectivo': 20000 },
    gastos: [{ id: 'g1', monto: 3000, fecha: '2026-10-01', categoria: 'Comida y Delivery', descripcion: 'almuerzo', tipo: 'gasto', medio: 'Efectivo', creado: 1 }],
    items: [], patrimonioCargado: true, compromisos: [], ...extra,
  };
}
const peticiones = [];
async function responder(page, respuesta) {
  await page.unroute(URL_API).catch(() => {});
  await page.route(URL_API, route => {
    peticiones.push(route.request().postData() || '');
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(respuesta) }] }) });
  });
}
async function setup(page, respuesta, estado = buildEstado(), hoy = HOY) {
  await responder(page, respuesta);
  await page.clock.setFixedTime(new Date(hoy + 'T12:00:00'));
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
const totalesDe = page => page.evaluate(() => JSON.stringify(totales()));
const base = (o = {}) => ({ monto: 4500, medio: 'Banco Santander', descripcion: 'pizza', tipo: 'gasto', categoria: 'Salud', cuotas: 0, dias_atras: 0, fecha: '', ...o });
const tipoActivo = page => page.locator('.vc-tipos button[aria-pressed="true"]').getAttribute('data-tipo');

test.describe('selector de tipo', () => {
  test('tipo inicial: con "borrador" → borrador; sin la palabra → gasto; ingreso de la IA → ingreso', async ({ page }) => {
    await setup(page, base());
    await dictar(page, 'borrador pizza 4500');
    expect(await tipoActivo(page)).toBe('borrador');
    await dictar(page, 'pizza 4500');
    expect(await tipoActivo(page)).toBe('gasto');
    await responder(page, base({ tipo: 'ingreso', categoria: 'Ingresos extras' }));
    await dictar(page, 'me regalaron 4500');
    expect(await tipoActivo(page)).toBe('ingreso');
    await dictar(page, 'borrador me regalaron 4500');
    expect(await tipoActivo(page)).toBe('ingreso');
  });

  test('cambiar entre los 3 tipos conserva monto, cuenta, fecha y descripción; textos y botón por tipo', async ({ page }) => {
    await setup(page, base({ fecha: '2026-10-22' }));
    await dictar(page, 'pizza');
    await page.fill('#vozBorrMonto', '1.234,56');
    await page.selectOption('#vozBorrMedio', 'Mercado Pago');
    await page.fill('#vozDesc', 'cena editada');
    const textos = { gasto: ['Descuenta del saldo de la cuenta.', '✓ Guardar'], ingreso: ['Suma al saldo de la cuenta.', '✓ Guardar'], borrador: ['No toca saldos: se cruza solo al importar el resumen.', '✓ Guardar borrador'] };
    for (const t of ['ingreso', 'borrador', 'gasto', 'borrador']) {
      await page.click(`.vc-tipos button[data-tipo="${t}"]`);
      expect(await tipoActivo(page)).toBe(t);
      await expect(page.locator('#vozBorrMonto')).toHaveValue('1.234,56');
      await expect(page.locator('#vozBorrMedio')).toHaveValue('Mercado Pago');
      await expect(page.locator('#vozFecha')).toHaveValue('2026-10-22');
      await expect(page.locator('#vozDesc')).toHaveValue('cena editada');
      await expect(page.locator('#vozNota')).toHaveText(textos[t][0]);
      await expect(page.locator('#btnVozOk')).toHaveText(textos[t][1]);
    }
  });

  test('las categorías cambian a las de ingreso y la categoría se conserva si existe en la nueva lista', async ({ page }) => {
    await setup(page, base({ categoria: 'Salud' }));
    await dictar(page, 'pizza');
    await expect(page.locator('#vozCat')).toHaveValue('Salud');
    await page.click('.vc-tipos button[data-tipo="ingreso"]');
    const optsIng = await page.$$eval('#vozCat option', o => o.map(x => x.textContent));
    expect(optsIng).toContain('Ingresos extras');
    expect(optsIng).not.toContain('Salud');
    await page.selectOption('#vozCat', 'Ingresos extras');
    await page.click('.vc-tipos button[data-tipo="borrador"]');
    await expect(page.locator('#vozCat')).toHaveValue('Salud');
    await page.selectOption('#vozCat', 'Comida y Delivery');
    await page.click('.vc-tipos button[data-tipo="gasto"]');
    await expect(page.locator('#vozCat')).toHaveValue('Comida y Delivery');
  });

  test('cuotas: el aviso solo aparece en Borrador y no se pierde al ir y volver', async ({ page }) => {
    await setup(page, base({ cuotas: 3 }));
    await dictar(page, 'borrador pizza en 3 cuotas');
    await expect(page.locator('#vozBorrCuotas')).toHaveCount(1);
    await page.click('.vc-tipos button[data-tipo="gasto"]');
    await expect(page.locator('#vozBorrCuotas')).toHaveCount(0);
    await page.click('.vc-tipos button[data-tipo="borrador"]');
    await page.click('#btnVozOk');
    expect((await estadoDe(page)).borradores[0].cuotas).toBe(3);
  });

  for (const tipo of ['gasto', 'ingreso', 'borrador']) {
    test(`guardar como ${tipo} deja el registro en su lugar con la fecha elegida`, async ({ page }) => {
      await setup(page, base({ medio: 'Efectivo' }));
      const antes = await estadoDe(page);
      const totAntes = await totalesDe(page);
      await dictar(page, 'pizza');
      await page.click(`.vc-tipos button[data-tipo="${tipo}"]`);
      await page.fill('#vozFecha', '2026-10-15');
      await page.click('#btnVozOk');
      const d = await estadoDe(page);
      if (tipo === 'borrador') {
        expect(d.borradores).toHaveLength(1);
        expect(d.borradores[0]).toMatchObject({ fecha: '2026-10-15', monto: 4500, medio: 'Efectivo', nota: 'pizza' });
        expect(d.gastos).toEqual(antes.gastos);
        expect(await totalesDe(page)).toBe(totAntes);
      } else {
        expect(d.gastos).toHaveLength(2);
        expect(d.gastos[1]).toMatchObject({ fecha: '2026-10-15', monto: 4500, medio: 'Efectivo', tipo, soloHistorial: false, descripcion: 'pizza' });
        expect(d.borradores || []).toHaveLength(0);
        expect(await totalesDe(page)).not.toBe(totAntes);
      }
    });
  }

  test('monto 0 o fecha inválida/futura: no guarda, muestra mensaje y conserva los datos', async ({ page }) => {
    await setup(page, base());
    await dictar(page, 'pizza');
    await page.fill('#vozBorrMonto', '0');
    await page.click('#btnVozOk');
    await expect(page.locator('#vozMsg')).toContainText('monto');
    await page.fill('#vozBorrMonto', '700');
    await page.fill('#vozFecha', '2026-10-27');
    await page.click('#btnVozOk');
    await expect(page.locator('#vozMsg')).toContainText('futura');
    await page.fill('#vozFecha', '');
    await page.click('#btnVozOk');
    await expect(page.locator('#vozMsg')).toContainText('fecha');
    await expect(page.locator('#voiceConfirm')).toBeVisible();
    await expect(page.locator('#vozBorrMonto')).toHaveValue('700');
    await expect(page.locator('#vozDesc')).toHaveValue('pizza');
    const d = await estadoDe(page);
    expect(d.gastos).toHaveLength(1);
    expect(d.borradores || []).toHaveLength(0);
  });
});

test.describe('fecha hablada', () => {
  for (const [dictado, tipoIA] of [['pizza el 22 de octubre', 'gasto'], ['borrador pizza el 22 de octubre', 'gasto'], ['me pagaron el 22 de octubre', 'ingreso']]) {
    test(`la fecha de la IA llega al input (${dictado})`, async ({ page }) => {
      await setup(page, base({ tipo: tipoIA, categoria: tipoIA === 'ingreso' ? 'Ingresos extras' : 'Salud', fecha: '2026-10-22' }));
      await dictar(page, dictado);
      await expect(page.locator('#vozFecha')).toHaveValue('2026-10-22');
      await page.click('#btnVozOk');
      const d = await estadoDe(page);
      const reg = /borrador/.test(dictado) ? d.borradores[0] : d.gastos[1];
      expect(reg.fecha).toBe('2026-10-22');
    });
  }

  test('fecha futura, inválida o de hace más de 5 años cae a dias_atras y luego a hoy', async ({ page }) => {
    await setup(page, base());
    const casos = [
      [{ fecha: '2026-11-22', dias_atras: 2 }, '2026-10-24'],
      [{ fecha: '2026-02-31', dias_atras: 0 }, HOY],
      [{ fecha: 'ayer', dias_atras: 1 }, '2026-10-25'],
      [{ fecha: '2020-10-25', dias_atras: 0 }, HOY],
      [{ fecha: '2021-10-26', dias_atras: 0 }, '2021-10-26'],
      [{ fecha: '', dias_atras: 0 }, HOY],
      [{ fecha: '2026-10-26', dias_atras: 0 }, '2026-10-26'],
    ];
    for (const [over, esperado] of casos) {
      await responder(page, base(over));
      await dictar(page, 'pizza');
      await expect(page.locator('#vozFecha')).toHaveValue(esperado);
    }
  });

  test('el pedido a la IA incluye la fecha de hoy y el campo fecha ("el 22" / "22/10" se resuelven con ella)', async ({ page }) => {
    await setup(page, base({ fecha: '2026-09-22' }), buildEstado(), '2026-10-20');
    peticiones.length = 0;
    await dictar(page, 'pizza el 22');
    const body = JSON.parse(peticiones[0]).messages[0].content;
    expect(body).toContain('La fecha de hoy es 2026-10-20');
    expect(body).toContain('"fecha":""');
    expect(body).toContain('mes anterior');
    await expect(page.locator('#vozFecha')).toHaveValue('2026-09-22');
    await responder(page, base({ fecha: '2025-10-22' }));
    await dictar(page, 'pizza 22/10');
    await expect(page.locator('#vozFecha')).toHaveValue('2025-10-22');
  });
});

test('lista de borradores: fecha descendente y, a igual fecha, creado descendente', async ({ page }) => {
  const b = (id, fecha, creado, nota) => ({ id, creado, fecha, monto: 100, medio: 'Efectivo', categoria: 'Salud', nota });
  await setup(page, base(), buildEstado({ borradores: [b('b1', '2026-10-22', 1000, 'veintidos'), b('b2', '2026-10-25', 2000, 'veinticinco-viejo'), b('b3', '2026-10-25', 3000, 'veinticinco-nuevo')] }));
  await page.evaluate(() => renderBorradores());
  const textos = await page.$$eval('#borrLista .borr-row .borr-izq > div:first-child', els => els.map(e => e.textContent));
  expect(textos.map(t => t.split(' · ')[0])).toEqual(['veinticinco-nuevo', 'veinticinco-viejo', 'veintidos']);
});
