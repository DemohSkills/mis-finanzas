// @ts-check
// Tests para PARTE 1: campo usd/usdPagado en compromiso tipo resumen
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
function daysBefore(n) {
  const d = new Date(TODAY); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
}

const CIERRE = daysBefore(30);
const VENC_FUTURO_LEJOS = daysAfter(20);
const VENC_FUTURO_CERCA = daysAfter(5);
const VENC_PASADO = daysBefore(3);

function buildEstado({ usd = 50, usdPagado = false, proxVenc = VENC_FUTURO_LEJOS } = {}) {
  return {
    iniciales: { 'Banco Santander': 500000, 'Visa Santander': -200000 },
    gastos: [],
    items: [],
    patrimonioCargado: true,
    compromisos: [{
      id: 'cr-usd',
      nombre: 'Visa 4321',
      entidad: 'Visa Santander',
      monto: 100000,
      pagoMinimo: 20000,
      pendientes: 1,
      proxVenc,
      tipo: 'resumen',
      cierre: CIERRE,
      estimado: false,
      usd,
      usdPagado,
    }],
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
// CHIP USD — visibilidad y contenido
// ─────────────────────────────────────────────────────────────
test.describe('resumen-usd: chip de compra MEP', () => {
  test('usd>0 y no pagado → chip chip-usd visible con texto MEP', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usd: 50, proxVenc: VENC_FUTURO_LEJOS }));
    await goToCompromisos(page);
    const chip = page.locator('.comp-row[data-id="cr-usd"] .chip.chip-usd');
    await expect(chip).toBeVisible();
    const txt = await chip.textContent();
    expect(txt).toContain('MEP');
    expect(txt).toContain('50');
  });

  test('usd=0 → no hay chip chip-usd', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usd: 0 }));
    await goToCompromisos(page);
    const count = await page.locator('.comp-row[data-id="cr-usd"] .chip.chip-usd').count();
    expect(count).toBe(0);
  });

  test('usdPagado=true → no hay chip chip-usd', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usd: 50, usdPagado: true }));
    await goToCompromisos(page);
    const count = await page.locator('.comp-row[data-id="cr-usd"] .chip.chip-usd').count();
    expect(count).toBe(0);
  });

  test('venc en ≤7 días → chip tiene clase alerta', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usd: 50, proxVenc: VENC_FUTURO_CERCA }));
    await goToCompromisos(page);
    const chip = page.locator('.comp-row[data-id="cr-usd"] .chip.chip-usd.alerta');
    await expect(chip).toBeVisible();
  });

  test('venc pasado → chip tiene clase vencido', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usd: 50, proxVenc: VENC_PASADO }));
    await goToCompromisos(page);
    const chip = page.locator('.comp-row[data-id="cr-usd"] .chip.chip-usd.vencido');
    await expect(chip).toBeVisible();
  });

  test('chip contiene span.amt para modo ojo', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usd: 50 }));
    await goToCompromisos(page);
    const amtSpan = page.locator('.comp-row[data-id="cr-usd"] .chip.chip-usd .amt');
    await expect(amtSpan).toBeVisible();
    const txt = await amtSpan.textContent();
    expect(txt).toContain('50');
  });
});

// ─────────────────────────────────────────────────────────────
// BOTONES Ya pagué / Deshacer
// ─────────────────────────────────────────────────────────────
test.describe('resumen-usd: botones de pago USD', () => {
  test('usd>0 y no pagado → botón "Ya pagué los USD" visible', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usd: 50 }));
    await goToCompromisos(page);
    const btn = page.locator('.comp-row[data-id="cr-usd"] button:has-text("Ya pagué los USD")');
    await expect(btn).toBeVisible();
  });

  test('clic en "Ya pagué los USD" → usdPagado=true en localStorage y chip desaparece', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usd: 50 }));
    await goToCompromisos(page);
    await page.locator('.comp-row[data-id="cr-usd"] button:has-text("Ya pagué los USD")').click();
    await page.waitForTimeout(300);
    // chip desaparece
    const count = await page.locator('.comp-row[data-id="cr-usd"] .chip.chip-usd').count();
    expect(count).toBe(0);
    // botón deshacer aparece
    const btnDeshacer = page.locator('.comp-row[data-id="cr-usd"] button:has-text("USD pagados")');
    await expect(btnDeshacer).toBeVisible();
    // localStorage tiene usdPagado=true
    const data = await page.evaluate(sk => JSON.parse(localStorage.getItem(sk)), SK);
    const comp = data.compromisos.find(c => c.id === 'cr-usd');
    expect(comp.usdPagado).toBe(true);
  });

  test('usdPagado=true → botón "↩ USD pagados" (deshacer) visible', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usd: 50, usdPagado: true }));
    await goToCompromisos(page);
    const btn = page.locator('.comp-row[data-id="cr-usd"] button:has-text("USD pagados")');
    await expect(btn).toBeVisible();
  });

  test('clic en "↩ USD pagados" → usdPagado=false y chip reaparece', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usd: 50, usdPagado: true }));
    await goToCompromisos(page);
    await page.locator('.comp-row[data-id="cr-usd"] button:has-text("USD pagados")').click();
    await page.waitForTimeout(300);
    const chip = page.locator('.comp-row[data-id="cr-usd"] .chip.chip-usd');
    await expect(chip).toBeVisible();
    const data = await page.evaluate(sk => JSON.parse(localStorage.getItem(sk)), SK);
    const comp = data.compromisos.find(c => c.id === 'cr-usd');
    expect(comp.usdPagado).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// MODAL DE EDICIÓN — campo compUsd
