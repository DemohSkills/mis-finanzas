// @ts-check
// Tests para PARTE 2: fijos pagados con tarjeta que tiene resumen no deben contarse dos veces
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';
const TODAY = new Date().toISOString().slice(0, 10);

function daysAfter(n) {
  const d = new Date(TODAY); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10);
}

const VENC = daysAfter(10);
const CIERRE_MES = TODAY.slice(0, 8) + '01';

function buildEstado({ fijoMedioPago = 'Visa Santander', resumenEntidad = 'Visa Santander' } = {}) {
  return {
    iniciales: { 'Banco Santander': 100000, 'Visa Santander': -50000 },
    gastos: [],
    items: [],
    patrimonioCargado: true,
    compromisos: [
      {
        id: 'res-1',
        nombre: 'Visa 4321',
        entidad: resumenEntidad,
        monto: 80000,
        pagoMinimo: 15000,
        pendientes: 1,
        proxVenc: VENC,
        tipo: 'resumen',
        cierre: CIERRE_MES,
        estimado: false,
      },
      {
        id: 'fijo-visa-1',
        tipo: 'fijo',
        nombre: 'Iplan',
        categoria: 'Servicios',
        monto: 12000,
        estimado: true,
        diaMes: 15,
        medioPago: fijoMedioPago,
        palabrasClave: '',
        activo: true,
        pagos: {},
      },
      {
        id: 'fijo-banco-1',
        tipo: 'fijo',
        nombre: 'Alquiler',
        categoria: 'Hogar y Materiales',
        monto: 50000,
        estimado: false,
        diaMes: 5,
        medioPago: 'Banco Santander',
        palabrasClave: '',
        activo: true,
        pagos: {},
      },
    ],
  };
}

async function seedAndUnlock(page, estado) {
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(500);
}

async function goToCompromisos(page) {
  await page.locator('nav.tabs button[data-vista="compromisos"]').click();
  await page.waitForSelector('#compromisosList');
}

// ─────────────────────────────────────────────────────────────
// CHIP "En el resumen de la tarjeta"
// ─────────────────────────────────────────────────────────────
test.describe('fijos-en-resumen: chip informativo', () => {
  test('fijo con medioPago=entidad de resumen → chip "En el resumen de la tarjeta"', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    // fijo aparece en varios meses; con .first() tomamos el primero
    const chip = page.locator('.comp-row--fijo[data-fijo-id="fijo-visa-1"] .chip.chip-tarjeta').first();
    await expect(chip).toBeVisible();
    expect(await chip.textContent()).toContain('resumen de la tarjeta');
  });

  test('fijo con medioPago distinto al de resumen → NO tiene chip chip-tarjeta', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    const count = await page.locator('.comp-row--fijo[data-fijo-id="fijo-banco-1"] .chip.chip-tarjeta').count();
    expect(count).toBe(0);
  });

  test('fijo en resumen sigue visible en la lista', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    await expect(page.locator('.comp-row--fijo[data-fijo-id="fijo-visa-1"]').first()).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────
// SUBTOTAL — exclusión del fijoTotal
// ─────────────────────────────────────────────────────────────
test.describe('fijos-en-resumen: subtotal no suma fijos en resumen', () => {
  test('subtotal del grupo muestra solo el fijo que NO está en resumen', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    // El grupo del mes actual (con ambos fijos) → el subtotal de Fijos solo debe mostrar Alquiler (50000)
    // Iplan (12000) está en el resumen → excluido
    // Usamos el texto del summary del grupo que tenga fijos
    const summaries = page.locator('.comp-mes summary');
    const count = await summaries.count();
    let found = false;
    for (let i = 0; i < count; i++) {
      const txt = await summaries.nth(i).textContent();
      if (txt.includes('Fijos') || txt.includes('50')) {
        // No debe contener 62 (50000 + 12000) ni mencionar Iplan en el subtotal de Fijos
        expect(txt).not.toMatch(/62\.000|62000/);
        found = true;
        break;
      }
    }
    // Asegurar que el grupo con fijos se encontró y examinó
    expect(found).toBe(true);
  });

  test('fijo con medioPago sin resumen → sigue sumando en subtotal', async ({ page }) => {
    // Solo el fijo de Banco Santander (50000) no tiene resumen, debe aparecer en el subtotal
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    const summaries = page.locator('.comp-mes summary');
    const count = await summaries.count();
    let textoTotal = '';
    for (let i = 0; i < count; i++) {
      const txt = await summaries.nth(i).textContent();
      textoTotal += txt + '|';
    }
    // El subtotal de fijos debe incluir 50 (50000 de Alquiler)
    expect(textoTotal).toMatch(/50/);
  });

  test('si no hay resumen para el medioPago → fijo NO excluido', async ({ page }) => {
    // Estado con medioPago = "American Express" que no tiene resumen
    const estadoSinResumen = {
      iniciales: { 'Banco Santander': 100000, 'Visa Santander': 0 },
      gastos: [], items: [], patrimonioCargado: true,
      compromisos: [{
        id: 'fijo-amex',
        tipo: 'fijo', nombre: 'Seguro', categoria: 'Seguros',
        monto: 8000, estimado: true, diaMes: 10,
        medioPago: 'American Express', palabrasClave: '', activo: true, pagos: {},
      }],
    };
    await seedAndUnlock(page, estadoSinResumen);
    await goToCompromisos(page);
    // Fijo sin resumen correspondiente → NO tiene chip-tarjeta
    const count = await page.locator('.comp-row--fijo[data-fijo-id="fijo-amex"] .chip.chip-tarjeta').count();
    expect(count).toBe(0);
    // Y su monto sí aparece en el subtotal
    const summaries = page.locator('.comp-mes summary');
    const summaryCount = await summaries.count();
    let textoTotal = '';
    for (let i = 0; i < summaryCount; i++) textoTotal += await summaries.nth(i).textContent() + '|';
    expect(textoTotal).toMatch(/8/);
  });
});

// ─────────────────────────────────────────────────────────────
// FIJO EN RESUMEN — sigue pudiendo marcarse como pagado
// ─────────────────────────────────────────────────────────────
test.describe('fijos-en-resumen: fijo sigue siendo accionable', () => {
  test('fijo en resumen tiene botón "Pagué" visible', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    const btn = page.locator('.comp-row--fijo[data-fijo-id="fijo-visa-1"] button:has-text("Pagué")').first();
    await expect(btn).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────
// COMPATIBILIDAD — fijo sin medioPago (backup viejo)
// ─────────────────────────────────────────────────────────────
test.describe('fijos-en-resumen: compatibilidad fijo sin medioPago', () => {
  test('fijo sin medioPago no tiene chip chip-tarjeta', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const estado = {
      iniciales: {}, gastos: [], items: [], patrimonioCargado: true,
      compromisos: [{
        id: 'fijo-nomedio',
        tipo: 'fijo', nombre: 'Agua', categoria: 'Servicios',
        monto: 5000, estimado: true, diaMes: 20,
        medioPago: null, palabrasClave: '', activo: true, pagos: {},
      }],
    };
    await seedAndUnlock(page, estado);
    await goToCompromisos(page);
    await page.waitForTimeout(300);
    expect(errors).toHaveLength(0);
    const count = await page.locator('.comp-row--fijo[data-fijo-id="fijo-nomedio"] .chip.chip-tarjeta').count();
    expect(count).toBe(0);
  });
});
