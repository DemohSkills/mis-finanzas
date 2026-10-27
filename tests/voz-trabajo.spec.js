// @ts-check
// Dictado de días trabajados para un cobro semanal (modo «🛠 Trabajo» de la tarjeta de voz) + importes en verde.
// Sin API real: se intercepta api.anthropic.com. Datos ficticios.
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1', PIN_KEY = 'finanzas-v1-pin', APIKEY_KEY = 'finanzas-v1-apikey', TEST_PIN = '1234';
const HOY = '2026-10-28'; // miércoles; semana en curso: 26/10 al 01/11
const URL_API = 'https://api.anthropic.com/v1/messages';

const cobro = (extra = {}) => ({ id: 'cs1', nombre: 'Meli Extra', persona: 'Meli Envíos', medioCobro: 'Mercado Pago', entradas: [], cobradas: [], ...extra });
function buildEstado(cobros = [cobro()]) {
  return {
    iniciales: { 'Banco Santander': 500000, 'Mercado Pago': 100000, 'Efectivo': 20000 },
    gastos: [], items: [], patrimonioCargado: true, compromisos: [], cobrosSemanales: cobros,
  };
}
const base = (o = {}) => ({ monto: 75980, medio: 'Efectivo', descripcion: 'trabajo', tipo: 'ingreso', categoria: 'Otros ingresos', cuotas: 0, dias_atras: 0, fecha: '', ...o });
async function responder(page, respuesta) {
  await page.unroute(URL_API).catch(() => {});
  await page.route(URL_API, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(respuesta) }] }) }));
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
const tipoActivo = page => page.locator('.vc-tipos button[aria-pressed="true"]').getAttribute('data-tipo');

