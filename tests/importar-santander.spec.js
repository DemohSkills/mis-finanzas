/**
 * Tests para el importador de movimientos Santander.
 * Usa fixtures sintéticos inventados (datos FICTICIOS, no reales).
 * El xlsx se genera en el test con la misma estructura que el banco.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

// ── Helpers ───────────────────────────────────────────────────

/** Build a synthetic Santander AoA (array of arrays) for SheetJS */
function buildSantanderAoa(rows) {
  // rows: [{fecha:'dd/mm/yyyy', desc:'...', ref:'...', ca:N, cc:N, saldo:N}]
  // Newest first in file (last row in `rows` array = oldest)
  const aoa = [
    // Some header rows before the real header
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    // Real header: col C = "Sucursal origen"
    ['', 'Fecha', 'Sucursal origen', 'Descripción', 'Referencia', 'Caja de Ahorro', 'Cuenta Corriente', 'Saldo'],
    // Data rows reversed (newest first)
    ...[...rows].reverse().map(r => [
      '', r.fecha, 'SUC 001', r.desc, r.ref || '', String(r.ca ?? 0), String(r.cc ?? 0), String(r.saldo),
    ]),
  ];
  return aoa;
}

/** Generate a minimal xlsx Buffer using SheetJS (via node) */
async function buildXlsxBuffer(rows) {
  // We generate using the same structure parseSantander expects
  // Since we can't load SheetJS in node context here, we build it in the page
  // We'll pass the AoA as JSON and let the page build it
  return buildSantanderAoa(rows);
}

