// @ts-check
// Editar un borrador ya guardado desde el mismo formulario. Datos ficticios.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { buildVisaAoa } = require('./_visa-aoa');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';
const HOY = '2026-10-20';

function buildEstado(extra = {}) {
  return {
    iniciales: { 'Banco Santander': 500000, 'Mercado Pago': 100000, 'Efectivo': 20000 },
    gastos: [{ id: 'g1', monto: 3000, fecha: '2026-10-01', categoria: 'Comida', descripcion: 'almuerzo', tipo: 'gasto', medio: 'Efectivo', creado: 1 }],
    items: [], patrimonioCargado: true, compromisos: [],
    ...extra,
  };
}
const bor = (id, over = {}) => ({ id, creado: Number(id.replace(/\D/g, '')) || 1, fecha: '2026-10-18', monto: 1500, medio: 'Banco Santander', categoria: 'Comida', nota: 'pizza', ...over });

async function seedAndUnlock(page, estado) {
  await page.clock.setFixedTime(new Date(HOY + 'T12:00:00'));
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
  await page.locator('nav.tabs button[data-vista="gastos"]').click();
  await page.waitForSelector('#busqMov');
}
const estadoDe = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window._getEstado())));
const abrir = (page) => page.evaluate(() => { document.getElementById('det-borradores').open = true; });
const editar = (page, i = 0) => page.locator('#borrLista .borr-edit').nth(i).click();

