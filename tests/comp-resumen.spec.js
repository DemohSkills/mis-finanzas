const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';
const TODAY = new Date().toISOString().slice(0, 10);

function daysBefore(n) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function daysAfter(n) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Cierre = 30 días atrás, vencimiento = 5 días atrás
const CIERRE = daysBefore(30);
const VENC_PASADO = daysBefore(5);
const VENC_FUTURO = daysAfter(10);

function buildEstado({ pagos = [], resumenExtra = {} } = {}) {
  return {
    iniciales: { 'Banco Santander': 500000, 'Visa Santander': -200000 },
    gastos: pagos,
    items: [],
    patrimonioCargado: true,
    compromisos: [
      {
        id: 'cr1',
        nombre: 'Visa 4321',
        entidad: 'Visa Santander',
        monto: 100000,
        pagoMinimo: 20000,
        pendientes: 1,
        proxVenc: VENC_PASADO,
        tipo: 'resumen',
        cierre: CIERRE,
        estimado: false,
        ...resumenExtra,
      },
    ],
  };
}

function buildPago(monto, fecha = TODAY) {
  return {
    id: 'pg-' + monto + '-' + fecha,
    creado: Date.now(),
    monto,
    fecha,
    categoria: 'Pago de Visa/MP',
    medio: 'Visa Santander',
    descripcion: 'Pago Visa 4321',
    tipo: 'ingreso',
    soloHistorial: false,
    transferencia: true,
    transferId: 'tr-test-' + monto,
  };
}

async function seedAndUnlock(page, estado) {
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(600);
}

async function goToCompromisos(page) {
  await page.locator('nav.tabs button[data-vista="compromisos"]').click();
  await page.waitForSelector('#compromisosList');
}

