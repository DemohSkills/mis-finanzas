// Tests: auto-snap, una foto por día, borrar foto, limpiar formulario
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK       = 'finanzas-v1';
const PIN_KEY  = 'finanzas-v1-pin';
const SNAP_KEY = 'finanzas-v1-snaps';
const TEST_PIN = '1234';

function buildEstado(extra = {}) {
  return {
    iniciales: { 'Banco Santander': 100000, 'Mercado Pago': 50000, 'Astropay': 0,
                 'Visa Santander': -20000, 'Mastercard MP': 0, 'Efectivo': 5000, 'American Express': 0 },
    gastos: [],
    items: [
      { id: 'item-1', nombre: 'Casa', tipo: 'activo', monto: 500000, grupo: 'Cobros pendientes', historial: [] },
    ],
    compromisos: [],
    patrimonioCargado: true,
    ...extra,
  };
}

async function seedAndUnlock(page, { estado = buildEstado(), snaps = [] } = {}) {
  await page.addInitScript(({ sk, pk, snapKey, pin, data, snapsData }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    if (snapsData.length) localStorage.setItem(snapKey, JSON.stringify(snapsData));
    else localStorage.removeItem(snapKey);
  }, { sk: SK, pk: PIN_KEY, snapKey: SNAP_KEY, pin: TEST_PIN, data: estado, snapsData: snaps });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

async function getSnaps(page) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), SNAP_KEY);
}

test.describe('snaps-fotos', () => {

  test('(a) editar un ítem de Patrimonio actualiza la foto de hoy sin tocar Actualizar', async ({ page }) => {
    await seedAndUnlock(page);
    // Navigate to Patrimonio
    await page.locator('[role=tab]', { hasText: 'Patrimonio' }).click();
    await page.waitForSelector('#listaActivos');

    // Edit the item "Casa" — click its ✎ edit button
    const editBtn = page.locator('#listaActivos button.edit').first();
    await editBtn.click();
    await page.waitForSelector('#formItem');

    // Change monto to 600000 and save
    const montoInput = page.locator('#itemMonto');
    await montoInput.fill('600.000');
    await page.locator('#btnItemGuardar').click();

    // Wait for the debounce (1.5 s) + a bit of margin
    await page.waitForTimeout(2200);

    const snaps = await getSnaps(page);
    const today = new Date().toLocaleDateString('sv');
    const hoySnaps = snaps.filter(s => s.d === today);
    expect(hoySnaps.length).toBe(1);
    // activos should include the new 600k item
    expect(hoySnaps[0].a).toBeGreaterThan(0);
  });

  test('(b) múltiples guardar() dejan una sola foto por día', async ({ page }) => {
    await seedAndUnlock(page);

    // Save 3 movements in quick succession
    await page.locator('[role=tab]', { hasText: 'Movim' }).click();
    const detForm = page.locator('#det-form');
    await detForm.evaluate(el => { el.open = true; });

    for (let i = 0; i < 3; i++) {
      await page.locator('#monto').fill('1.000');
      await page.locator('#descripcion').fill(`gasto test ${i}`);
      await page.locator('#btnGuardar').click();
      // brief pause between saves
      await page.waitForTimeout(200);
    }

    // Wait for debounce to settle
    await page.waitForTimeout(2200);

    const snaps = await getSnaps(page);
    const today = new Date().toLocaleDateString('sv');
    const todaySnaps = snaps.filter(s => s.d === today);
    expect(todaySnaps.length).toBe(1);
  });

  test('(c) borrar una foto la elimina del gráfico y del almacenamiento', async ({ page }) => {
    const today = new Date().toLocaleDateString('sv');
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv');
    const existingSnaps = [
      { d: yesterday, a: 200000, dv: -10000, n: 190000, dd: {} },
      { d: today,     a: 210000, dv: -10000, n: 200000, dd: {} },
    ];
    await seedAndUnlock(page, { snaps: existingSnaps });

    // Navigate to Config (tab shows ⚙️)
    await page.locator('[role=tab][data-vista="config"]').click();
    await page.waitForTimeout(500);

    // Open the "Fotos del gráfico" details section
    const details = page.locator('#detFotos');
    await details.evaluate(el => { el.open = true; });
    await page.waitForTimeout(300);

    // Confirm the list shows 2 photos
    const rows = page.locator('#fotosLista button', { hasText: 'Borrar' });
    await expect(rows).toHaveCount(2);

    // Delete the first (most recent = today)
    page.once('dialog', d => d.accept());
    await rows.first().click();
    await page.waitForTimeout(300);

    // List should now show 1 photo
    await expect(rows).toHaveCount(1);

    // localStorage should only have 1 snap
    const snaps = await getSnaps(page);
    expect(snaps.length).toBe(1);
    expect(snaps[0].d).toBe(yesterday);
  });

  test('(d) el formulario queda limpio después de guardar un movimiento', async ({ page }) => {
    await seedAndUnlock(page);

    await page.locator('[role=tab]', { hasText: 'Movim' }).click();
    const detForm = page.locator('#det-form');
    await detForm.evaluate(el => { el.open = true; });

    // Fill the form
    await page.locator('#monto').fill('5.000');
    await page.locator('#descripcion').fill('cafe con leche');
    // Leave other fields at defaults, submit
    await page.locator('#btnGuardar').click();
    await page.waitForTimeout(300);

    // Monto should be empty
    const monto = await page.locator('#monto').inputValue();
    expect(monto).toBe('');

    // Descripcion should be empty
    const desc = await page.locator('#descripcion').inputValue();
    expect(desc).toBe('');

    // Tipo should be 'gasto'
    const tipo = await page.locator('#tipo').inputValue();
    expect(tipo).toBe('gasto');

    // Fecha should be today
    const fecha = await page.locator('#fecha').inputValue();
    const today = new Date().toLocaleDateString('sv');
    expect(fecha).toBe(today);
  });

});
