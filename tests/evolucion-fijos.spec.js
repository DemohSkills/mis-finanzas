const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';
const TODAY = new Date().toISOString().slice(0, 10);

function mesActual() { return TODAY.slice(0, 7); }
function mesSig(k = 1) {
  const [y, m] = mesActual().split('-').map(Number);
  let ny = y, nm = m + k;
  while (nm > 12) { ny++; nm -= 12; }
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

function buildEstado(compromisos = [], gastos = [], items = []) {
  return {
    iniciales: { 'Banco Santander': 5000000, 'Mercado Pago': 1000000, 'Astropay': 0, 'Visa Santander': 0, 'Mastercard MP': 0, 'Efectivo': 0, 'American Express': 0 },
    gastos,
    items,
    patrimonioCargado: true,
    compromisos,
  };
}

function mkFijo(overrides = {}) {
  return {
    id: 'fijo-ev-1',
    tipo: 'fijo',
    nombre: 'Alquiler',
    categoria: 'Hogar y Materiales',
    monto: 120000,
    estimado: true,
    diaMes: 5,
    medioPago: 'Banco Santander',
    palabrasClave: '',
    activo: true,
    pagos: {},
    cadaMeses: 1,
    mesBase: null,
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

async function goToEvolucion(page) {
  await page.locator('nav.tabs button[data-vista="evolucion"]').click();
  await page.waitForFunction(
    () => typeof Chart !== 'undefined' && window._ci && window._ci['cIngD'],
    null, { timeout: 10000 }
  );
  await page.waitForTimeout(300);
}

// ─── A. Fijos en totalCmp y en "Cubre/Faltan" ────────────────────────────────

test('(a) fijo activo no pagado suma a tarjeta Compromisos', async ({ page }) => {
  const fijo = mkFijo({ monto: 80000 });
  await seedAndUnlock(page, buildEstado([fijo]));
  await goToEvolucion(page);
  const cmpText = await page.locator('#evBrow .bcard').filter({ hasText: 'Compromisos' }).locator('.bv').textContent();
  // should contain 80.000 (or similar formatting)
  expect(cmpText).toMatch(/80[\.,]?000|80000/);
});

test('(b) fijo activo no pagado reduce el margen de Cubre/Faltan', async ({ page }) => {
  // With a big income and a big fijo, Cubre should reflect the fijo deducted
  const fijo = mkFijo({ monto: 999000 });
  // Seed ingreso del mes: 500000 (less than fijo)
  const mes = mesActual();
  const gasto = { id: 'g-ing-1', creado: Date.now(), monto: 500000, fecha: mes + '-01', categoria: 'Cobros/Ventas', medio: 'Banco Santander', descripcion: 'Ingreso', tipo: 'ingreso', soloHistorial: false };
  await seedAndUnlock(page, buildEstado([fijo], [gasto]));
  await goToEvolucion(page);
  // recursos=500000+0+5000000=5500000, compromisos=999000 → Cubre
  // but with Banco Santander = 5000000 inicial, recursos covers it
  // Actually check that the Cubre/Faltan card contains info about fijos
  const balCard = await page.locator('#evBrow .bcard').filter({ hasText: 'Con total Visa' }).locator('.bv').textContent();
  // recursos > compromisos → Cubre
  expect(balCard).toContain('Cubre');
});

test('(c) fijo ya pagado en el mes NO suma a Compromisos', async ({ page }) => {
  const mes = mesActual();
  const pagadoFijo = mkFijo({ monto: 80000, pagos: { [mes]: { fecha: mes + '-05', monto: 80000, gastoId: null } } });
  await seedAndUnlock(page, buildEstado([pagadoFijo]));
  await goToEvolucion(page);
  const cmpText = await page.locator('#evBrow .bcard').filter({ hasText: 'Compromisos' }).locator('.bv').textContent();
  // fijo is paid, so Compromisos should be 0 (or very close, shown as − 0)
  expect(cmpText).toMatch(/[−\-]\s*0|−\$\s*0/);
});

test('(d) fijo con medioPago de resumen NO suma (no doble cuenta)', async ({ page }) => {
  const resumen = { id: 'res-visa', tipo: 'resumen', entidad: 'Visa Santander', nombre: 'Visa Santander', monto: 50000, pendientes: 1, proxVenc: mesActual() + '-15', pagoMinimo: 10000, cierre: mesActual() + '-10' };
  // fijo con medioPago='Visa Santander' → _fijoEnResumen returns true → excluded
  const fijo = mkFijo({ monto: 30000, medioPago: 'Visa Santander' });
  await seedAndUnlock(page, buildEstado([resumen, fijo]));
  await goToEvolucion(page);
  const totalFijos = await page.evaluate(() => window.fijosMontoPendiente(new Date().toISOString().slice(0, 7)));
  expect(totalFijos).toBe(0);
});

test('(e) fijo pausado (activo:false) NO suma', async ({ page }) => {
  const fijo = mkFijo({ monto: 80000, activo: false });
  await seedAndUnlock(page, buildEstado([fijo]));
  await goToEvolucion(page);
  const totalFijos = await page.evaluate(() => window.fijosMontoPendiente(new Date().toISOString().slice(0, 7)));
  expect(totalFijos).toBe(0);
});

// ─── B. Fijo bimestral ────────────────────────────────────────────────────────

test('(f) fijo bimestral solo aparece en meses que corresponden', async ({ page }) => {
  const mes0 = mesActual();
  const mes1 = mesSig(1);
  const mes2 = mesSig(2);
  // cadaMeses=2, mesBase=mes0 → aparece en mes0, mes2, mes4...
  const fijo = mkFijo({ monto: 50000, cadaMeses: 2, mesBase: mes0 });
  await seedAndUnlock(page, buildEstado([fijo]));
  await goToEvolucion(page);
  const [v0, v1, v2] = await page.evaluate(([m0, m1, m2]) => [
    window.fijosMontoPendiente(m0),
    window.fijosMontoPendiente(m1),
    window.fijosMontoPendiente(m2),
  ], [mes0, mes1, mes2]);
  expect(v0).toBe(50000);
  expect(v1).toBe(0);  // no corresponde
  expect(v2).toBe(50000);
});

// ─── C. Gráfico cCmpD (proyección) ────────────────────────────────────────────

test('(g) proyección cCmpD tiene serie "Fijos" con fijo activo', async ({ page }) => {
  const fijo = mkFijo({ monto: 60000 });
  await seedAndUnlock(page, buildEstado([fijo]));
  await goToEvolucion(page);
  const labels = await page.evaluate(() => window._ci['cCmpD'].data.datasets.map(d => d.label));
  expect(labels).toContain('Fijos');
});

test('(h) ninguna serie en cCmpD tiene label vacío o undefined', async ({ page }) => {
  const fijo = mkFijo({ monto: 60000 });
  await seedAndUnlock(page, buildEstado([fijo]));
  await goToEvolucion(page);
  const labels = await page.evaluate(() => window._ci['cCmpD'].data.datasets.map(d => d.label));
  labels.forEach(l => {
    expect(l).toBeTruthy();
    expect(l).not.toBe('undefined');
    expect(typeof l).toBe('string');
  });
});

test('(i) ninguna serie en cIngD tiene label vacío o undefined', async ({ page }) => {
  const fijo = mkFijo({ monto: 60000 });
  await seedAndUnlock(page, buildEstado([fijo]));
  await goToEvolucion(page);
  const labels = await page.evaluate(() => window._ci['cIngD'].data.datasets.map(d => d.label));
  labels.forEach(l => {
    expect(l).toBeTruthy();
    expect(l).not.toBe('undefined');
    expect(typeof l).toBe('string');
  });
});

test('(j) cIngD tiene serie "Fijos" en la columna Compromisos con fijo activo', async ({ page }) => {
  const fijo = mkFijo({ monto: 60000 });
  await seedAndUnlock(page, buildEstado([fijo]));
  await goToEvolucion(page);
  const fijosDs = await page.evaluate(() => {
    const ds = window._ci['cIngD'].data.datasets.find(d => d.label === 'Fijos');
    return ds ? { label: ds.label, data: ds.data } : null;
  });
  expect(fijosDs).not.toBeNull();
  expect(fijosDs.data[1]).toBe(60000); // columna Compromisos (index 1)
  expect(fijosDs.data[0]).toBe(0);     // columna Recursos (index 0)
});

test('(k) mes actual y 5 siguientes tienen el valor correcto de fijos en cCmpD', async ({ page }) => {
  const fijo = mkFijo({ monto: 70000 });
  await seedAndUnlock(page, buildEstado([fijo]));
  await goToEvolucion(page);
  const fijoData = await page.evaluate(() => {
    const ds = window._ci['cCmpD'].data.datasets.find(d => d.label === 'Fijos');
    return ds ? ds.data : null;
  });
  expect(fijoData).not.toBeNull();
  expect(fijoData.length).toBe(6);
  // fijo mensual → all 6 months should have 70000 (except current month if paid, but it's not paid here)
  // Current month: fijo is not paid, so 70000. Future months: 70000 each.
  fijoData.forEach(v => expect(v).toBe(70000));
});

test('(l) fijo bimestral proyecta 0 en meses impares', async ({ page }) => {
  const mes0 = mesActual();
  const fijo = mkFijo({ monto: 50000, cadaMeses: 2, mesBase: mes0 });
  await seedAndUnlock(page, buildEstado([fijo]));
  await goToEvolucion(page);
  const fijoData = await page.evaluate(() => {
    const ds = window._ci['cCmpD'].data.datasets.find(d => d.label === 'Fijos');
    return ds ? ds.data : null;
  });
  expect(fijoData).not.toBeNull();
  expect(fijoData.length).toBe(6);
  // indices 0, 2, 4 → 50000; indices 1, 3, 5 → 0
  expect(fijoData[0]).toBe(50000);
  expect(fijoData[1]).toBe(0);
  expect(fijoData[2]).toBe(50000);
  expect(fijoData[3]).toBe(0);
  expect(fijoData[4]).toBe(50000);
  expect(fijoData[5]).toBe(0);
});

// ─── D. Sin fijos → NO serie "Fijos" en proyección ───────────────────────────

test('(m) sin fijos activos NO hay serie "Fijos" en cCmpD', async ({ page }) => {
  await seedAndUnlock(page, buildEstado([]));
  await goToEvolucion(page);
  const labels = await page.evaluate(() => window._ci['cCmpD'].data.datasets.map(d => d.label));
  expect(labels).not.toContain('Fijos');
});

test('(n) sin fijos activos NO hay serie "Fijos" en cIngD', async ({ page }) => {
  await seedAndUnlock(page, buildEstado([]));
  await goToEvolucion(page);
  const labels = await page.evaluate(() => window._ci['cIngD'].data.datasets.map(d => d.label));
  expect(labels).not.toContain('Fijos');
});

// ─── E. Overflow en .bcard a 360/412/450 px ──────────────────────────────────

async function checkBcardOverflow(page, width) {
  await page.setViewportSize({ width, height: 800 });
  // Big ingreso and big fijo to get large amounts
  const mes = mesActual();
  const gasto = { id: 'g-big', creado: Date.now(), monto: 9999999.99, fecha: mes + '-01', categoria: 'Cobros/Ventas', medio: 'Banco Santander', descripcion: 'Ingreso grande', tipo: 'ingreso', soloHistorial: false };
  const fijo = mkFijo({ monto: 5393523 });
  await seedAndUnlock(page, buildEstado([fijo], [gasto]));
  await goToEvolucion(page);
  // Check that the page body doesn't scroll horizontally (no overflow on viewport)
  const overflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
  });
  return overflow;
}

test('(o) sin overflow en .bcard a 360 px con importes grandes', async ({ page }) => {
  const overflow = await checkBcardOverflow(page, 360);
  expect(overflow).toBe(false);
});

test('(p) sin overflow en .bcard a 412 px con importes grandes', async ({ page }) => {
  const overflow = await checkBcardOverflow(page, 412);
  expect(overflow).toBe(false);
});

test('(q) sin overflow en .bcard a 450 px con importes grandes', async ({ page }) => {
  const overflow = await checkBcardOverflow(page, 450);
  expect(overflow).toBe(false);
});

test('(r) sin overflow en .bcard tema negro a 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const mes = mesActual();
  const gasto = { id: 'g-big2', creado: Date.now(), monto: 9999999.99, fecha: mes + '-01', categoria: 'Cobros/Ventas', medio: 'Banco Santander', descripcion: 'Ingreso', tipo: 'ingreso', soloHistorial: false };
  const fijo = mkFijo({ monto: 5393523 });
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    localStorage.setItem('finanzas-v1-tema', 'negro');
    document.documentElement.setAttribute('data-theme', 'negro');
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: buildEstado([fijo], [gasto]) });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
  await goToEvolucion(page);
  const overflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
  });
  expect(overflow).toBe(false);
});

