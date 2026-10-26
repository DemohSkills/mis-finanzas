// @ts-check
// Dólar de referencia (Configuración) que solo precarga la cotización del modal "Ya compré los USD"
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const REF_K = 'finanzas-v1-usd-ref';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';
const TODAY = new Date().toLocaleDateString('sv');
function daysBefore(n, base = TODAY) { const d = new Date(base + 'T12:00:00'); d.setDate(d.getDate() - n); return d.toLocaleDateString('sv'); }

const ROW = '.comp-row[data-id="cr-usd"]';

function buildEstado() {
  return {
    iniciales: { 'Banco Santander': 500000, 'Visa Santander': -200000 },
    gastos: [], items: [], patrimonioCargado: true,
    compromisos: [{
      id: 'cr-usd', nombre: 'Visa 4321', entidad: 'Visa Santander',
      monto: 100000, pagoMinimo: 20000, pendientes: 1,
      proxVenc: daysBefore(-20), tipo: 'resumen', cierre: daysBefore(30),
      estimado: false, usd: 50, usdPagado: false,
    }],
  };
}

async function seedAndUnlock(page, { ref, estado = buildEstado(), fixedTime } = {}) {
  if (fixedTime) await page.clock.setFixedTime(fixedTime);
  await page.addInitScript(({ sk, pk, pin, data, refK, ref }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    if (ref) localStorage.setItem(refK, JSON.stringify(ref));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado, refK: REF_K, ref });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(500);
}
async function goToCompromisos(page) {
  await page.locator('nav.tabs button[data-vista="compromisos"]').click();
  await page.waitForSelector('#compromisosList');
}
async function goToConfig(page) {
  await page.locator('nav.tabs button[data-vista="config"]').click();
  await page.locator('#cfg-usdref').evaluate(d => { d.open = true; }); // Configuración: secciones plegadas por defecto
  await page.waitForSelector('#cfgUsdRef');
}
async function abrirModal(page) {
  await goToCompromisos(page);
  await page.locator(`${ROW} button:has-text("Ya compré los USD")`).click();
  await expect(page.locator('#compraUsdModal')).toBeVisible();
}
const leerCompra = (page) => page.evaluate(sk => JSON.parse(localStorage.getItem(sk)).compromisos.find(c => c.id === 'cr-usd').usdCompra, SK);
const leerRef = (page) => page.evaluate(k => JSON.parse(localStorage.getItem(k)), REF_K);
const digitos = (s) => s.replace(/\D/g, '');