// ─────────────────────────────────────────────────────────────
// ESTADO: chips de estado
// ─────────────────────────────────────────────────────────────
test.describe('resumen: chips de estado', () => {
  test('sin pagos y vencido → chip "Vencido hace N días"', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    const chip = page.locator('.comp-row[data-id="cr1"] .chip.vencido');
    await expect(chip).toBeVisible();
    expect(await chip.textContent()).toMatch(/Vencido hace \d+ día/);
  });

  test('pagado < mínimo → chip "Pagó menos del mínimo"', async ({ page }) => {
    const estado = buildEstado({ pagos: [buildPago(5000)] });
    await seedAndUnlock(page, estado);
    await goToCompromisos(page);
    const chip = page.locator('.comp-row[data-id="cr1"] .chip.minpago');
    await expect(chip).toBeVisible();
    expect(await chip.textContent()).toMatch(/Pagó menos del mínimo/);
  });

  test('pagado >= total → chip "Abonada" y botón deshabilitado', async ({ page }) => {
    const estado = buildEstado({ pagos: [buildPago(100000)] });
    await seedAndUnlock(page, estado);
    await goToCompromisos(page);
    const chip = page.locator('.comp-row[data-id="cr1"] .chip.abonada');
    await expect(chip).toBeVisible();
    expect(await chip.textContent()).toMatch(/Abonada/);
    // botón Pagar debe estar deshabilitado
    const btnAbon = page.locator('.comp-row[data-id="cr1"] button[disabled]');
    await expect(btnAbon).toBeVisible();
  });

  test('pagado >= mínimo y < total → chip "Abonado parcial"', async ({ page }) => {
    const estado = buildEstado({ pagos: [buildPago(30000)] });
    await seedAndUnlock(page, estado);
    await goToCompromisos(page);
    const chip = page.locator('.comp-row[data-id="cr1"] .chip.parcial');
    await expect(chip).toBeVisible();
    expect(await chip.textContent()).toMatch(/Abonado parcial/);
  });

  test('mínimo pagado a tiempo → chip "Mínimo pagado a tiempo"', async ({ page }) => {
    // pago antes del vencimiento que suma >= min
    const pagoATiempo = buildPago(25000, VENC_PASADO);
    const estado = buildEstado({ pagos: [pagoATiempo] });
    await seedAndUnlock(page, estado);
    await goToCompromisos(page);
    const chip = page.locator('.comp-row[data-id="cr1"] .chip.minok');
    await expect(chip).toBeVisible();
    expect(await chip.textContent()).toMatch(/Mínimo pagado a tiempo/);
  });

  test('sin cierre → sin chip de pagos (tratado como sin pagos del ciclo)', async ({ page }) => {
    const estado = buildEstado({
      pagos: [buildPago(50000)],
      resumenExtra: { cierre: null },
    });
    await seedAndUnlock(page, estado);
    await goToCompromisos(page);
    // no debe mostrar chip.abonada ni chip.parcial ya que no hay cierre
    const chipAbon = await page.locator('.comp-row[data-id="cr1"] .chip.abonada').count();
    const chipParc = await page.locator('.comp-row[data-id="cr1"] .chip.parcial').count();
    expect(chipAbon).toBe(0);
    expect(chipParc).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// ATAJOS en el modal de pago
// ─────────────────────────────────────────────────────────────
test.describe('resumen: atajos en modal de pago', () => {
  test('botón Pagar abre transModal con destino fijo y atajos visibles', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    await page.locator('.comp-row[data-id="cr1"] button:not([disabled]):has-text("Pagar")').click();
    await expect(page.locator('#transModal')).toBeVisible();
    // destino fijo = Visa Santander
    const destText = await page.locator('#transDestino').inputValue();
    expect(destText).toBe('Visa Santander');
    // destino disabled
    const isDisabled = await page.locator('#transDestino').isDisabled();
    expect(isDisabled).toBe(true);
    // atajos visibles
    await expect(page.locator('#transAtajos')).toBeVisible();
    await expect(page.locator('#btnAtajoMin')).toBeVisible();
    await expect(page.locator('#btnAtajoResto')).toBeVisible();
    await expect(page.locator('#btnAtajoTotal')).toBeVisible();
  });

  test('atajo Mínimo rellena el monto con pagoMinimo', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    await page.locator('.comp-row[data-id="cr1"] button:not([disabled]):has-text("Pagar")').click();
    await page.locator('#btnAtajoMin').click();
    const val = await page.locator('#transMonto').inputValue();
    // pagoMinimo = 20000
    expect(val.replace(/\./g, '').replace(',', '.')).toMatch(/20000/);
  });

  test('atajo Total rellena el monto con c.monto', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    await page.locator('.comp-row[data-id="cr1"] button:not([disabled]):has-text("Pagar")').click();
    await page.locator('#btnAtajoTotal').click();
    const val = await page.locator('#transMonto').inputValue();
    // monto = 100000
    expect(val.replace(/\D/g, '')).toBe('100000');
  });

  test('atajo Resto rellena con total - pagado', async ({ page }) => {
    const estado = buildEstado({ pagos: [buildPago(30000)] });
    await seedAndUnlock(page, estado);
    await goToCompromisos(page);
    await page.locator('.comp-row[data-id="cr1"] button:not([disabled]):has-text("Pagar")').click();
    await page.locator('#btnAtajoResto').click();
    const val = await page.locator('#transMonto').inputValue();
    // resto = 100000 - 30000 = 70000
    expect(val.replace(/\D/g, '')).toBe('70000');
  });

  test('guardar pago crea movimiento ingreso en Visa Santander', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    await page.locator('.comp-row[data-id="cr1"] button:not([disabled]):has-text("Pagar")').click();
    await page.locator('#btnAtajoTotal').click();
    await page.locator('#btnGuardarTrans').click();
    // verificar que el modal cerró
    await expect(page.locator('#transModal')).toBeHidden();
    // verificar en localStorage que se guardó un ingreso en Visa Santander
    const data = await page.evaluate(sk => JSON.parse(localStorage.getItem(sk)), SK);
    const ingresos = data.gastos.filter(g => g.tipo === 'ingreso' && g.medio === 'Visa Santander');
    expect(ingresos.length).toBeGreaterThanOrEqual(1);
    expect(ingresos[ingresos.length - 1].monto).toBe(100000);
  });

  test('pagar no modifica c.monto del compromiso', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    await page.locator('.comp-row[data-id="cr1"] button:not([disabled]):has-text("Pagar")').click();
    await page.locator('#btnAtajoTotal').click();
    await page.locator('#btnGuardarTrans').click();
    const data = await page.evaluate(sk => JSON.parse(localStorage.getItem(sk)), SK);
    const comp = data.compromisos.find(c => c.id === 'cr1');
    expect(comp.monto).toBe(100000); // sin cambio
  });

  test('modal normal Pagar tarjeta NO muestra atajos', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    // open via the inicio pagar-tarjeta button
    await page.locator('nav.tabs button[data-vista="inicio"]').click();
    await page.locator('#btnPagarTarjetaInicio').click();
    // transModal opened but atajos should be hidden
    await expect(page.locator('#transModal')).toBeVisible();
    const atajos = await page.locator('#transAtajos').evaluate(el => el.style.display);
    expect(atajos).toBe('none');
  });
});

