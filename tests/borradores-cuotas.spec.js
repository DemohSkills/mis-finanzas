// @ts-check
// Borradores con cuotas (versión mínima): el borrador con N cuotas cruza solo con la cuota 1 del plan en la Visa.
// Datos ficticios.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { buildVisaAoa } = require('./_visa-aoa');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const APIKEY_KEY = 'finanzas-v1-apikey';
const TEST_PIN = '1234';
const HOY = '2026-10-20';
const VISA = 'Visa Santander';
const URL_API = 'https://api.anthropic.com/v1/messages';

function buildEstado(extra = {}) {
  return {
    iniciales: { 'Banco Santander': 500000, 'Mercado Pago': 100000, 'Efectivo': 20000 },
    gastos: [], items: [], patrimonioCargado: true, compromisos: [],
    ...extra,
  };
}
const bor = (id, over = {}) => ({ id, creado: Number(id.replace(/\D/g, '')) || 1, fecha: '2026-09-29', monto: 20000, medio: VISA, categoria: 'Salud', nota: 'consulta', cuotas: 3, ...over });

async function seedAndUnlock(page, estado) {
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
const sinDialogos = (page) => page.evaluate(() => { window.alert = () => {}; window.confirm = () => true; });
const estadoDe = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window._getEstado())));

/** movs: [{fecha, desc, cuotaN?, cuotaM?, pesos}] -> vista previa de la Visa (sin confirmar) */
async function previewVisa(page, movs) {
  const total = movs.reduce((s, m) => s + m.pesos, 0);
  const aoa = buildVisaAoa({
    cierre: '01/10/2026', vencimiento: '09/10/2026', totalPesos: total, totalUSD: 0,
    cards: [{ nombre: 'Titular', numero: '1111', tipo: 'titular', totalPesos: total, totalUSD: 0,
      movs: movs.map((m, i) => ({ comp: `00${i}K`, ...m })) }],
  });
  await page.evaluate((aoa) => {
    const data = window.parseVisaXlsx(aoa);
    document.getElementById('impModal').hidden = false;
    window._renderVisaPreview(data);
  }, aoa);
}
const mov = (over = {}) => ({ fecha: '30/09/2026', desc: 'Zzqx comercio ficticio', cuotaN: 1, cuotaM: 3, pesos: 6667, ...over });
const tags = (page) => page.locator('#impModalBody .imp-borr-tag');

