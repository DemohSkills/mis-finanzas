// Tests para el botón "Cobré" en ítems de "Cobros pendientes"
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

function buildEstado(overrides = {}) {
  return {
    iniciales: { 'Mercado Pago': 5000, 'Banco Santander': 10000, 'Efectivo': 2000, 'Visa Santander': 0, 'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0 },
    gastos: [],
    items: [
      { id: 'delux-id', nombre: 'Delux sueldo', tipo: 'activo', monto: 80000, grupo: 'Cobros pendientes', persona: '', historial: [] },
    ],
    compromisos: [],
    patrimonioCargado: true,
    ...overrides,
  };
}

async function seedAndUnlock(page, estado) {
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) {
    await page.click(`button[data-d="${d}"]`);
  }
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

async function getEstado(page) {
  return page.evaluate((sk) => JSON.parse(localStorage.getItem(sk)), SK);
}

async function abrirPatrimonio(page) {
  await page.locator('[role=tab]', { hasText: 'Patrimonio' }).click();
  await page.waitForSelector('#listaActivos');
}

test.describe('cobre', () => {

  test('(a) botón Cobré aparece en Cobros pendientes en Patrimonio', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndUnlock(page, buildEstado());
    await abrirPatrimonio(page);
    const btn = page.locator('#listaActivos button', { hasText: 'Cobré' });
    await expect(btn).toBeVisible();
    expect(errors.filter(e => !/ResizeObserver/.test(e))).toHaveLength(0);
  });

  test('(b) cobro total sin retención: saldo de MP sube el neto, ítem baja el bruto, movimiento no es transferencia', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await abrirPatrimonio(page);

    await page.locator('#listaActivos button', { hasText: 'Cobré' }).click();
    await page.waitForSelector('#cobreModal:not([hidden])');

    // Verificar defaults: bruto = 80000, neto = 80000
    const bruto = await page.$eval('#cobreBruto', el => el.value);
    const neto  = await page.$eval('#cobreNeto',  el => el.value);
    expect(bruto).toMatch(/80/);
    expect(neto).toMatch(/80/);

    // Medio MP (default)
    await page.selectOption('#cobreMedio', 'Mercado Pago');

    await page.click('#btnGuardarCobre');
    await page.waitForSelector('#cobreModal', { state: 'hidden' });

    const est = await getEstado(page);

    // Ítem baja a 0
    expect(est.items.find(it => it.nombre === 'Delux sueldo').monto).toBe(0);

    // Movimiento de ingreso en MP por 80000, NO transferencia
    const mov = est.gastos.find(g => g.medio === 'Mercado Pago' && g.tipo === 'ingreso');
    expect(mov).toBeTruthy();
    expect(mov.monto).toBe(80000);
    expect(mov.transferencia).toBeFalsy();
    expect(mov.categoria).toBe('Sueldo/Honorarios');

    // Saldo de MP sube: 5000 + 80000 = 85000
    const mpIng = est.gastos.filter(g => g.medio === 'Mercado Pago' && !g.soloHistorial && (g.tipo||'gasto') === 'ingreso').reduce((s,g) => s+g.monto, 0);
    const mpGas = est.gastos.filter(g => g.medio === 'Mercado Pago' && !g.soloHistorial && (g.tipo||'gasto') === 'gasto').reduce((s,g) => s+g.monto, 0);
    expect(est.iniciales['Mercado Pago'] - mpGas + mpIng).toBe(85000);
  });

  test('(c) cobro con retención: cuenta sube el neto, ítem baja el bruto', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await abrirPatrimonio(page);

    await page.locator('#listaActivos button', { hasText: 'Cobré' }).click();
    await page.waitForSelector('#cobreModal:not([hidden])');

    // Bruto 80000, neto 72000 → retención 8000
    await page.fill('#cobreBruto', '80000');
    await page.fill('#cobreNeto', '72000');

    await page.click('#btnGuardarCobre');
    await page.waitForSelector('#cobreModal', { state: 'hidden' });

    const est = await getEstado(page);

    // Ítem baja 80000 → 0
    expect(est.items.find(it => it.nombre === 'Delux sueldo').monto).toBe(0);

    // Movimiento de ingreso por el NETO (72000)
    const mov = est.gastos.find(g => g.tipo === 'ingreso' && g.medio === 'Mercado Pago');
    expect(mov.monto).toBe(72000);
    expect(mov.transferencia).toBeFalsy();

    // Historial tiene neto correcto
    const h = est.items.find(it => it.nombre === 'Delux sueldo').historial[0];
    expect(h.accion).toBe('cobre');
    expect(h.monto).toBe(80000);  // bruto
    expect(h.neto).toBe(72000);
  });

  test('(d) cobro parcial: ítem queda con el saldo restante', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await abrirPatrimonio(page);

    await page.locator('#listaActivos button', { hasText: 'Cobré' }).click();
    await page.waitForSelector('#cobreModal:not([hidden])');

    await page.fill('#cobreBruto', '30000');
    await page.fill('#cobreNeto', '30000');

    await page.click('#btnGuardarCobre');
    await page.waitForSelector('#cobreModal', { state: 'hidden' });

    const est = await getEstado(page);

    // Ítem queda con 50000
    expect(est.items.find(it => it.nombre === 'Delux sueldo').monto).toBe(50000);

    // Movimiento por 30000
    const mov = est.gastos.find(g => g.tipo === 'ingreso');
    expect(mov.monto).toBe(30000);
  });

  test('(e) neto > bruto no permitido', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await abrirPatrimonio(page);

    await page.locator('#listaActivos button', { hasText: 'Cobré' }).click();
    await page.waitForSelector('#cobreModal:not([hidden])');

    await page.fill('#cobreBruto', '50000');
    await page.fill('#cobreNeto', '60000');

    page.once('dialog', d => { expect(d.message()).toContain('neto'); d.accept(); });
    await page.click('#btnGuardarCobre');

    // Modal sigue abierto
    await expect(page.locator('#cobreModal')).not.toHaveAttribute('hidden');

    const est = await getEstado(page);
    expect(est.gastos).toHaveLength(0);
    expect(est.items.find(it => it.nombre === 'Delux sueldo').monto).toBe(80000);
  });

  test('(f) deshacer último cobro: restaura ítem y borra movimiento', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await abrirPatrimonio(page);

    // Hacer cobro parcial
    await page.locator('#listaActivos button', { hasText: 'Cobré' }).click();
    await page.waitForSelector('#cobreModal:not([hidden])');
    await page.fill('#cobreBruto', '30000');
    await page.fill('#cobreNeto', '27000');
    await page.click('#btnGuardarCobre');
    await page.waitForSelector('#cobreModal', { state: 'hidden' });

    // Abrir historial
    const hdet = page.locator('#listaActivos details:not(.pat-grp)', { hasText: 'Historial' });
    await expect(hdet).toBeVisible();
    await hdet.evaluate(el => { el.open = true; });

    // Deshacer
    page.once('dialog', d => d.accept());
    await page.locator('#listaActivos .mini.danger', { hasText: '↩ Deshacer último' }).click();

    const est = await getEstado(page);

    // Ítem volvió a 80000
    expect(est.items.find(it => it.nombre === 'Delux sueldo').monto).toBe(80000);

    // Sin movimientos
    expect(est.gastos).toHaveLength(0);

    // Historial vacío
    expect(est.items.find(it => it.nombre === 'Delux sueldo').historial).toHaveLength(0);
  });

  test('(g) backup viejo sin historial: compatibilidad, no rompe', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Ítem sin campo historial (backup viejo)
    const est = buildEstado();
    delete est.items[0].historial;
    await seedAndUnlock(page, est);
    await abrirPatrimonio(page);
    const btn = page.locator('#listaActivos button', { hasText: 'Cobré' });
    await expect(btn).toBeVisible();
    // Hacer un cobro
    await btn.click();
    await page.waitForSelector('#cobreModal:not([hidden])');
    await page.fill('#cobreNeto', '10000');
    await page.fill('#cobreBruto', '10000');
    await page.click('#btnGuardarCobre');
    await page.waitForSelector('#cobreModal', { state: 'hidden' });
    const guardado = await getEstado(page);
    expect(guardado.items[0].historial).toHaveLength(1);
    expect(errors.filter(e => !/ResizeObserver/.test(e))).toHaveLength(0);
  });

});
