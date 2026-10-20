const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const SORT_KEY = 'finanzas-v1-comp-sort';
const TEST_PIN = '1234';

function estadoConCompromisos() {
  return {
    iniciales: {}, gastos: [], items: [], patrimonioCargado: true,
    compromisos: [
      { id: 'c1', nombre: 'Cuota A', entidad: 'Santander', monto: 50000, pendientes: 2, proxVenc: '2026-11-15', tipo: 'cuota' },
      { id: 'c2', nombre: 'Cuota B', entidad: 'Mercado Pago', monto: 20000, pendientes: 3, proxVenc: '2026-10-25', tipo: 'cuota' },
      { id: 'c3', nombre: 'Cuota C', entidad: 'Astropay', monto: 80000, pendientes: 1, proxVenc: null, tipo: 'cuota' },
    ],
  };
}

async function seedAndUnlock(page, estado, sortVal) {
  await page.addInitScript(({ sk, pk, pin, data, skey, sval }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    if (sval) localStorage.setItem(skey, sval);
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado, skey: SORT_KEY, sval: sortVal || null });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(600);
}

test.describe('1b: Orden en Compromisos', () => {
  test('selector de orden visible en la vista compromisos', async ({ page }) => {
    await seedAndUnlock(page, estadoConCompromisos());
    await page.locator('nav.tabs button[data-vista="compromisos"]').click();
    await expect(page.locator('#compSort')).toBeVisible();
  });

  test('por defecto ordena por fecha de vencimiento (más próxima primero)', async ({ page }) => {
    await seedAndUnlock(page, estadoConCompromisos());
    await page.locator('nav.tabs button[data-vista="compromisos"]').click();
    const rows = await page.locator('.comp-row').all();
    expect(rows.length).toBe(3);
    // c2 (oct-25) < c1 (nov-15) < c3 (sin fecha)
    const first = await rows[0].locator('.comp-ent').textContent();
    const last = await rows[2].locator('.comp-ent').textContent();
    expect(first.trim()).toBe('Mercado Pago');
    expect(last.trim()).toBe('Astropay'); // sin fecha al final
  });

  test('ordenar por monto pone el mayor primero', async ({ page }) => {
    await seedAndUnlock(page, estadoConCompromisos(), 'monto');
    await page.locator('nav.tabs button[data-vista="compromisos"]').click();
    const rows = await page.locator('.comp-row').all();
    const first = await rows[0].locator('.comp-ent').textContent();
    expect(first.trim()).toBe('Astropay'); // monto 80000
  });

  test('ordenar por entidad agrupa alfabéticamente', async ({ page }) => {
    await seedAndUnlock(page, estadoConCompromisos(), 'entidad');
    await page.locator('nav.tabs button[data-vista="compromisos"]').click();
    const rows = await page.locator('.comp-row').all();
    const names = await Promise.all(rows.map(r => r.locator('.comp-ent').textContent()));
    const sorted = [...names].sort((a, b) => a.trim().localeCompare(b.trim(), 'es'));
    expect(names.map(n => n.trim())).toEqual(sorted.map(n => n.trim()));
  });

  test('cambiar selector persiste en localStorage', async ({ page }) => {
    await seedAndUnlock(page, estadoConCompromisos());
    await page.locator('nav.tabs button[data-vista="compromisos"]').click();
    await page.selectOption('#compSort', 'monto');
    const saved = await page.evaluate(k => localStorage.getItem(k), SORT_KEY);
    expect(saved).toBe('monto');
  });
});
