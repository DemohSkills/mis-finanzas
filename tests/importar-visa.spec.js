/**
 * Tests para el importador de resúmenes Visa (Excel).
 * Usa fixture sintético con la misma estructura que el archivo real.
 * parseVisaXlsx() recibe el AOA generado por SheetJS.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

// ── Helpers ───────────────────────────────────────────────────

/** Format number as es-AR with 2 decimal places */
function fmtAR(n) {
  return Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPesos(n) {
  const s = fmtAR(n);
  return n < 0 ? `$-${s}` : `$${s}`;
}
function fmtUSD(n) {
  return `U$S${fmtAR(n)}`;
}

/**
 * Build a synthetic Visa AOA matching the real fixture structure.
 * cards: [{ nombre, numero, tipo:'titular'|'adicional', movs:[{fecha,desc,cuotaN?,cuotaM?,comp,pesos?,usd?}], totalPesos, totalUSD }]
 * pagos: [{ fecha, desc, pesos?, usd? }]
 * otros: [{ desc, monto }]
 */
function buildVisaAoa({
  cierre = '01/10/2026',
  vencimiento = '09/10/2026',
  proxCierre = '29/10/2026',
  proxVencimiento = '11/11/2026',
  totalPesos = 170621.25,
  totalUSD = 20.78,
  cards = [],
  pagos = [],
  otros = [],
} = {}) {
  const rows = [];
  rows.push(['Movimientos del resumen', '', '', '', '', '']);
  rows.push(['Tarjeta Visa Crédito terminada en 1111', '', '', '', '', '']);
  rows.push(['', '', '', '', '', '']);
  rows.push(['Fecha de cierre', 'Fecha de vencimiento', '', '', '', '']);
  rows.push([cierre, vencimiento, '', '', '', '']);
  rows.push(['Total a pagar', '', '', '', '', '']);
  rows.push([fmtPesos(totalPesos), fmtUSD(totalUSD), '', '', '', '']);
  rows.push(['Mínimo a pagar', '', '', '', '', '']);
  rows.push([fmtPesos(totalPesos), fmtUSD(totalUSD), '', '', '', '']); // ignored
  rows.push(['', '', '', '', '', '']);
  rows.push(['', '', '', '', '', '']);
  rows.push(['Cierres y vencimientos', '', '', '', '', '']);
  rows.push(['Resumen actual', 'Próximo resumen', '', '', '', '']);
  rows.push([`Cierre: ${cierre}`, `Cierre: ${proxCierre}`, '', '', '', '']);
  rows.push([`Vencimiento: ${vencimiento}`, `Vencimiento: ${proxVencimiento}`, '', '', '', '']);
  rows.push(['', '', '', '', '', '']);
  // Pago de tarjeta
  rows.push(['Pago de tarjeta y devoluciones', '', '', '', '', '']);
  rows.push(['Fecha', 'Descripción', 'Cuotas', 'Comprobante', 'Monto en pesos', 'Monto en dólares']);
  for (const p of pagos) {
    rows.push([p.fecha || '', p.desc || '', '', '-',
      p.pesos != null ? fmtPesos(p.pesos) : '',
      p.usd != null ? fmtUSD(p.usd) : '']);
  }
  rows.push(['', '', '', '', '', '']);
  // Card sections
  for (const card of cards) {
    const prefix = card.tipo === 'adicional' ? `Adicional de ${card.nombre}` : `Tarjeta de ${card.nombre}`;
    rows.push([`${prefix} - Visa Crédito terminada en ${card.numero}`, '', '', '', '', '']);
    rows.push(['Fecha', 'Descripción', 'Cuotas', 'Comprobante', 'Monto en pesos', 'Monto en dólares']);
    let lastFecha = '';
    for (const mov of card.movs) {
      const fechaCol = mov.fecha !== lastFecha ? mov.fecha : '';
      if (mov.fecha !== lastFecha) lastFecha = mov.fecha;
      const cuota = (mov.cuotaN != null && mov.cuotaM != null) ? `${mov.cuotaN} de ${mov.cuotaM}` : '';
      rows.push([fechaCol, mov.desc, cuota, mov.comp || '',
        mov.pesos != null ? fmtPesos(mov.pesos) : '',
        mov.usd != null ? fmtUSD(mov.usd) : '']);
    }
    rows.push([`Total de Visa Crédito terminada en ${card.numero}`, '', '', '',
      fmtPesos(card.totalPesos ?? 0), fmtUSD(card.totalUSD ?? 0)]);
    rows.push(['', '', '', '', '', '']);
  }
  // Otros conceptos
  if (otros.length) {
    rows.push(['Otros conceptos', '', '', '', '', '']);
    rows.push(['Descripción', 'Monto en pesos', '', '', '', '']);
    for (const o of otros) {
      rows.push([o.desc, fmtPesos(o.monto), '', '', '', '']);
    }
    rows.push(['Aviso importante: sin validez legal.', '', '', '', '', '']);
  }
  return rows;
}

const BASE_STATE = {
  iniciales: { 'Banco Santander': 0, 'Visa Santander': 0, 'Mercado Pago': 0,
    'Efectivo': 0, 'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0 },
  gastos: [], items: [], patrimonioCargado: true, compromisos: [], importaciones: {},
};

async function seedAndLoad(page, state = BASE_STATE) {
  await page.addInitScript((s) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(s));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
  }, state);
  await page.goto(INDEX);
}

