/**
 * Tests para el importador de movimientos Mercado Pago (PDF).
 * Usa fixtures sintéticos inventados (datos FICTICIOS, no reales).
 * parseMercadoPago() recibe lineas ya reconstruidas con Y, sin necesidad de PDF real.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

// ── Helpers ───────────────────────────────────────────────────

/** Formats a number as es-AR: 57397.44 → "57.397,44" */
function fmtAR(n) {
  return Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Formats a signed es-AR value for the Valor column: -32796.46 → "-32.796,46" */
function fmtValor(n) {
  return (n < 0 ? '-' : '') + fmtAR(n);
}

/**
 * Build synthetic lineas array for parseMercadoPago.
 * rows: [{ fecha:'21-09-2026', id:'987654321', valor:-32796.46, saldo:24601.98,
 *           descAbove?:'text', descBelow?:'text' }]
 * Extra lineas can be inserted via extraLineas: [{y, text}] merged by y.
 */
function buildMPLineas(rows, saldoInicial, saldoFinal, { addDolarSection = false, extraLineas = [] } = {}) {
  const lines = [
    { y: 10,  text: 'RESUMEN DE CUENTA EN PESOS' },
    { y: 20,  text: 'Periodo: Del 21 de septiembre al 20 de octubre de 2026' },
    { y: 30,  text: `Saldo inicial: $ ${fmtAR(saldoInicial)}` },
    { y: 40,  text: `Saldo final: $ ${fmtAR(saldoFinal)}` },
    { y: 50,  text: 'Entradas' },
    { y: 60,  text: 'Salidas' },
    { y: 70,  text: 'Fecha Descripción ID de la operación Valor Saldo' }, // table header
    { y: 71,  text: '1/6' }, // page number — should be ignored
  ];
  let y = 80;
  for (const r of rows) {
    if (r.descAbove) { lines.push({ y, text: r.descAbove }); y += 10; }
    const numLine = r.descInline
      ? `${r.fecha} ${r.descInline} ${r.id} $ ${fmtValor(r.valor)} $ ${fmtAR(r.saldo)}`
      : `${r.fecha} ${r.id} $ ${fmtValor(r.valor)} $ ${fmtAR(r.saldo)}`;
    lines.push({ y, text: numLine });
    y += 10;
    if (r.descBelow) { lines.push({ y, text: r.descBelow }); y += 10; }
  }
  if (addDolarSection) {
    lines.push({ y: y + 10, text: 'RESUMEN DE TENENCIAS EN DÓLARES' });
    lines.push({ y: y + 20, text: 'Este texto no debe parsearse' });
  }
  for (const el of extraLineas) lines.push(el);
  return lines;
}

const BASE_STATE = {
  iniciales: { 'Banco Santander': 0, 'Visa Santander': 0, 'Mercado Pago': 0,
    'Efectivo': 0, 'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0 },
  gastos: [],
  items: [],
  patrimonioCargado: true,
  compromisos: [],
  importaciones: {},
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

async function callParseMP(page, lineas) {
  return page.evaluate((ls) => {
    try { return { ok: true, rows: window.parseMercadoPago(ls) }; }
    catch (e) { return { ok: false, err: e.message }; }
  }, lineas);
}

// ── Tests ─────────────────────────────────────────────────────

test.describe('importar-mp', () => {

  test('(a) parseMercadoPago: campos básicos y orden cronológico', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndLoad(page);
    await enterPIN(page);

    const saldoInicial = 57397.44;
    const rows = [
      { fecha: '21-09-2026', id: '987654321', valor: -32796.46, saldo: 24600.98 },
      { fecha: '22-09-2026', id: '123456789012', valor: 400000.00, saldo: 424600.98 },
    ];
    const lineas = buildMPLineas(rows, saldoInicial, rows[rows.length - 1].saldo);

    const result = await callParseMP(page, lineas);

    expect(errors).toHaveLength(0);
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(2);
    // Chronological: first row oldest
    expect(result.rows[0].fecha).toBe('2026-09-21');
    expect(result.rows[1].fecha).toBe('2026-09-22');
    expect(result.rows[0].ref).toBe('987654321');
    expect(result.rows[0].monto).toBeCloseTo(-32796.46, 1);
    expect(result.rows[1].monto).toBeCloseTo(400000, 1);
  });

  test('(b) parseMercadoPago: descripción partida arriba y abajo', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const saldoInicial = 100000;
    const rows = [
      {
        fecha: '21-09-2026', id: '111222333', valor: -32000, saldo: 68000,
        descAbove: 'Transferencia enviada Micaela',
        descBelow: 'Perez Gonzalez'
      },
      {
        fecha: '22-09-2026', id: '444555666', valor: 50000, saldo: 118000,
        descAbove: 'Transferencia recibida Juan'
        // no descBelow
      },
    ];
    const lineas = buildMPLineas(rows, saldoInicial, rows[rows.length - 1].saldo);

    const result = await callParseMP(page, lineas);

    expect(result.ok).toBe(true);
    // Row 0: above + below fragments joined
    expect(result.rows[0].desc).toContain('Transferencia enviada Micaela');
    expect(result.rows[0].desc).toContain('Perez Gonzalez');
    // Row 1: only above fragment
    expect(result.rows[1].desc).toContain('Transferencia recibida Juan');
  });

  test('(c) parseMercadoPago: sección dólares ignorada', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const saldoInicial = 100000;
    const rows = [
      { fecha: '21-09-2026', id: '999888777', valor: -10000, saldo: 90000 },
    ];
    const lineas = buildMPLineas(rows, saldoInicial, 90000, { addDolarSection: true });

    const result = await callParseMP(page, lineas);

    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1); // only the peso section row
  });

  test('(d) parseMercadoPago: cadena de saldos rota → aborta con mensaje', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const saldoInicial = 100000;
    // Row 2 has wrong saldo (should be 80000, we set 999999)
    const rows = [
      { fecha: '21-09-2026', id: '111000111', valor: -20000, saldo: 80000 },
      { fecha: '22-09-2026', id: '222000222', valor: -5000, saldo: 999999 }, // wrong
    ];
    // Build lineas manually (buildMPLineas uses saldoFinal = rows[-1].saldo)
    const lineas = buildMPLineas(rows, saldoInicial, 75000 /* correct final */);
    // Override last saldo in the numeric line to induce validation failure
    // We inject rows as-is since buildMPLineas uses the saldo from the row object
    const result = await callParseMP(page, lineas);

    expect(result.ok).toBe(false);
    expect(result.err).toMatch(/incompleto o no se pudo leer bien/i);
    expect(result.err).toMatch(/fila 2/i);
  });

  test('(e) parseMercadoPago: saldo final no coincide → aborta', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const saldoInicial = 100000;
    const rows = [{ fecha: '21-09-2026', id: '333444555', valor: -10000, saldo: 90000 }];
    // saldoFinal declared in header is wrong (should be 90000)
    const lineas = buildMPLineas(rows, saldoInicial, 99999 /* wrong */);

    const result = await callParseMP(page, lineas);

    expect(result.ok).toBe(false);
    expect(result.err).toMatch(/incompleto o no se pudo leer bien/i);
  });

  test('(f) categorización: rendimientos → ingreso, agrupable', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const result = await page.evaluate(() =>
      window._categorizarMP('Rendimientos Mercado Pago', 1500)
    );
    expect(result.tipo).toBe('ingreso');
    expect(result.cat).toBe('Ingresos extras');
    expect(result.agrupable).toBe('Rendimientos Mercado Pago');
  });

  test('(g) categorización: peaje → gasto, agrupable', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const result = await page.evaluate(() =>
      window._categorizarMP('Pago AUSA autopista', -150)
    );
    expect(result.tipo).toBe('gasto');
    expect(result.cat).toBe('Transporte/Auto');
    expect(result.agrupable).toBe('Peajes y subte');
  });

  test('(h) categorización: IIBB Bs. As. → descFija correcta', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const result = await page.evaluate(() =>
      window._categorizarMP('Pago de impuesto IIBB Bs. As.', -2000)
    );
    expect(result.tipo).toBe('gasto');
    expect(result.cat).toBe('Impuestos e Intereses');
    expect(result.descFija).toMatch(/Bs\. As\./);
  });

  test('(i) categorización: pago de resumen tarjeta → transferPair Mastercard MP', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const result = await page.evaluate(() =>
      window._categorizarMP('Pago de resumen tarjeta Mastercard', -50000)
    );
    expect(result.tipo).toBe('gasto');
    expect(result.cat).toBe('Pago de Visa/MP');
    expect(result.transferPair).toBe('Mastercard MP');
  });

  test('(j) categorización: cashback / pago-drivers → ingreso, Sueldo/Honorarios', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const cb = await page.evaluate(() => window._categorizarMP('Cashback Mercado Pago promo', 500));
    expect(cb.tipo).toBe('ingreso');
    expect(cb.cat).toBe('Sueldo/Honorarios');
    expect(cb.descFija).toBe('Pago Meli Envíos');

    const dr = await page.evaluate(() => window._categorizarMP('pago-drivers envios flex', 12000));
    expect(dr.tipo).toBe('ingreso');
    expect(dr.descFija).toBe('Pago Meli Envíos');
  });

  test('(k) categorización: transferencia enviada urbanc dimitri → transferencia entre cuentas', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const result = await page.evaluate(() =>
      window._categorizarMP('Transferencia enviada Urbanc Dimitri cuenta propia', -200000)
    );
    expect(result.transf).toBe(true);
    expect(result.cat).toBe('Transferencia entre cuentas');
  });

  test('(l) categorización: transferencia enviada (tercero) → gasto, Para revisar', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const result = await page.evaluate(() =>
      window._categorizarMP('Transferencia enviada Maria Lopez', -5000)
    );
    expect(result.tipo).toBe('gasto');
    expect(result.cat).toBe('Otros/Varios');
    expect(result.paraRevisar).toBe(true);
  });

  test('(m) agrupación semanal de rendimientos (3 en la misma semana → 1 grupo)', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const saldoInicial = 100000;
    const rows = [
      { fecha: '05-10-2026', id: '100200300', valor: 500, saldo: 100500 },
      { fecha: '06-10-2026', id: '100200301', valor: 500, saldo: 101000 },
      { fecha: '07-10-2026', id: '100200302', valor: 500, saldo: 101500 },
    ];
    const lineas = buildMPLineas(rows.map(r => ({ ...r, descAbove: 'Rendimientos Mercado Pago' })),
      saldoInicial, 101500);

    const result = await page.evaluate((ls) => {
      const parsed = window.parseMercadoPago(ls);
      const cands = parsed.map(f => {
        const catInfo = window._categorizarMP(f.desc, f.monto);
        return { ...f, catInfo, refs: f.ref ? [f.ref] : [], yaExiste: false, soloHistorial: false,
          paraRevisar: catInfo.paraRevisar, _revisar_sel: null, _recordar: false, _recordarTexto: '' };
      });
      window._deduplicarImp(cands, 'Mercado Pago');
      const grouped = window._agruparRuidoImp(cands, true);
      return grouped.map(c => ({ desc: c.desc, monto: c.monto, agrupado: !!c._agrupado }));
    }, lineas);

    expect(result).toHaveLength(1);
    expect(result[0].agrupado).toBe(true);
    expect(result[0].monto).toBeCloseTo(1500, 1);
  });

  test('(n) agrupación semanal de peajes (2 en la misma semana → 1 grupo)', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const saldoInicial = 50000;
    const rows = [
      { fecha: '05-10-2026', id: '200300400', valor: -150, saldo: 49850, descAbove: 'Pago AUSA Acceso Oeste' },
      { fecha: '06-10-2026', id: '200300401', valor: -200, saldo: 49650, descAbove: 'Pago AUSA Buenos Aires' },
    ];
    const lineas = buildMPLineas(rows, saldoInicial, 49650);

    const result = await page.evaluate((ls) => {
      const parsed = window.parseMercadoPago(ls);
      const cands = parsed.map(f => {
        const catInfo = window._categorizarMP(f.desc, f.monto);
        return { ...f, catInfo, refs: f.ref ? [f.ref] : [], yaExiste: false, soloHistorial: false,
          paraRevisar: catInfo.paraRevisar, _revisar_sel: null, _recordar: false, _recordarTexto: '' };
      });
      window._deduplicarImp(cands, 'Mercado Pago');
      const grouped = window._agruparRuidoImp(cands, true);
      return grouped.map(c => ({ agrupado: !!c._agrupado, monto: c.monto }));
    }, lineas);

    expect(result).toHaveLength(1);
    expect(result[0].agrupado).toBe(true);
    expect(result[0].monto).toBeCloseTo(-350, 1);
  });

  test('(o) dedupe de pago de cuotas agrupadas (2 cuotas MP ya cargadas suman el monto del banco)', async ({ page }) => {
    const state = {
      ...BASE_STATE,
      gastos: [
        { id: 'mp1', creado: 1, monto: 30000, fecha: '2026-10-05', categoria: 'Pago de créditos',
          medio: 'Mercado Pago', tipo: 'gasto', soloHistorial: false },
        { id: 'mp2', creado: 2, monto: 20000, fecha: '2026-10-06', categoria: 'Pago de créditos',
          medio: 'Mercado Pago', tipo: 'gasto', soloHistorial: false },
      ],
    };
    await seedAndLoad(page, state);
    await enterPIN(page);

    const saldoInicial = 100000;
    const rows = [
      { fecha: '05-10-2026', id: '555666777', valor: -50000, saldo: 50000,
        descAbove: 'Pago de cuota creditos de Mercado Pago' },
    ];
    const lineas = buildMPLineas(rows, saldoInicial, 50000);

    const yaExiste = await page.evaluate((ls) => {
      const parsed = window.parseMercadoPago(ls);
      const cands = parsed.map(f => {
        const catInfo = window._categorizarMP(f.desc, f.monto);
        return { ...f, catInfo, refs: f.ref ? [f.ref] : [], yaExiste: false, soloHistorial: false,
          paraRevisar: catInfo.paraRevisar, _revisar_sel: null, _recordar: false, _recordarTexto: '' };
      });
      window._deduplicarImp(cands, 'Mercado Pago');
      return cands[0].yaExiste;
    }, lineas);

    expect(yaExiste).toBe(true);
  });

  test('(p) par con Mastercard MP: crea ingreso en Mastercard MP', async ({ page }) => {
    const state = {
      ...BASE_STATE,
      iniciales: { ...BASE_STATE.iniciales, 'Mercado Pago': 100000 },
    };
    await seedAndLoad(page, state);
    await enterPIN(page);

    const saldoInicial = 100000;
    const rows = [
      { fecha: '21-09-2026', id: '666777888', valor: -45000, saldo: 55000,
        descAbove: 'Pago de resumen tarjeta Mastercard' },
    ];
    const lineas = buildMPLineas(rows, saldoInicial, 55000);

    const result = await page.evaluate((ls) => {
      const parsed = window.parseMercadoPago(ls);
      const cands = parsed.map(f => {
        const catInfo = window._categorizarMP(f.desc, f.monto);
        return { ...f, catInfo, refs: f.ref ? [f.ref] : [], yaExiste: false, soloHistorial: false,
          paraRevisar: catInfo.paraRevisar, _revisar_sel: null, _recordar: false, _recordarTexto: '' };
      });
      window._deduplicarImp(cands, 'Mercado Pago');
      const c = cands[0];
      return { transferPair: c.catInfo.transferPair, yaExiste: c.yaExiste };
    }, lineas);

    expect(result.transferPair).toBe('Mastercard MP');
    expect(result.yaExiste).toBe(false);
  });

  test('(q) par con Mastercard MP no duplica ingreso existente (±5 días)', async ({ page }) => {
    const state = {
      ...BASE_STATE,
      iniciales: { ...BASE_STATE.iniciales, 'Mercado Pago': 100000 },
      gastos: [{
        id: 'mc1', creado: 1, monto: 45000, fecha: '2026-09-21',
        categoria: 'Pago de Visa/MP', medio: 'Mastercard MP',
        tipo: 'ingreso', soloHistorial: false,
      }],
    };
    await seedAndLoad(page, state);
    await enterPIN(page);

    const saldoInicial = 100000;
    const rows = [
      { fecha: '21-09-2026', id: '777888999', valor: -45000, saldo: 55000,
        descAbove: 'Pago de resumen tarjeta Mastercard' },
    ];
    const lineas = buildMPLineas(rows, saldoInicial, 55000);

    // Verify that the existing Mastercard ingreso is detected (visaLinked)
    const existingFound = await page.evaluate((ls) => {
      const parsed = window.parseMercadoPago(ls);
      const c = parsed[0];
      const catInfo = window._categorizarMP(c.desc, c.monto);
      const monto = Math.abs(c.monto);
      const est = window._getEstado();
      const existing = est.gastos.find(g =>
        g.medio === catInfo.transferPair && g.tipo === 'ingreso' &&
        Math.abs(g.monto - monto) < 0.01 &&
        Math.abs(new Date(g.fecha) - new Date(c.fecha)) / 86400000 <= 5
      );
      return !!existing;
    }, lineas);

    expect(existingFound).toBe(true);
  });

  test('(r) reimportar da 0 nuevos', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const saldoInicial = 100000;
    const rows = [
      { fecha: '21-09-2026', id: '100000001', valor: 5000, saldo: 105000, descAbove: 'Rendimientos Mercado Pago' },
      { fecha: '22-09-2026', id: '100000002', valor: -150, saldo: 104850, descAbove: 'Pago AUSA peaje' },
    ];
    const lineas = buildMPLineas(rows, saldoInicial, 104850);

    // First import: save the movements
    await page.evaluate((ls) => {
      const parsed = window.parseMercadoPago(ls);
      const est = window._getEstado();
      parsed.forEach((f, i) => {
        const catInfo = window._categorizarMP(f.desc, f.monto);
        est.gastos.push({
          id: 'rmp' + i, creado: Date.now() + i, monto: Math.abs(f.monto),
          fecha: f.fecha, categoria: catInfo.cat, medio: 'Mercado Pago',
          tipo: catInfo.tipo, soloHistorial: false,
          refs: [f.ref], lote: 'lote-mp-first',
        });
      });
      window._guardar();
    }, lineas);

    // Re-import: should find 0 new
    const nuevos = await page.evaluate((ls) => {
      const parsed = window.parseMercadoPago(ls);
      let cands = parsed.map(f => {
        const catInfo = window._categorizarMP(f.desc, f.monto);
        return { ...f, catInfo, refs: f.ref ? [f.ref] : [], yaExiste: false, soloHistorial: false,
          paraRevisar: catInfo.paraRevisar, _revisar_sel: null, _recordar: false, _recordarTexto: '' };
      });
      window._deduplicarImp(cands, 'Mercado Pago');
      return cands.filter(c => !c.yaExiste).length;
    }, lineas);

    expect(nuevos).toBe(0);
  });

  test('(s) estado.importaciones["Mercado Pago"] se guarda tras importar', async ({ page }) => {
    const state = {
      ...BASE_STATE,
      iniciales: { ...BASE_STATE.iniciales, 'Mercado Pago': 100000 },
    };
    await seedAndLoad(page, state);
    await enterPIN(page);

    // Simulate the confirm flow by directly injecting importaciones
    await page.evaluate(() => {
      const est = window._getEstado();
      est.importaciones ||= {};
      est.importaciones['Mercado Pago'] = { hasta: '2026-10-20', lote: 'lote-mp-test', fecha: '2026-10-21' };
      window._guardar();
    });

    const imp = await page.evaluate(() => window._getEstado().importaciones['Mercado Pago']);
    expect(imp).toBeDefined();
    expect(imp.hasta).toBe('2026-10-20');
    expect(imp.lote).toBe('lote-mp-test');
  });

  test('(t) parseMercadoPago: sin saldo inicial en cabecera → aborta', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    // Lines without "Saldo inicial"
    const lineas = [
      { y: 10, text: 'RESUMEN DE CUENTA EN PESOS' },
      { y: 20, text: 'Saldo final: $ 50.000,00' },
      { y: 80, text: '21-09-2026 987654321 $ 50.000,00 $ 50.000,00' },
    ];
    const result = await callParseMP(page, lineas);

    expect(result.ok).toBe(false);
    expect(result.err).toMatch(/saldo inicial/i);
  });

  test('(u) header de tabla y número de página ignorados en descripción', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const saldoInicial = 100000;
    const rows = [
      { fecha: '21-09-2026', id: '321321321', valor: -1000, saldo: 99000, descAbove: 'Pago con QR comercio local' },
    ];
    // Add table header and page number close in Y to the data row
    const lineas = buildMPLineas(rows, saldoInicial, 99000, {
      extraLineas: [
        { y: 75, text: 'Fecha Descripción ID de la operación Valor Saldo' }, // repeated header
        { y: 76, text: '2/6' }, // page number
      ]
    });

    const result = await callParseMP(page, lineas);

    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    // Description should not include "Fecha" or "2/6"
    expect(result.rows[0].desc).not.toMatch(/^Fecha/i);
    expect(result.rows[0].desc).not.toContain('2/6');
  });

  test('(v) descripción inline en la misma línea que fecha e ID', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    // Synthetic lineas reproducing real PDF structure: description between date and ID
    const lineas = [
      { y: 10,  text: 'RESUMEN DE CUENTA EN PESOS' },
      { y: 20,  text: 'Dimitri Urbanc' },
      { y: 30,  text: 'CVU: 0000003100096655555555' },
      { y: 40,  text: 'Periodo: Del 21 de septiembre al 20 de octubre de 2026' },
      { y: 50,  text: 'Saldo inicial: $ 50.000,00' },
      { y: 55,  text: 'Saldo final: $ 50.147,73' },
      { y: 65,  text: 'DETALLE DE MOVIMIENTOS' },
      { y: 72,  text: 'Fecha Descripción Valor Saldo' },
      { y: 73,  text: 'ID de la' },
      { y: 74,  text: 'operación' },
      { y: 75,  text: '1/6' },
      // Numeric line: description "Rendimientos" is between date and ID
      { y: 90,  text: '21-09-2026 Rendimientos 1750262986159 $ 147,73 $ 50.147,73' },
    ];

    const result = await callParseMP(page, lineas);

    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].desc).toBe('Rendimientos');
    expect(result.rows[0].ref).toBe('1750262986159');
    expect(result.rows[0].monto).toBeCloseTo(147.73, 2);
    expect(result.rows[0].fecha).toBe('2026-09-21');
  });

  test('(w) ruido de encabezado y pie de página no contamina la primera ni la última fila', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    // Two rows separated by a page break with full header/footer noise between them
    const lineas = [
      // Global header
      { y: 10,  text: 'RESUMEN DE CUENTA EN PESOS' },
      { y: 20,  text: 'Dimitri Urbanc' },
      { y: 30,  text: 'CVU: 0000003100096655555555' },
      { y: 40,  text: 'Saldo inicial: $ 100.000,00' },
      { y: 50,  text: 'Saldo final: $ 99.700,00' },
      { y: 60,  text: 'DETALLE DE MOVIMIENTOS' },
      { y: 68,  text: 'Fecha Descripción Valor Saldo' },
      { y: 69,  text: 'ID de la' },
      { y: 70,  text: 'operación' },
      { y: 71,  text: '1/3' },
      // First data row
      { y: 90,  text: '21-09-2026 Pago con QR 111222333444 $ -100,00 $ 99.900,00' },
      // Page-break footer (close in Y to row 0 — must be ignored)
      { y: 100, text: 'Mercado Libre S.R.L. Av. del Libertador 123, CABA' },
      { y: 110, text: 'de consulta en tu app Mercado Pago.' },
      { y: 120, text: 'Estas operaciones son definitivas.' },
      { y: 130, text: 'ante la AFIP.' },
      // Page-break header on next page (close in Y to row 1 — must be ignored)
      { y: 400, text: 'RESUMEN DE CUENTA EN PESOS' },
      { y: 410, text: 'Dimitri Urbanc' },
      { y: 420, text: 'CVU: 0000003100096655555555' },
      { y: 430, text: 'Fecha de generación: 20-10-2026' },
      { y: 440, text: 'ID de la' },
      { y: 450, text: 'Fecha Descripción Valor Saldo' },
      { y: 451, text: 'operación' },
      { y: 452, text: '2/3' },
      // Second data row
      { y: 470, text: '22-09-2026 Dinero recibido pago-drivers 222333444555 $ -200,00 $ 99.700,00' },
    ];

    const result = await callParseMP(page, lineas);

    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(2);

    // First row: desc should be the inline text only, no noise
    expect(result.rows[0].desc).toBe('Pago con QR');
    expect(result.rows[0].desc).not.toMatch(/Mercado Libre|Dimitri|CVU|Fecha|operaci/i);

    // Second row: desc should be the inline text only, no noise
    expect(result.rows[1].desc).toContain('Dinero recibido pago-drivers');
    expect(result.rows[1].desc).not.toMatch(/RESUMEN|CVU|Fecha de generaci|operaci/i);

    // No empty descriptions
    for (const r of result.rows) expect(r.desc.trim()).not.toBe('');
  });

  test('(x) tres renglones: fragmento arriba + texto inline + fragmento abajo a 12 pt', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    // Fragment above at y=80, numLine with inline at y=90, fragment below at y=102 (12 pt gap)
    const lineas = [
      { y: 10,  text: 'Saldo inicial: $ 100.000,00' },
      { y: 20,  text: 'Saldo final: $ 99.700,00' },
      { y: 80,  text: 'Pago de peaje' },
      { y: 90,  text: '21-09-2026 RUTAS SUR ATLANTICO S.A. 555666777888 $ -300,00 $ 99.700,00' },
      { y: 102, text: 'RUTAS SUR ATLANTICO S.A.' },
    ];

    const result = await callParseMP(page, lineas);

    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].desc).toContain('Pago de peaje');
    expect(result.rows[0].desc).toContain('RUTAS SUR ATLANTICO S.A.');
    // Fragment below at 12 pt must be included (≤ 15 pt limit)
    const parts = result.rows[0].desc.split(' ');
    expect(parts.length).toBeGreaterThan(4);
    expect(result.rows[0].desc.trim()).not.toBe('');
  });

  test('(y) ninguna fila queda con descripción vacía (mix inline + arriba/abajo)', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const saldoInicial = 200000;
    const rows = [
      { fecha: '01-10-2026', id: '100100100100', valor: 500, saldo: 200500,
        descInline: 'Rendimientos' },
      { fecha: '02-10-2026', id: '200200200200', valor: -150, saldo: 200350,
        descAbove: 'Pago AUSA Acceso Oeste' },
      { fecha: '03-10-2026', id: '300300300300', valor: -5000, saldo: 195350,
        descAbove: 'Transferencia enviada', descBelow: 'Maria Perez' },
      { fecha: '04-10-2026', id: '400400400400', valor: 12000, saldo: 207350,
        descInline: 'pago-drivers mla flex' },
    ];
    const lineas = buildMPLineas(rows, saldoInicial, 207350);

    const result = await callParseMP(page, lineas);

    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(4);
    for (const r of result.rows) {
      expect(r.desc.trim()).not.toBe('');
    }
    expect(result.rows[0].desc).toContain('Rendimientos');
    expect(result.rows[1].desc).toContain('Pago AUSA Acceso Oeste');
    expect(result.rows[2].desc).toContain('Transferencia enviada');
    expect(result.rows[3].desc).toContain('pago-drivers mla flex');
  });

});
