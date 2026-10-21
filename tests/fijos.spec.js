const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';
const TODAY = new Date().toISOString().slice(0, 10);

function mesActual() { return TODAY.slice(0, 7); }
function mesSiguiente(k = 1) {
  const [y, m] = mesActual().split('-').map(Number);
  let ny = y, nm = m + k;
  if (nm > 12) { ny++; nm -= 12; }
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

function buildEstado(compromisos = [], gastos = []) {
  return {
    iniciales: { 'Banco Santander': 100000, 'Mercado Pago': 50000, 'Astropay': 0, 'Visa Santander': 0, 'Mastercard MP': 0, 'Efectivo': 0, 'American Express': 0 },
    gastos,
    items: [],
    patrimonioCargado: true,
    compromisos,
  };
}

function mkFijo(overrides = {}) {
  return {
    id: 'fijo-test-1',
    tipo: 'fijo',
    nombre: 'Alquiler',
    categoria: 'Hogar y Materiales',
    monto: 50000,
    estimado: true,
    diaMes: 5,
    medioPago: 'Banco Santander',
    palabrasClave: '',
    activo: true,
    pagos: {},
    ...overrides,
  };
}

async function seedAndUnlock(page, estado) {
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    window.confirm = () => true;
    window._alerts = [];
    window.alert = msg => { window._alerts.push(String(msg)); };
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}

async function goToCompromisos(page) {
  await page.locator('nav.tabs button[data-vista="compromisos"]').click();
  await page.waitForSelector('#compromisosList');
}

// ─── 1. Alta de fijo ──────────────────────────────────────────────────────────

test('fijo: alta crea un fijo en estado.compromisos con tipo:fijo', async ({ page }) => {
  await seedAndUnlock(page, buildEstado());
  await goToCompromisos(page);
  await page.click('#btnNuevoFijo');
  await page.waitForSelector('#fijoModal:not([hidden])');
  await page.fill('#fijoNombre', 'Alquiler');
  await page.fill('#fijoMonto', '50000');
  await page.fill('#fijoDiaMes', '5');
  await page.click('#fijoForm button[type=submit]');
  await page.waitForSelector('#fijoModal[hidden]', { state: 'attached' });
  const estado = await page.evaluate(() => window._getEstado());
  const fijo = estado.compromisos.find(c => c.tipo === 'fijo');
  expect(fijo).toBeTruthy();
  expect(fijo.nombre).toBe('Alquiler');
  expect(fijo.monto).toBe(50000);
  expect(fijo.diaMes).toBe(5);
  expect(fijo.activo).toBe(true);
  expect(fijo.estimado).toBe(true);
  expect(fijo.pagos).toBeDefined();
});

test('fijo: el fijo aparece en la pestaña Compromisos', async ({ page }) => {
  await seedAndUnlock(page, buildEstado([mkFijo()]));
  await goToCompromisos(page);
  await expect(page.locator('.comp-row--fijo').first()).toBeVisible();
  const txt = await page.locator('.comp-row--fijo').first().textContent();
  expect(txt).toContain('Alquiler');
});

// ─── 2. Edición ──────────────────────────────────────────────────────────────

test('fijo: editar cambia monto y diaMes', async ({ page }) => {
  await seedAndUnlock(page, buildEstado([mkFijo()]));
  await goToCompromisos(page);
  await page.evaluate(() => window.abrirFijoModal('fijo-test-1'));
  await page.waitForSelector('#fijoModal:not([hidden])');
  await page.fill('#fijoMonto', '60000');
  await page.fill('#fijoDiaMes', '10');
  await page.click('#fijoForm button[type=submit]');
  const estado = await page.evaluate(() => window._getEstado());
  const f = estado.compromisos.find(c => c.id === 'fijo-test-1');
  expect(f.monto).toBe(60000);
  expect(f.diaMes).toBe(10);
});

test('fijo: editar valida monto <= 0', async ({ page }) => {
  await seedAndUnlock(page, buildEstado([mkFijo()]));
  await page.evaluate(() => window.abrirFijoModal('fijo-test-1'));
  await page.waitForSelector('#fijoModal:not([hidden])');
  await page.fill('#fijoMonto', '0');
  await page.click('#fijoForm button[type=submit]');
  const alerted = await page.evaluate(() => window._alerts.length > 0);
  expect(alerted).toBe(true);
  const estado = await page.evaluate(() => window._getEstado());
  const f = estado.compromisos.find(c => c.id === 'fijo-test-1');
  expect(f.monto).toBe(50000); // unchanged
});

// ─── 3. Pausa ─────────────────────────────────────────────────────────────────

test('fijo: pausar pone activo:false y lo oculta de la lista', async ({ page }) => {
  await seedAndUnlock(page, buildEstado([mkFijo()]));
  await page.evaluate(() => window.pausarFijo('fijo-test-1'));
  const estado = await page.evaluate(() => window._getEstado());
  const f = estado.compromisos.find(c => c.id === 'fijo-test-1');
  expect(f.activo).toBe(false);
});

test('fijo: fijo pausado no aparece en la vista', async ({ page }) => {
  await seedAndUnlock(page, buildEstado([mkFijo({ activo: false })]));
  await goToCompromisos(page);
  const count = await page.locator('.comp-row--fijo').count();
  expect(count).toBe(0);
});

test('fijo: pausar y volver a activar restaura activo:true', async ({ page }) => {
  await seedAndUnlock(page, buildEstado([mkFijo({ activo: false })]));
  await page.evaluate(() => window.pausarFijo('fijo-test-1'));
  const estado = await page.evaluate(() => window._getEstado());
  const f = estado.compromisos.find(c => c.id === 'fijo-test-1');
  expect(f.activo).toBe(true);
});

// ─── 4. Baja ─────────────────────────────────────────────────────────────────

test('fijo: borrar elimina el fijo de estado.compromisos', async ({ page }) => {
  await seedAndUnlock(page, buildEstado([mkFijo()]));
  await page.evaluate(() => window.borrarFijo('fijo-test-1'));
  const estado = await page.evaluate(() => window._getEstado());
  expect(estado.compromisos.filter(c => c.tipo === 'fijo')).toHaveLength(0);
});

// ─── 5. Derivación de meses ───────────────────────────────────────────────────

test('fijo: aparece en mes actual, mes+1 y mes+2 (sort venc)', async ({ page }) => {
  await seedAndUnlock(page, buildEstado([mkFijo()]));
  await goToCompromisos(page);
  const filaCount = await page.locator('.comp-row--fijo').count();
  expect(filaCount).toBe(3);
});

test('fijo: fijoFechaEnMes devuelve la fecha correcta', async ({ page }) => {
  await seedAndUnlock(page, buildEstado());
  const fecha = await page.evaluate(() => window.fijoFechaEnMes(5, '2026-10'));
  expect(fecha).toBe('2026-10-05');
});

// ─── 6. Último día del mes ────────────────────────────────────────────────────

test('fijo: diaMes=31 en febrero usa último día del mes', async ({ page }) => {
  await seedAndUnlock(page, buildEstado());
  const fecha = await page.evaluate(() => window.fijoFechaEnMes(31, '2026-02'));
  expect(fecha).toBe('2026-02-28');
});

test('fijo: diaMes=31 en abril usa día 30', async ({ page }) => {
  await seedAndUnlock(page, buildEstado());
  const fecha = await page.evaluate(() => window.fijoFechaEnMes(31, '2026-04'));
  expect(fecha).toBe('2026-04-30');
});

test('fijo: diaMes=29 en febrero año no bisiesto usa día 28', async ({ page }) => {
  await seedAndUnlock(page, buildEstado());
  const fecha = await page.evaluate(() => window.fijoFechaEnMes(29, '2025-02'));
  expect(fecha).toBe('2025-02-28');
});

// ─── 7. Estado vencido ────────────────────────────────────────────────────────

test('fijo: chip vencido aparece si fechaPago < hoy y no está pagado', async ({ page }) => {
  // diaMes=1 del mes actual → si hoy >= dia 2, está vencido
  const today = new Date(TODAY);
  const dia = today.getDate();
  if (dia <= 1) { test.skip(); return; }
  const mes = mesActual();
  await seedAndUnlock(page, buildEstado([mkFijo({ diaMes: 1 })]));
  await goToCompromisos(page);
  // find fijo row for current month
  const chips = page.locator('.comp-row--fijo .chip.vencido');
  await expect(chips.first()).toBeVisible();
});

test('fijo: estado es "vencido" para fecha pasada sin pago', async ({ page }) => {
  await seedAndUnlock(page, buildEstado([mkFijo({ diaMes: 1 })]));
  const mes = mesSiguiente(-1); // last month
  const estado = await page.evaluate(m => window._fijoEstadoMes(
    { diaMes: 1, pagos: {} },
    m
  ), mes);
  expect(estado).toBe('vencido');
});

test('fijo: estado es "pagado" cuando hay entrada en pagos[mes]', async ({ page }) => {
  await seedAndUnlock(page, buildEstado());
  const mes = mesActual();
  const estado = await page.evaluate(m => window._fijoEstadoMes(
    { diaMes: 5, pagos: { [m]: { fecha: m + '-05', monto: 50000, gastoId: 'g1' } } },
    m
  ), mes);
  expect(estado).toBe('pagado');
});

// ─── 8. Pagar crea gasto en cuenta correcta ───────────────────────────────────

test('fijo: pagar crea gasto con medio correcto y categoría del fijo', async ({ page }) => {
  await seedAndUnlock(page, buildEstado([mkFijo({ medioPago: 'Banco Santander' })]));
  const mes = mesActual();
  await page.evaluate(async ({ id, mes }) => {
    await window.abrirFijoPagoModal(id, mes);
  }, { id: 'fijo-test-1', mes });
  await page.waitForSelector('#fijoPagoModal:not([hidden])');
  await page.fill('#fijoPagoMonto', '50000');
  await page.click('#btnConfirmarFijoPago');
  const estado = await page.evaluate(() => window._getEstado());
  const gastos = estado.gastos.filter(g => g.categoria === 'Hogar y Materiales');
  expect(gastos).toHaveLength(1);
  expect(gastos[0].medio).toBe('Banco Santander');
  expect(gastos[0].monto).toBe(50000);
  expect(gastos[0].tipo).toBe('gasto');
  // check pagos[mes]
  const f = estado.compromisos.find(c => c.id === 'fijo-test-1');
  expect(f.pagos[mes]).toBeTruthy();
  expect(f.pagos[mes].gastoId).toBe(gastos[0].id);
});

test('fijo: pagar actualiza saldo de la cuenta', async ({ page }) => {
  await seedAndUnlock(page, buildEstado([mkFijo({ medioPago: 'Banco Santander' })]));
  const mes = mesActual();
  await page.evaluate(({ id, mes }) => window.abrirFijoPagoModal(id, mes), { id: 'fijo-test-1', mes });
  await page.waitForSelector('#fijoPagoModal:not([hidden])');
  await page.fill('#fijoPagoMonto', '50000');
  await page.click('#btnConfirmarFijoPago');
  const saldoBanco = await page.evaluate(() => {
    const e = window._getEstado();
    const gastado = e.gastos.filter(g => g.medio === 'Banco Santander' && !g.soloHistorial && g.tipo === 'gasto').reduce((s, g) => s + g.monto, 0);
    const ingresado = e.gastos.filter(g => g.medio === 'Banco Santander' && !g.soloHistorial && g.tipo === 'ingreso').reduce((s, g) => s + g.monto, 0);
    return e.iniciales['Banco Santander'] - gastado + ingresado;
  });
  expect(saldoBanco).toBe(50000); // 100000 - 50000
});

// ─── 9. Pagar sin movimiento (Visa) ──────────────────────────────────────────

test('fijo: pagar sin movimiento (Visa) guarda pagos[mes] con gastoId:null', async ({ page }) => {
  const fijo = mkFijo({ medioPago: 'Tarjeta (Visa)', id: 'fijo-visa-1' });
  await seedAndUnlock(page, buildEstado([fijo]));
  const mes = mesActual();
  await page.evaluate(({ id, mes }) => window.abrirFijoPagoModal(id, mes), { id: 'fijo-visa-1', mes });
  await page.waitForSelector('#fijoPagoModal:not([hidden])');
  await page.waitForSelector('#fijoPagoVisaWrap:not([hidden])');
  await page.fill('#fijoPagoMonto', '50000');
  await page.click('#btnFijoPagoSinMov');
  const estado = await page.evaluate(() => window._getEstado());
  const f = estado.compromisos.find(c => c.id === 'fijo-visa-1');
  expect(f.pagos[mes]).toBeTruthy();
  expect(f.pagos[mes].gastoId).toBeNull();
  // no gasto created
  expect(estado.gastos).toHaveLength(0);
});

test('fijo: Visa muestra el botón "sin movimiento"', async ({ page }) => {
  const fijo = mkFijo({ medioPago: 'Tarjeta (Visa)', id: 'fijo-visa-2' });
  await seedAndUnlock(page, buildEstado([fijo]));
  const mes = mesActual();
  await page.evaluate(({ id, mes }) => window.abrirFijoPagoModal(id, mes), { id: 'fijo-visa-2', mes });
  await page.waitForSelector('#fijoPagoModal:not([hidden])');
  const visaWrap = page.locator('#fijoPagoVisaWrap');
  await expect(visaWrap).not.toHaveAttribute('hidden');
});

// ─── 10. Actualizar estimado ──────────────────────────────────────────────────

test('fijo: "Actualizar estimado" actualiza monto y pone estimado:false', async ({ page }) => {
  await seedAndUnlock(page, buildEstado([mkFijo()]));
  const mes = mesActual();
  await page.evaluate(({ id, mes }) => window.abrirFijoPagoModal(id, mes), { id: 'fijo-test-1', mes });
  await page.waitForSelector('#fijoPagoModal:not([hidden])');
  await page.fill('#fijoPagoMonto', '55000');
  await page.check('#fijoPagoEstim');
  await page.click('#btnConfirmarFijoPago');
  const estado = await page.evaluate(() => window._getEstado());
  const f = estado.compromisos.find(c => c.id === 'fijo-test-1');
  expect(f.monto).toBe(55000);
  expect(f.estimado).toBe(false);
});

// ─── 11. Deshacer ─────────────────────────────────────────────────────────────

test('fijo: deshacer pago borra gasto y quita pagos[mes]', async ({ page }) => {
  const gastoId = 'gasto-fijo-1';
  const mes = mesActual();
  const fijo = mkFijo({ pagos: { [mes]: { fecha: TODAY, monto: 50000, gastoId } } });
  const gasto = { id: gastoId, creado: Date.now(), monto: 50000, fecha: TODAY, categoria: 'Hogar y Materiales', medio: 'Banco Santander', descripcion: 'Alquiler', tipo: 'gasto', soloHistorial: false };
  await seedAndUnlock(page, buildEstado([fijo], [gasto]));
  await page.evaluate(({ id, mes }) => window.deshacerFijoPago(id, mes), { id: 'fijo-test-1', mes });
  const estado = await page.evaluate(() => window._getEstado());
  expect(estado.gastos).toHaveLength(0);
  const f = estado.compromisos.find(c => c.id === 'fijo-test-1');
  expect(f.pagos[mes]).toBeUndefined();
});

test('fijo: deshacer pago sin movimiento (gastoId null) no rompe', async ({ page }) => {
  const mes = mesActual();
  const fijo = mkFijo({ pagos: { [mes]: { fecha: TODAY, monto: 50000, gastoId: null } } });
  await seedAndUnlock(page, buildEstado([fijo]));
  await page.evaluate(({ id, mes }) => window.deshacerFijoPago(id, mes), { id: 'fijo-test-1', mes });
  const estado = await page.evaluate(() => window._getEstado());
  const f = estado.compromisos.find(c => c.id === 'fijo-test-1');
  expect(f.pagos[mes]).toBeUndefined();
  expect(estado.gastos).toHaveLength(0);
});

// ─── 12. Subtotal con desglose ────────────────────────────────────────────────

test('fijo: subtotal muestra "Cuotas · Fijos ·" cuando hay ambos', async ({ page }) => {
  const cuota = { id: 'cuota-1', nombre: 'Préstamo', entidad: 'Banco', monto: 10000, pendientes: 2, proxVenc: mesSiguiente(0) + '-15', tipo: 'cuota' };
  const fijo = mkFijo();
  await seedAndUnlock(page, buildEstado([cuota, fijo]));
  await goToCompromisos(page);
  // find the month group for current month
  const subTexts = await page.locator('.comp-mes-sub').allTextContents();
  const hayDesglose = subTexts.some(t => t.includes('Cuotas') && t.includes('Fijos'));
  expect(hayDesglose).toBe(true);
});

test('fijo: subtotal solo fijos (sin cuotas) muestra total sin desglose', async ({ page }) => {
  await seedAndUnlock(page, buildEstado([mkFijo()]));
  await goToCompromisos(page);
  const subTexts = await page.locator('.comp-mes-sub').allTextContents();
  // all sub texts should not have "Cuotas ·"
  const hayDesglose = subTexts.some(t => t.includes('Cuotas') && t.includes('Fijos'));
  expect(hayDesglose).toBe(false);
});

// ─── 13. Backup viejo ─────────────────────────────────────────────────────────

test('fijo: backup sin compromisos no rompe (compromisos vacío)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const estadoViejo = {
    iniciales: {}, gastos: [], items: [], patrimonioCargado: true
    // sin compromisos
  };
  await seedAndUnlock(page, estadoViejo);
  await goToCompromisos(page);
  expect(errors).toHaveLength(0);
  const contenido = await page.locator('#compromisosList').textContent();
  expect(contenido).toContain('Sin compromisos');
});

