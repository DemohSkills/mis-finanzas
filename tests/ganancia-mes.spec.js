// Tarjeta "Ganancia del mes" en Inicio (datos ficticios)
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

const ing = (id, fecha, monto, categoria, extra = {}) =>
  ({ id, tipo: 'ingreso', fecha, monto, medio: 'Banco Santander', categoria, descripcion: 'x ' + id, ...extra });

function estadoBase(gastos) {
  return {
    iniciales: { 'Banco Santander': 0, 'Visa Santander': 0, 'Mercado Pago': 0, 'Efectivo': 0,
      'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0, 'Reservas MP': 0 },
    gastos, items: [], compromisos: [], patrimonioCargado: true,
  };
}
const MAYO = [ing('m1', '2026-05-03', 50000, 'Sueldo/Honorarios')];
const JUNIO = [
  ing('a', '2026-06-05', 300000, 'Transferencia recibida', { proposito: 'sueldo-delux', descripcion: 'Transferencia recibida X' }),
  ing('b', '2026-06-06', 100000, 'Transferencia recibida', { proposito: 'otro-trabajo' }),
  ing('c', '2026-06-07', 80000, 'Transferencia recibida', { proposito: 'prestamo' }),
  ing('d', '2026-06-08', 20000, 'Transferencia recibida', { proposito: 'reembolso' }),
  ing('e', '2026-06-09', 7000, 'Transferencia recibida'),
  ing('f', '2026-06-10', 5000, 'Reintegro'),
  ing('g', '2026-06-11', 1000, 'Rendimientos'),
];

async function abrir(page, gastos, extraLS = {}) {
  await page.addInitScript(({ sk, pk, pin, data, extra }) => {
    if (!localStorage.getItem(sk)) localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, JSON.stringify(v));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estadoBase(gastos), extra: extraLS });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}
const calc = (page, ym) => page.evaluate(m => gananciaMes(m), ym);

test.describe('Ganancia del mes', () => {
  test('suma solo lo que corresponde y avisa la sin clasificar', async ({ page }) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await abrir(page, [...MAYO, ...JUNIO]);
    expect(errors).toEqual([]);
    const d = await calc(page, '2026-06');
    expect(d.total).toBe(401000);   // 300000 + 100000 + 1000
    expect(d.fuentes.map(f => f[0])).toEqual(['Sueldo Delux', 'Otro trabajo', 'Rendimientos']);
    expect(d.sinClas).toMatchObject({ n: 1, monto: 7000 });
    expect(d.noCuenta).toEqual({ prestamo: 80000, reembolso: 20000 });
    await page.selectOption('#ganMes', '2026-06');
    await expect(page.locator('.gan-aviso')).toContainText('1 transferencia');
    await expect(page.locator('#ganNoCuenta')).toContainText('préstamos');
    await expect(page.locator('#ganBody .gan-cmp')).toContainText('▲');
    await expect(page.locator('.gan-row')).toHaveCount(3);
    await page.click('#btnGanClasif');
    await expect(page.locator('#clasifModal')).toBeVisible();
  });

  test('categoría con interruptor apagado deja de contar', async ({ page }) => {
    await abrir(page, JUNIO);
    await page.evaluate(() => { ls.set(CATS_GAN_K, { 'Rendimientos': false }); render(); });
    expect((await calc(page, '2026-06')).total).toBe(400000);
    await page.evaluate(() => { ls.set(CATS_GAN_K, { 'Reintegro': true }); render(); });
    expect((await calc(page, '2026-06')).total).toBe(406000);
  });

  test('préstamo clasificado no cuenta aunque su categoría sí', async ({ page }) => {
    await abrir(page, [ing('p', '2026-06-03', 9000, 'Sueldo/Honorarios', { proposito: 'prestamo' }),
      ing('q', '2026-06-04', 4000, 'Sueldo/Honorarios')]);
    const d = await calc(page, '2026-06');
    expect(d.total).toBe(4000);
    expect(d.noCuenta.prestamo).toBe(9000);
  });

  test('backup conserva los interruptores', async ({ page }) => {
    await abrir(page, JUNIO);
    await page.evaluate(() => { ls.set(CATS_GAN_K, { 'Reintegro': true, 'Rendimientos': false }); });
    const json = await page.evaluate(() => buildBackupJson());
    expect(JSON.parse(json).catsGanancia).toEqual({ 'Reintegro': true, 'Rendimientos': false });
    await page.evaluate(() => { localStorage.removeItem(CATS_GAN_K); });
    await page.evaluate(async j => {
      window.confirm = () => true; window.alert = () => {};
      const f = new File([j], 'b.json', { type: 'application/json' });
      restaurarBackup(f);
      await new Promise(r => setTimeout(r, 300));
    }, json);
    expect(await page.evaluate(() => getCatsGanancia())).toEqual({ 'Reintegro': true, 'Rendimientos': false });
  });

  test('configuración: el interruptor persiste', async ({ page }) => {
    await abrir(page, JUNIO);
    await page.evaluate(() => { mostrarVista('config'); abrirCfg('cfg-cats-ingresos'); });
    const chk = page.locator('#catGananciaList .gan-chk').nth(1);   // Sueldo/Honorarios
    await expect(chk).toBeChecked();
    await chk.uncheck();
    expect(await page.evaluate(() => catCuentaGanancia('Sueldo/Honorarios'))).toBe(false);
  });

  test('modal: Total Sueldo Delux solo del mes más reciente', async ({ page }) => {
    await abrir(page, [
      ing('a', '2026-05-05', 100000, 'Transferencia recibida'),
      ing('b', '2026-06-05', 300000, 'Transferencia recibida'),
    ]);
    await page.evaluate(() => { abrirClasifTransf(); _clasif.pend.forEach(r => r.sel = 'sueldo-delux'); _renderClasif(); });
    const txt = await page.locator('#clasifTotal').innerText();
    expect(txt).toContain('Total Sueldo Delux de Junio 2026');
    expect(txt).toContain('(1 transferencia)');
  });

  for (const tema of ['claro', 'negro', 'neon-azul']) {
    test(`captura 390px ${tema}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 800 });
      await abrir(page, [...MAYO, ...JUNIO], { 'finanzas-v1-tema': tema });
      await page.selectOption('#ganMes', '2026-06');
      await page.locator('#ganCard').screenshot({ path: `test-results/ganancia-${tema}.png` });
      const ov = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(ov).toBe(false);
    });
  }
});