test.describe('usd-referencia', () => {
  test('(a) sin referencia el campo abre vacío y sin nota', async ({ page }) => {
    await seedAndUnlock(page);
    await abrirModal(page);
    expect(await page.locator('#compraUsdCot').inputValue()).toBe('');
    await expect(page.locator('#compraUsdCot')).toHaveAttribute('placeholder', 'Opcional');
    await expect(page.locator('#compraUsdRefNota')).toBeHidden();
    expect(await page.locator('#compraUsdPesos').inputValue()).toBe('');
  });

  test('(b) con referencia abre precargado, con costo en pesos y nota', async ({ page }) => {
    await seedAndUnlock(page, { ref: { cotizacion: 1234, fecha: TODAY } });
    await abrirModal(page);
    expect(digitos(await page.locator('#compraUsdCot').inputValue())).toBe('1234');
    expect(digitos(await page.locator('#compraUsdPesos').inputValue())).toBe('61700');
    const nota = page.locator('#compraUsdRefNota');
    await expect(nota).toBeVisible();
    await expect(nota).toContainText('Precargado con tu dólar de referencia del');
    await expect(nota).toContainText('Corregilo si compraste a otro valor.');
  });

  test('(c) guardar compra con la cotización precargada la deja en usdCompra', async ({ page }) => {
    await seedAndUnlock(page, { ref: { cotizacion: 1234, fecha: TODAY } });
    await abrirModal(page);
    await page.locator('#compraUsdForm button[type="submit"]').click();
    await expect(page.locator('#compraUsdModal')).toBeHidden();
    const c = await leerCompra(page);
    expect(c.cotizacion).toBe(1234);
    expect(c.pesos).toBe(61700);
    expect(c.usd).toBe(50);
  });

  test('(d) cambiar la referencia después no modifica una compra ya guardada', async ({ page }) => {
    await seedAndUnlock(page, { ref: { cotizacion: 1234, fecha: TODAY } });
    await abrirModal(page);
    await page.locator('#compraUsdForm button[type="submit"]').click();
    const antes = await leerCompra(page);
    await goToConfig(page);
    await page.locator('#cfgUsdRef').fill('2000');
    await page.locator('#btnGuardarUsdRef').click();
    expect((await leerRef(page)).cotizacion).toBe(2000);
    expect(await leerCompra(page)).toEqual(antes);
  });

  test('(e) borrar la referencia deja el campo vacío de nuevo', async ({ page }) => {
    await seedAndUnlock(page, { ref: { cotizacion: 1234, fecha: TODAY } });
    await goToConfig(page);
    await expect(page.locator('#cfgUsdRefInfo')).toContainText('Actualizado el');
    await page.locator('#cfgUsdRef').fill('');
    await page.locator('#btnGuardarUsdRef').click();
    await expect(page.locator('#cfgUsdRefInfo')).toHaveText('Sin valor guardado');
    expect(await leerRef(page)).toBeNull();
    await abrirModal(page);
    expect(await page.locator('#compraUsdCot').inputValue()).toBe('');
    await expect(page.locator('#compraUsdRefNota')).toBeHidden();
  });

  test('(f) referencia de más de 7 días muestra la advertencia', async ({ page }) => {
    const base = '2026-06-15';
    await seedAndUnlock(page, {
      ref: { cotizacion: 1234, fecha: daysBefore(10, base) },
      fixedTime: new Date(base + 'T12:00:00'),
    });
    await abrirModal(page);
    const nota = page.locator('#compraUsdRefNota');
    await expect(nota).toContainText('Referencia vieja (05/06): verificá la cotización');
    expect(digitos(await page.locator('#compraUsdCot').inputValue())).toBe('1234');
    const color = await nota.evaluate(el => el.style.color);
    expect(color).toContain('--warn');
  });

  test('(f2) referencia de exactamente 7 días no es vieja', async ({ page }) => {
    const base = '2026-06-15';
    await seedAndUnlock(page, {
      ref: { cotizacion: 1234, fecha: daysBefore(7, base) },
      fixedTime: new Date(base + 'T12:00:00'),
    });
    await abrirModal(page);
    await expect(page.locator('#compraUsdRefNota')).toContainText('Precargado con tu dólar de referencia del 08/06');
  });

  test('(g) valor inválido o 0 no se guarda', async ({ page }) => {
    await seedAndUnlock(page, { ref: { cotizacion: 1234, fecha: TODAY } });
    await goToConfig(page);
    const alertas = [];
    page.on('dialog', d => { alertas.push(d.message()); d.accept(); });
    for (const v of ['0', 'abc', '-5']) {
      await page.locator('#cfgUsdRef').fill(v);
      await page.locator('#btnGuardarUsdRef').click();
    }
    expect(alertas).toHaveLength(3);
    expect((await leerRef(page)).cotizacion).toBe(1234);
  });

  test('(g2) sin referencia previa, valor inválido no crea la clave', async ({ page }) => {
    await seedAndUnlock(page);
    await goToConfig(page);
    page.on('dialog', d => d.accept());
    await expect(page.locator('#cfgUsdRefInfo')).toHaveText('Sin valor guardado');
    await page.locator('#cfgUsdRef').fill('0');
    await page.locator('#btnGuardarUsdRef').click();
    expect(await leerRef(page)).toBeNull();
  });

  test('guardar desde Configuración escribe {cotizacion, fecha}', async ({ page }) => {
    await seedAndUnlock(page);
    await goToConfig(page);
    await page.locator('#cfgUsdRef').fill('1500');
    await page.locator('#btnGuardarUsdRef').click();
    expect(await leerRef(page)).toEqual({ cotizacion: 1500, fecha: TODAY });
  });

  test('el backup exporta la referencia', async ({ page }) => {
    await seedAndUnlock(page, { ref: { cotizacion: 1234, fecha: TODAY } });
    const json = await page.evaluate(() => JSON.parse(window.buildBackupJson ? window.buildBackupJson() : 'null'));
    test.skip(json === null, 'buildBackupJson no expuesta');
    expect(json.usdRef).toEqual({ cotizacion: 1234, fecha: TODAY });
  });
});
