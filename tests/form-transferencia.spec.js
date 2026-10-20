// Tests para transferir/pagar tarjeta desde el formulario "Cargar movimiento"
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

function buildEstado() {
  return {
    iniciales: {
      'Banco Santander': 100000,
      'Mercado Pago': 50000,
      'Visa Santander': -30000,
      'Mastercard MP': -10000,
      'American Express': 0,
      'Astropay': 0,
      'Efectivo': 5000,
    },
    gastos: [],
    items: [],
    compromisos: [],
    patrimonioCargado: true,
  };
}

async function seedAndUnlock(page, estado) {
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

async function getEstado(page) {
  return page.evaluate((sk) => JSON.parse(localStorage.getItem(sk)), SK);
}

async function openForm(page) {
  // Navigate to Movim. tab (data-vista="gastos") and open the form details
  await page.locator('button[data-vista="gastos"]').click();
  const det = page.locator('#det-form');
  await det.evaluate(el => { el.open = true; });
  await expect(page.locator('#form')).toBeVisible();
}

function netoDeEstado(est) {
  const saldoDe = (m) => {
    const gastado  = est.gastos.filter(g => g.medio === m && !g.soloHistorial && (g.tipo || 'gasto') === 'gasto').reduce((s, g) => s + g.monto, 0);
    const ingresado = est.gastos.filter(g => g.medio === m && !g.soloHistorial && g.tipo === 'ingreso').reduce((s, g) => s + g.monto, 0);
    return est.iniciales[m] - gastado + ingresado;
  };
  const MEDIOS = ['Banco Santander', 'Mercado Pago', 'Astropay', 'Visa Santander', 'Mastercard MP', 'Efectivo', 'American Express'];
  let a = 0, d = 0;
  for (const m of MEDIOS) { const s = saldoDe(m); s >= 0 ? a += s : d -= s; }
  for (const it of est.items) it.tipo === 'activo' ? a += it.monto : d += it.monto;
  return a - d;
}

test.describe('form-transferencia', () => {
  test('(a) cambiar tipo a Transferir muestra Origen/Destino y oculta Categoría', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndUnlock(page, buildEstado());
    await openForm(page);

    await page.selectOption('#tipo', 'transferir');

    // Destino aparece
    await expect(page.locator('#formDestinoLabel')).toBeVisible();
    // Categoría oculta
    await expect(page.locator('#categoriaLabel')).toBeHidden();
    // Botón dice "Transferir"
    await expect(page.locator('#btnGuardar')).toHaveText('Transferir');

    expect(errors.filter(e => !/ResizeObserver/.test(e))).toHaveLength(0);
  });

  test('(b) cambiar tipo a Pagar tarjeta muestra campos correctos', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await openForm(page);

    await page.selectOption('#tipo', 'pagar-tarjeta');

    // Destino aparece
    await expect(page.locator('#formDestinoLabel')).toBeVisible();
    // Botón dice "Pagar tarjeta"
    await expect(page.locator('#btnGuardar')).toHaveText('Pagar tarjeta');
    // Destino contiene solo tarjetas
    const destOpts = await page.locator('#formDestino option').allTextContents();
    expect(destOpts.some(o => o.includes('Visa Santander'))).toBe(true);
    expect(destOpts.some(o => o.includes('Banco Santander'))).toBe(false);
    // Origen no contiene tarjetas
    const origOpts = await page.locator('#medio option').allTextContents();
    expect(origOpts.some(o => o.includes('Visa Santander'))).toBe(false);
    expect(origOpts.some(o => o.includes('Banco Santander'))).toBe(true);
  });

  test('(c) volver a Gasto restaura campos originales', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await openForm(page);

    await page.selectOption('#tipo', 'transferir');
    await page.selectOption('#tipo', 'gasto');

    await expect(page.locator('#formDestinoLabel')).toBeHidden();
    await expect(page.locator('#categoriaLabel')).toBeVisible();
    await expect(page.locator('#btnGuardar')).toHaveText('Guardar movimiento');
  });

  test('(d) Transferir desde formulario cambia ambos saldos, neto sin cambio, no afecta ingresos/gastos del mes', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const estInicial = await getEstado(page);
    const netoAntes = netoDeEstado(estInicial);
    const mesActual = new Date().toISOString().slice(0, 7);

    await openForm(page);
    await page.selectOption('#tipo', 'transferir');
    await page.fill('#monto', '2000');
    await page.selectOption('#medio', 'Mercado Pago');
    await page.selectOption('#formDestino', 'Banco Santander');
    await page.locator('#btnGuardar').click();

    // Form should reset (tipo back to gasto)
    await expect(page.locator('#tipo')).toHaveValue('gasto');

    const estFinal = await getEstado(page);
    const transMovs = estFinal.gastos.filter(g => g.transferencia && g.transferId);
    expect(transMovs).toHaveLength(2);

    // Same transferId
    expect(transMovs[0].transferId).toBe(transMovs[1].transferId);

    // Mercado Pago: gasto de 2000
    const gastado = transMovs.find(g => g.medio === 'Mercado Pago' && (g.tipo || 'gasto') === 'gasto');
    expect(gastado?.monto).toBe(2000);

    // Banco Santander: ingreso de 2000
    const ingresado = transMovs.find(g => g.medio === 'Banco Santander' && g.tipo === 'ingreso');
    expect(ingresado?.monto).toBe(2000);

    // Neto sin cambio
    expect(netoDeEstado(estFinal)).toBe(netoAntes);

    // No afecta ingresos/gastos reales del mes
    const ingresosMes = estFinal.gastos.filter(g => g.tipo === 'ingreso' && g.fecha?.slice(0, 7) === mesActual && !g.transferencia).reduce((s, g) => s + g.monto, 0);
    const gastosMes   = estFinal.gastos.filter(g => (g.tipo || 'gasto') === 'gasto' && g.fecha?.slice(0, 7) === mesActual && !g.transferencia).reduce((s, g) => s + g.monto, 0);
    expect(ingresosMes).toBe(0);
    expect(gastosMes).toBe(0);
  });

  test('(e) Pagar tarjeta desde formulario baja la deuda de la Visa', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const estInicial = await getEstado(page);
    const netoAntes = netoDeEstado(estInicial);

    await openForm(page);
    await page.selectOption('#tipo', 'pagar-tarjeta');
    await page.fill('#monto', '5000');
    await page.selectOption('#medio', 'Banco Santander');
    await page.selectOption('#formDestino', 'Visa Santander');
    await page.locator('#btnGuardar').click();

    const estFinal = await getEstado(page);

    // Visa saldo: -30000 + 5000 ingreso = -25000
    const visaIngresado = estFinal.gastos.filter(g => g.medio === 'Visa Santander' && g.tipo === 'ingreso').reduce((s, g) => s + g.monto, 0);
    const visaGastado   = estFinal.gastos.filter(g => g.medio === 'Visa Santander' && (g.tipo || 'gasto') === 'gasto').reduce((s, g) => s + g.monto, 0);
    const visaSaldo = estInicial.iniciales['Visa Santander'] - visaGastado + visaIngresado;
    expect(visaSaldo).toBe(-25000); // deuda bajó de 30000 a 25000

    // Categoría correcta
    const pagoMov = estFinal.gastos.find(g => g.transferencia && g.categoria === 'Pago de Visa/MP');
    expect(pagoMov).toBeTruthy();

    // Neto sin cambio
    expect(netoDeEstado(estFinal)).toBe(netoAntes);
  });

  test('(f) al editar un gasto, el selector solo ofrece gasto e ingreso', async ({ page }) => {
    const estado = buildEstado();
    estado.gastos.push({
      id: 'test-gasto-1', creado: Date.now(),
      monto: 500, fecha: new Date().toISOString().slice(0, 10),
      categoria: 'Comida y Delivery', medio: 'Efectivo',
      descripcion: 'test', tipo: 'gasto', soloHistorial: false,
    });
    await seedAndUnlock(page, estado);

    // Navigate to Movim. and open historial
    await page.locator('button[data-vista="gastos"]').click();
    const detHistorial = page.locator('#det-historial');
    await detHistorial.evaluate(el => { el.open = true; });

    // Click edit on the gasto
    await page.locator('#historial .gasto button[data-a="editar"]').first().click();

    // Transfer options must be hidden
    const transOpts = page.locator('#tipo option.opt-trans');
    for (const opt of await transOpts.all()) {
      await expect(opt).toBeHidden();
    }

    // Only gasto and ingreso visible
    const visibleOpts = await page.locator('#tipo option:not([hidden])').allTextContents();
    expect(visibleOpts.length).toBe(2);
    expect(visibleOpts.some(o => o.includes('Gasto'))).toBe(true);
    expect(visibleOpts.some(o => o.includes('Ingreso'))).toBe(true);
  });

  test('(g) formulario limpio después de guardar una transferencia', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await openForm(page);

    await page.selectOption('#tipo', 'transferir');
    await page.fill('#monto', '1000');
    await page.selectOption('#medio', 'Efectivo');
    await page.selectOption('#formDestino', 'Banco Santander');
    await page.locator('#btnGuardar').click();

    // Form reset: tipo=gasto, destino hidden, categoría visible, botón original
    await expect(page.locator('#tipo')).toHaveValue('gasto');
    await expect(page.locator('#formDestinoLabel')).toBeHidden();
    await expect(page.locator('#categoriaLabel')).toBeVisible();
    await expect(page.locator('#btnGuardar')).toHaveText('Guardar movimiento');
    await expect(page.locator('#monto')).toHaveValue('');
  });
});