test.describe('borradores con cuotas: cruce con la cuota 1 (Visa)', () => {
  test('(a) 3 cuotas total 20.000 cruza con "1 de 3" de 6.667 y toma la categoría', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1')] }));
    await sinDialogos(page);
    await previewVisa(page, [mov()]);
    await expect(tags(page)).toHaveCount(1);
    await expect(tags(page)).toHaveText('📝 cruzó con borrador: Salud (cuota 1/3)');
    await page.click('#btnConfirmarVisaImp');
    const est = await estadoDe(page);
    expect(est.gastos.find(g => g.monto === 6667).categoria).toBe('Salud');
  });

  test('(b) no cruza con "2 de 3" aunque el importe coincida', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1')] }));
    await previewVisa(page, [mov({ cuotaN: 2 })]);
    await expect(tags(page)).toHaveCount(0);
    await expect(page.locator('#impBorrSin')).toContainText('QUEDARON SIN CRUZAR (1)');
    await expect(page.locator('#impBorrSin')).toContainText('consulta · Salud · 3 cuotas');
  });

  test('(c) no cruza si m es distinto ("1 de 6")', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1')] }));
    await previewVisa(page, [mov({ cuotaM: 6 })]);
    await expect(tags(page)).toHaveCount(0);
  });

  test('(d) no cruza si el importe supera la tolerancia; dentro de ella sí', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1')] }));
    await previewVisa(page, [mov({ pesos: 6700 })]); // cuota 6666,67; 1% = 66,67: 33,33 de diferencia entra
    await expect(tags(page)).toHaveCount(1);
    await previewVisa(page, [mov({ pesos: 6800 })]); // 133,33 de diferencia: no entra
    await expect(tags(page)).toHaveCount(0);
  });

  test('(d) borrador chico: la tolerancia mínima es 2,00', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1', { monto: 300 })] })); // cuota 100: 1% = 1 -> manda 2
    await previewVisa(page, [mov({ pesos: 101.9 })]);
    await expect(tags(page)).toHaveCount(1);
    await previewVisa(page, [mov({ pesos: 102.5 })]);
    await expect(tags(page)).toHaveCount(0);
  });

  test('(e) no cruza si la fecha está a más de 5 días; a 5 sí', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1', { fecha: '2026-09-20' })] }));
    await previewVisa(page, [mov()]); // 30/09: 10 días
    await expect(tags(page)).toHaveCount(0);
    await page.evaluate(() => { window._getEstado().borradores[0].fecha = '2026-09-25'; });
    await previewVisa(page, [mov()]); // 5 días
    await expect(tags(page)).toHaveCount(1);
  });

  test('(f) sin cuotas: no cruza con "2 de 3" de igual importe, sí con fila sin cuota', async ({ page }) => {
    const b = bor('b1', { monto: 6667, nota: 'x' });
    delete b.cuotas;
    await seedAndUnlock(page, buildEstado({ borradores: [b] }));
    await previewVisa(page, [mov({ cuotaN: 2 })]);
    await expect(tags(page)).toHaveCount(0);
    await previewVisa(page, [mov({ cuotaN: undefined, cuotaM: undefined })]);
    await expect(tags(page)).toHaveCount(1);
    await expect(tags(page)).toHaveText('📝 cruzó con borrador: Salud');
    await previewVisa(page, [mov({ cuotaN: 1, cuotaM: 1 })]);
    await expect(tags(page)).toHaveCount(1);
  });

  test('(g) uso único: dos cuotas 1 iguales y un solo borrador cruza una', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1')] }));
    await previewVisa(page, [mov({ desc: 'Zzqx uno' }), mov({ desc: 'Zzqx dos' })]);
    await expect(tags(page)).toHaveCount(1);
  });

  test('(h) cancelar no consume; confirmar consume; deshacer lo devuelve con su campo cuotas', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1', { creado: 77 }), bor('b2', { monto: 555, cuotas: 2, categoria: 'Comida' })] }));
    await sinDialogos(page);
    const original = (await estadoDe(page)).borradores.find(b => b.id === 'b1');
    await previewVisa(page, [mov()]);
    await expect(tags(page)).toHaveCount(1);
    await page.click('#btnCerrarImpModal');
    expect((await estadoDe(page)).borradores).toHaveLength(2);
    await previewVisa(page, [mov()]);
    await page.click('#btnConfirmarVisaImp');
    let est = await estadoDe(page);
    expect(est.borradores.map(b => b.id)).toEqual(['b2']);
    await page.evaluate(() => window._deshacerUltimaImpVisa());
    est = await estadoDe(page);
    expect(est.borradores.find(b => b.id === 'b1')).toEqual(original);
    expect(est.borradores.find(b => b.id === 'b1').cuotas).toBe(3);
    expect(est.borradores).toHaveLength(2);
  });

  test('(k) borrador viejo con nota "x · 3 cuotas" y sin campo se trata como 3 cuotas', async ({ page }) => {
    const b = bor('b1', { nota: 'consulta · 3 cuotas' });
    delete b.cuotas;
    await seedAndUnlock(page, buildEstado({ borradores: [b] }));
    expect(await page.evaluate((x) => window._cuotasDeBorrador(x), b)).toBe(3);
    expect(await page.evaluate(() => window._cuotasDeBorrador({ nota: 'sin sufijo' }))).toBe(0);
    expect(await page.evaluate(() => window._cuotasDeBorrador({ nota: 'x · 1 cuotas' }))).toBe(0);
    await previewVisa(page, [mov()]);
    await expect(tags(page)).toHaveText('📝 cruzó con borrador: Salud (cuota 1/3)');
  });

  for (const medio of ['Banco Santander', 'Mercado Pago']) {
    test(`(l) un borrador con cuotas no cruza en la importación de ${medio}`, async ({ page }) => {
      await seedAndUnlock(page, buildEstado({ borradores: [bor('b1', { medio, monto: 1500, fecha: '2026-10-18' })] }));
      await page.evaluate(({ medio }) => {
        const fila = (monto) => ({
          fecha: '2026-10-18', desc: 'Compra', concepto: 'Compra', monto: -monto,
          catInfo: { tipo: 'gasto', cat: 'Otros/Varios', paraRevisar: false },
          refs: [], yaExiste: false, soloHistorial: false, paraRevisar: false,
          _revisar_sel: null, _recordar: false, _recordarTexto: '',
        });
        const cands = [fila(1500), fila(500)];
        window._deduplicarImp(cands, medio);
        window._cruzarBorradores(cands, medio);
        window._setImpState(cands, medio);
        document.getElementById('impModal').hidden = false;
        window._renderImpPreview();
      }, { medio });
      await expect(tags(page)).toHaveCount(0);
      await expect(page.locator('#impBorrSin')).toContainText('· 3 cuotas');
    });
  }
});