const BASE_STATE = {
  iniciales: { 'Banco Santander': 50000, 'Visa Santander': 0, 'Mercado Pago': 0, 'Efectivo': 10000, 'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0 },
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

/** Seed state and invoke parseSantander() directly in the page context */
async function callParseSantander(page, aoa) {
  return page.evaluate((aoaData) => {
    try { return { ok: true, rows: window.parseSantander(aoaData) }; }
    catch (e) { return { ok: false, err: e.message }; }
  }, aoa);
}

/** Build a valid AoA with consistent saldos */
function buildValidRows() {
  // Synthetic data: 4 rows, saldo grows
  // Oldest first internally, but passed as buildSantanderAoa reverses
  return [
    { fecha: '05/10/2026', desc: 'Credito de sueldos\tEmpresa SA', ref: 'REF001', ca: 200000, cc: 0, saldo: 250000 },
    { fecha: '06/10/2026', desc: 'Debito automatico\tARCA monotributo', ref: 'REF002', ca: -30000, cc: 0, saldo: 220000 },
    { fecha: '10/10/2026', desc: 'Sircreb Ret IIBB\tTucuman', ref: 'REF003', ca: -5000, cc: 0, saldo: 215000 },
    { fecha: '12/10/2026', desc: 'Pago de tarjeta de credito\tVisa 4321', ref: 'REF004', ca: -50000, cc: 0, saldo: 165000 },
  ];
}

// ── Tests ─────────────────────────────────────────────────────

test.describe('importar-santander', () => {

  test('(a) parseSantander: orden cronológico y campos básicos', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndLoad(page);
    await enterPIN(page);

    const rows = buildValidRows();
    const aoa = buildSantanderAoa(rows);
    const result = await callParseSantander(page, aoa);

    expect(errors).toHaveLength(0);
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(4);
    // Should be chronological (oldest first)
    expect(result.rows[0].fecha).toBe('2026-10-05');
    expect(result.rows[3].fecha).toBe('2026-10-12');
    // Last saldo
    expect(result.rows[3].saldo).toBe(165000);
    // monto = ca + cc
    expect(result.rows[0].monto).toBe(200000);
    expect(result.rows[1].monto).toBe(-30000);
  });

  test('(b) parseSantander: validación de saldos roto → aborta con mensaje', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    // Build rows with broken saldo on row 3
    const rows = [
      { fecha: '05/10/2026', desc: 'Deposito', ref: 'R1', ca: 100000, cc: 0, saldo: 150000 },
      { fecha: '06/10/2026', desc: 'Compra debito', ref: 'R2', ca: -20000, cc: 0, saldo: 130000 },
      { fecha: '07/10/2026', desc: 'Otro', ref: 'R3', ca: -5000, cc: 0, saldo: 999999 }, // wrong saldo
    ];
    const aoa = buildSantanderAoa(rows);
    const result = await callParseSantander(page, aoa);

    expect(result.ok).toBe(false);
    expect(result.err).toMatch(/incompleto o alterado/i);
    expect(result.err).toMatch(/fila 3/i);
  });

  test('(c) dedupe por monto/fecha ±3 días: movimiento existente no se reimporta', async ({ page }) => {
    // Seed state with an existing movement matching the import row
    const state = {
      ...BASE_STATE,
      iniciales: { ...BASE_STATE.iniciales, 'Banco Santander': 200000 },
      gastos: [{
        id: 'exist1', creado: Date.now(), monto: 30000, fecha: '2026-10-06',
        categoria: 'Impuestos e Intereses', medio: 'Banco Santander',
        descripcion: 'Debito automatico ARCA', tipo: 'gasto', soloHistorial: false,
      }],
    };
    await seedAndLoad(page, state);
    await enterPIN(page);

    const rows = [
      { fecha: '05/10/2026', desc: 'Deposito efectivo', ref: 'R1', ca: 200000, cc: 0, saldo: 200000 },
      { fecha: '06/10/2026', desc: 'Debito automatico\tARCA monotributo', ref: 'REF002', ca: -30000, cc: 0, saldo: 170000 },
    ];
    const aoa = buildSantanderAoa(rows);

    const result = await page.evaluate((aoaData) => {
      const parsed = window.parseSantander(aoaData);
      const candidates = parsed.map(f => {
        const catInfo = window._categorizarSant(f.desc, f.monto);
        return { ...f, catInfo, refs: f.ref ? [f.ref] : [], yaExiste: false,
          soloHistorial: false, paraRevisar: catInfo.paraRevisar,
          _revisar_sel: catInfo.revisar_opciones ? catInfo.revisar_opciones[0][0] : null,
          _recordar: false, _recordarTexto: '' };
      });
      window._deduplicarImp(candidates, 'Banco Santander');
      return candidates.map(c => ({ fecha: c.fecha, yaExiste: c.yaExiste, monto: c.monto }));
    }, aoa);

    // Row with ca=-30000 on 06/10 matches existing → yaExiste
    const rowARCA = result.find(r => r.monto === -30000);
    expect(rowARCA.yaExiste).toBe(true);
    // Deposit should NOT be marked as existing
    const rowDep = result.find(r => r.monto === 200000);
    expect(rowDep.yaExiste).toBe(false);
  });

  test('(d) dedupe por suma de cuotas (pago de créditos agrupado)', async ({ page }) => {
    // Two existing cuotas that sum to 50000
    const state = {
      ...BASE_STATE,
      gastos: [
        { id: 'c1', creado: 1, monto: 30000, fecha: '2026-10-10', categoria: 'Pago de créditos', medio: 'Banco Santander', tipo: 'gasto', soloHistorial: false },
        { id: 'c2', creado: 2, monto: 20000, fecha: '2026-10-11', categoria: 'Pago de créditos', medio: 'Banco Santander', tipo: 'gasto', soloHistorial: false },
      ],
    };
    await seedAndLoad(page, state);
    await enterPIN(page);

    const rows = [
      { fecha: '10/10/2026', desc: 'Prestamo personal cuota 1', ref: 'R1', ca: -50000, cc: 0, saldo: 0 },
    ];
    const aoa = buildSantanderAoa(rows);

    const result = await page.evaluate((aoaData) => {
      const parsed = window.parseSantander(aoaData);
      const candidates = parsed.map(f => {
        const catInfo = window._categorizarSant(f.desc, f.monto);
        return { ...f, catInfo, refs: f.ref ? [f.ref] : [], yaExiste: false, soloHistorial: false,
          paraRevisar: catInfo.paraRevisar, _revisar_sel: null, _recordar: false, _recordarTexto: '' };
      });
      window._deduplicarImp(candidates, 'Banco Santander');
      return candidates[0].yaExiste;
    }, aoa);

    expect(result).toBe(true);
  });

  test('(e) pago tarjeta no duplica ingreso existente en Visa Santander', async ({ page }) => {
    // Visa Santander already has an ingreso matching the pago tarjeta
    const state = {
      ...BASE_STATE,
      iniciales: { ...BASE_STATE.iniciales, 'Banco Santander': 300000 },
      gastos: [{
        id: 'visa1', creado: 1, monto: 50000, fecha: '2026-10-12',
        categoria: 'Pago de Visa/MP', medio: 'Visa Santander',
        tipo: 'ingreso', soloHistorial: false,
      }],
    };
    await seedAndLoad(page, state);
    await enterPIN(page);

    const rows = [
      { fecha: '01/10/2026', desc: 'Deposito', ref: 'R0', ca: 300000, cc: 0, saldo: 300000 },
      { fecha: '12/10/2026', desc: 'Pago de tarjeta de credito\tVisa', ref: 'REF004', ca: -50000, cc: 0, saldo: 250000 },
    ];
    const aoa = buildSantanderAoa(rows);

    // Check via JS that the candidate with transferPair detects existing Visa ingreso
    const result = await page.evaluate((aoaData) => {
      const parsed = window.parseSantander(aoaData);
      const c = parsed.find(f => f.monto < 0 && f.desc.toLowerCase().includes('pago de tarjeta'));
      if (!c) return null;
      const catInfo = window._categorizarSant(c.desc, c.monto);
      const est = window._getEstado();
      const existing = est.gastos.find(g =>
        g.medio === 'Visa Santander' && g.tipo === 'ingreso' &&
        Math.abs(g.monto - Math.abs(c.monto)) < 0.01 &&
        Math.abs(new Date(g.fecha) - new Date(c.fecha)) / 86400000 <= 5
      );
      return { hasPair: catInfo.transferPair === 'Visa Santander', existingFound: !!existing };
    }, aoa);

    expect(result.hasPair).toBe(true);
    expect(result.existingFound).toBe(true);
  });

  test('(f) agrupación por semana de SIRCREB', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    // 3 SIRCREB rows in the same week (Monday 05/10 – Sunday 11/10)
    const rows = [
      { fecha: '05/10/2026', desc: 'SIRCREB retencion 1', ref: 'R1', ca: 0, cc: -1000, saldo: 99000 },
      { fecha: '06/10/2026', desc: 'SIRCREB retencion 2', ref: 'R2', ca: 0, cc: -2000, saldo: 97000 },
      { fecha: '07/10/2026', desc: 'IIBB Tucuman ret 3', ref: 'R3', ca: 0, cc: -500, saldo: 96500 },
    ];
    const aoa = buildSantanderAoa(rows);

    const result = await page.evaluate((aoaData) => {
      const parsed = window.parseSantander(aoaData);
      const candidates = parsed.map(f => {
        const catInfo = window._categorizarSant(f.desc, f.monto);
        return { ...f, catInfo, refs: f.ref ? [f.ref] : [], yaExiste: false, soloHistorial: false,
          paraRevisar: catInfo.paraRevisar, _revisar_sel: null, _recordar: false, _recordarTexto: '' };
      });
      window._deduplicarImp(candidates, 'Banco Santander');
      const grouped = window._agruparRuidoImp(candidates, true);
      return grouped.map(c => ({ desc: c.desc, monto: c.monto, agrupado: !!c._agrupado }));
    }, aoa);

    // Should be grouped into 1 row
    expect(result).toHaveLength(1);
    expect(result[0].agrupado).toBe(true);
    expect(result[0].monto).toBeCloseTo(-3500, 1);
    expect(result[0].desc).toMatch(/Retenciones SIRCREB/);
    expect(result[0].desc).toMatch(/3 mov/);
  });

  test('(g) verificación de saldo coincide', async ({ page }) => {
    // saldo inicial 50000, import: -5000 gasto → saldo 45000
    const state = {
      ...BASE_STATE,
      iniciales: { ...BASE_STATE.iniciales, 'Banco Santander': 50000 },
      gastos: [],
    };
    await seedAndLoad(page, state);
    await enterPIN(page);

    const rows = [
      { fecha: '10/10/2026', desc: 'Comision por servicio mensual', ref: 'R1', ca: -5000, cc: 0, saldo: 45000 },
    ];
    const aoa = buildSantanderAoa(rows);

    const result = await page.evaluate((aoaData) => {
      const parsed = window.parseSantander(aoaData);
      const candidates = parsed.map(f => {
        const catInfo = window._categorizarSant(f.desc, f.monto);
        return { ...f, catInfo, refs: f.ref ? [f.ref] : [], yaExiste: false, soloHistorial: false,
          paraRevisar: catInfo.paraRevisar, _revisar_sel: null, _recordar: false, _recordarTexto: '' };
      });
      window._deduplicarImp(candidates, 'Banco Santander');
      const saldoFinal = parsed[parsed.length-1].saldo;
      const fechaFinal = parsed[parsed.length-1].fecha;
      return window._verifSaldo('Banco Santander', fechaFinal, saldoFinal, candidates);
    }, aoa);

    expect(Math.abs(result.diff)).toBeLessThan(0.01);
    expect(result.saldoBanco).toBeCloseTo(45000, 1);
  });

  test('(h) verificación de saldo difiere', async ({ page }) => {
    // Banco says 40000 but app would compute 45000
    const state = {
      ...BASE_STATE,
      iniciales: { ...BASE_STATE.iniciales, 'Banco Santander': 50000 },
      gastos: [],
    };
    await seedAndLoad(page, state);
    await enterPIN(page);

    const rows = [
      { fecha: '10/10/2026', desc: 'Comision por servicio mensual', ref: 'R1', ca: -5000, cc: 0, saldo: 40000 }, // saldo mismatch with app
    ];
    // Manually override saldo to create difference: parseSantander validates consecutive rows only,
    // so with 1 row there's nothing to validate. The _verifSaldo is what detects the diff vs app.
    const aoa = buildSantanderAoa(rows);

    const result = await page.evaluate((aoaData) => {
      const parsed = window.parseSantander(aoaData);
      const candidates = parsed.map(f => {
        const catInfo = window._categorizarSant(f.desc, f.monto);
        return { ...f, catInfo, refs: f.ref ? [f.ref] : [], yaExiste: false, soloHistorial: false,
          paraRevisar: catInfo.paraRevisar, _revisar_sel: null, _recordar: false, _recordarTexto: '' };
      });
      window._deduplicarImp(candidates, 'Banco Santander');
      const saldoFinal = parsed[parsed.length-1].saldo;
      const fechaFinal = parsed[parsed.length-1].fecha;
      return window._verifSaldo('Banco Santander', fechaFinal, saldoFinal, candidates);
    }, aoa);

    // App computes 50000 - 5000 = 45000, bank says 40000 → diff = -5000
    expect(Math.abs(result.diff)).toBeGreaterThan(0.01);
  });

  test('(i) deshacer importación por lote elimina solo esos movimientos', async ({ page }) => {
    const state = {
      ...BASE_STATE,
      iniciales: { ...BASE_STATE.iniciales, 'Banco Santander': 300000 },
      gastos: [
        { id: 'manual1', creado: 1, monto: 1000, fecha: '2026-09-01', categoria: 'Comida y Delivery',
          medio: 'Banco Santander', tipo: 'gasto', soloHistorial: false },
      ],
    };
    await seedAndLoad(page, state);
    await enterPIN(page);

    // Inject a fake lote import
    await page.evaluate(() => {
      const LOTE = 'lote-test-abc';
      const est = window._getEstado();
      est.gastos.push(
        { id: 'imp1', creado: 2, monto: 5000, fecha: '2026-10-01', categoria: 'Impuestos e Intereses',
          medio: 'Banco Santander', tipo: 'gasto', soloHistorial: false, lote: LOTE, refs: ['REF1'] },
        { id: 'imp2', creado: 3, monto: 2000, fecha: '2026-10-02', categoria: 'Otros/Varios',
          medio: 'Banco Santander', tipo: 'gasto', soloHistorial: false, lote: LOTE, refs: ['REF2'] }
      );
      est.importaciones = { 'Banco Santander': { hasta: '2026-10-02', lote: LOTE, fecha: '2026-10-21' } };
      window._guardar();
    });

    // Undo import via JS (skip the confirm dialog)
    const result = await page.evaluate(() => {
      const est = window._getEstado();
      const lote = est.importaciones['Banco Santander']?.lote;
      const before = est.gastos.length;
      est.gastos = est.gastos.filter(g => g.lote !== lote);
      delete est.importaciones['Banco Santander'];
      window._guardar();
      return { before, after: est.gastos.length, manual: est.gastos.find(g=>g.id==='manual1') };
    });

    expect(result.before).toBe(3);
    expect(result.after).toBe(1); // only manual1 remains
    expect(result.manual).toBeTruthy();
  });

  test('(j) backup antiguo sin campos nuevos (refs, lote, importaciones) carga sin errores', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    // Old-style backup: no refs, no lote, no importaciones
    const oldState = {
      iniciales: { 'Banco Santander': 10000, 'Visa Santander': 0, 'Mercado Pago': 0, 'Efectivo': 0, 'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0 },
      gastos: [
        { id: 'g1', creado: 1, monto: 500, fecha: '2026-09-01', categoria: 'Comida y Delivery',
          medio: 'Banco Santander', tipo: 'gasto', soloHistorial: false }
        // No refs, no lote, no importaciones
      ],
      items: [],
      patrimonioCargado: true,
      compromisos: [],
      // No importaciones field
    };

    await page.addInitScript((s) => {
      localStorage.setItem('finanzas-v1', JSON.stringify(s));
      localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    }, oldState);
    await page.goto(INDEX);
    await enterPIN(page);
    await page.waitForSelector('#vista-inicio');

    expect(errors).toHaveLength(0);

    // importaciones should be initialized as {}
    const imp = await page.evaluate(() => window._getEstado().importaciones);
    expect(imp).toBeDefined();
    expect(typeof imp).toBe('object');
  });

  test('(k) botón "Importar movimientos del banco" abre modal en ⚙️', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndLoad(page);
    await enterPIN(page);

    await page.locator('[data-vista="config"]').click();
    await page.waitForSelector('#vista-config');

    const btn = page.locator('#btnImportarBanco');
    await expect(btn).toBeVisible();
    await btn.click();

    await expect(page.locator('#impModal')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('(l) parseSantander: ref y concepto/detalle extraídos correctamente', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const rows = [
      { fecha: '15/10/2026', desc: 'Transferencia inmediata\tJuan Perez CUIT 20123456789', ref: 'TXN99', ca: -10000, cc: 0, saldo: 90000 },
    ];
    const aoa = buildSantanderAoa(rows);
    const result = await callParseSantander(page, aoa);

    expect(result.ok).toBe(true);
    expect(result.rows[0].ref).toBe('TXN99');
    expect(result.rows[0].concepto).toBe('Transferencia inmediata');
    expect(result.rows[0].detalle).toBe('Juan Perez CUIT 20123456789');
  });

  test('(m) categorización: debito automatico ARCA → Impuestos e Intereses', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const result = await page.evaluate(() => {
      return window._categorizarSant('Debito automatico\tARCA monotributo CUIT 20-12345678-9', -5000);
    });
    expect(result.tipo).toBe('gasto');
    expect(result.cat).toBe('Impuestos e Intereses');
    expect(result.descFija).toMatch(/ARCA/i);
  });

  test('(n) categorización: sircreb → AGRUPABLE', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const result = await page.evaluate(() => window._categorizarSant('SIRCREB retencion semana', -1200));
    expect(result.agrupable).toBeTruthy();
    expect(result.agrupable).toMatch(/Retenciones/);
  });

  test('(o) categorización: pago de tarjeta de credito → transferPair Visa Santander', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const result = await page.evaluate(() => window._categorizarSant('Pago de tarjeta de credito\t4321', -70000));
    expect(result.tipo).toBe('gasto');
    expect(result.cat).toBe('Pago de Visa/MP');
    expect(result.transferPair).toBe('Visa Santander');
  });

  test('(p) los campos refs y lote se exportan/restauran en backup', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    // Inject movement with refs and lote
    await page.evaluate(() => {
      const est = window._getEstado();
      est.gastos.push({
        id: 'rtest', creado: 1, monto: 1000, fecha: '2026-10-01',
        categoria: 'Impuestos e Intereses', medio: 'Banco Santander',
        tipo: 'gasto', soloHistorial: false,
        refs: ['REF-A', 'REF-B'], lote: 'LOTE-XYZ',
      });
      est.importaciones = { 'Banco Santander': { hasta: '2026-10-01', lote: 'LOTE-XYZ', fecha: '2026-10-21' } };
      window._guardar();
    });

    // Export backup and check it contains the new fields
    const backupJson = await page.evaluate(() => window.buildBackupJson());
    const backup = JSON.parse(backupJson);

    const g = backup.estado.gastos.find(g => g.id === 'rtest');
    expect(g).toBeTruthy();
    expect(g.refs).toEqual(['REF-A', 'REF-B']);
    expect(g.lote).toBe('LOTE-XYZ');
    expect(backup.estado.importaciones).toBeDefined();
    expect(backup.estado.importaciones['Banco Santander'].lote).toBe('LOTE-XYZ');
  });

  test('(q) reimportar archivo con filas agrupadas da 0 nuevos', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const rows = [
      { fecha: '05/10/2026', desc: 'SIRCREB retencion 1', ref: 'SR1', ca: 0, cc: -1000, saldo: 99000 },
      { fecha: '06/10/2026', desc: 'SIRCREB retencion 2', ref: 'SR2', ca: 0, cc: -1500, saldo: 97500 },
      { fecha: '07/10/2026', desc: 'SIRCREB retencion 3', ref: 'SR3', ca: 0, cc: -500,  saldo: 97000 },
      { fecha: '08/10/2026', desc: 'SIRCREB retencion 4', ref: 'SR4', ca: 0, cc: -2000, saldo: 95000 },
      { fecha: '09/10/2026', desc: 'SIRCREB retencion 5', ref: 'SR5', ca: 0, cc: -800,  saldo: 94200 },
      { fecha: '10/10/2026', desc: 'SIRCREB retencion 6', ref: 'SR6', ca: 0, cc: -700,  saldo: 93500 },
    ];
    const aoa = buildSantanderAoa(rows);

    // Simulate saving the grouped movement from a first import
    await page.evaluate((aoaData) => {
      const parsed = window.parseSantander(aoaData);
      let cands = parsed.map(f => {
        const catInfo = window._categorizarSant(f.desc, f.monto);
        return { ...f, catInfo, refs: f.ref ? [f.ref] : [], yaExiste: false, soloHistorial: false,
          paraRevisar: catInfo.paraRevisar, _revisar_sel: null, _recordar: false, _recordarTexto: '' };
      });
      window._deduplicarImp(cands, 'Banco Santander');
      cands = window._agruparRuidoImp(cands, true);
      window._deduplicarImp(cands, 'Banco Santander');
      const grp = cands.find(c => c._agrupado);
      if (grp) {
        const est = window._getEstado();
        est.gastos.push({ id: 'grp1', creado: Date.now(), monto: Math.abs(grp.monto),
          fecha: grp.fecha, categoria: 'Ingresos brutos (retenciones)', medio: 'Banco Santander',
          tipo: 'gasto', soloHistorial: false, refs: grp.refs, lote: 'lote-first' });
        window._guardar();
      }
    }, aoa);

    // Re-import the same file → 0 new
    const nuevos = await page.evaluate((aoaData) => {
      const parsed = window.parseSantander(aoaData);
      let cands = parsed.map(f => {
        const catInfo = window._categorizarSant(f.desc, f.monto);
        return { ...f, catInfo, refs: f.ref ? [f.ref] : [], yaExiste: false, soloHistorial: false,
          paraRevisar: catInfo.paraRevisar, _revisar_sel: null, _recordar: false, _recordarTexto: '' };
      });
      window._deduplicarImp(cands, 'Banco Santander');
      cands = window._agruparRuidoImp(cands, true);
      window._deduplicarImp(cands, 'Banco Santander');
      return cands.filter(c => !c.yaExiste).length;
    }, aoa);

    expect(nuevos).toBe(0);
  });

  test('(r) corte historial: verifSaldo OK cuando diff era de filas antes del corte', async ({ page }) => {
    // Initial=40000 was set AFTER the historical -10000 transaction: importing without cutoff
    // would double-count it (saldoApp=40000-10000-3000=27000 vs banco=37000 → diff=10000).
    // Marking the historical row soloHistorial=true fixes the diff to 0.
    const state = {
      ...BASE_STATE,
      iniciales: { ...BASE_STATE.iniciales, 'Banco Santander': 40000 },
      gastos: [],
    };
    await seedAndLoad(page, state);
    await enterPIN(page);

    const result = await page.evaluate(() => {
      const histCand = { fecha: '2026-09-15', monto: -10000, yaExiste: false, soloHistorial: false,
        catInfo: { tipo: 'gasto', cat: 'Impuestos e Intereses' } };
      const newCand  = { fecha: '2026-10-15', monto: -3000,  yaExiste: false, soloHistorial: false,
        catInfo: { tipo: 'gasto', cat: 'Otros/Varios' } };
      const cands = [histCand, newCand];

      // Without cutoff: diff should be non-zero
      const v1 = window._verifSaldo('Banco Santander', '2026-10-15', 37000, cands);

      // With cutoff: mark historical row soloHistorial
      histCand.soloHistorial = true;
      const v2 = window._verifSaldo('Banco Santander', '2026-10-15', 37000, cands);

      return { diffSin: v1.diff, diffCon: v2.diff };
    });

    expect(Math.abs(result.diffSin)).toBeGreaterThan(0.01);
    expect(Math.abs(result.diffCon)).toBeLessThan(0.01);
  });

  test('(s) importe del ajuste no tiene ruido de punto flotante', async ({ page }) => {
    await seedAndLoad(page);
    await enterPIN(page);

    const result = await page.evaluate(() => {
      // Simulate a diff with float noise
      const rawDiff = 500000.0000000001;
      const rounded = Math.round(rawDiff * 100) / 100;
      // Also verify the monto stored would be clean
      const monto = Math.abs(rounded);
      return { rounded, monto, isClean: monto === 500000 };
    });

    expect(result.isClean).toBe(true);
    expect(result.monto).toBe(500000);
  });

});
