// Préstamos con personas: seguimiento contra un fondo de referencia («📈 Fondo»)
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

function buildEstado(items) {
  return {
    iniciales: { 'Efectivo': 5000, 'Visa Santander': 0, 'Banco Santander': 0, 'Mercado Pago': 0, 'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0 },
    gastos: [],
    items,
    compromisos: [],
    patrimonioCargado: true,
  };
}

const CON_REF = { id: 'ref-id', nombre: 'Boris', tipo: 'deuda', monto: 1500000, grupo: 'Préstamos con personas', persona: 'Boris', historial: [], refInicial: 15000, montoOriginal: 1500000, escala: 100 };
const SIN_REF = { id: 'sin-id', nombre: 'Ana', tipo: 'deuda', monto: 3000, grupo: 'Préstamos con personas', persona: 'Ana', historial: [] };

async function seedAndUnlock(page, estado) {
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

const getEstado = (page) => page.evaluate((sk) => JSON.parse(localStorage.getItem(sk)), SK);

const abrirTodo = (page) => page.evaluate(() => document.querySelectorAll('#vinculos details').forEach(d => { d.open = true; }));

test.describe('prestamo-fondo', () => {
  test('crear un préstamo con referencia guarda refInicial, montoOriginal y escala', async ({ page }) => {
    await seedAndUnlock(page, buildEstado([]));
    await page.locator('[role=tab]', { hasText: 'Patrimonio' }).click();
    await page.evaluate(() => { document.getElementById('det-pat-form').open = true; });
    await page.fill('#itemNombre', 'Carla');
    await page.selectOption('#itemTipo', 'deuda');
    await page.fill('#itemMonto', '1500000');
    await page.selectOption('#itemGrupo', 'Préstamos con personas');
    await page.fill('#itemPersona', 'Carla');
    await expect(page.locator('#itemRefBox')).toBeVisible();
    await page.fill('#itemRefInicial', '15000');
    await page.fill('#itemEscala', '100');
    await page.click('#btnItemGuardar');
    const it = (await getEstado(page)).items.find(x => x.nombre === 'Carla');
    expect(it.refInicial).toBe(15000);
    expect(it.montoOriginal).toBe(1500000);
    expect(it.escala).toBe(100);
  });

  test('con solo la escala se deriva la referencia (monto ÷ escala); en otro grupo no se guarda', async ({ page }) => {
    await seedAndUnlock(page, buildEstado([]));
    await page.locator('[role=tab]', { hasText: 'Patrimonio' }).click();
    await page.evaluate(() => { document.getElementById('det-pat-form').open = true; });
    await page.fill('#itemNombre', 'Dani');
    await page.selectOption('#itemTipo', 'deuda');
    await page.fill('#itemMonto', '1500000');
    await page.selectOption('#itemGrupo', 'Préstamos con personas');
    await page.fill('#itemEscala', '100');
    await page.click('#btnItemGuardar');
    const it = (await getEstado(page)).items.find(x => x.nombre === 'Dani');
    expect(it.refInicial).toBe(15000);
    expect(it.montoOriginal).toBe(1500000);
  });

  test('deuda sugerida = montoOriginal × (hoy / refInicial) y se aplica con historial «interes»', async ({ page }) => {
    await seedAndUnlock(page, buildEstado([{ ...CON_REF }]));
    await page.locator('[role=tab]', { hasText: 'Vínculos' }).click();
    await page.locator('#vinculos .fondo-btn').click();
    await page.waitForSelector('#fondoModal:not([hidden])');
    await page.fill('#fondoRefHoy', '15300');
    // 1.500.000 × 15.300 / 15.000 = 1.530.000 → diferencia +30.000
    await expect(page.locator('#fondoCalc')).toContainText('1.530.000');
    await expect(page.locator('#fondoCalc')).toContainText('30.000');
    await page.click('#btnGuardarFondo');
    const st = await getEstado(page);
    const it = st.items.find(x => x.id === 'ref-id');
    expect(it.monto).toBe(1530000);
    expect(it.refActual).toBe(15300);
    expect(it.refFecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(it.historial).toHaveLength(1);
    expect(it.historial[0].accion).toBe('interes');
    expect(it.historial[0].monto).toBe(30000);
    expect(st.gastos).toHaveLength(0); // el interés no mueve cuentas
  });

  test('segunda actualización usa siempre montoOriginal; deshacer restaura monto y última referencia', async ({ page }) => {
    await seedAndUnlock(page, buildEstado([{ ...CON_REF }]));
    await page.locator('[role=tab]', { hasText: 'Vínculos' }).click();
    for (const v of ['15300', '15150']) {
      await abrirTodo(page);
      await page.locator('#vinculos .fondo-btn').click();
      await page.fill('#fondoRefHoy', v);
      await page.click('#btnGuardarFondo');
    }
    let it = (await getEstado(page)).items.find(x => x.id === 'ref-id');
    expect(it.monto).toBe(1515000);
    expect(it.historial[1].monto).toBe(-15000);
    await abrirTodo(page);
    page.once('dialog', d => d.accept());
    await page.locator('#vinculos .vinc-hist-undo').click();
    it = (await getEstado(page)).items.find(x => x.id === 'ref-id');
    expect(it.monto).toBe(1530000);
    expect(it.refActual).toBe(15300);
    expect(it.historial).toHaveLength(1);
  });

  test('préstamo sin refInicial: sin botón Fondo y ± Ajustar igual que siempre', async ({ page }) => {
    await seedAndUnlock(page, buildEstado([{ ...SIN_REF }]));
    await page.locator('[role=tab]', { hasText: 'Vínculos' }).click();
    await expect(page.locator('#vinculos .fondo-btn')).toHaveCount(0);
    await page.locator('#vinculos button', { hasText: '± Ajustar' }).click();
    await page.selectOption('#ajusteAccion', 'prestoMas');
    await page.fill('#ajusteMonto', '1000');
    await page.selectOption('#ajusteMedio', 'Efectivo');
    await page.click('#btnGuardarAjuste');
    const st = await getEstado(page);
    const it = st.items.find(x => x.id === 'sin-id');
    expect(it.monto).toBe(4000);
    expect(it.refInicial).toBeUndefined();
    expect(it.historial[0].accion).toBe('prestoMas');
    expect(st.gastos).toHaveLength(1);
  });
});
