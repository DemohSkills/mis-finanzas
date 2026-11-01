const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';
const TODAY = new Date().toISOString().slice(0, 10);
function off(n) { const d = new Date(TODAY); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

const CIERRE = off(-3);

function gasto(id, fecha, monto, extra = {}) {
  return { id, creado: Date.now(), monto, fecha, categoria: 'Compras', medio: 'Mastercard MP', descripcion: 'Compra ' + id, tipo: 'gasto', soloHistorial: false, ...extra };
}

function buildEstado({ resumenExtra = {} } = {}) {
  return {
    iniciales: { 'Banco Santander': 900000, 'Mastercard MP': -100000 },
    gastos: [
      gasto('g1', off(-10), 1000),
      gasto('g2', off(-20), 2000),
      gasto('g3', off(-60), 9999), // fuera del ciclo
      gasto('g4', off(-12), 5555, { transferencia: true }), // transferencia: no cuenta
    ],
    items: [],
    patrimonioCargado: true,
    compromisos: [
      { id: 'res', nombre: 'Mastercard MP', entidad: 'Mastercard MP', monto: 50000, pagoMinimo: 5000, pendientes: 1, proxVenc: off(10), tipo: 'resumen', cierre: CIERRE, estimado: false, ...resumenExtra },
      { id: 'q1', nombre: 'Movilidad DLO', entidad: 'Mastercard MP', monto: 20000, pendientes: 3, proxVenc: off(-8), tipo: 'cuota', estimado: false },
      { id: 'q2', nombre: 'Cuota futura', entidad: 'Mastercard MP', monto: 7000, pendientes: 2, proxVenc: off(40), tipo: 'cuota', estimado: false },
    ],
  };
}

async function seed(page, estado) {
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(600);
  await page.locator('nav.tabs button[data-vista="compromisos"]').click();
  await page.waitForSelector('#compromisosList');
}

test.describe('resumen: detalle plegable y cuotas incluidas', () => {
  test('el detalle está plegado y lista gastos del ciclo + la cuota incluida', async ({ page }) => {
    await seed(page, buildEstado());
    const det = page.locator('.comp-row[data-id="res"] details.comp-detalle');
    await expect(det).toHaveCount(1);
    expect(await det.evaluate(e => e.open)).toBe(false);
    await expect(det.locator('summary')).toContainText('3 consumos');
    const filas = det.locator('li');
    await expect(filas).toHaveCount(3);
    const txt = await det.textContent();
    expect(txt).toContain('Compra g1');
    expect(txt).toContain('Compra g2');
    expect(txt).toContain('Movilidad DLO');
    expect(txt).not.toContain('Compra g3');
    expect(txt).not.toContain('Compra g4');
  });

  test('cuota incluida no aparece como fila propia; la de otro ciclo sí', async ({ page }) => {
    await seed(page, buildEstado());
    await expect(page.locator('.comp-row[data-id="q1"]:not(.comp-row--proy)')).toHaveCount(0);
    await expect(page.locator('.comp-row[data-id="q2"]:not(.comp-row--proy)')).toHaveCount(1);
  });

  test('compromisosMes no duplica la cuota incluida', async ({ page }) => {
    await seed(page, buildEstado());
    const r = await page.evaluate(() => ({
      mesQ1: compromisosMes(estado.compromisos.find(c => c.id === 'q1').proxVenc.slice(0, 7)).map(c => c.id),
      mesQ2: compromisosMes(estado.compromisos.find(c => c.id === 'q2').proxVenc.slice(0, 7)).map(c => c.id),
    }));
    expect(r.mesQ1).not.toContain('q1');
    expect(r.mesQ2).toContain('q2');
  });

  test('cierreAnterior explícito acota el ciclo', async ({ page }) => {
    await seed(page, buildEstado({ resumenExtra: { cierreAnterior: off(-15) } }));
    const det = page.locator('.comp-row[data-id="res"] details.comp-detalle');
    const txt = await det.textContent();
    expect(txt).toContain('Compra g1');
    expect(txt).not.toContain('Compra g2');
    await expect(det.locator('summary')).toContainText('2 consumos');
  });

  test('pagar el resumen completo baja un pendiente de la cuota incluida', async ({ page }) => {
    await seed(page, buildEstado());
    await page.evaluate(() => abrirTransModal('pagar-tarjeta', { resumenId: 'res' }));
    await page.selectOption('#transOrigen', 'Banco Santander');
    await page.click('#btnAtajoTotal');
    await page.click('#btnGuardarTrans');
    const r = await page.evaluate(() => {
      const e = JSON.parse(localStorage.getItem('finanzas-v1'));
      const q1 = e.compromisos.find(c => c.id === 'q1'), q2 = e.compromisos.find(c => c.id === 'q2');
      return { q1: [q1.pendientes, q1.proxVenc], q2: [q2.pendientes, q2.proxVenc] };
    });
    expect(r.q1[0]).toBe(2);
    expect(r.q1[1]).toBe(await page.evaluate(d => addMeses(d, 1), off(-8)));
    expect(r.q2).toEqual([2, off(40)]);
  });

  test('pago parcial (solo el mínimo) no toca la cuota', async ({ page }) => {
    await seed(page, buildEstado());
    await page.evaluate(() => abrirTransModal('pagar-tarjeta', { resumenId: 'res' }));
    await page.selectOption('#transOrigen', 'Banco Santander');
    await page.click('#btnAtajoMin');
    await page.click('#btnGuardarTrans');
    const q1 = await page.evaluate(() => JSON.parse(localStorage.getItem('finanzas-v1')).compromisos.find(c => c.id === 'q1'));
    expect(q1.pendientes).toBe(3);
  });

  test('sin cierre no hay detalle ni se excluyen cuotas', async ({ page }) => {
    await seed(page, buildEstado({ resumenExtra: { cierre: null } }));
    await expect(page.locator('.comp-row[data-id="res"] details.comp-detalle')).toHaveCount(0);
    await expect(page.locator('.comp-row[data-id="q1"]:not(.comp-row--proy)')).toHaveCount(1);
  });

  test('sin overflow horizontal a 360 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await seed(page, buildEstado());
    await page.locator('.comp-row[data-id="res"] details.comp-detalle summary').click();
    const sw = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(sw).toBe(true);
  });
});