// ─────────────────────────────────────────────────────────────
test.describe('resumen-usd: modal de edición', () => {
  test('abrir modal de resumen → compUsdWrap visible', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usd: 50 }));
    await goToCompromisos(page);
    await page.locator('.comp-row[data-id="cr-usd"] button:has-text("Editar")').click();
    await expect(page.locator('#compUsdWrap')).toBeVisible();
  });

  test('campo compUsd muestra el valor actual', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usd: 75 }));
    await goToCompromisos(page);
    await page.locator('.comp-row[data-id="cr-usd"] button:has-text("Editar")').click();
    const val = await page.locator('#compUsd').inputValue();
    expect(val.replace(/\D/g, '')).toBe('75');
  });

  test('guardar modal actualiza usd en localStorage', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usd: 50 }));
    await goToCompromisos(page);
    await page.locator('.comp-row[data-id="cr-usd"] button:has-text("Editar")').click();
    await page.locator('#compUsd').fill('200');
    await page.locator('#compForm button[type="submit"]').click();
    await page.waitForTimeout(300);
    const data = await page.evaluate(sk => JSON.parse(localStorage.getItem(sk)), SK);
    const comp = data.compromisos.find(c => c.id === 'cr-usd');
    expect(comp.usd).toBe(200);
  });

  test('tipo cuota → compUsdWrap oculto; tipo resumen → visible', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ usd: 0 }));
    await goToCompromisos(page);
    // click the "Agregar cuota" button
    await page.locator('#btnNuevoCompromiso').click();
    await page.waitForSelector('#compModal:not([hidden])');
    // default tipo = cuota → compUsdWrap hidden
    const usdWrap = page.locator('#compUsdWrap');
    await expect(usdWrap).toBeHidden();
    // cambiar a resumen → visible
    await page.locator('#compTipo').selectOption('resumen');
    await expect(usdWrap).toBeVisible();
    // volver a cuota → oculto
    await page.locator('#compTipo').selectOption('cuota');
    await expect(usdWrap).toBeHidden();
  });
});

// ─────────────────────────────────────────────────────────────
// COMPATIBILIDAD — resumen sin campo usd (backup viejo)
// ─────────────────────────────────────────────────────────────
test.describe('resumen-usd: compatibilidad backup sin usd', () => {
  test('resumen sin campo usd carga sin errores JS', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const estado = {
      iniciales: {}, gastos: [], items: [], patrimonioCargado: true,
      compromisos: [{ id: 'old-usd', nombre: 'Visa vieja', entidad: 'Visa Santander', monto: 50000, pendientes: 1, proxVenc: VENC_FUTURO_LEJOS, tipo: 'resumen', estimado: false }],
    };
    await seedAndUnlock(page, estado);
    await goToCompromisos(page);
    await page.waitForTimeout(300);
    expect(errors).toHaveLength(0);
  });

  test('resumen sin campo usd no muestra chip chip-usd', async ({ page }) => {
    const estado = {
      iniciales: {}, gastos: [], items: [], patrimonioCargado: true,
      compromisos: [{ id: 'old-usd2', nombre: 'Visa vieja', entidad: 'Visa Santander', monto: 50000, pendientes: 1, proxVenc: VENC_FUTURO_LEJOS, tipo: 'resumen', estimado: false }],
    };
    await seedAndUnlock(page, estado);
    await goToCompromisos(page);
    const count = await page.locator('.comp-row[data-id="old-usd2"] .chip.chip-usd').count();
    expect(count).toBe(0);
  });
});
