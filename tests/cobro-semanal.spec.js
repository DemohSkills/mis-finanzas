// Cobro semanal (Meli Extra): semanas lunes–domingo, estados, "+ Sumar", "Cobré" con retención, deshacer, ganancia bruta
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN = '1234';

const ent = (id, fecha, monto, tipo = 'dia') => ({ id, fecha, monto, tipo });
function cobro(extra = {}) {
  return { id: 'cs1', nombre: 'Meli Extra', persona: 'Meli Envíos', medioCobro: 'Mercado Pago',
    entradas: [ent('e1', '2026-10-19', 60000), ent('e2', '2026-10-25', 40000)], cobradas: [], ...extra };
}
function estadoBase(cs, extra = {}) {
  return { iniciales: { 'Mercado Pago': 0, 'Banco Santander': 0, 'Efectivo': 0 }, gastos: [], items: [], compromisos: [],
    patrimonioCargado: true, cobrosSemanales: cs ? [cs] : [], ...extra };
}
async function abrir(page, hoyStr, estado) {
  await page.clock.setFixedTime(new Date(hoyStr + 'T12:00:00'));
  await page.addInitScript(({ sk, est, pin }) => {
    localStorage.setItem(sk, JSON.stringify(est));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify(pin));
  }, { sk: SK, est: estado, pin: PIN });
  await page.goto(INDEX);
  for (const d of PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}
const irPatrimonio = async page => { await page.locator('[role=tab]', { hasText: 'Patrimonio' }).click(); await page.waitForSelector('#listaActivos'); };
const getEstado = page => page.evaluate(sk => JSON.parse(localStorage.getItem(sk)), SK);
const semanas = page => page.evaluate(() => cwSemanas(estado.cobrosSemanales[0]));