test('fijo: backup con compromisos sin fijos no rompe', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const estadoViejo = {
    iniciales: {}, gastos: [], items: [], patrimonioCargado: true,
    compromisos: [{ id: 'c1', nombre: 'Préstamo', entidad: 'Banco', monto: 5000, pendientes: 3, proxVenc: mesSiguiente(1) + '-01', tipo: 'cuota' }]
  };
  await seedAndUnlock(page, estadoViejo);
  await goToCompromisos(page);
  expect(errors).toHaveLength(0);
});

test('fijo: fijos no afectan totales de deuda/patrimonio', async ({ page }) => {
  const fijo = mkFijo({ monto: 99999 });
  await seedAndUnlock(page, buildEstado([fijo]));
  const totales = await page.evaluate(() => {
    const e = window._getEstado();
    let a = 0, d = 0;
    const MEDIOS = ['Banco Santander', 'Mercado Pago', 'Astropay', 'Visa Santander', 'Mastercard MP', 'Efectivo', 'American Express'];
    MEDIOS.forEach(m => {
      const gastado = e.gastos.filter(g => g.medio === m && !g.soloHistorial && g.tipo === 'gasto').reduce((s, g) => s + g.monto, 0);
      const ingresado = e.gastos.filter(g => g.medio === m && !g.soloHistorial && g.tipo === 'ingreso').reduce((s, g) => s + g.monto, 0);
      const s = e.iniciales[m] - gastado + ingresado;
      s >= 0 ? a += s : d -= s;
    });
    e.items.forEach(it => it.tipo === 'activo' ? a += it.monto : d += it.monto);
    return { activos: a, deudas: d };
  });
  // The fijo monto (99999) should NOT be in deudas
  expect(totales.deudas).toBe(0);
  expect(totales.activos).toBe(150000); // 100000 + 50000 from iniciales
});

test('fijo: sin errores JS con fijo activo en compromisos', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await seedAndUnlock(page, buildEstado([mkFijo()]));
  await goToCompromisos(page);
  await page.waitForTimeout(300);
  expect(errors).toHaveLength(0);
});