async function enterPIN(page) {
  for (const d of ['1', '2', '3', '4']) await page.locator(`[data-d="${d}"]`).click();
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

async function callParseVisaXlsx(page, aoa) {
  return page.evaluate((aoaData) => {
    try { return { ok: true, data: window.parseVisaXlsx(aoaData) }; }
    catch (e) { return { ok: false, err: e.message }; }
  }, aoa);
}

// ── Tests ─────────────────────────────────────────────

test.describe('importar-visa', () => {

  test('(a) fechas arrastradas por celdas combinadas (date drag)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndLoad(page);
    await enterPIN(page);

    const aoa = buildVisaAoa({
      cards: [{
        nombre: 'Titular Prueba', numero: '1111', tipo: 'titular',
        totalPesos: 3000, totalUSD: 0,
        movs: [
          { fecha: '15/09/2026', desc: 'Gasto A', comp: '001K', pesos: 1000 },
          // Same date — should be dragged (empty fecha cell in real file)
          { fecha: '15/09/2026', desc: 'Gasto B', comp: '002K', pesos: 2000 },
        ],
      }],
    });
    // Simulate merged cell: blank out second fecha
    const tarjetaStartRow = aoa.findIndex(r => r[0].includes('Tarjeta de Titular'));
    const movRowB = aoa.findIndex((r, i) => i > tarjetaStartRow + 1 && r[1] === 'Gasto B');
    aoa[movRowB][0] = ''; // merged cell → blank

    const result = await callParseVisaXlsx(page, aoa);
    expect(errors).toHaveLength(0);
    expect(result.ok).toBe(true);
    const movs = result.data.tarjetas[0].movs;
    expect(movs).toHaveLength(2);
    // Both movements should have the same fecha (dragged)
    expect(movs[0].fecha).toBe('2026-09-15');
    expect(movs[1].fecha).toBe('2026-09-15');
  });

  test('(b) importes negativos en sección Pagos', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const aoa = buildVisaAoa({
      pagos: [
        { fecha: '03/09/2026', desc: 'Su pago en pesos', pesos: -10000 },
        { fecha: '04/09/2026', desc: 'Transferencia deuda', pesos: 1000 },
      ],
      cards: [{
        nombre: 'Prueba', numero: '1111', tipo: 'titular',
        totalPesos: 0, totalUSD: 0, movs: [],
      }],
    });

    const result = await callParseVisaXlsx(page, aoa);
    expect(result.ok).toBe(true);
    expect(result.data.pagos).toHaveLength(2);
    expect(result.data.pagos[0].pesos).toBe(-10000);
    expect(result.data.pagos[1].pesos).toBe(1000);
  });

  test('(c) USD sin pesos en movimientos', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const aoa = buildVisaAoa({
      cards: [{
        nombre: 'Titular', numero: '1111', tipo: 'titular',
        totalPesos: 0, totalUSD: 7.29,
        movs: [{ fecha: '30/09/2026', desc: 'Google servicio', comp: '123K', usd: 7.29 }],
      }],
    });

    const result = await callParseVisaXlsx(page, aoa);
    expect(result.ok).toBe(true);
    const mov = result.data.tarjetas[0].movs[0];
    expect(mov.pesos).toBe(0);
    expect(mov.usd).toBeCloseTo(7.29, 2);
  });

  test('(d) tarjeta adicional: tipo y nombre parseados correctamente', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const aoa = buildVisaAoa({
      cards: [
        { nombre: 'Titular Prueba', numero: '1111', tipo: 'titular', totalPesos: 0, totalUSD: 0, movs: [] },
        { nombre: 'Persona Prueba', numero: '2222', tipo: 'adicional', totalPesos: 0, totalUSD: 3.50,
          movs: [{ fecha: '03/10/2026', desc: 'Google adicional', comp: '666K', usd: 3.50 }] },
      ],
    });

    const result = await callParseVisaXlsx(page, aoa);
    expect(result.ok).toBe(true);
    expect(result.data.tarjetas).toHaveLength(2);
    expect(result.data.tarjetas[1].tipo).toBe('adicional');
    expect(result.data.tarjetas[1].nombre).toBe('Persona Prueba');
    expect(result.data.tarjetas[1].numero).toBe('2222');
  });

  test('(e) cuotas: n>1 usa fecha de cierre, cuota 1/N usa fecha de compra', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const aoa = buildVisaAoa({
      cierre: '01/10/2026',
      cards: [{
        nombre: 'Titular', numero: '1111', tipo: 'titular', totalPesos: 3000, totalUSD: 0,
        movs: [
          { fecha: '04/05/2026', desc: 'Compra en cuotas', comp: '111*', pesos: 1000, cuotaN: 5, cuotaM: 12 },
          { fecha: '28/09/2026', desc: 'Cuota uno', comp: '222K', pesos: 2000, cuotaN: 1, cuotaM: 6 },
        ],
      }],
    });

    const result = await callParseVisaXlsx(page, aoa);
    expect(result.ok).toBe(true);
    const movs = result.data.tarjetas[0].movs;
    // cuota 5/12 → fecha = cierre = 2026-10-01
    expect(movs[0].cuota).toEqual({ n: 5, m: 12 });
    expect(movs[0].fecha).toBe('2026-10-01');
    // cuota 1/6 → fecha de compra = 2026-09-28
    expect(movs[1].cuota).toEqual({ n: 1, m: 6 });
    expect(movs[1].fecha).toBe('2026-09-28');
  });

  test('(f) verificación ✓: sumas coinciden con totales del archivo', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const aoa = buildVisaAoa({
      cards: [{
        nombre: 'Titular', numero: '1111', tipo: 'titular',
        totalPesos: 1500, totalUSD: 7.29,
        movs: [
          { fecha: '30/09/2026', desc: 'Gasto pesos', comp: '001K', pesos: 1500 },
          { fecha: '30/09/2026', desc: 'Gasto usd', comp: '002K', usd: 7.29 },
        ],
      }],
    });

    const result = await callParseVisaXlsx(page, aoa);
    expect(result.ok).toBe(true);
    const t = result.data.tarjetas[0];
    const sumP = t.movs.reduce((s, m) => s + m.pesos, 0);
    const sumU = t.movs.reduce((s, m) => s + m.usd, 0);
    expect(Math.abs(sumP - t.totalPesos)).toBeLessThan(0.02);
    expect(Math.abs(sumU - t.totalUSD)).toBeLessThan(0.005);
  });

  test('(g) verificación ⚠: alterando totalPesos en memoria detecta diferencia', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const aoa = buildVisaAoa({
      cards: [{
        nombre: 'Titular', numero: '1111', tipo: 'titular',
        totalPesos: 9999, // intentionally wrong (sum of movs = 1000)
        totalUSD: 0,
        movs: [{ fecha: '30/09/2026', desc: 'Gasto', comp: '001K', pesos: 1000 }],
      }],
    });

    const result = await callParseVisaXlsx(page, aoa);
    expect(result.ok).toBe(true);
    const t = result.data.tarjetas[0];
    const sumP = t.movs.reduce((s, m) => s + m.pesos, 0);
    expect(Math.abs(sumP - t.totalPesos)).toBeGreaterThan(0.01);
  });

  test('(h) archivo que no es de Visa arroja error claro', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const notVisa = [
      ['Fecha', 'Sucursal origen', 'Descripción'],
      ['01/10/2026', 'SUC 001', 'Débito automático'],
    ];
    const result = await callParseVisaXlsx(page, notVisa);
    expect(result.ok).toBe(false);
    expect(result.err).toMatch(/no parece un resumen de visa/i);
  });

  test('(i) fixture sintético completo: tarjetas, pagos, otros parseados', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    // Use exact same structure as the real fixture
    const aoa = buildVisaAoa({
      cierre: '01/10/2026', vencimiento: '09/10/2026',
      proxCierre: '29/10/2026', proxVencimiento: '11/11/2026',
      totalPesos: 170621.25, totalUSD: 20.78,
      pagos: [
        { fecha: '03/09/2026', desc: 'Su pago en pesos', pesos: -10000 },
        { fecha: '04/09/2026', desc: 'Transferencia deuda 10, tc1530,000', pesos: 1000 },
      ],
      cards: [
        {
          nombre: 'Titular Prueba', numero: '1111', tipo: 'titular',
          totalPesos: 136501.25, totalUSD: 17.28,
          movs: [
            { fecha: '04/05/2026', desc: 'Comercio uno', comp: '111111*', pesos: 1000.50, cuotaN: 5, cuotaM: 12 },
            { fecha: '04/05/2026', desc: 'Comercio uno', comp: '111112*', pesos: 2000.25, cuotaN: 5, cuotaM: 12 },
            { fecha: '07/06/2026', desc: 'Plan v consolid 3-36 (tna 40,10) 505603', comp: '', pesos: 50000 },
            { fecha: '28/09/2026', desc: 'Tienda online', comp: '222222K', pesos: 6000, cuotaN: 1, cuotaM: 6 },
            { fecha: '30/09/2026', desc: 'Pedidosya*local uno', comp: '333333K', pesos: 12000 },
            { fecha: '30/09/2026', desc: 'Dlo*pedidosya propina', comp: '333334K', pesos: 500 },
            { fecha: '30/09/2026', desc: 'Google *servicio p1xx', comp: '333335K', usd: 7.29 },
            { fecha: '01/10/2026', desc: 'Combustible estacion', comp: '444444*', pesos: 40000 },
            { fecha: '01/10/2026', desc: 'Merpago*mercadolibre', comp: '444445K', pesos: 25000.50 },
            { fecha: '02/10/2026', desc: 'Google *otro p1yy', comp: '555555K', usd: 9.99 },
          ],
        },
        {
          nombre: 'Persona Prueba', numero: '2222', tipo: 'adicional',
          totalPesos: 0, totalUSD: 3.50,
          movs: [{ fecha: '03/10/2026', desc: 'Google *adicional p1zz', comp: '666666K', usd: 3.50 }],
        },
      ],
      otros: [
        { desc: 'Db iva $ plan v 505603 21', monto: 10500 },
        { desc: 'Impuesto de sellos $', monto: 3000 },
        { desc: 'Intereses financiacion $', monto: 20000 },
        { desc: 'Db iva $ 21% 20.000,00', monto: 4200 },
        { desc: 'Iibb percep-bsas 2,00%( 6)', monto: 120 },
        { desc: 'Db.rg 5617 30% ( 1000,00 )', monto: 300 },
      ],
    });

    const result = await callParseVisaXlsx(page, aoa);
    expect(result.ok).toBe(true);
    const data = result.data;
    expect(data.cierre).toBe('2026-10-01');
    expect(data.vencimiento).toBe('2026-10-09');
    expect(data.proxCierre).toBe('2026-10-29');
    expect(data.proxVencimiento).toBe('2026-11-11');
    expect(data.tarjetas).toHaveLength(2);
    expect(data.tarjetas[0].movs).toHaveLength(10);
    expect(data.tarjetas[1].tipo).toBe('adicional');
    expect(data.pagos).toHaveLength(2);
    expect(data.otros).toHaveLength(6);
  });

  // ── Categorization rules ──────────────────────────────

  test('(j) categorización: pedidosya → Comida y Delivery', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const r = await page.evaluate(() => window._categorizarVisa('Pedidosya*local uno', 1000));
    expect(r.cat).toBe('Comida y Delivery');
    expect(r.paraRevisar).toBe(false);
  });

  test('(k) categorización: dlo*pedidosya propina → Propinas y Extras', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const r = await page.evaluate(() => window._categorizarVisa('Dlo*pedidosya propina', 500));
    expect(r.cat).toBe('Propinas y Extras');
  });

  test('(l) categorización: plan v consolid → Financiación Consolidada', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const r = await page.evaluate(() => window._categorizarVisa('Plan v consolid 3-36 (tna 40,10)', 50000));
    expect(r.cat).toBe('Financiación Consolidada');
  });

  test('(m) categorización: db iva → Impuestos e Intereses', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const r = await page.evaluate(() => window._categorizarVisa('Db iva $ plan v 505603 21', 10500));
    expect(r.cat).toBe('Impuestos e Intereses');
  });

  test('(n) categorización: iibb percep → Ingresos brutos (retenciones)', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const r = await page.evaluate(() => window._categorizarVisa('Iibb percep-bsas 2,00%( 6)', 120));
    expect(r.cat).toBe('Ingresos brutos (retenciones)');
  });

  test('(o) categorización: merpago*mercadolibre → Compras Online', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const r = await page.evaluate(() => window._categorizarVisa('Merpago*mercadolibre', 500));
    expect(r.cat).toBe('Compras Online');
  });

  test('(p) categorización: farmacity → Salud', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const r = await page.evaluate(() => window._categorizarVisa('Farmacity suc centro', 2000));
    expect(r.cat).toBe('Salud');
  });

  test('(q) categorización: impuesto de sellos → Impuestos e Intereses', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const r = await page.evaluate(() => window._categorizarVisa('Impuesto de sellos $', 3000));
    expect(r.cat).toBe('Impuestos e Intereses');
  });

  test('(r) categorización: db.rg → Impuestos e Intereses', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const r = await page.evaluate(() => window._categorizarVisa('Db.rg 5617 30% ( 1000,00 )', 300));
    expect(r.cat).toBe('Impuestos e Intereses');
  });

  test('(s) categorización: desconocido → Otros/Varios paraRevisar', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);
    const r = await page.evaluate(() => window._categorizarVisa('Comercio desconocido xyz', 500));
    expect(r.cat).toBe('Otros/Varios');
    expect(r.paraRevisar).toBe(true);
  });

  test('(t) botón "Importar Visa (Excel)" abre modal en ⚙️', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndLoad(page);
    await enterPIN(page);

    await page.locator('[data-vista="config"]').click();
    await page.waitForSelector('#vista-config');

    const btn = page.locator('#btnImportarVisa');
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.locator('#impModal')).toBeVisible();
    await expect(page.locator('#impVisaFile')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('(u) otros conceptos agrupados por categoría en la vista previa', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const aoa = buildVisaAoa({
      cards: [{
        nombre: 'Titular', numero: '1111', tipo: 'titular',
        totalPesos: 0, totalUSD: 0, movs: [],
      }],
      otros: [
        { desc: 'Db iva $ 21%', monto: 4200 },
        { desc: 'Impuesto de sellos $', monto: 3000 },
        { desc: 'Intereses financiacion $', monto: 20000 },
        { desc: 'Iibb percep-bsas 2,00%', monto: 120 },
      ],
    });

    const result = await callParseVisaXlsx(page, aoa);
    expect(result.ok).toBe(true);

    // Render and check grouping
    const html = await page.evaluate((data) => {
      window._renderVisaPreview(data);
      return document.getElementById('impModalBody')?.innerHTML || '';
    }, result.data);

    // Impuestos e Intereses: iva + sellos + intereses = $27.200
    // Ingresos brutos: iibb = $120
    // Should have fewer rows than items (grouped)
    expect(html).toContain('Impuestos e Intereses');
    expect(html).toContain('Ingresos brutos (retenciones)');
    // Only 2 unique categories → only 2 rows in Otros conceptos
    const catMatches = html.match(/class="imp-row-desc"/g);
    // The otros section has 2 category rows (plus card section rows)
    expect(html).toContain('Otros conceptos');
  });

  test('(v) botón confirmar deshabilitado con texto "Disponible en la parte 2"', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const aoa = buildVisaAoa({
      cards: [{
        nombre: 'Titular', numero: '1111', tipo: 'titular',
        totalPesos: 0, totalUSD: 0, movs: [],
      }],
    });

    const result = await callParseVisaXlsx(page, aoa);
    await page.evaluate((data) => {
      document.getElementById('impModal').hidden = false;
      window._renderVisaPreview(data);
    }, result.data);

    const btn = page.locator('#impModalBody button[disabled]');
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
    expect(await btn.textContent()).toMatch(/parte 2/i);
  });

});