test.describe('cobro semanal', () => {
  test('entradas de lunes a domingo van a una semana; otra semana va aparte', async ({ page }) => {
    const cs = cobro({ entradas: [ent('e1', '2026-10-19', 60000), ent('e2', '2026-10-25', 40000), ent('e3', '2026-10-26', 5000)] });
    await abrir(page, '2026-10-27', estadoBase(cs));
    const s = await semanas(page);
    expect(s.map(x => [x.desde, x.hasta, x.bruto])).toEqual([['2026-10-26', '2026-11-01', 5000], ['2026-10-19', '2026-10-25', 100000]]);
  });

  test('estados: en curso el martes, cerrada el lunes siguiente, atrasada pasado el miércoles', async ({ page }) => {
    const cs = cobro({ entradas: [ent('e1', '2026-10-27', 1000)] }); // semana 26/10–01/11, cobro estimado 04/11
    const est = async h => { await page.clock.setFixedTime(new Date(h + 'T12:00:00')); return page.evaluate(() => { const s = cwSemanas(estado.cobrosSemanales[0])[0]; return [s.estado, s.atrasada, s.estimado]; }); };
    await abrir(page, '2026-10-27', estadoBase(cs));
    expect(await est('2026-10-27')).toEqual(['en curso', false, '2026-11-04']);
    expect(await est('2026-11-01')).toEqual(['en curso', false, '2026-11-04']);
    expect(await est('2026-11-02')).toEqual(['cerrada', false, '2026-11-04']);
    expect(await est('2026-11-04')).toEqual(['cerrada', false, '2026-11-04']);
    expect(await est('2026-11-05')).toEqual(['cerrada', true, '2026-11-04']);
  });

  test('cobro estimado = domingo + 3 y se muestra con chip atrasada', async ({ page }) => {
    await abrir(page, '2026-11-06', estadoBase(cobro()));
    expect((await semanas(page))[0].estimado).toBe('2026-10-28');
    await irPatrimonio(page);
    const fila = page.locator('#listaActivos .cw-sem');
    await expect(fila).toContainText('cobro estimado 28/10/26');
    await expect(fila).toContainText('2 días cargados');
    await expect(fila.locator('.cw-chip-atr')).toHaveText('atrasada');
  });

  test('tarjeta: Te debe, semanas no cobradas y cobradas plegadas por defecto', async ({ page }) => {
    const cs = cobro({ entradas: [ent('e1', '2026-10-19', 60000), ent('e2', '2026-10-25', 40000), ent('e3', '2026-10-12', 20000), ent('e4', '2026-10-21', 1000, 'desafio')],
      cobradas: [{ desde: '2026-10-12', hasta: '2026-10-18', bruto: 20000, neto: 19400, retencion: 600, fechaCobro: '2026-10-21', movId: 'x' }] });
    await abrir(page, '2026-10-27', estadoBase(cs));
    await irPatrimonio(page);
    const pd = page.locator('#listaActivos details[data-cw-id="cs1"]');
    await expect(pd.locator('> summary')).toContainText('Meli Extra');
    await expect(pd.locator('> summary')).toContainText('Te debe');
    expect(await page.evaluate(() => cwDebeTotal())).toBe(101000);
    await expect(pd.locator('.cw-sem')).toHaveCount(1);
    await expect(pd.locator('.cw-sem')).toContainText('incluye desafío');
    const cob = pd.locator('details.cw-cob');
    await expect(cob.locator('summary')).toHaveText('Semanas cobradas (1)');
    expect(await cob.evaluate(d => d.open)).toBe(false);
    await cob.locator('summary').click();
    await expect(cob).toContainText('12/10 al 18/10');
    await expect(cob).toContainText('3,0 %');
  });

  test('Cobré con depositado < bruto: 1 ingreso por lo depositado, retención guardada, saldo y Te debe', async ({ page }) => {
    await abrir(page, '2026-10-27', estadoBase(cobro()));
    await irPatrimonio(page);
    await page.locator('#listaActivos .cw-sem button', { hasText: 'Cobré' }).click();
    await expect(page.locator('#cwCobFecha')).toHaveValue('2026-10-28');
    await expect(page.locator('#cwCobMedio')).toHaveValue('Mercado Pago');
    expect(await page.locator('#cwCobDep').inputValue()).toMatch(/100\.000/);
    await page.fill('#cwCobDep', '97000');
    await expect(page.locator('#cwCobRet')).toContainText('Retención');
    await expect(page.locator('#cwCobRet')).toContainText('3,0 %');
    await page.click('#btnCwCobGuardar');
    const e = await getEstado(page);
    expect(e.gastos).toHaveLength(1);
    expect(e.gastos[0]).toMatchObject({ monto: 97000, tipo: 'ingreso', medio: 'Mercado Pago', categoria: 'Sueldo/Honorarios', retencion: 3000, bruto: 100000, fecha: '2026-10-28', descripcion: 'Meli Extra semana 19/10 al 25/10' });
    expect(e.cobrosSemanales[0].cobradas).toEqual([{ desde: '2026-10-19', hasta: '2026-10-25', bruto: 100000, neto: 97000, retencion: 3000, fechaCobro: '2026-10-28', movId: e.gastos[0].id }]);
    expect(await page.evaluate(() => saldoDe('Mercado Pago'))).toBe(97000);
    expect(await page.evaluate(() => cwDebeTotal())).toBe(0);
    await expect(page.locator('#listaActivos .cw-sem')).toHaveCount(0);
    await expect(page.locator('#listaActivos details.cw-cob summary')).toHaveText('Semanas cobradas (1)');
  });

  test('deshacer el último cobro borra el ingreso y vuelve a cerrada', async ({ page }) => {
    await abrir(page, '2026-10-27', estadoBase(cobro()));
    await irPatrimonio(page);
    await page.locator('#listaActivos .cw-sem button', { hasText: 'Cobré' }).click();
    await page.fill('#cwCobDep', '97500');
    await page.click('#btnCwCobGuardar');
    page.once('dialog', d => d.accept());
    await page.locator('#listaActivos details.cw-cob summary').click();
    await page.locator('#listaActivos .cw-undo').click();
    const e = await getEstado(page);
    expect(e.gastos).toHaveLength(0);
    expect(e.cobrosSemanales[0].cobradas).toHaveLength(0);
    expect((await semanas(page))[0].estado).toBe('cerrada');
    expect(await page.evaluate(() => saldoDe('Mercado Pago'))).toBe(0);
    expect(await page.evaluate(() => cwDebeTotal())).toBe(100000);
  });

  test('depositado mayor al bruto se rechaza', async ({ page }) => {
    await abrir(page, '2026-10-27', estadoBase(cobro()));
    await irPatrimonio(page);
    await page.locator('#listaActivos .cw-sem button', { hasText: 'Cobré' }).click();
    await page.fill('#cwCobDep', '100001');
    await expect(page.locator('#cwCobRet')).toContainText('no puede ser mayor');
    await page.click('#btnCwCobGuardar');
    await expect(page.locator('#cwCobMsg')).toContainText('no puede ser mayor');
    const e = await getEstado(page);
    expect(e.gastos).toHaveLength(0);
    expect(e.cobrosSemanales[0].cobradas).toHaveLength(0);
  });

  test('+ Sumar: día y desafío suman al bruto; editar, borrar y fecha futura', async ({ page }) => {
    const cs = cobro({ entradas: [ent('e1', '2026-10-26', 10000)] });
    await abrir(page, '2026-10-27', estadoBase(cs));
    await irPatrimonio(page);
    await page.locator('#listaActivos .cw-sem button', { hasText: '+ Sumar' }).click();
    await expect(page.locator('#cwSumFecha')).toHaveValue('2026-10-27');
    await page.fill('#cwSumMonto', '5000');
    await page.click('#btnCwSumGuardar');
    await page.click('#cwTipoDesafio');
    await page.fill('#cwSumMonto', '3000');
    await page.click('#btnCwSumGuardar');
    expect((await semanas(page))[0]).toMatchObject({ bruto: 18000, desafio: 3000, dias: 2 });
    await expect(page.locator('#cwSumLista li')).toHaveCount(3);
    await expect(page.locator('#cwSumTot')).toContainText('18.000');
    // fecha futura
    await page.fill('#cwSumFecha', '2026-10-30');
    await page.fill('#cwSumMonto', '1000');
    await page.click('#btnCwSumGuardar');
    await expect(page.locator('#cwSumMsg')).toContainText('futura');
    await page.fill('#cwSumFecha', '2026-10-27');
    // editar la primera entrada
    await page.locator('#cwSumLista li').first().locator('.cw-e-ed').click();
    await page.fill('#cwSumMonto', '12000');
    await page.click('#btnCwSumGuardar');
    expect((await semanas(page))[0].bruto).toBe(20000);
    // borrar
    page.once('dialog', d => d.accept());
    await page.locator('#cwSumLista li').last().locator('.cw-e-del').click();
    expect((await semanas(page))[0].bruto).toBe(17000);
    await expect(page.locator('#listaActivos .cw-sem')).not.toContainText('incluye desafío');
  });

  test('ganancia bruta suma monto + retención y muestra la línea', async ({ page }) => {
    await abrir(page, '2026-10-29', estadoBase(cobro()));
    await irPatrimonio(page);
    await page.locator('#listaActivos .cw-sem button', { hasText: 'Cobré' }).click();
    await page.fill('#cwCobDep', '97000');
    await page.click('#btnCwCobGuardar');
    expect(await page.evaluate(() => gananciaMes('2026-10').total)).toBe(100000);
    await page.locator('[role=tab]', { hasText: 'Inicio' }).click();
    await expect(page.locator('#ganRet')).toContainText('incluye');
    await expect(page.locator('#ganRet')).toContainText('3.000');
    await expect(page.locator('#ganRet')).toContainText('retenciones');
    // el saldo solo ve lo depositado
    expect(await page.evaluate(() => saldoDe('Mercado Pago'))).toBe(97000);
  });

  test('Total activos de Patrimonio incluye el saldo de Meli Extra; también Vínculos', async ({ page }) => {
    await abrir(page, '2026-10-27', estadoBase(cobro(), { iniciales: { 'Mercado Pago': 5000, 'Banco Santander': 0, 'Efectivo': 0 } }));
    expect((await page.evaluate(() => totales())).activos).toBe(105000);
    await irPatrimonio(page);
    await expect(page.locator('#listaActivos .subtotal')).toContainText('105.000');
    await page.locator('[role=tab]', { hasText: 'Vínculos' }).click();
    const card = page.locator('#vinculos details.persona');
    await expect(card).toHaveCount(1);
    await expect(card.locator('summary')).toContainText('Meli Envíos');
    await expect(card.locator('summary')).toContainText('Te debe');
    await expect(card.locator('.cw-sem')).toHaveCount(1);
  });

  test('+ Cobro semanal crea uno nuevo con nombre sugerido', async ({ page }) => {
    await abrir(page, '2026-10-27', estadoBase(null));
    await irPatrimonio(page);
    await page.click('#btnCobroSemanal');
    await expect(page.locator('#cwAltaNombre')).toHaveValue('Meli Extra');
    await page.fill('#cwAltaPersona', 'Meli Envíos');
    await page.click('#btnCwAltaGuardar');
    const e = await getEstado(page);
    expect(e.cobrosSemanales).toHaveLength(1);
    expect(e.cobrosSemanales[0]).toMatchObject({ nombre: 'Meli Extra', persona: 'Meli Envíos', medioCobro: 'Mercado Pago', entradas: [], cobradas: [] });
  });

  test('backup conserva cobrosSemanales y uno viejo carga sin error', async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('dialog', d => d.accept());
    await abrir(page, '2026-10-27', estadoBase(cobro()));
    const json = await page.evaluate(() => buildBackupJson());
    expect(JSON.parse(json).estado.cobrosSemanales[0].entradas).toHaveLength(2);
    // restaurar un backup viejo (sin el campo)
    await page.evaluate(() => {
      const viejo = JSON.stringify({ version: 1, fecha: '2024-01-01', estado: { iniciales: {}, gastos: [], items: [], patrimonioCargado: true, compromisos: [] }, snaps: [], cats: [], catsIncome: [], reglas: [] });
      restaurarBackup(new File([viejo], 'b.json', { type: 'application/json' }));
    });
    await expect.poll(() => page.evaluate(() => Array.isArray(estado.cobrosSemanales) && estado.cobrosSemanales.length === 0)).toBe(true);
    // y restaurar el nuevo
    await page.evaluate(j => restaurarBackup(new File([j], 'b.json', { type: 'application/json' })), json);
    await expect.poll(() => page.evaluate(() => estado.cobrosSemanales.length)).toBe(1);
    expect(errs.filter(e => !/ResizeObserver/.test(e))).toHaveLength(0);
  });

  test('importar después el depósito de Mercado Pago no duplica el ingreso creado a mano', async ({ page }) => {
    await abrir(page, '2026-10-29', estadoBase(cobro()));
    await irPatrimonio(page);
    await page.locator('#listaActivos .cw-sem button', { hasText: 'Cobré' }).click();
    await page.fill('#cwCobDep', '97000');
    await page.click('#btnCwCobGuardar');
    const r = await page.evaluate(() => {
      const mk = (fecha) => ({ monto: 97000, fecha, catInfo: { tipo: 'ingreso' }, ref: null });
      return _deduplicarImp([mk('2026-10-28'), mk('2026-10-29')], 'Mercado Pago').map(c => c.yaExiste);
    });
    expect(r).toEqual([true, false]); // dedupe: mismo importe, mismo medio, ±3 días (el segundo consume el único existente)
  });
});