test.describe('dictado de días de trabajo', () => {
  test('"hoy trabajé para Meli por 75980" abre modo trabajo y suma a la semana sin tocar saldos', async ({ page }) => {
    await setup(page, base());
    await dictar(page, 'hoy trabajé para Meli por 75980');
    expect(await tipoActivo(page)).toBe('trabajo');
    await expect(page.locator('.voice-confirm > p').first()).toHaveText('¿Confirmás este día de trabajo?');
    await expect(page.locator('#vozCobro')).toHaveValue('cs1');
    await expect(page.locator('#vozCwTipo')).toHaveValue('dia');
    await expect(page.locator('#vozBorrMonto')).toHaveValue('75.980');
    await expect(page.locator('#vozFecha')).toHaveValue(HOY);
    await expect(page.locator('#vozBorrMedio')).toHaveCount(0);
    await expect(page.locator('#vozCat')).toHaveCount(0);
    await expect(page.locator('#vozDesc')).toHaveCount(0);
    await expect(page.locator('#vozTrabInfo')).toContainText('Semana 26/10 al 01/11: hoy llevás');
    await expect(page.locator('#vozTrabInfo')).not.toContainText('<span');
    await expect(page.locator('#vozNota')).toContainText('suma a la semana de Meli Extra');
    await page.click('#btnVozOk');
    const e = await estadoDe(page);
    expect(e.cobrosSemanales[0].entradas).toHaveLength(1);
    expect(e.cobrosSemanales[0].entradas[0]).toMatchObject({ fecha: HOY, monto: 75980, tipo: 'dia' });
    expect(e.gastos).toHaveLength(0);
    expect(e.iniciales['Mercado Pago']).toBe(100000);
    await expect(page.locator('#voiceConfirm')).toBeHidden();
  });

  test('"ayer trabajé para Meli por 66500" usa la fecha de ayer', async ({ page }) => {
    await setup(page, base({ monto: 66500, dias_atras: 1 }));
    await dictar(page, 'ayer trabajé para Meli por 66500');
    expect(await tipoActivo(page)).toBe('trabajo');
    await expect(page.locator('#vozFecha')).toHaveValue('2026-10-27');
  });

  test('"gané un desafío de 15000 en Meli" preselecciona Desafío', async ({ page }) => {
    await setup(page, base({ monto: 15000 }));
    await dictar(page, 'gané un desafío de 15000 en Meli');
    expect(await tipoActivo(page)).toBe('trabajo');
    await expect(page.locator('#vozCwTipo')).toHaveValue('desafio');
    await page.click('#btnVozOk');
    expect((await estadoDe(page)).cobrosSemanales[0].entradas[0]).toMatchObject({ monto: 15000, tipo: 'desafio' });
  });

  test('entrada existente ese día: aviso amarillo y deja confirmar igual; fecha en otra semana muestra esa semana', async ({ page }) => {
    const cs = cobro({ entradas: [{ id: 'e1', fecha: HOY, monto: 50000, tipo: 'dia' }] });
    await setup(page, base(), buildEstado([cs]));
    await dictar(page, 'hoy trabajé para Meli por 75980');
    await expect(page.locator('#vozTrabAviso')).toBeVisible();
    await expect(page.locator('#vozTrabAviso')).toContainText('Ya tenés');
    await expect(page.locator('#vozTrabAviso')).toContainText('28/10');
    await expect(page.locator('#vozTrabInfo')).toContainText('quedaría en');
    await page.fill('#vozFecha', '2026-10-20');
    await page.dispatchEvent('#vozFecha', 'change');
    await expect(page.locator('#vozTrabAviso')).toBeHidden();
    await expect(page.locator('#vozTrabInfo')).toContainText('Semana 19/10 al 25/10');
    await page.fill('#vozFecha', HOY);
    await page.dispatchEvent('#vozFecha', 'change');
    await page.click('#btnVozOk');
    expect((await estadoDe(page)).cobrosSemanales[0].entradas).toHaveLength(2);
  });

  test('sin cobros semanales no aparece el botón Trabajo', async ({ page }) => {
    await setup(page, base({ tipo: 'gasto' }), buildEstado([]));
    await dictar(page, 'pizza 4500');
    await expect(page.locator('.vc-tipos button')).toHaveCount(3);
    await expect(page.locator('.vc-tipos button[data-tipo="trabajo"]')).toHaveCount(0);
  });

  test('"gasté 2500 en pizza" sigue abriendo gasto aunque haya cobros', async ({ page }) => {
    await setup(page, base({ monto: 2500, tipo: 'gasto', descripcion: 'pizza', categoria: 'Comida y Delivery' }));
    await dictar(page, 'gasté 2500 en pizza');
    expect(await tipoActivo(page)).toBe('gasto');
    await expect(page.locator('.vc-tipos button[data-tipo="trabajo"]')).toHaveCount(1);
  });

  test('con varios cobros y sin coincidencia de nombre no abre trabajo; a mano sí', async ({ page }) => {
    const otro = cobro({ id: 'cs2', nombre: 'Feria Sábado', persona: '' });
    await setup(page, base({ tipo: 'gasto' }), buildEstado([cobro(), otro]));
    await dictar(page, 'hoy trabajé por 75980');
    expect(await tipoActivo(page)).toBe('gasto');
    await page.click('.vc-tipos button[data-tipo="trabajo"]');
    await expect(page.locator('#vozCobro option')).toHaveCount(2);
    await dictar(page, 'hoy trabajé en la feria por 1000');
    expect(await tipoActivo(page)).toBe('trabajo');
    await expect(page.locator('#vozCobro')).toHaveValue('cs2');
  });

  test('cambiar a Gasto desde trabajo conserva monto y fecha', async ({ page }) => {
    await setup(page, base({ dias_atras: 1 }));
    await dictar(page, 'ayer trabajé para Meli por 75980');
    await page.click('.vc-tipos button[data-tipo="gasto"]');
    await expect(page.locator('#vozBorrMonto')).toHaveValue('75.980');
    await expect(page.locator('#vozFecha')).toHaveValue('2026-10-27');
    await page.click('.vc-tipos button[data-tipo="trabajo"]');
    await expect(page.locator('#vozBorrMonto')).toHaveValue('75.980');
  });

  test('importes de semanas pendientes en verde', async ({ page }) => {
    const cs = cobro({ entradas: [{ id: 'e1', fecha: HOY, monto: 50000, tipo: 'dia' }] });
    await setup(page, base(), buildEstado([cs]));
    await page.locator('[role=tab]', { hasText: 'Patrimonio' }).click();
    await page.waitForSelector('#listaActivos');
    const verde = await page.evaluate(() => {
      const n = document.querySelector('.cw-sem .num');
      return n ? [getComputedStyle(n).color, getComputedStyle(document.documentElement).getPropertyValue('--ok')] : null;
    });
    expect(verde).not.toBeNull();
    const rgb = await page.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--ok)'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; });
    expect(verde[0]).toBe(rgb);
  });
});

const TEMAS = ['auto', 'claro', 'oscuro', 'negro', 'neon-azul', 'neon-turquesa', 'neon-violeta'];
test.describe('390 px', () => {
  for (const tema of TEMAS) {
    test(`sin scroll horizontal en modo trabajo, tema ${tema}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await setup(page, base());
      await page.evaluate(t => { localStorage.setItem('finanzas-v1-tema', JSON.stringify(t)); }, tema);
      await page.reload();
      for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
      await page.waitForTimeout(300);
      await dictar(page, 'hoy trabajé para Meli por 75980');
      const sc = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(sc).toBe(true);
      const caja = await page.evaluate(() => { const c = document.querySelector('.voice-confirm'); return c.scrollWidth <= c.clientWidth + 1; });
      expect(caja).toBe(true);
      if (tema === 'neon-azul') await page.locator('#voiceConfirm').screenshot({ path: 'capturas-tmp/voz-trabajo-neon-azul.png' });
    });
  }
});
