const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

const BASE_STATE = {
  iniciales: { 'Efectivo': 10000 },
  gastos: [],
  items: [{ id: 'item1', nombre: 'Item Test', tipo: 'deuda', monto: 500000, grupo: 'Deudas', persona: '' }],
  patrimonioCargado: true,
  compromisos: [
    { id: 'comp1', nombre: 'Test Credito', entidad: 'Santander', monto: 5000.5, pendientes: 3,
      proxVenc: '2026-11-01', tipo: 'cuota', estimado: false, itemNombre: 'Item Test' }
  ],
};

async function seedAndLoad(page, state = BASE_STATE) {
  await page.addInitScript(({ state }) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(state));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
  }, { state });
  await page.goto(INDEX);
}

async function enterPIN(page) {
  for (const d of ['1', '2', '3', '4']) {
    await page.locator(`[data-d="${d}"]`).click();
  }
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

async function goToMovimientos(page) {
  await page.locator('[role=tab]', { hasText: 'Movim.' }).click();
  // Open the form details if it's collapsed
  await page.evaluate(() => {
    const d = document.getElementById('det-form');
    if (d && !d.open) d.open = true;
  });
  await page.waitForSelector('#monto', { state: 'visible' });
}

function getState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('finanzas-v1')));
}

// ─── tests ────────────────────────────────────────────────────

test('(a) sin errores JS al cargar y desbloquear', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await seedAndLoad(page);
  await enterPIN(page);
  expect(errors).toHaveLength(0);
});

test('(b) #monto: blur en "1234567,89" muestra "1.234.567,89"', async ({ page }) => {
  await seedAndLoad(page);
  await enterPIN(page);
  await goToMovimientos(page);
  const inp = page.locator('#monto');
  await inp.fill('1234567,89');
  await inp.evaluate(el => el.blur());
  await expect(inp).toHaveValue('1.234.567,89');
});

test('(c) guardar movimiento → gasto.monto === 1234567.89', async ({ page }) => {
  await seedAndLoad(page);
  await enterPIN(page);
  await goToMovimientos(page);
  await page.fill('#monto', '1234567,89');
  await page.evaluate(() => document.getElementById('monto').blur());
  await page.locator('#btnGuardar').click();
  const state = await getState(page);
  expect(state.gastos.length).toBe(1);
  expect(state.gastos[0].monto).toBeCloseTo(1234567.89, 2);
});

test('(d) editar movimiento → muestra formateado; guardar sin tocar no cambia monto', async ({ page }) => {
  const stateConGasto = {
    ...BASE_STATE,
    gastos: [{ id: 'g1', creado: 1, monto: 1234567.89, fecha: '2026-10-18',
      categoria: 'Alimentación', medio: 'Efectivo', descripcion: 'test', tipo: 'gasto', soloHistorial: false }],
  };
  await seedAndLoad(page, stateConGasto);
  await enterPIN(page);
  await goToMovimientos(page);
  await page.evaluate(() => {
    const d = document.getElementById('det-historial');
    if (d && !d.open) d.open = true;
  });
  await page.locator('[data-a=editar]').first().click();
  await page.waitForSelector('#monto', { state: 'visible' });
  const inp = page.locator('#monto');
  await expect(inp).toHaveValue('1.234.567,89');
  await page.locator('#btnGuardar').click();
  const state = await getState(page);
  expect(state.gastos[0].monto).toBeCloseTo(1234567.89, 2);
});

test('(e) "1.500" en #monto se guarda como 1500', async ({ page }) => {
  await seedAndLoad(page);
  await enterPIN(page);
  await goToMovimientos(page);
  await page.fill('#monto', '1.500');
  await page.evaluate(() => document.getElementById('monto').blur());
  await page.locator('#btnGuardar').click();
  const state = await getState(page);
  expect(state.gastos[0].monto).toBe(1500);
});

