// Vínculos: una sola tarjeta por persona (préstamos + cobros + otros ítems)
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

function buildEstado() {
  return {
    iniciales: { 'Mercado Pago': 5000, 'Banco Santander': 10000, 'Efectivo': 2000, 'Visa Santander': 0, 'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0 },
    gastos: [],
    items: [
      { id: 'd1', nombre: 'Sueldo julio', tipo: 'activo', monto: 80000, grupo: 'Cobros pendientes', persona: 'Delux', historial: [] },
      { id: 'd2', nombre: 'Sueldo agosto', tipo: 'activo', monto: 50000, grupo: 'Cobros pendientes', persona: 'Delux', historial: [] },
      { id: 'd3', nombre: 'Equipo prestado', tipo: 'activo', monto: 10000, grupo: 'Otros activos', persona: 'Delux', historial: [] },
      { id: 'b1', nombre: 'Préstamo Boris', tipo: 'deuda', monto: 3000, grupo: 'Préstamos con personas', persona: 'Boris', historial: [] },
      { id: 'b2', nombre: 'Cobro Boris', tipo: 'activo', monto: 1000, grupo: 'Cobros pendientes', persona: 'Boris', historial: [] },
    ],
    compromisos: [],
    patrimonioCargado: true,
  };
}

async function desbloquear(page) {
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

async function seedAndUnlock(page, estado) {
  // solo siembra la primera vez (sobrevive a recargas dentro del test)
  await page.addInitScript(({ sk, pk, pin, data }) => {
    if (!localStorage.getItem(sk)) {
      localStorage.setItem(sk, JSON.stringify(data));
      localStorage.setItem(pk, JSON.stringify(pin));
    }
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  await desbloquear(page);
}

async function irVinculos(page) {
  await page.locator('[role=tab]', { hasText: 'Vínculos' }).click();
  await page.waitForSelector('#vinculos .persona');
}

const tarjeta = (page, nombre) =>
  page.locator('#vinculos details.persona').filter({ has: page.locator('summary .nombre', { hasText: new RegExp('^' + nombre + '$') }) });

test.describe('vinculos por persona', () => {
  test('tres ítems de Delux: una tarjeta, neto sumado y tres filas', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await irVinculos(page);
    const c = tarjeta(page, 'Delux');
    await expect(c).toHaveCount(1);
    await expect(c.locator('summary .estado')).toContainText('Te debe');
    await expect(c.locator('summary .estado')).toContainText('140.000');
    await expect(c.locator(':scope > ul > li')).toHaveCount(3);
    await expect(c.locator('button', { hasText: 'Cobré' })).toHaveCount(2);
    await expect(c.locator('button', { hasText: '± Ajustar' })).toHaveCount(0);
  });

  test('préstamo y cobro de la misma persona: una sola tarjeta', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await irVinculos(page);
    const c = tarjeta(page, 'Boris');
    await expect(c).toHaveCount(1);
    await expect(c.locator(':scope > ul > li')).toHaveCount(2);
    await expect(c.locator('button', { hasText: '± Ajustar' })).toHaveCount(1);
    await expect(c.locator('button', { hasText: 'Cobré' })).toHaveCount(1);
    await expect(c.locator('summary .estado')).toContainText('Le debés');
    await expect(c.locator('summary .estado')).toContainText('2.000');
    await expect(page.locator('#vinculos details.persona')).toHaveCount(2);
  });

  test('Cobré desde la fila actualiza el neto', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await irVinculos(page);
    const c = tarjeta(page, 'Delux');
    await c.locator('li', { hasText: 'Sueldo julio' }).locator('button', { hasText: 'Cobré' }).click();
    await page.waitForSelector('#cobreModal:not([hidden])');
    await page.click('#btnGuardarCobre');
    await page.waitForSelector('#cobreModal', { state: 'hidden' });
    await expect(tarjeta(page, 'Delux').locator('summary .estado')).toContainText('60.000');
  });

  test('abiertas la primera vez; al cerrar una y recargar queda cerrada', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await irVinculos(page);
    const ab = await page.$$eval('#vinculos details.persona', els => els.map(e => e.open));
    expect(ab).toEqual([true, true]);
    await tarjeta(page, 'Delux').locator('summary').click();
    await expect.poll(() => tarjeta(page, 'Delux').evaluate(e => e.open)).toBe(false);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('finanzas-v1-det-vinc-delux'))).toBe('false');
    await page.reload();
    await desbloquear(page);
    await irVinculos(page);
    expect(await tarjeta(page, 'Delux').evaluate(e => e.open)).toBe(false);
    expect(await tarjeta(page, 'Boris').evaluate(e => e.open)).toBe(true);
  });

  test('Plegar todo sigue funcionando', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await irVinculos(page);
    await page.click('#btnPlegVinc');
    const ab = await page.$$eval('#vinculos details.persona', els => els.map(e => e.open));
    expect(ab).toEqual([false, false]);
  });

  test('totales de Patrimonio sin cambios y sin scroll horizontal a 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await seedAndUnlock(page, buildEstado());
    await irVinculos(page);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(sw).toBe(true);
    await page.locator('[role=tab]', { hasText: 'Patrimonio' }).click();
    await page.waitForSelector('#totNeto', { state: 'attached' });
    expect(await page.$eval('#totActivos', e => e.textContent)).toMatch(/158\.000/);
    expect(await page.$eval('#totDeudas', e => e.textContent)).toMatch(/3\.000/);
  });
});
