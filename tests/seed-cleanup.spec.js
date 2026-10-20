// Verifica que sembrarCompromisos fue eliminado y no carga datos personales
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

function estadoConCompromisos() {
  return {
    iniciales: {},
    gastos: [],
    items: [
      { id: 'i1', nombre: 'Crédito X', grupo: 'Deudas', saldo: -100000, persona: '', esManual: true },
    ],
    compromisos: [
      { id: 'c1', nombre: 'Mi préstamo', entidad: 'Banco', monto: 50000, pendientes: 3, proxVenc: '2026-11-01', tipo: 'cuota', estimado: false, itemNombre: 'Crédito X' },
      { id: 'c2', nombre: 'Tarjeta', entidad: 'Visa', monto: 20000, pendientes: 1, proxVenc: '2026-10-25', tipo: 'cuota', estimado: false },
      { id: 'c3', nombre: 'Servicio', entidad: 'MP', monto: 5000, pendientes: 2, proxVenc: '2026-10-30', tipo: 'cuota', estimado: false },
    ],
    patrimonioCargado: true,
  };
}

async function seedAndUnlock(page, estado) {
  await page.addInitScript(({ sk, pk, pin, data }) => {
    if (data) localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado || null });
  await page.goto(INDEX);
  // Enter PIN digits
  for (const d of TEST_PIN) {
    await page.click(`button[data-d="${d}"]`);
  }
  await page.waitForTimeout(600);
}

test.describe('seed-cleanup', () => {
  test('(a) sin errores JS al cargar', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndUnlock(page, estadoConCompromisos());
    expect(errors.filter(e => !/ResizeObserver/.test(e))).toHaveLength(0);
  });

  test('(b) con datos cargados, compromisos se preservan (count 3)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndUnlock(page, estadoConCompromisos());
    expect(errors.filter(e => !/ResizeObserver/.test(e))).toHaveLength(0);
    const count = await page.evaluate((sk) => {
      const d = JSON.parse(localStorage.getItem(sk) || '{}');
      return (d.compromisos || []).length;
    }, SK);
    expect(count).toBe(3);
  });

  test('(b2) itemNombre del compromiso se conserva', async ({ page }) => {
    await seedAndUnlock(page, estadoConCompromisos());
    const itemNombre = await page.evaluate((sk) => {
      const d = JSON.parse(localStorage.getItem(sk) || '{}');
      return (d.compromisos || [])[0]?.itemNombre;
    }, SK);
    expect(itemNombre).toBe('Crédito X');
  });

  test('(c) sembrarCompromisos no existe como función global', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndUnlock(page, estadoConCompromisos());
    const hasSembrar = await page.evaluate(() => typeof sembrarCompromisos === 'function');
    expect(hasSembrar).toBe(false);
    expect(errors.filter(e => !/ResizeObserver/.test(e))).toHaveLength(0);
  });

  test('(c2) con localStorage vacío de compromisos, estado.compromisos queda []', async ({ page }) => {
    const emptyState = { iniciales: {}, gastos: [], items: [], compromisos: [], patrimonioCargado: true };
    await seedAndUnlock(page, emptyState);
    const count = await page.evaluate((sk) => {
      const d = JSON.parse(localStorage.getItem(sk) || '{}');
      return (d.compromisos || []).length;
    }, SK);
    expect(count).toBe(0);
  });
});
