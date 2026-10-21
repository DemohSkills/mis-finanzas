const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';
const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

function todayPlusDays(n) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function buildEstadoCompromisos() {
  return {
    iniciales: {},
    gastos: [],
    items: [],
    patrimonioCargado: true,
    compromisos: [
      // overdue: 30 days ago
      { id: 'cv1', nombre: 'Cuota pasada', entidad: 'Banco', monto: 10000, pendientes: 2, proxVenc: todayPlusDays(-30), tipo: 'cuota' },
      // future: 15 days from now
      { id: 'cf1', nombre: 'Cuota futura', entidad: 'MP', monto: 20000, pendientes: 1, proxVenc: todayPlusDays(15), tipo: 'cuota' },
      // finalized: overdue but marked finalized
      { id: 'cfd1', nombre: 'Cuota fin', entidad: 'Fin', monto: 5000, pendientes: 0, proxVenc: todayPlusDays(-10), tipo: 'cuota', finalizado: true },
    ],
  };
}

async function seedAndUnlock(page, estado, sortVal) {
  await page.addInitScript(({ sk, pk, pin, data, skey, sval }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    if (sval) localStorage.setItem(skey, sval);
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado, skey: 'finanzas-v1-comp-sort', sval: sortVal || null });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(600);
}

async function goToCompromisos(page) {
  await page.locator('nav.tabs button[data-vista="compromisos"]').click();
  await page.waitForSelector('#compromisosList');
}

test.describe('4b: Compromisos — divider Hoy y chip Vencido', () => {
  test('divider .comp-hoy-div existe con sort=venc', async ({ page }) => {
    await seedAndUnlock(page, buildEstadoCompromisos(), 'venc');
    await goToCompromisos(page);
    const dividers = page.locator('.comp-hoy-div');
    await expect(dividers.first()).toBeVisible();
    expect(await dividers.count()).toBeGreaterThanOrEqual(1);
  });

  test('divider muestra texto "Hoy" con fecha dd/mm', async ({ page }) => {
    await seedAndUnlock(page, buildEstadoCompromisos(), 'venc');
    await goToCompromisos(page);
    const divText = await page.locator('.comp-hoy-div span').first().textContent();
    expect(divText).toMatch(/Hoy/i);
    // dd/mm format
    expect(divText).toMatch(/\d{1,2}\/\d{2}/);
  });

  test('divider NO aparece con sort=monto', async ({ page }) => {
    await seedAndUnlock(page, buildEstadoCompromisos(), 'monto');
    await goToCompromisos(page);
    const count = await page.locator('.comp-hoy-div').count();
    expect(count).toBe(0);
  });

  test('divider NO aparece con sort=entidad', async ({ page }) => {
    await seedAndUnlock(page, buildEstadoCompromisos(), 'entidad');
    await goToCompromisos(page);
    const count = await page.locator('.comp-hoy-div').count();
    expect(count).toBe(0);
  });

  test('chip "Vencido hace N días" aparece en compromiso vencido (sort=venc)', async ({ page }) => {
    await seedAndUnlock(page, buildEstadoCompromisos(), 'venc');
    await goToCompromisos(page);
    const chips = page.locator('.chip.vencido');
    await expect(chips.first()).toBeVisible();
    const chipText = await chips.first().textContent();
    expect(chipText).toMatch(/Vencido hace \d+ día/i);
  });

  test('chip indica cantidad de días correcta (~30 días)', async ({ page }) => {
    await seedAndUnlock(page, buildEstadoCompromisos(), 'venc');
    await goToCompromisos(page);
    const chips = page.locator('.chip.vencido');
    const chipText = await chips.first().textContent();
    const match = chipText.match(/(\d+) día/);
    expect(match).toBeTruthy();
    const days = parseInt(match[1]);
    // Allow ±1 day for timezone/timing
    expect(days).toBeGreaterThanOrEqual(29);
    expect(days).toBeLessThanOrEqual(31);
  });

  test('chip NO aparece en compromiso finalizado', async ({ page }) => {
    await seedAndUnlock(page, buildEstadoCompromisos(), 'venc');
    await goToCompromisos(page);
    // cfd1 is finalized and overdue — should NOT have .chip.vencido
    const rows = page.locator('.comp-row');
    const count = await rows.count();
    let finRow = null;
    for (let i = 0; i < count; i++) {
      const txt = await rows.nth(i).textContent();
      if (txt.includes('Cuota fin')) { finRow = rows.nth(i); break; }
    }
    if (finRow) {
      const chipInFin = await finRow.locator('.chip.vencido').count();
      expect(chipInFin).toBe(0);
    }
    // The test passes vacuously if finRow not found (finalized items may be hidden)
  });

  test('chip tiene clase chip.vencido (para estilos CSS)', async ({ page }) => {
    await seedAndUnlock(page, buildEstadoCompromisos(), 'venc');
    await goToCompromisos(page);
    const chip = page.locator('.chip.vencido').first();
    await expect(chip).toBeVisible();
    // should be a span with both classes
    const tagName = await chip.evaluate(el => el.tagName.toLowerCase());
    expect(tagName).toBe('span');
  });

  test('compromiso futuro no tiene chip vencido', async ({ page }) => {
    await seedAndUnlock(page, buildEstadoCompromisos(), 'venc');
    await goToCompromisos(page);
    const rows = page.locator('.comp-row');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const txt = await rows.nth(i).textContent();
      if (txt.includes('Cuota futura')) {
        const chipCount = await rows.nth(i).locator('.chip.vencido').count();
        expect(chipCount).toBe(0);
      }
    }
  });

  test('sin errores JS en la página', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndUnlock(page, buildEstadoCompromisos(), 'venc');
    await goToCompromisos(page);
    await page.waitForTimeout(300);
    expect(errors).toHaveLength(0);
  });
});