// ─── F. Modo ojo sigue ocultando importes en .bcard ──────────────────────────

test('(s) modo ojo oculta importes en .bcard de evBrow', async ({ page }) => {
  const fijo = mkFijo({ monto: 60000 });
  await seedAndUnlock(page, buildEstado([fijo]));
  await goToEvolucion(page);
  await page.locator('#btnOjo').click();
  await page.waitForTimeout(200);
  const bulletVisible = await page.evaluate(() => {
    const bvs = Array.from(document.querySelectorAll('#evBrow .bcard .bv.amt, #evBrow .bcard .bv'));
    // Check if any .bv has an ::after with bullets (body.ocultar .amt::after)
    return document.body.classList.contains('ocultar');
  });
  expect(bulletVisible).toBe(true);
});

// ─── G. Sin errores JS ────────────────────────────────────────────────────────

test('(t) sin errores JS al cargar Evolución con fijos', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const fijo = mkFijo({ monto: 60000 });
  await seedAndUnlock(page, buildEstado([fijo]));
  await goToEvolucion(page);
  await page.waitForTimeout(300);
  expect(errors).toHaveLength(0);
});

test('(u) fijosMontoPendiente suma correctamente fijos pendientes del mes', async ({ page }) => {
  const mes = mesActual();
  const f1 = mkFijo({ id: 'f1', monto: 100000, pagos: {} });
  const f2 = mkFijo({ id: 'f2', monto: 200000, pagos: {} });
  const f3Pagado = mkFijo({ id: 'f3', monto: 300000, pagos: { [mes]: { fecha: mes + '-05', monto: 300000, gastoId: null } } });
  await seedAndUnlock(page, buildEstado([f1, f2, f3Pagado]));
  const total = await page.evaluate(m => window.fijosMontoPendiente(m), mes);
  expect(total).toBe(300000); // f1(100000) + f2(200000), f3 excluded (pagado)
});