test('(f) #itemMonto: guardar ítem con "2.345,67" → item.monto === 2345.67', async ({ page }) => {
  await seedAndLoad(page);
  await enterPIN(page);
  await page.locator('[role=tab]', { hasText: 'Patrimonio' }).click();
  await page.waitForSelector('#itemMonto', { state: 'visible' });
  await page.fill('#itemNombre', 'TestItem');
  await page.fill('#itemMonto', '2.345,67');
  await page.evaluate(() => document.getElementById('itemMonto').blur());
  const inp = page.locator('#itemMonto');
  await expect(inp).toHaveValue('2.345,67');
  await page.locator('#btnItemGuardar').click();
  const state = await getState(page);
  const newItem = state.items.find(x => x.nombre === 'TestItem');
  expect(newItem).toBeTruthy();
  expect(newItem.monto).toBeCloseTo(2345.67, 2);
});

test('(f) #compMonto: editar compromiso prefill muestra formateado', async ({ page }) => {
  await seedAndLoad(page);
  await enterPIN(page);
  await page.evaluate(() => window.editarCompromiso('comp1'));
  await page.waitForSelector('#compModal:not([hidden])');
  const inp = page.locator('#compMonto');
  await expect(inp).toHaveValue('5.000,5');
});

test('(f) #pagoImporte: abrir pago modal prefill muestra formateado', async ({ page }) => {
  await seedAndLoad(page);
  await enterPIN(page);
  await page.evaluate(() => window.abrirPagoModal('comp1'));
  await page.waitForSelector('#pagoModal:not([hidden])');
  const inp = page.locator('#pagoImporte');
  await expect(inp).toHaveValue('5.000,5');
});

test('(f) #wiMonto en wizard: blur formatea', async ({ page }) => {
  const wizState = { iniciales: {}, gastos: [], items: [], patrimonioCargado: false, compromisos: [] };
  await seedAndLoad(page, wizState);
  await enterPIN(page);
  await page.waitForSelector('#wizScr', { state: 'visible' });
  // advance to step 2 (items) where wiMonto lives
  await page.evaluate(() => window.wizPaso2());
  await page.waitForSelector('#wiMonto', { state: 'visible' });
  const inp = page.locator('#wiMonto');
  await inp.fill('98765,43');
  await inp.evaluate(el => el.blur());
  await expect(inp).toHaveValue('98.765,43');
});

test('(g) monto vacío no guarda y muestra alerta', async ({ page }) => {
  await seedAndLoad(page);
  await enterPIN(page);
  await goToMovimientos(page);
  const dialogPromise = page.waitForEvent('dialog');
  page.locator('#btnGuardar').click(); // no await — dialog intercepts
  const dialog = await dialogPromise;
  expect(dialog.message()).toMatch(/monto/i);
  await dialog.accept();
  const state = await getState(page);
  expect(state.gastos.length).toBe(0);
});

test('(g) monto "abc" no guarda', async ({ page }) => {
  await seedAndLoad(page);
  await enterPIN(page);
  await goToMovimientos(page);
  await page.fill('#monto', 'abc');
  let alerted = '';
  page.once('dialog', async d => { alerted = d.message(); await d.accept(); });
  await page.locator('#btnGuardar').click();
  await expect.poll(() => alerted).toBeTruthy();
  const state = await getState(page);
  expect(state.gastos.length).toBe(0);
});

test('(h) saldo inicial wizard se guarda bien', async ({ page }) => {
  const wizState = { iniciales: {}, gastos: [], items: [], patrimonioCargado: false, compromisos: [] };
  await seedAndLoad(page, wizState);
  await enterPIN(page);
  await page.waitForSelector('#wizScr', { state: 'visible' });
  const efInp = page.locator('input[data-medio="Efectivo"]');
  await efInp.fill('1.234.567,89');
  await efInp.evaluate(el => el.blur());
  await page.evaluate(() => {
    window.wizPaso2();
    window.guardar(); // persist estado to localStorage
  });
  const state = await getState(page);
  expect(state.iniciales['Efectivo']).toBeCloseTo(1234567.89, 2);
});

test('(i) mostrarConfirmVoz guarda monto correcto', async ({ page }) => {
  await seedAndLoad(page);
  await enterPIN(page);
  await page.evaluate(() => window.mostrarConfirmVoz(75000.5, 'Efectivo', 'test voz'));
  await page.locator('#btnVozOk').click();
  const state = await getState(page);
  const g = state.gastos.find(x => x.descripcion === 'test voz');
  expect(g).toBeTruthy();
  expect(g.monto).toBeCloseTo(75000.5, 2);
});
