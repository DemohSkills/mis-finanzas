// @ts-check
// Estados de los USD del resumen de la Visa: falta comprar / comprados / pagados
const { test, expect } = require('@playwright/test');
const path = require('path');
const { buildVisaAoa } = require('./_visa-aoa');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';
const TODAY = new Date().toLocaleDateString('sv');
function daysAfter(n) { const d = new Date(TODAY); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function daysBefore(n) { const d = new Date(TODAY); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

const ROW = '.comp-row[data-id="cr-usd"]';

function buildEstado(extra = {}) {
  return {
    iniciales: { 'Banco Santander': 500000, 'Visa Santander': -200000 },
    gastos: [], items: [], patrimonioCargado: true,
    compromisos: [{
      id: 'cr-usd', nombre: 'Visa 4321', entidad: 'Visa Santander',
      monto: 100000, pagoMinimo: 20000, pendientes: 1,
      proxVenc: daysAfter(20), tipo: 'resumen', cierre: daysBefore(30),
      estimado: false, usd: 50, usdPagado: false, ...extra,
    }],
  };
}

async function seedAndUnlock(page, estado, theme) {
  await page.addInitScript(({ sk, pk, pin, data, theme }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    if (theme) localStorage.setItem('finanzas-v1-tema', JSON.stringify(theme));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado, theme });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(500);
}
async function goToCompromisos(page) {
  await page.locator('nav.tabs button[data-vista="compromisos"]').click();
  await page.waitForSelector('#compromisosList');
}
const leer = (page) => page.evaluate(sk => JSON.parse(localStorage.getItem(sk)).compromisos.find(c => c.id === 'cr-usd'), SK);

const COMPRA = { usd: 50, cotizacion: 1200, pesos: 60000, fecha: daysBefore(1) };

test.describe('usd-compra: estados y botones', () => {
  test('falta comprar: chip MEP y solo el botón "Ya compré" (sin "Ya pagué")', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    await expect(page.locator(`${ROW} .chip.chip-usd`)).toBeVisible();
    await expect(page.locator(`${ROW} button:has-text("Ya compré los USD")`)).toBeVisible();
    await expect(page.locator(`${ROW} button:has-text("Ya pagué los USD")`)).toHaveCount(0);
    await expect(page.locator(`${ROW} .usd-nota`)).toHaveCount(0);
  });

  test('comprados: chip verde con cotización y costo, nota y botones', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usdCompra: COMPRA }));
    await goToCompromisos(page);
    const chip = page.locator(`${ROW} .chip.abonada`);
    await expect(chip).toBeVisible();
    const txt = (await chip.textContent()) || '';
    expect(txt).toContain('USD comprados');
    expect(txt).toContain('cot.');
    expect(txt.replace(/\D/g, '')).toContain('60000');
    await expect(page.locator(`${ROW} .chip .amt`).first()).toBeVisible();
    await expect(page.locator(`${ROW} .usd-nota`)).toContainText('Alojados en cuenta en dólares');
    await expect(page.locator(`${ROW} button:has-text("Ya pagué los USD a la Visa")`)).toBeVisible();
    await expect(page.locator(`${ROW} button:has-text("Deshacer compra")`)).toBeVisible();
    await expect(page.locator(`${ROW} button:has-text("Ya compré los USD")`)).toHaveCount(0);
  });

  test('comprados sin cotización: chip simple', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usdCompra: { usd: 50, cotizacion: null, pesos: null, fecha: TODAY } }));
    await goToCompromisos(page);
    const txt = (await page.locator(`${ROW} .chip.abonada`).textContent()) || '';
    expect(txt).toContain('USD comprados');
    expect(txt).not.toContain('cot.');
  });

  test('pagar desde comprados → pagados con costo; deshacer vuelve a comprados', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usdCompra: COMPRA }));
    await goToCompromisos(page);
    await page.locator(`${ROW} button:has-text("Ya pagué los USD a la Visa")`).click();
    const chip = page.locator(`${ROW} .chip.abonada`);
    await expect(chip).toContainText('USD pagados');
    await expect(chip).toContainText('costo');
    expect((await leer(page)).usdPagado).toBe(true);
    await page.locator(`${ROW} button:has-text("↩ USD pagados")`).click();
    await expect(page.locator(`${ROW} .chip.abonada`)).toContainText('USD comprados');
    const c = await leer(page);
    expect(c.usdPagado).toBe(false);
    expect(c.usdCompra.pesos).toBe(60000);
  });

  test('pagado viejo sin usdCompra: chip sin costo; deshacer vuelve a falta comprar', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usdPagado: true }));
    await goToCompromisos(page);
    const chip = page.locator(`${ROW} .chip.abonada`);
    await expect(chip).toContainText('USD pagados');
    expect(((await chip.textContent()) || '')).not.toContain('costo');
    await page.locator(`${ROW} button:has-text("↩ USD pagados")`).click();
    await expect(page.locator(`${ROW} .chip.chip-usd`)).toBeVisible();
  });

  test('deshacer compra borra usdCompra y vuelve a falta comprar', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usdCompra: COMPRA }));
    await goToCompromisos(page);
    await page.locator(`${ROW} button:has-text("Deshacer compra")`).click();
    await expect(page.locator(`${ROW} .chip.chip-usd`)).toBeVisible();
    expect((await leer(page)).usdCompra).toBeUndefined();
  });
});

