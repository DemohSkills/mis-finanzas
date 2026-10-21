// Tests para transferencias entre cuentas y "Pagar tarjeta"
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

// Helper: net patrimony computed from estado
function netoDeEstado(est) {
  const saldoDe = (m) => {
    const gastado  = est.gastos.filter(g => g.medio === m && !g.soloHistorial && (g.tipo || 'gasto') === 'gasto').reduce((s, g) => s + g.monto, 0);
    const ingresado = est.gastos.filter(g => g.medio === m && !g.soloHistorial && (g.tipo || 'gasto') === 'ingreso').reduce((s, g) => s + g.monto, 0);
    return est.iniciales[m] - gastado + ingresado;
  };
  const MEDIOS = ['Banco Santander', 'Mercado Pago', 'Astropay', 'Visa Santander', 'Mastercard MP', 'Efectivo', 'American Express'];
  let a = 0, d = 0;
  for (const m of MEDIOS) { const s = saldoDe(m); s >= 0 ? a += s : d -= s; }
  for (const it of est.items) it.tipo === 'activo' ? a += it.monto : d += it.monto;
  return a - d;
}

test.describe('transferencia', () => {
  test('(a) sin errores JS con estado inicial', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndUnlock(page, buildEstado());
    expect(errors.filter(e => !/ResizeObserver/.test(e))).toHaveLength(0);
  });

  test('(b) botones Transferir y Pagar tarjeta visibles en Inicio', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await expect(page.locator('#btnTransferirInicio')).toBeVisible();
    await expect(page.locator('#btnPagarTarjetaInicio')).toBeVisible();
  });

  test('(c) Transferir $1.000 de Mercado Pago a Banco Santander: ambos saldos cambian, neto sin cambio, ingresos/gastos mes sin cambio', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const estInicial = await getEstado(page);
    const netoAntes = netoDeEstado(estInicial);
    const mesActual = new Date().toISOString().slice(0, 7);

    // Abrir modal de transferencia
    await page.click('#btnTransferirInicio');
    await page.waitForSelector('#transModal:not([hidden])');

    // Seleccionar Mercado Pago como origen
    await page.selectOption('#transOrigen', 'Mercado Pago');
    // Seleccionar Banco Santander como destino
    await page.selectOption('#transDestino', 'Banco Santander');
    // Ingresar monto
    await page.fill('#transMonto', '1000');
    // Guardar
    await page.click('#btnGuardarTrans');
    await page.waitForSelector('#transModal', { state: 'hidden' });

    const estFinal = await getEstado(page);

    // Verificar que se crearon 2 movimientos con transferId
    const transMovs = estFinal.gastos.filter(g => g.transferencia && g.transferId);
    expect(transMovs).toHaveLength(2);

    // Ambos comparten el mismo transferId
    const [tid1, tid2] = [transMovs[0].transferId, transMovs[1].transferId];
    expect(tid1).toBe(tid2);

    // Mercado Pago gasto de 1000
    const gastado = transMovs.find(g => g.medio === 'Mercado Pago' && (g.tipo || 'gasto') === 'gasto');
    expect(gastado).toBeTruthy();
    expect(gastado.monto).toBe(1000);

    // Banco Santander ingreso de 1000
    const ingresado = transMovs.find(g => g.medio === 'Banco Santander' && g.tipo === 'ingreso');
    expect(ingresado).toBeTruthy();
    expect(ingresado.monto).toBe(1000);

    // Patrimonio neto no cambia
    const netoAfter = netoDeEstado(estFinal);
    expect(netoAfter).toBe(netoAntes);

    // No cuentan en ingresos/gastos reales del mes
    const ingresosMes = estFinal.gastos.filter(g => g.tipo === 'ingreso' && g.fecha && g.fecha.slice(0, 7) === mesActual && !g.transferencia).reduce((s, g) => s + g.monto, 0);
    const gastosMes   = estFinal.gastos.filter(g => (g.tipo || 'gasto') === 'gasto' && g.fecha && g.fecha.slice(0, 7) === mesActual && !g.transferencia).reduce((s, g) => s + g.monto, 0);
    expect(ingresosMes).toBe(0);
    expect(gastosMes).toBe(0);
  });

  test('(d) Pagar tarjeta $1.000 de Banco Santander a Visa: deuda Visa baja 1.000, neto sin cambio', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const estInicial = await getEstado(page);
    const netoAntes = netoDeEstado(estInicial);

    // Visa inicial: -30000 → saldoDe = -30000 (deuda)
    const visaInicial = estInicial.iniciales['Visa Santander']; // -30000

    await page.click('#btnPagarTarjetaInicio');
    await page.waitForSelector('#transModal:not([hidden])');

    // Origen: Banco Santander (cuentas)
    await page.selectOption('#transOrigen', 'Banco Santander');
    // Destino: Visa Santander (tarjeta)
    await page.selectOption('#transDestino', 'Visa Santander');
    await page.fill('#transMonto', '1000');
    await page.click('#btnGuardarTrans');
    await page.waitForSelector('#transModal', { state: 'hidden' });

    const estFinal = await getEstado(page);

    // Visa saldo = -30000 + 1000 (ingreso) = -29000 → deuda bajó en 1000
    const visaGastado  = estFinal.gastos.filter(g => g.medio === 'Visa Santander' && !g.soloHistorial && (g.tipo || 'gasto') === 'gasto').reduce((s, g) => s + g.monto, 0);
    const visaIngresado = estFinal.gastos.filter(g => g.medio === 'Visa Santander' && !g.soloHistorial && g.tipo === 'ingreso').reduce((s, g) => s + g.monto, 0);
    const visaSaldo = visaInicial - visaGastado + visaIngresado;
    expect(visaSaldo).toBe(visaInicial + 1000); // deuda reduce: -30000 + 1000 = -29000

    // Categoría correcta para pago tarjeta
    const mov = estFinal.gastos.find(g => g.transferencia && g.categoria === 'Pago de Visa/MP');
    expect(mov).toBeTruthy();

    // Neto sin cambio
    expect(netoDeEstado(estFinal)).toBe(netoAntes);
  });

  test('(e) borrar el par revierte ambos saldos y neto', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    const estInicial = await getEstado(page);
    const netoAntes = netoDeEstado(estInicial);

    // Crear transferencia
    await page.click('#btnTransferirInicio');
    await page.waitForSelector('#transModal:not([hidden])');
    await page.selectOption('#transOrigen', 'Mercado Pago');
    await page.selectOption('#transDestino', 'Banco Santander');
    await page.fill('#transMonto', '1000');
    await page.click('#btnGuardarTrans');
    await page.waitForSelector('#transModal', { state: 'hidden' });

    // Ir a Movim. y verificar la fila de transferencia en el historial
    await page.locator('[role=tab]', { hasText: 'Movimientos' }).click();
    const detHistorial = page.locator('#det-historial');
    await detHistorial.evaluate(el => { el.open = true; });
    const filaTransfer = page.locator('#historial .gasto', { hasText: '⇄' });
    await expect(filaTransfer).toBeVisible();

    // Borrar
    page.once('dialog', d => d.accept());
    await filaTransfer.locator('button.mini.danger').click();

    const estFinal = await getEstado(page);

    // No hay movimientos de transferencia
    expect(estFinal.gastos.filter(g => g.transferencia)).toHaveLength(0);

    // Neto volvió al original
    expect(netoDeEstado(estFinal)).toBe(netoAntes);
  });

  test('(f) transferId se guarda y se restaura en el backup', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());

    await page.click('#btnTransferirInicio');
    await page.waitForSelector('#transModal:not([hidden])');
    await page.selectOption('#transOrigen', 'Mercado Pago');
    await page.selectOption('#transDestino', 'Banco Santander');
    await page.fill('#transMonto', '5000');
    await page.click('#btnGuardarTrans');
    await page.waitForSelector('#transModal', { state: 'hidden' });

    const rawJson = await page.evaluate((sk) => localStorage.getItem(sk), SK);
    const parsed = JSON.parse(rawJson);
    const movs = parsed.gastos.filter(g => g.transferencia && g.transferId);
    expect(movs).toHaveLength(2);
    expect(movs[0].transferId).toBe(movs[1].transferId);
    expect(typeof movs[0].transferId).toBe('string');
  });
});
