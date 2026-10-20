// Tests para botón ± Ajustar en solapa Vínculos Comerciales
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

function buildEstado() {
  return {
    iniciales: { 'Efectivo': 5000, 'Visa Santander': 0, 'Banco Santander': 0, 'Mercado Pago': 0, 'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0 },
    gastos: [],
    items: [
      { id: 'boris-id', nombre: 'Boris', tipo: 'deuda', monto: 3000, grupo: 'Préstamos con personas', persona: 'Boris', historial: [] },
    ],
    compromisos: [],
    patrimonioCargado: true,
  };
}

async function seedAndUnlock(page, estado) {
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) {
    await page.click(`button[data-d="${d}"]`);
  }
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

async function getEstado(page) {
  return page.evaluate((sk) => JSON.parse(localStorage.getItem(sk)), SK);
}

test.describe('ajuste-vinculos', () => {
  test('(a) botón ± Ajustar aparece en Vínculos Comerciales para Boris', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await page.locator('[role=tab]', { hasText: 'Vínculos' }).click();
    await page.waitForSelector('#vinculos');
    const btn = page.locator('#vinculos button', { hasText: '± Ajustar' });
    await expect(btn).toBeVisible();
  });

  test('(b) ajustar Boris desde Vínculos: "Me prestó más" $1.000 en Efectivo — deuda sube, Efectivo baja', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());

    // Ir a Vínculos
    await page.locator('[role=tab]', { hasText: 'Vínculos' }).click();
    await page.waitForSelector('#vinculos');

    // Abrir modal desde Vínculos
    await page.locator('#vinculos button', { hasText: '± Ajustar' }).click();
    await page.waitForSelector('#ajusteModal:not([hidden])');

    await page.selectOption('#ajusteAccion', 'prestoMas');
    await page.fill('#ajusteMonto', '1000');
    await page.selectOption('#ajusteMedio', 'Efectivo');
    await page.click('#btnGuardarAjuste');
    await page.waitForSelector('#ajusteModal', { state: 'hidden' });

    const est = await getEstado(page);

    // Deuda Boris sube 1000
    const boris = est.items.find(it => it.nombre === 'Boris');
    expect(boris.monto).toBe(4000);

    // Movimiento en Efectivo con transferencia:true, tipo ingreso
    const mov = est.gastos.find(g => g.transferencia && g.medio === 'Efectivo');
    expect(mov).toBeTruthy();
    expect(mov.tipo).toBe('ingreso');
    expect(mov.monto).toBe(1000);

    // saldoDe(Efectivo) = 5000 + 1000 = 6000 (ingreso registrado)
    const efGastado = est.gastos.filter(g => g.medio === 'Efectivo' && !g.soloHistorial && (g.tipo||'gasto') === 'gasto').reduce((s,g)=>s+g.monto,0);
    const efIngresado = est.gastos.filter(g => g.medio === 'Efectivo' && !g.soloHistorial && (g.tipo||'gasto') === 'ingreso').reduce((s,g)=>s+g.monto,0);
    const efSaldo = est.iniciales['Efectivo'] - efGastado + efIngresado;
    expect(efSaldo).toBe(6000);
  });

  test('(c) cambio en Vínculos se refleja en Patrimonio', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());

    await page.locator('[role=tab]', { hasText: 'Vínculos' }).click();
    await page.waitForSelector('#vinculos');
    await page.locator('#vinculos button', { hasText: '± Ajustar' }).click();
    await page.waitForSelector('#ajusteModal:not([hidden])');

    await page.selectOption('#ajusteAccion', 'prestoMas');
    await page.fill('#ajusteMonto', '1000');
    await page.selectOption('#ajusteMedio', 'Efectivo');
    await page.click('#btnGuardarAjuste');
    await page.waitForSelector('#ajusteModal', { state: 'hidden' });

    // Ir a Patrimonio y verificar que Boris muestra 4000
    await page.locator('[role=tab]', { hasText: 'Patrimonio' }).click();
    await page.waitForSelector('#listaDeudas');
    const textoDeuda = await page.locator('#listaDeudas').textContent();
    expect(textoDeuda).toContain('4.000');
  });

  test('(d) Deshacer desde Vínculos revierte deuda y movimiento', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());

    await page.locator('[role=tab]', { hasText: 'Vínculos' }).click();
    await page.waitForSelector('#vinculos');
    await page.locator('#vinculos button', { hasText: '± Ajustar' }).click();
    await page.waitForSelector('#ajusteModal:not([hidden])');

    await page.selectOption('#ajusteAccion', 'prestoMas');
    await page.fill('#ajusteMonto', '1000');
    await page.selectOption('#ajusteMedio', 'Efectivo');
    await page.click('#btnGuardarAjuste');
    await page.waitForSelector('#ajusteModal', { state: 'hidden' });

    // Abrir historial en Vínculos
    const histDet = page.locator('#vinculos details', { hasText: 'Historial' });
    await expect(histDet).toBeVisible();
    await histDet.evaluate(el => { el.open = true; });

    // Deshacer
    page.once('dialog', d => d.accept());
    await page.locator('#vinculos .mini.danger', { hasText: '↩ Deshacer último' }).click();

    const est = await getEstado(page);

    // Boris volvió a 3000
    expect(est.items.find(it => it.nombre === 'Boris').monto).toBe(3000);

    // Sin movimientos de transferencia
    expect(est.gastos.filter(g => g.transferencia)).toHaveLength(0);

    // Historial vacío
    expect(est.items.find(it => it.nombre === 'Boris').historial).toHaveLength(0);
  });
});
