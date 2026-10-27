// Retoques de presentación: regla del « · » en nombres, Patrimonio agrupado por persona, título de Ganancia bruta
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';
const LARGO = 'Semana 19/10 al 25/10 · cobro estimado 28/10/26';

function buildEstado() {
  return {
    iniciales: { 'Mercado Pago': 5000, 'Banco Santander': 10000, 'Efectivo': 2000, 'Visa Santander': 0, 'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0 },
    gastos: [],
    items: [
      { id: 'd1', nombre: LARGO, tipo: 'activo', monto: 80000, grupo: 'Cobros pendientes', persona: 'Delux', historial: [] },
      { id: 'd2', nombre: 'Sueldo agosto', tipo: 'activo', monto: 50000, grupo: 'Cobros pendientes', persona: 'Delux', historial: [] },
      { id: 'd3', nombre: 'Sueldo julio', tipo: 'activo', monto: 10000, grupo: 'Cobros pendientes', persona: 'Delux', historial: [] },
      { id: 's1', nombre: 'Cobro suelto', tipo: 'activo', monto: 1000, grupo: 'Cobros pendientes', persona: '', historial: [] },
      { id: 'p1', nombre: 'Préstamo Boris', tipo: 'deuda', monto: 3000, grupo: 'Préstamos con personas', persona: 'Boris', historial: [] },
    ],
    compromisos: [],
    patrimonioCargado: true,
  };
}

async function seedAndUnlock(page, estado) {
  await page.addInitScript(({ sk, pk, pin, data }) => {
    if (!localStorage.getItem(sk)) {
      localStorage.setItem(sk, JSON.stringify(data));
      localStorage.setItem(pk, JSON.stringify(pin));
    }
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

async function irPatrimonio(page) {
  await page.locator('[role=tab]', { hasText: 'Patrimonio' }).click();
  await page.waitForSelector('#totNeto', { state: 'attached' });
}

test.describe('presentación de nombres y Patrimonio por persona', () => {
  test('regla del « · »: con separador parte título y detalle; sin él no cambia; el dato guardado no se toca', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const r = await page.evaluate(() => ({
      con: nombreItemHtml('A b · c d · e'),
      sin: nombreItemHtml('Sueldo agosto'),
      esc: nombreItemHtml('<b> · <i>'),
    }));
    expect(r.con).toBe('<span class="nom-t">A b</span><span class="nom-s">c d · e</span>');
    expect(r.sin).toBe('Sueldo agosto');
    expect(r.esc).not.toContain('<b>');
    await irPatrimonio(page);
    const fila = page.locator('.item', { hasText: 'Semana 19/10 al 25/10' });
    await expect(fila.locator('.nom-t')).toHaveText('Semana 19/10 al 25/10');
    await expect(fila.locator('.nom-s')).toHaveText('cobro estimado 28/10/26');
    expect(await fila.locator('.nom-s').evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeLessThan(12.5);
    await expect(page.locator('.item', { hasText: 'Sueldo agosto' }).locator('.nom-s')).toHaveCount(0);
    const guardado = await page.evaluate(k => JSON.parse(localStorage.getItem(k)).items.find(i => i.id === 'd1').nombre, SK);
    expect(guardado).toBe(LARGO);
  });

  test('Vínculos aplica la misma regla', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await page.locator('[role=tab]', { hasText: 'Vínculos' }).click();
    const li = page.locator('#vinculos details.persona li', { hasText: 'Semana 19/10' });
    await expect(li.locator('.vinc-nom .nom-t')).toHaveText('Semana 19/10 al 25/10');
    await expect(li.locator('.vinc-nom .nom-s')).toHaveText('cobro estimado 28/10/26');
  });

  test('Cobros pendientes: Delux en un recuadro con 3 ítems y total verde; el suelto queda fuera', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await irPatrimonio(page);
    const cobros = page.locator('#listaActivos details.pat-grp:not(.pat-pers)', { has: page.locator(':scope > summary h3', { hasText: 'Cobros pendientes' }) });
    const caja = cobros.locator('details.pat-pers');
    await expect(caja).toHaveCount(1);
    await expect(caja.locator('summary h3')).toHaveText('👤 Delux');
    await expect(caja.locator('summary .pat-sub')).toContainText('140.000');
    await expect(caja.locator('summary .pat-sub')).toHaveClass(/pos/);
    await expect(caja.locator('.item')).toHaveCount(3);
    expect(await caja.evaluate(e => e.open)).toBe(true);
    // el suelto no está dentro del recuadro
    await expect(caja.locator('.item', { hasText: 'Cobro suelto' })).toHaveCount(0);
    await expect(cobros.locator(':scope > .item', { hasText: 'Cobro suelto' })).toHaveCount(1);
    // el préstamo con persona sigue con su chip, sin recuadro
    await expect(page.locator('.item', { hasText: 'Préstamo Boris' }).locator('.chip')).toHaveText('Boris');
  });

  test('estado del recuadro se recuerda con clave propia', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await irPatrimonio(page);
    await page.locator('details.pat-pers > summary').click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('finanzas-v1-det-pat-cobros-delux'))).toBe('false');
    await page.reload();
    for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
    await irPatrimonio(page);
    expect(await page.locator('details.pat-pers').evaluate(e => e.open)).toBe(false);
  });

  test('Cobré y ✎ siguen funcionando dentro del recuadro; los totales no cambian', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await irPatrimonio(page);
    expect(await page.$eval('#totActivos', e => e.textContent)).toMatch(/158.000/);
    expect(await page.$eval('#totDeudas', e => e.textContent)).toMatch(/3\.000/);
    const caja = page.locator('details.pat-pers');
    await caja.locator('.item', { hasText: 'Sueldo julio' }).locator('button.edit').click();
    await expect(page.locator('#itemNombre')).toHaveValue('Sueldo julio');
    await page.locator('#btnItemCancelar').click();
    await caja.locator('.item', { hasText: 'Sueldo julio' }).locator('button', { hasText: 'Cobré' }).click();
    await page.waitForSelector('#cobreModal:not([hidden])');
    await page.click('#btnGuardarCobre');
    await page.waitForSelector('#cobreModal', { state: 'hidden' });
    await expect(page.locator('details.pat-pers summary .pat-sub')).toContainText('130.000');
  });

  test('390px sin scroll horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await seedAndUnlock(page, buildEstado());
    await irPatrimonio(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('tarjeta de Inicio dice «Ganancia bruta del mes» y aclara que no resta gastos', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await expect(page.locator('#ganCard h2')).toHaveText('💼 Ganancia bruta del mes');
    await expect(page.locator('#ganCard .gan-desc')).toContainText('sin restar gastos');
  });
});