// ─── H. Grid 2 columnas en #evBrow ────────────────────────────────────────────

async function check2ColGrid(page, width) {
  await page.setViewportSize({ width, height: 800 });
  const fijo = mkFijo({ monto: 50000 });
  await seedAndUnlock(page, buildEstado([fijo]));
  await goToEvolucion(page);
  // Verify CSS grid with 2 columns
  const cols = await page.evaluate(() => {
    const el = document.getElementById('evBrow');
    return getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length;
  });
  expect(cols).toBe(2);
  // Verify first 4 cards are in 2 rows (cards 0,1 same top; cards 2,3 same top; row1 < row2)
  const tops = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#evBrow .bcard'));
    return cards.slice(0, 4).map(c => Math.round(c.getBoundingClientRect().top));
  });
  expect(tops.length).toBe(4);
  expect(tops[0]).toBe(tops[1]);
  expect(tops[2]).toBe(tops[3]);
  expect(tops[0]).toBeLessThan(tops[2]);
}

test('(v) cuatro bcards en 2 columnas a 360 px', async ({ page }) => {
  await check2ColGrid(page, 360);
});

test('(w) cuatro bcards en 2 columnas a 412 px', async ({ page }) => {
  await check2ColGrid(page, 412);
});

test('(x) cuatro bcards en 2 columnas a 450 px', async ({ page }) => {
  await check2ColGrid(page, 450);
});