const TEMAS = ['auto', 'claro', 'oscuro', 'negro', 'neon-azul', 'neon-turquesa', 'neon-violeta'];
test.describe('cobro semanal: filas de semana, un dato por renglón', () => {
  test('cada dato en su propio elemento; desafío solo si existe; botones funcionan', async ({ page }) => {
    const cs = cobro({ entradas: [ent('e1', '2026-10-12', 60000), ent('e2', '2026-10-13', 5000, 'desafio'), ent('e3', '2026-10-27', 1000)] });
    await abrir(page, '2026-10-27', estadoBase(cs));
    await irPatrimonio(page);
    const cerrada = page.locator('#listaActivos .cw-sem[data-desde="2026-10-12"]');
    await expect(cerrada.locator('.cw-tit .rng')).toHaveText('12/10 al 18/10');
    await expect(cerrada.locator('.cw-d-est')).toHaveText('cobro estimado 21/10/26');
    await expect(cerrada.locator('.cw-d-dias')).toHaveText('1 día cargado');
    await expect(cerrada.locator('.cw-d-desafio')).toContainText('incluye desafío');
    expect(await cerrada.locator('.cw-inf').innerText()).not.toContain(' · ');
    await expect(cerrada.locator('.cw-der .num')).toBeVisible();
    await expect(cerrada.locator('.cw-der button')).toHaveText('Cobré');
    const curso = page.locator('#listaActivos .cw-sem[data-desde="2026-10-26"]');
    await expect(curso.locator('.cw-d-desafio')).toHaveCount(0);
    await expect(curso.locator('.cw-der button')).toHaveText('+ Sumar');
    await curso.locator('button').click();
    await expect(page.locator('#cwSumarModal')).toBeVisible();
    await page.click('#btnCwSumCerrar');
    await cerrada.locator('button').click();
    await expect(page.locator('#cwCobreModal')).toBeVisible();
  });

  test('390 px sin scroll horizontal en los 7 temas', async ({ page }) => {
    const cs = cobro({ nombre: 'Meli Extra con un nombre larguísimo', entradas: [ent('e1', '2026-10-12', 99999999), ent('e2', '2026-10-13', 5000, 'desafio'), ent('e3', '2026-10-27', 1000)] });
    await page.setViewportSize({ width: 390, height: 800 });
    await abrir(page, '2026-10-27', estadoBase(cs));
    await irPatrimonio(page);
    for (const t of TEMAS) {
      await page.evaluate(x => aplicarTema(x), t);
      await expect(page.locator('#listaActivos .cw-sem').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), t).toBe(true);
      if (t === 'neon-azul' || t === 'claro') await page.locator('#listaActivos details[data-cw-id="cs1"]').screenshot({ path: 'capturas-tmp/cw-renglones-' + t + '.png' });
    }
  });
});
