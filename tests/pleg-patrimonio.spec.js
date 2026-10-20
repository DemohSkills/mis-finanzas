const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

function buildEstado() {
  return {
    iniciales: { 'Efectivo': 10000, 'Banco Santander': 50000 },
    gastos: [],
    items: [
      { id: 'ia1', nombre: 'Efectivo', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 10000 },
      { id: 'ia2', nombre: 'Banco Santander', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 50000 },
      { id: 'id1', nombre: 'Boris', grupo: 'Préstamos con personas', tipo: 'deuda', monto: 3000, persona: 'Boris' },
      { id: 'id2', nombre: 'Deuda Santander', grupo: 'Créditos bancarios', tipo: 'deuda', monto: 20000 },
    ],
    patrimonioCargado: true,
    compromisos: [],
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

async function goToPatrimonio(page) {
  await page.locator('[role=tab]', { hasText: 'Patrimonio' }).click();
  await page.waitForSelector('#listaActivos');
}

test.describe('2b: Patrimonio grupos plegables', () => {
  test('grupos de activos son <details class="pat-grp">', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToPatrimonio(page);
    const grps = page.locator('#listaActivos details.pat-grp');
    await expect(grps.first()).toBeVisible();
    const count = await grps.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('grupos de deudas son <details class="pat-grp">', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToPatrimonio(page);
    const grps = page.locator('#listaDeudas details.pat-grp');
    await expect(grps.first()).toBeVisible();
    const count = await grps.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('summary de grupo muestra subtotal', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToPatrimonio(page);
    const summary = page.locator('#listaActivos details.pat-grp').first().locator('summary');
    await expect(summary).toBeVisible();
    const txt = await summary.textContent();
    // debe contener algún número (el subtotal)
    expect(txt).toMatch(/\d/);
  });

  test('se puede plegar y desplegar un grupo', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToPatrimonio(page);
    const grp = page.locator('#listaActivos details.pat-grp').first();
    await expect(grp).toHaveAttribute('open', '');
    // cerrar
    await grp.locator('summary').click();
    await expect(grp).not.toHaveAttribute('open', '');
    // abrir
    await grp.locator('summary').click();
    await expect(grp).toHaveAttribute('open', '');
  });

  test('estado persiste en localStorage con prefijo pat-', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToPatrimonio(page);
    const grp = page.locator('#listaActivos details.pat-grp').first();
    await grp.locator('summary').click();
    await expect(grp).not.toHaveAttribute('open', '');
    await page.waitForTimeout(150);
    const stored = await page.evaluate(() =>
      Object.keys(localStorage).filter(k => k.startsWith('finanzas-v1-det-pat-'))
    );
    expect(stored.length).toBeGreaterThan(0);
  });

  test('formulario Agregar activo/deuda es plegable', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToPatrimonio(page);
    const detForm = page.locator('#det-pat-form');
    await expect(detForm).toBeVisible();
    // por defecto abierto
    await expect(detForm).toHaveAttribute('open', '');
  });

  test('btnPlegPat pliega todos los grupos del patrimonio', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToPatrimonio(page);
    await page.waitForSelector('#btnPlegPat');
    await page.click('#btnPlegPat');
    await page.waitForTimeout(200);
    const openGrps = await page.locator('#vista-patrimonio details[open]').count();
    expect(openGrps).toBe(0);
    await expect(page.locator('#btnPlegPat')).toHaveText('Desplegar todo');
  });
});