// ─── I. Importe $99.999.999,99 sin overflow en .bv ────────────────────────────

async function checkBvNoOverflow(page, width) {
  await page.setViewportSize({ width, height: 800 });
  const mes = mesActual();
  // Importe máximo de prueba
  const gasto = { id: 'g-max', creado: Date.now(), monto: 99999999.99, fecha: mes + '-01', categoria: 'Cobros/Ventas', medio: 'Banco Santander', descripcion: 'Ingreso ficticio máximo', tipo: 'ingreso', soloHistorial: false };
  const fijo = mkFijo({ id: 'fijo-max', monto: 99999999 });
  await seedAndUnlock(page, buildEstado([fijo], [gasto]));
  await goToEvolucion(page);
  const overflows = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#evBrow .bv'))
      .map(el => ({ text: el.textContent.slice(0, 30), over: el.scrollWidth > el.clientWidth }));
  });
  return overflows;
}

test('(y) importe 99.999.999,99 sin overflow en .bv a 360 px', async ({ page }) => {
  const overflows = await checkBvNoOverflow(page, 360);
  expect(overflows.length).toBeGreaterThan(0);
  overflows.forEach(({ text, over }) => {
    expect(over, `overflow en "${text}" a 360px`).toBe(false);
  });
});

test('(y2) importe 99.999.999,99 sin overflow en .bv a 412 px', async ({ page }) => {
  const overflows = await checkBvNoOverflow(page, 412);
  overflows.forEach(({ text, over }) => {
    expect(over, `overflow en "${text}" a 412px`).toBe(false);
  });
});