test.describe('usd-compra: modal', () => {
  test('precarga USD, calcula costo y guarda', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    await page.locator(`${ROW} button:has-text("Ya compré los USD")`).click();
    await expect(page.locator('#compraUsdModal')).toBeVisible();
    expect((await page.locator('#compraUsdMonto').inputValue()).replace(/\D/g, '')).toBe('50');
    expect(await page.locator('#compraUsdFecha').inputValue()).toBe(TODAY);
    await page.locator('#compraUsdCot').fill('1200');
    expect((await page.locator('#compraUsdPesos').inputValue()).replace(/\D/g, '')).toBe('60000');
    await page.locator('#compraUsdMonto').fill('40');
    expect((await page.locator('#compraUsdPesos').inputValue()).replace(/\D/g, '')).toBe('48000');
    await page.locator('#compraUsdForm button[type="submit"]').click();
    await expect(page.locator('#compraUsdModal')).toBeHidden();
    const c = await leer(page);
    expect(c.usdCompra).toEqual({ usd: 40, cotizacion: 1200, pesos: 48000, fecha: TODAY });
    await expect(page.locator(`${ROW} .chip.abonada`)).toContainText('USD comprados');
  });

  test('cotización vacía guarda null', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    await page.locator(`${ROW} button:has-text("Ya compré los USD")`).click();
    await page.locator('#compraUsdForm button[type="submit"]').click();
    const c = await leer(page);
    expect(c.usdCompra.cotizacion).toBeNull();
    expect(c.usdCompra.pesos).toBeNull();
    expect(c.usdCompra.usd).toBe(50);
  });

  test('cancelar no guarda', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    await page.locator(`${ROW} button:has-text("Ya compré los USD")`).click();
    await page.locator('#compraUsdModal button:has-text("Cancelar")').click();
    await expect(page.locator('#compraUsdModal')).toBeHidden();
    expect((await leer(page)).usdCompra).toBeUndefined();
  });
});

test.describe('usd-compra: importar resumen nuevo', () => {
  test('la importación borra usdCompra y el deshacer lo restaura', async ({ page }) => {
    const estado = buildEstado({ usdCompra: COMPRA });
    estado.compromisos[0].cierre = '2026-09-01';
    estado.importaciones = {};
    await seedAndUnlock(page, estado);
    const aoa = buildVisaAoa({
      cierre: '01/10/2026', vencimiento: '09/10/2026', totalPesos: 14000, totalUSD: 7.29,
      cards: [{
        nombre: 'Titular', numero: '1111', tipo: 'titular', totalPesos: 14000, totalUSD: 7.29,
        movs: [{ fecha: '30/09/2026', desc: 'Pedidosya*local uno', comp: '001K', pesos: 14000 }],
      }],
    });
    const despues = await page.evaluate((aoa) => {
      const data = window.parseVisaXlsx(aoa);
      document.getElementById('impModal').hidden = false;
      window._renderVisaPreview(data);
      window._confirmarImpVisa();
      return JSON.parse(JSON.stringify(window._getEstado().compromisos[0]));
    }, aoa);
    expect(despues.usd).toBe(7.29);
    expect(despues.usdPagado).toBe(false);
    expect(despues.usdCompra).toBeUndefined();
    const restaurado = await page.evaluate(() => {
      window.confirm = () => true;
      window.alert = () => {};
      window._deshacerUltimaImpVisa();
      return JSON.parse(JSON.stringify(window._getEstado().compromisos[0]));
    });
    expect(restaurado.usd).toBe(50);
    expect(restaurado.usdCompra).toEqual(COMPRA);
  });
});

test.describe('usd-compra: layout y robustez', () => {
  for (const w of [360, 412, 450]) {
    for (const [nombre, estado] of [['faltaComprar', {}], ['comprados', { usdCompra: COMPRA }], ['pagados', { usdPagado: true, usdCompra: COMPRA }]]) {
      test(`sin overflow horizontal a ${w}px (${nombre})`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: 800 });
        await seedAndUnlock(page, buildEstado(estado));
        await goToCompromisos(page);
        const ov = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        expect(ov).toBe(false);
      });
    }
  }

  test('modal sin overflow a 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    await page.locator(`${ROW} button:has-text("Ya compré los USD")`).click();
    const ov = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(ov).toBe(false);
  });

  for (const tema of ['auto', 'claro', 'oscuro', 'negro']) {
    test(`tema ${tema}: estado comprados se renderiza sin errores`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await seedAndUnlock(page, buildEstado({ usdCompra: COMPRA }), tema);
      await goToCompromisos(page);
      await expect(page.locator(`${ROW} .chip.abonada`)).toBeVisible();
      expect(errors).toHaveLength(0);
    });
  }

  test('ids únicos y sin errores de consola', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await seedAndUnlock(page, buildEstado({ usdCompra: COMPRA }));
    await goToCompromisos(page);
    const dup = await page.evaluate(() => {
      const seen = {}, d = [];
      document.querySelectorAll('[id]').forEach(el => { if (seen[el.id]) d.push(el.id); seen[el.id] = 1; });
      return d;
    });
    expect(dup).toEqual([]);
    expect(errors).toHaveLength(0);
  });
});
