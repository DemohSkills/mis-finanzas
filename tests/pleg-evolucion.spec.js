const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const SNAPS_KEY = 'finanzas-v1-snaps';
const TEST_PIN = '1234';

function buildEstado() {
  return {
    iniciales: { 'Efectivo': 10000 },
    gastos: [{ id: 'g1', monto: 500, fecha: '2026-10-01', categoria: 'Comida', desc: 'Test' }],
    items: [{ id: 'ia1', nombre: 'Efectivo', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 10000 }],
    patrimonioCargado: true,
    compromisos: [],
  };
}

async function seedAndUnlock(page, estado) {
  const snaps = [
    { fecha: '2026-10-13', neto: 9000, activos: 9000, deudas: 0 },
    { fecha: '2026-10-20', neto: 10000, activos: 10000, deudas: 0 },
  ];
  await page.addInitScript(({ sk, pk, pin, data, snk, sndata }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    localStorage.setItem(snk, JSON.stringify(sndata));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado, snk: SNAPS_KEY, sndata: snaps });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(600);
}

async function goToEvolucion(page) {
  await page.locator('nav.tabs button[data-vista="evolucion"]').click();
  await page.waitForTimeout(800); // espera charts lazy-load
}

test.describe('2d: Evolución charts plegables', () => {
  test('cada gráfico es un <details class="ev-card">', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToEvolucion(page);
    const cards = page.locator('#vista-evolucion details.ev-card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(4); // al menos 4 gráficos
  });

  test('summary de ev-card contiene título del gráfico', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToEvolucion(page);
    const summary = page.locator('#det-ev-cP summary');
    await expect(summary).toBeVisible();
    const txt = await summary.textContent();
    expect(txt).toMatch(/Patrimonio/i);
  });

  test('se puede plegar y desplegar un gráfico', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToEvolucion(page);
    const card = page.locator('#det-ev-cP');
    await expect(card).toHaveAttribute('open', '');
    // cerrar
    await card.locator('summary').click();
    await expect(card).not.toHaveAttribute('open', '');
    // abrir
    await card.locator('summary').click();
    await expect(card).toHaveAttribute('open', '');
  });

  test('estado open/closed persiste en localStorage', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToEvolucion(page);
    const card = page.locator('#det-ev-cP');
    await card.locator('summary').click();
    await expect(card).not.toHaveAttribute('open', '');
    await page.waitForTimeout(150);
    const stored = await page.evaluate(() =>
      Object.keys(localStorage).filter(k => k.startsWith('finanzas-v1-det-det-ev-'))
    );
    expect(stored.length).toBeGreaterThan(0);
  });

  test('btnPlegEvol pliega todos los charts', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToEvolucion(page);
    await page.waitForSelector('#btnPlegEvol');
    await page.click('#btnPlegEvol');
    await page.waitForTimeout(200);
    const open = await page.locator('#vista-evolucion details.ev-card[open]').count();
    expect(open).toBe(0);
    await expect(page.locator('#btnPlegEvol')).toHaveText('Desplegar todo');
  });
});