test.describe('borradores: editar', () => {
  test('el botón ✎ carga el borrador en el formulario y abre la sección', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1', { monto: 1234.56, cuotas: 3, medio: 'Visa Santander', nota: 'zapas' })] }));
    expect(await page.locator('#det-borradores').evaluate(e => e.open)).toBe(false);
    await abrir(page);
    await expect(page.locator('#borrLista .borr-edit')).toHaveAttribute('title', 'Editar borrador');
    await page.evaluate(() => { document.getElementById('det-borradores').open = false; });
    await page.evaluate(() => document.querySelector('#borrLista .borr-edit').click());
    expect(await page.locator('#det-borradores').evaluate(e => e.open)).toBe(true);
    expect(await page.inputValue('#borrMonto')).toBe('1.234,56');
    expect(await page.inputValue('#borrFecha')).toBe('2026-10-18');
    expect(await page.inputValue('#borrMedio')).toBe('Visa Santander');
    expect(await page.inputValue('#borrCat')).toBe('Comida');
    expect(await page.inputValue('#borrCuotas')).toBe('3');
    expect(await page.inputValue('#borrNota')).toBe('zapas');
    await expect(page.locator('#btnAnotarBorrador')).toHaveText('Guardar cambios');
    await expect(page.locator('#btnCancelarBorrador')).toBeVisible();
    await expect(page.locator('#borrLista .borr-row.borr-editando')).toHaveCount(1);
  });

  test('editar todos los campos conserva id y creado y sigue en la lista', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1'), bor('b2', { monto: 800, nota: 'otro' })] }));
    await abrir(page);
    const antes = (await estadoDe(page)).borradores.find(b => b.id === 'b1');
    const gastos = (await estadoDe(page)).gastos;
    await page.locator('#borrLista .borr-row[data-id="b1"] .borr-edit').click();
    await page.fill('#borrMonto', '2345,678');
    await page.fill('#borrFecha', '2026-10-12');
    await page.selectOption('#borrMedio', 'Mercado Pago');
    await page.selectOption('#borrCat', 'Salud');
    await page.fill('#borrCuotas', '6');
    await page.fill('#borrNota', 'farmacia');
    await page.click('#btnAnotarBorrador');
    const est = await estadoDe(page);
    expect(est.borradores).toHaveLength(2);
    const b = est.borradores.find(x => x.id === 'b1');
    expect(b).toMatchObject({ id: 'b1', creado: antes.creado, monto: 2345.68, fecha: '2026-10-12', medio: 'Mercado Pago', categoria: 'Salud', cuotas: 6, nota: 'farmacia' });
    expect(est.gastos).toEqual(gastos);
    await expect(page.locator('#btnAnotarBorrador')).toHaveText('Anotar borrador');
    await expect(page.locator('#btnCancelarBorrador')).toBeHidden();
    await expect(page.locator('#borrLista .borr-editando')).toHaveCount(0);
    expect(await page.inputValue('#borrMonto')).toBe('');
    await expect(page.locator('#borrLista')).toContainText('farmacia');
    await expect(page.locator('#borrLista')).toContainText('6 cuotas');
    // vaciar cuotas las quita
    await page.locator('#borrLista .borr-row[data-id="b1"] .borr-edit').click();
    await page.fill('#borrCuotas', '');
    await page.click('#btnAnotarBorrador');
    expect((await estadoDe(page)).borradores.find(x => x.id === 'b1').cuotas).toBeUndefined();
  });

  test('cancelar no cambia nada y vuelve al modo normal', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1')] }));
    await abrir(page);
    const antes = await estadoDe(page);
    await editar(page);
    await page.fill('#borrMonto', '999');
    await page.fill('#borrNota', 'cambiado');
    await page.click('#btnCancelarBorrador');
    expect(await estadoDe(page)).toEqual(antes);
    await expect(page.locator('#btnAnotarBorrador')).toHaveText('Anotar borrador');
    await expect(page.locator('#btnCancelarBorrador')).toBeHidden();
    expect(await page.inputValue('#borrMonto')).toBe('');
    expect(await page.inputValue('#borrNota')).toBe('');
  });

  test('validaciones no guardan y mantienen el modo edición', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1')] }));
    await abrir(page);
    const msgs = [];
    page.on('dialog', d => { msgs.push(d.message()); d.accept(); });
    const antes = await estadoDe(page);
    await editar(page);
    await page.fill('#borrMonto', '0');
    await page.click('#btnAnotarBorrador');
    await page.fill('#borrMonto', '100');
    await page.evaluate(() => { const s = document.getElementById('borrCat'); s.add(new Option('', '')); s.value = ''; });
    await page.click('#btnAnotarBorrador');
    await page.selectOption('#borrCat', 'Comida');
    for (const c of ['1', '61', '2.5']) {
      await page.fill('#borrCuotas', c);
      await page.click('#btnAnotarBorrador');
    }
    expect(msgs).toHaveLength(5);
    expect((await estadoDe(page)).borradores).toEqual(antes.borradores);
    await expect(page.locator('#btnAnotarBorrador')).toHaveText('Guardar cambios');
    await expect(page.locator('#borrLista .borr-editando')).toHaveCount(1);
  });

  test('borrar el borrador en edición vuelve al modo normal', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1'), bor('b2', { nota: 'otro' })] }));
    await abrir(page);
    await editar(page, 1);
    const id = await page.locator('#borrLista .borr-editando').getAttribute('data-id');
    page.once('dialog', d => d.accept());
    await page.locator(`#borrLista .borr-row[data-id="${id}"] .borr-del`).click();
    await expect(page.locator('#btnAnotarBorrador')).toHaveText('Anotar borrador');
    await expect(page.locator('#btnCancelarBorrador')).toBeHidden();
    expect(await page.inputValue('#borrMonto')).toBe('');
    await expect(page.locator('#borrLista .borr-row')).toHaveCount(1);
  });

  test('si el borrador desaparece por fuera mientras se edita, el formulario se resetea sin errores', async ({ page }) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1')] }));
    await abrir(page);
    await editar(page);
    await page.evaluate(() => { window._getEstado().borradores = []; renderBorradores(); });
    await expect(page.locator('#btnAnotarBorrador')).toHaveText('Anotar borrador');
    await expect(page.locator('#btnCancelarBorrador')).toBeHidden();
    expect(errores).toEqual([]);
  });

  test('un borrador editado con otro monto/fecha cruza en la importación de Visa', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1', { medio: 'Visa Santander', fecha: '2026-08-01', monto: 99, categoria: 'Comida', nota: 'compra' })] }));
    await abrir(page);
    await editar(page);
    await page.fill('#borrMonto', '14000');
    await page.fill('#borrFecha', '2026-09-29');
    await page.selectOption('#borrCat', 'Salud');
    await page.click('#btnAnotarBorrador');
    const aoa = buildVisaAoa({
      cierre: '01/10/2026', vencimiento: '09/10/2026', totalPesos: 14000, totalUSD: 0,
      cards: [{ nombre: 'Titular', numero: '1111', tipo: 'titular', totalPesos: 14000, totalUSD: 0,
        movs: [{ fecha: '30/09/2026', desc: 'Zzqx comercio ficticio', comp: '001K', pesos: 14000 }] }],
    });
    await page.evaluate((aoa) => {
      window.alert = () => {};
      const data = window.parseVisaXlsx(aoa);
      document.getElementById('impModal').hidden = false;
      window._renderVisaPreview(data);
    }, aoa);
    await expect(page.locator('#impModalBody')).toContainText('📝 cruzó con borrador: Salud');
    await page.click('#btnConfirmarVisaImp');
    const est = await estadoDe(page);
    expect(est.borradores).toHaveLength(0);
    expect(est.gastos.find(g => g.monto === 14000).categoria).toBe('Salud');
  });
});