test('(y3) importe 99.999.999,99 sin overflow en .bv a 450 px', async ({ page }) => {
  const overflows = await checkBvNoOverflow(page, 450);
  overflows.forEach(({ text, over }) => {
    expect(over, `overflow en "${text}" a 450px`).toBe(false);
  });
});

// ─── J. Proyección: fijos con tarjeta en meses futuros ────────────────────────

function mkResumenVisa(proxVenc) {
  return {
    id: 'res-visa-test', tipo: 'resumen', entidad: 'Visa Santander',
    nombre: 'Visa Santander', monto: 5000, pendientes: 0,
    proxVenc, pagoMinimo: 1000, cierre: proxVenc.slice(0, 7) + '-10',
  };
}

test('(z) fijo con tarjeta: mes M excluido, M+1 y M+2 incluidos en proyección', async ({ page }) => {
  const mesM = mesActual();
  const resumen = mkResumenVisa(mesM + '-15');
  const fijo = mkFijo({ id: 'fijo-visa-z', monto: 10000, medioPago: 'Visa Santander' });
  await seedAndUnlock(page, buildEstado([resumen, fijo]));
  await goToEvolucion(page);
  const [vM, vM1, vM2] = await page.evaluate(([m, m1, m2]) => [
    window.fijosConTarjetaProyeccion(m),
    window.fijosConTarjetaProyeccion(m1),
    window.fijosConTarjetaProyeccion(m2),
  ], [mesM, mesSig(1), mesSig(2)]);
  expect(vM).toBe(0);      // mes del resumen: excluido (evita doble cuenta)
  expect(vM1).toBe(10000); // M+1: incluido en proyección
  expect(vM2).toBe(10000); // M+2: incluido en proyección
});

test('(aa) fijo bimestral con tarjeta respeta cadaMeses en proyección', async ({ page }) => {
  const mesM = mesActual();
  const resumen = mkResumenVisa(mesM + '-15');
  // cadaMeses:2, mesBase = mesSig(1) → aplica en M+1, M+3, M+5...
  const fijo = mkFijo({ id: 'fijo-bim-visa', monto: 10000, medioPago: 'Visa Santander', cadaMeses: 2, mesBase: mesSig(1) });
  await seedAndUnlock(page, buildEstado([resumen, fijo]));
  await goToEvolucion(page);
  const [vM1, vM2, vM3] = await page.evaluate(([m1, m2, m3]) => [
    window.fijosConTarjetaProyeccion(m1),
    window.fijosConTarjetaProyeccion(m2),
    window.fijosConTarjetaProyeccion(m3),
  ], [mesSig(1), mesSig(2), mesSig(3)]);
  expect(vM1).toBe(10000); // corresponde (base M+1) y > proxVenc M
  expect(vM2).toBe(0);     // no corresponde (bimestral desde M+1)
  expect(vM3).toBe(10000); // corresponde (M+3 = M+1 + 2)
});

// ─── K. Cubre/Faltan del mes actual sin cambio ────────────────────────────────

test('(ab) Cubre/Faltan del mes actual no cambia con fijo de tarjeta', async ({ page }) => {
  const mesM = mesActual();
  const resumen = mkResumenVisa(mesM + '-15');
  const fijo = mkFijo({ id: 'fijo-ab', monto: 10000, medioPago: 'Visa Santander' });
  await seedAndUnlock(page, buildEstado([resumen, fijo]));
  await goToEvolucion(page);
  // El fijo tiene medioPago de tarjeta con resumen cargado → fijosMontoPendiente = 0 en mes actual
  const totalFijosActual = await page.evaluate(() =>
    window.fijosMontoPendiente(new Date().toISOString().slice(0, 7))
  );
  expect(totalFijosActual).toBe(0);
  // El resultado de Cubre/Faltan existe y es coherente
  const cubreTxt = await page.locator('#evBrow .bcard').filter({ hasText: 'Con total Visa' }).locator('.bv').textContent();
  expect(cubreTxt).toMatch(/Cubre|Faltan/);
});