// ─────────────────────────────────────────────────────────────
// LISTA DE PAGOS DEL CICLO
// ─────────────────────────────────────────────────────────────
test.describe('resumen: lista de pagos del ciclo', () => {
  test('con pagos: muestra details.comp-pagos colapsable', async ({ page }) => {
    const estado = buildEstado({ pagos: [buildPago(30000)] });
    await seedAndUnlock(page, estado);
    await goToCompromisos(page);
    const det = page.locator('.comp-row[data-id="cr1"] details.comp-pagos');
    await expect(det).toBeVisible();
  });

  test('summary muestra suma de pagos', async ({ page }) => {
    const estado = buildEstado({ pagos: [buildPago(30000), buildPago(20000)] });
    await seedAndUnlock(page, estado);
    await goToCompromisos(page);
    const summary = page.locator('.comp-row[data-id="cr1"] details.comp-pagos summary');
    expect(await summary.textContent()).toMatch(/50\.000|50000/);
  });

  test('al abrir details muestra cada pago en una li', async ({ page }) => {
    const estado = buildEstado({ pagos: [buildPago(30000, TODAY), buildPago(20000, TODAY)] });
    await seedAndUnlock(page, estado);
    await goToCompromisos(page);
    const det = page.locator('.comp-row[data-id="cr1"] details.comp-pagos');
    await det.click();
    const items = det.locator('li');
    expect(await items.count()).toBe(2);
  });

  test('sin cierre: no muestra details de pagos aunque haya movimientos', async ({ page }) => {
    const estado = buildEstado({
      pagos: [buildPago(30000)],
      resumenExtra: { cierre: null },
    });
    await seedAndUnlock(page, estado);
    await goToCompromisos(page);
    const count = await page.locator('.comp-row[data-id="cr1"] details.comp-pagos').count();
    expect(count).toBe(0);
  });

  test('pagos fuera del cierre no se cuentan', async ({ page }) => {
    // pago con fecha anterior al cierre
    const pagoViejo = { ...buildPago(30000, daysBefore(40)), id: 'pg-viejo' };
    const estado = buildEstado({ pagos: [pagoViejo] });
    await seedAndUnlock(page, estado);
    await goToCompromisos(page);
    // no debe haber details (0 pagos en ciclo)
    const count = await page.locator('.comp-row[data-id="cr1"] details.comp-pagos').count();
    expect(count).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// COMPATIBILIDAD: backup sin campo cierre
// ─────────────────────────────────────────────────────────────
test.describe('resumen: compatibilidad backup sin cierre', () => {
  test('compromiso resumen sin campo cierre carga sin errores JS', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const estado = {
      iniciales: {},
      gastos: [],
      items: [],
      patrimonioCargado: true,
      compromisos: [
        // sin campo cierre (backup viejo)
        { id: 'old1', nombre: 'Visa vieja', entidad: 'Visa Santander', monto: 50000, pagoMinimo: 10000, pendientes: 1, proxVenc: VENC_FUTURO, tipo: 'resumen', estimado: false },
      ],
    };
    await seedAndUnlock(page, estado);
    await goToCompromisos(page);
    await page.waitForTimeout(300);
    expect(errors).toHaveLength(0);
  });

  test('compromiso resumen sin cierre no muestra chip de pagos', async ({ page }) => {
    const estado = {
      iniciales: {},
      gastos: [],
      items: [],
      patrimonioCargado: true,
      compromisos: [
        { id: 'old2', nombre: 'Visa vieja', entidad: 'Visa Santander', monto: 50000, pagoMinimo: 10000, pendientes: 1, proxVenc: VENC_FUTURO, tipo: 'resumen', estimado: false },
      ],
    };
    await seedAndUnlock(page, estado);
    await goToCompromisos(page);
    const chipAbon = await page.locator('.comp-row[data-id="old2"] .chip.abonada').count();
    const chipParc = await page.locator('.comp-row[data-id="old2"] .chip.parcial').count();
    expect(chipAbon).toBe(0);
    expect(chipParc).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// SUBTOTAL DEL MES: suma lo que resta por pagar en tipo resumen
// ─────────────────────────────────────────────────────────────
test.describe('resumen: subtotal del mes usa resto por pagar', () => {
  test('resumen parcialmente pagado: subtotal muestra monto − pagado', async ({ page }) => {
    // monto=100000, pagado=30000 → resta 70000
    const pago = { ...buildPago(30000), id: 'pg-sub-1' };
    const estado = buildEstado({ pagos: [pago] });
    await seedAndUnlock(page, estado);
    await goToCompromisos(page);
    // El summary del grupo debe mostrar ~70000, no 100000
    const sub = page.locator('.comp-mes .comp-mes-sub').first();
    await expect(sub).toBeVisible();
    const txt = await sub.textContent();
    expect(txt).toContain('70');
    expect(txt).not.toMatch(/100\.000|100,000/);
  });

  test('resumen completamente pagado: subtotal del grupo es 0', async ({ page }) => {
    // monto=100000, pagado=100000 → resta 0
    const pago = { ...buildPago(100000), id: 'pg-sub-2' };
    const estado = buildEstado({ pagos: [pago] });
    await seedAndUnlock(page, estado);
    await goToCompromisos(page);
    const sub = page.locator('.comp-mes .comp-mes-sub').first();
    await expect(sub).toBeVisible();
    const txt = await sub.textContent();
    // subtotal = 0 → "$ 0" o similar
    expect(txt).toMatch(/\$ 0|0,00/);
  });
});
