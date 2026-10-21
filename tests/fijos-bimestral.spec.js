// Tests para gastos fijos con cadaMeses (bimestral, trimestral, etc.)
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
  while (nm < 1)  { ny--; nm += 12; }
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

function buildEstado(compromisos = []) {
  return {
    iniciales: { 'Banco Santander': 100000, 'Mercado Pago': 50000, 'Astropay': 0, 'Visa Santander': 0, 'Mastercard MP': 0, 'Efectivo': 0, 'American Express': 0 },
    gastos: [], items: [], patrimonioCargado: true, compromisos,
  };
}

function mkFijoBimestral(mesBase, overrides = {}) {
  return {
    id: 'fijo-bim-1',
    tipo: 'fijo',
    nombre: 'Patente ARBA',
    categoria: 'Impuestos',
    monto: 12000,
    estimado: true,
    diaMes: 10,
    medioPago: null,
    palabrasClave: '',
    activo: true,
    pagos: {},
    cadaMeses: 2,
    mesBase,
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

// ─── _fijoMesCorresponde lógica pura ────────────────────────────────────────

test('bimestral: _fijoMesCorresponde devuelve true para mesBase == mesStr', async ({ page }) => {
  await seedAndUnlock(page, buildEstado());
  const mes = mesActual();
  const result = await page.evaluate(({ fijo, mes }) => window._fijoMesCorresponde(fijo, mes),
    { fijo: mkFijoBimestral(mes), mes });
  expect(result).toBe(true);
});

test('bimestral: _fijoMesCorresponde devuelve false para mes+1 (no múltiplo)', async ({ page }) => {
  await seedAndUnlock(page, buildEstado());
  const base = mesActual();
  const siguiente = mesSig(1);
  const result = await page.evaluate(({ fijo, mes }) => window._fijoMesCorresponde(fijo, mes),
    { fijo: mkFijoBimestral(base), mes: siguiente });
  expect(result).toBe(false);
});

test('bimestral: _fijoMesCorresponde devuelve true para mes+2 (múltiplo)', async ({ page }) => {
  await seedAndUnlock(page, buildEstado());
  const base = mesActual();
  const dos = mesSig(2);
  const result = await page.evaluate(({ fijo, mes }) => window._fijoMesCorresponde(fijo, mes),
    { fijo: mkFijoBimestral(base), mes: dos });
  expect(result).toBe(true);
});

test('bimestral: mesBase dos meses atrás corresponde al mes actual', async ({ page }) => {
  await seedAndUnlock(page, buildEstado());
  const base = mesSig(-2);
  const result = await page.evaluate(({ fijo, mes }) => window._fijoMesCorresponde(fijo, mes),
    { fijo: mkFijoBimestral(base), mes: mesActual() });
  expect(result).toBe(true);
});

test('bimestral: mesBase un mes atrás NO corresponde al mes actual', async ({ page }) => {
  await seedAndUnlock(page, buildEstado());
  const base = mesSig(-1);
  const result = await page.evaluate(({ fijo, mes }) => window._fijoMesCorresponde(fijo, mes),
    { fijo: mkFijoBimestral(base), mes: mesActual() });
  expect(result).toBe(false);
});

// ─── Integración en renderCompromisos ────────────────────────────────────────

test('bimestral: fijo cadaMeses=2 con mesBase=mesActual aparece una sola vez en los 3 meses', async ({ page }) => {
  await seedAndUnlock(page, buildEstado([mkFijoBimestral(mesActual())]));
  await goToCompromisos(page);
  // Aparece en mes actual y mes+2, NO en mes+1 → 2 filas de las 3 posibles
  const count = await page.locator('.comp-row--fijo').count();
  expect(count).toBe(2);
});

test('bimestral: fijo cadaMeses=2 con mesBase=mes+1 aparece en mes+1 pero NO en mesActual', async ({ page }) => {
  const base = mesSig(1);
  await seedAndUnlock(page, buildEstado([mkFijoBimestral(base)]));
  await goToCompromisos(page);
  // Aparece en mes+1 y (si aplica) mes+3, pero mes+3 > ventana de 3 meses
  // Ventana: mesActual, mes+1, mes+2
  // base=mes+1 → mes+1 corresponde (diff=0), mesActual (diff=-1 no múltiplo), mes+2 (diff=1 no múltiplo)
  const count = await page.locator('.comp-row--fijo').count();
  expect(count).toBe(1);
});

test('bimestral: fijo sin cadaMeses (mensual, backup viejo) sigue apareciendo en 3 meses', async ({ page }) => {
  const fijo = mkFijoBimestral(mesActual());
  delete fijo.cadaMeses;
  delete fijo.mesBase;
  await seedAndUnlock(page, buildEstado([fijo]));
  await goToCompromisos(page);
  const count = await page.locator('.comp-row--fijo').count();
  expect(count).toBe(3);
});

test('bimestral: la fila muestra "cada 2 meses" en la meta', async ({ page }) => {
  await seedAndUnlock(page, buildEstado([mkFijoBimestral(mesActual())]));
  await goToCompromisos(page);
  const txt = await page.locator('.comp-row--fijo').first().textContent();
  expect(txt).toContain('cada 2 meses');
});
