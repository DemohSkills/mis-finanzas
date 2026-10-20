const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

function buildEstado() {
  return {
    iniciales: {},
    gastos: [],
    items: [],
    patrimonioCargado: true,
    compromisos: [
      { id: 'c1', nombre: 'Cuota A', entidad: 'Santander', monto: 50000, pendientes: 2, proxVenc: '2026-11-15', tipo: 'cuota' },
      { id: 'c2', nombre: 'Cuota B', entidad: 'Mercado Pago', monto: 20000, pendientes: 3, proxVenc: '2026-10-25', tipo: 'cuota' },
      { id: 'c3', nombre: 'Cuota C', entidad: 'Astropay', monto: 80000, pendientes: 1, proxVenc: null, tipo: 'cuota' },
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

test.describe('2c: Compromisos por mes plegables', () => {
  test('compromisos por vencimiento se agrupan en <details class="comp-mes">', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    const groups = page.locator('#compromisosList details.comp-mes');
    await expect(groups.first()).toBeVisible();
    const count = await groups.count();
    expect(count).toBeGreaterThanOrEqual(2); // oct + nov + sin-fecha → al menos 2
  });

  test('summary del grupo muestra etiqueta de mes y subtotal', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    const summary = page.locator('#compromisosList details.comp-mes').first().locator('summary');
    const txt = await summary.textContent();
    expect(txt).toMatch(/\d/); // subtotal
    expect(txt).toMatch(/Octubre|Noviembre|Sin fecha|Finalizados/i);
  });

  test('se puede plegar y desplegar un grupo de mes', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    const grp = page.locator('#compromisosList details.comp-mes').first();
    await expect(grp).toHaveAttribute('open', '');
    await grp.locator('summary').click();
    await expect(grp).not.toHaveAttribute('open', '');
    await grp.locator('summary').click();
    await expect(grp).toHaveAttribute('open', '');
  });

  test('sort=monto renderiza lista plana (sin details.comp-mes)', async ({ page }) => {
    await seedAndUnlock(page, buildEstado(), 'monto');
    await goToCompromisos(page);
    const groups = await page.locator('#compromisosList details.comp-mes').count();
    expect(groups).toBe(0);
    const rows = await page.locator('.comp-row').count();
    expect(rows).toBe(3);
  });

  test('sort=entidad agrupa por entidad en details.comp-mes', async ({ page }) => {
    await seedAndUnlock(page, buildEstado(), 'entidad');
    await goToCompromisos(page);
    const groups = page.locator('#compromisosList details.comp-mes');
    const count = await groups.count();
    expect(count).toBe(3); // Astropay, Mercado Pago, Santander
  });

  test('estado open/closed de grupos persiste en localStorage', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    const grp = page.locator('#compromisosList details.comp-mes').first();
    await grp.locator('summary').click();
    await expect(grp).not.toHaveAttribute('open', '');
    await page.waitForTimeout(150);
    const stored = await page.evaluate(() =>
      Object.keys(localStorage).filter(k => k.startsWith('finanzas-v1-det-comp-'))
    );
    expect(stored.length).toBeGreaterThan(0);
  });

  test('btnPlegComp pliega todos los grupos de compromisos', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToCompromisos(page);
    await page.waitForSelector('#btnPlegComp');
    await page.click('#btnPlegComp');
    await page.waitForTimeout(200);
    const open = await page.locator('#compromisosList details.comp-mes[open]').count();
    expect(open).toBe(0);
    await expect(page.locator('#btnPlegComp')).toHaveText('Desplegar todo');
  });
});