test.describe('borradores con cuotas: formulario manual', () => {
  async function abrirBorradores(page) {
    await page.locator('nav.tabs button[data-vista="gastos"]').click();
    await page.waitForSelector('#busqMov');
    await page.locator('#det-borradores > summary').click();
    await page.locator('#det-borr-manual > summary').click();
  }

  test('(i) vacío = sin campo; 1, 0, 61 y decimal se rechazan; 3 se guarda', async ({ page }) => {
    const msgs = [];
    page.on('dialog', d => { msgs.push(d.message()); d.accept(); });
    await seedAndUnlock(page, buildEstado({ borradores: [] }));
    await abrirBorradores(page);
    await page.fill('#borrMonto', '20000');
    await page.click('#btnAnotarBorrador');
    let bs = (await estadoDe(page)).borradores;
    expect(bs).toHaveLength(1);
    expect('cuotas' in bs[0]).toBe(false);
    for (const malo of ['1', '0', '61', '2.5']) {
      await page.fill('#borrMonto', '20000');
      await page.evaluate((v) => { document.getElementById('borrCuotas').value = v; }, malo);
      await page.click('#btnAnotarBorrador');
    }
    expect(msgs.filter(m => m.includes('entero entre 2 y 60'))).toHaveLength(4);
    expect((await estadoDe(page)).borradores).toHaveLength(1);
    await page.fill('#borrMonto', '20000');
    await page.fill('#borrCuotas', '3');
    await page.fill('#borrNota', 'pizza');
    await page.click('#btnAnotarBorrador');
    bs = (await estadoDe(page)).borradores;
    expect(bs).toHaveLength(2);
    expect(bs[1].cuotas).toBe(3);
    expect(bs[1].nota).toBe('pizza');
    await expect(page.locator('#borrLista')).toContainText('pizza · ');
    await expect(page.locator('#borrLista')).toContainText('· 3 cuotas');
    await expect(page.locator('#borrCuotas')).toHaveValue('');
  });

  test('la lista no duplica el sufijo si la nota ya lo trae', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1', { nota: 'consulta · 3 cuotas' })] }));
    await abrirBorradores(page);
    const txt = await page.locator('#borrLista').innerText();
    expect(txt.match(/3 cuotas/g)).toHaveLength(1);
  });
});

test('(j) voz: guarda b.cuotas=3 y la nota NO lleva el sufijo', async ({ page }) => {
  await page.route(URL_API, route => {
    const text = JSON.stringify({ monto: 20000, medio: VISA, descripcion: 'consulta', tipo: 'gasto', categoria: 'Salud', cuotas: 3, dias_atras: 0 });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text }] }) });
  });
  await seedAndUnlock(page, buildEstado({ borradores: [] }));
  await page.evaluate(() => parsearVoz('borrador consulta en 3 cuotas', 'sk-test'));
  await expect(page.locator('#vozBorrCuotas')).toContainText('Se cruza con la primera cuota del resumen (importe total ÷ cuotas). Las cuotas 2 y siguientes no se cruzan todavía.');
  await page.click('#btnVozOk');
  const b = (await estadoDe(page)).borradores[0];
  expect(b.cuotas).toBe(3);
  expect(b.nota).toBe('consulta');
});
