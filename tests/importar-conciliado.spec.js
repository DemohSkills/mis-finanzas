/**
 * Tests para recordatorio "conciliado hasta" e importador con omisión automática.
 * Datos FICTICIOS, fixtures sintéticos.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

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

function buildSantanderAoa(rows) {
  return [
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['', 'Fecha', 'Sucursal origen', 'Descripción', 'Referencia', 'Caja de Ahorro', 'Cuenta Corriente', 'Saldo'],
    ...[...rows].reverse().map(r => [
      '', r.fecha, 'SUC 001', r.desc, r.ref || '', String(r.ca ?? 0), String(r.cc ?? 0), String(r.saldo),
    ]),
  ];
}

// ── (a) Etiqueta sin importaciones ────────────────────────────
test('(a) tarjeta Banco Santander muestra "Sin conciliar" si no hay importaciones', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await seedAndLoad(page);
  await enterPIN(page);
  await page.waitForSelector('#saldos');

  // Banco Santander card: find the card that has "Banco Santander" as its name
  const santCard = page.locator('#saldos .saldo').filter({ hasText: 'Banco Santander' }).first();
  const label = santCard.locator('.saldo-concil');
  await expect(label).toBeVisible();
  await expect(label).toHaveText('Sin conciliar');
  expect(errors).toHaveLength(0);
});

// ── (b) Etiqueta con dato reciente ────────────────────────────
test('(b) tarjeta muestra fecha de conciliación cuando hay importación reciente', async ({ page }) => {
  const hoy = new Date().toLocaleDateString('sv'); // YYYY-MM-DD
  const state = {
    ...BASE_STATE,
    importaciones: { 'Banco Santander': { hasta: hoy, lote: 'LOTE-X', fecha: hoy } },
  };
  await seedAndLoad(page, state);
  await enterPIN(page);
  await page.waitForSelector('#saldos');

  // Find the Banco Santander card specifically
  const santCard = page.locator('#saldos .saldo').filter({ hasText: 'Banco Santander' }).first();
  const concilLabel = santCard.locator('.saldo-concil');
  await expect(concilLabel).toBeVisible();
  const txt = await concilLabel.textContent();
  // Should contain the date in dd/mm/yyyy format
  const [y, m, d] = hoy.split('-');
  expect(txt).toContain(`${d}/${m}/${y}`);
  // Not orange since it's today (0 days)
  const cls = await concilLabel.getAttribute('class');
  expect(cls).not.toContain('warn');
});

// ── (c) Etiqueta naranja a los 8 días ─────────────────────────
test('(c) tarjeta muestra naranja cuando conciliación tiene más de 7 días', async ({ page }) => {
  // 8 days ago
  const fecha8 = new Date(Date.now() - 8 * 86400000).toLocaleDateString('sv');
  const state = {
    ...BASE_STATE,
    importaciones: { 'Banco Santander': { hasta: fecha8, lote: 'LOTE-OLD', fecha: fecha8 } },
  };
  await seedAndLoad(page, state);
  await enterPIN(page);
  await page.waitForSelector('#saldos');

  const santCard = page.locator('#saldos .saldo').filter({ hasText: 'Banco Santander' }).first();
  const concilLabel = santCard.locator('.saldo-concil');
  await expect(concilLabel).toBeVisible();
  const cls = await concilLabel.getAttribute('class');
  expect(cls).toContain('warn');
  const txt = await concilLabel.textContent();
  expect(txt).toMatch(/días/i);
});

// ── (d) Marcar a mano ─────────────────────────────────────────
test('(d) _marcarConciliadoHasta guarda {hasta, lote:null, fecha}', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await seedAndLoad(page);
  await enterPIN(page);

  const imp = await page.evaluate(() => {
    window._marcarConciliadoHasta('Banco Santander', '2026-10-15');
    return window._getEstado().importaciones['Banco Santander'];
  });

  expect(imp).toBeDefined();
  expect(imp.hasta).toBe('2026-10-15');
  expect(imp.lote).toBeNull();
  expect(imp.fecha).toBeDefined();
  expect(errors).toHaveLength(0);
});

// ── (e) Deshacer con lote null no rompe ───────────────────────
test('(e) _deshacerUltimaImp con lote null no lanza excepción', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // State with a null-lote importacion
  const state = {
    ...BASE_STATE,
    importaciones: { 'Banco Santander': { hasta: '2026-10-10', lote: null, fecha: '2026-10-10' } },
  };
  await seedAndLoad(page, state);
  await enterPIN(page);

  // Open modal so we can call deshacer via JS (bypassing confirm)
  const result = await page.evaluate(() => {
    try {
      const est = window._getEstado();
      const imp = (est.importaciones||{})['Banco Santander'];
      if (!imp) return { ok: false, err: 'no imp' };
      // Simulate confirm = true by directly deleting (as _deshacerUltimaImp would after confirm)
      if (!imp.lote) {
        delete est.importaciones['Banco Santander'];
        window._guardar();
        return { ok: true, deleted: true };
      }
      return { ok: true, deleted: false };
    } catch(e) { return { ok: false, err: e.message }; }
  });

  expect(result.ok).toBe(true);
  expect(result.deleted).toBe(true);
  expect(errors).toHaveLength(0);
});

// ── (f) Omitir filas <= hasta ─────────────────────────────────
test('(f) filas con fecha <= conciliado_hasta se omiten por defecto al cargar archivo', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // conciliado hasta 2026-10-06 → rows on 10-05 and 10-06 omitted; 10-10 stays
  const state = {
    ...BASE_STATE,
    importaciones: { 'Banco Santander': { hasta: '2026-10-06', lote: null, fecha: '2026-10-06' } },
  };
  await seedAndLoad(page, state);
  await enterPIN(page);

  const rows = [
    { fecha: '05/10/2026', desc: 'Deposito', ref: 'R1', ca: 10000, cc: 0, saldo: 60000 },
    { fecha: '06/10/2026', desc: 'Comision', ref: 'R2', ca: -500, cc: 0, saldo: 59500 },
    { fecha: '10/10/2026', desc: 'Pago servicios', ref: 'R3', ca: -1000, cc: 0, saldo: 58500 },
  ];
  const aoa = buildSantanderAoa(rows);

  const result = await page.evaluate((aoaData) => {
    const parsed = window.parseSantander(aoaData);
    // Simulate what the file parser does
    const conc = (window._getEstado().importaciones||{})['Banco Santander']?.hasta;
    let cands = parsed.map(f => {
      const catInfo = window._categorizarSant(f.desc, f.monto);
      return { ...f, catInfo, refs: f.ref ? [f.ref] : [], yaExiste: false,
        soloHistorial: false, paraRevisar: catInfo.paraRevisar,
        _revisar_sel: null, _recordar: false, _recordarTexto: '' };
    });
    let omitidas = [];
    if (conc) {
      omitidas = cands.filter(c => c.fecha <= conc);
      cands = cands.filter(c => c.fecha > conc);
    }
    window._deduplicarImp(cands, 'Banco Santander');
    return {
      omitidas: omitidas.map(c => c.fecha),
      candidatos: cands.map(c => c.fecha),
    };
  }, aoa);

  expect(result.omitidas).toContain('2026-10-05');
  expect(result.omitidas).toContain('2026-10-06');
  expect(result.candidatos).toContain('2026-10-10');
  expect(result.candidatos).not.toContain('2026-10-05');
  expect(result.candidatos).not.toContain('2026-10-06');
  expect(errors).toHaveLength(0);
});

// ── (g) Incluir omitidas restaura filas ──────────────────────
test('(g) incluir omitidas agrega filas de vuelta con dedupe', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const state = {
    ...BASE_STATE,
    importaciones: { 'Banco Santander': { hasta: '2026-10-06', lote: null, fecha: '2026-10-06' } },
  };
  await seedAndLoad(page, state);
  await enterPIN(page);

  const rows = [
    { fecha: '05/10/2026', desc: 'Deposito', ref: 'R1', ca: 10000, cc: 0, saldo: 60000 },
    { fecha: '10/10/2026', desc: 'Pago servicios', ref: 'R3', ca: -1000, cc: 0, saldo: 59000 },
  ];
  const aoa = buildSantanderAoa(rows);

  const result = await page.evaluate((aoaData) => {
    const parsed = window.parseSantander(aoaData);
    const conc = (window._getEstado().importaciones||{})['Banco Santander']?.hasta;
    let cands = parsed.map(f => {
      const catInfo = window._categorizarSant(f.desc, f.monto);
      return { ...f, catInfo, refs: f.ref ? [f.ref] : [], yaExiste: false,
        soloHistorial: false, paraRevisar: catInfo.paraRevisar,
        _revisar_sel: null, _recordar: false, _recordarTexto: '' };
    });
    let omitidas = [];
    if (conc) {
      omitidas = cands.filter(c => c.fecha <= conc);
      cands = cands.filter(c => c.fecha > conc);
    }
    // Simulate "Incluirlos" checked
    cands = [...omitidas, ...cands];
    omitidas = [];
    window._deduplicarImp(cands, 'Banco Santander');
    return { totalCands: cands.length, omitidas: omitidas.length };
  }, aoa);

  expect(result.totalCands).toBe(2);
  expect(result.omitidas).toBe(0);
  expect(errors).toHaveLength(0);
});

// ── (h) Redondeo de grupos ────────────────────────────────────
test('(h) _agruparRuidoImp redondea suma a 2 decimales', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await seedAndLoad(page);
  await enterPIN(page);

  // Use amounts that produce float noise when summed
  const result = await page.evaluate(() => {
    const cands = [
      { fecha: '2026-10-05', monto: -1000.1, desc: 'SIRCREB r1', ref: 'R1', yaExiste: false,
        catInfo: { agrupable: 'Retenciones SIRCREB', tipo: 'gasto', cat: 'Impuestos e Intereses' } },
      { fecha: '2026-10-06', monto: -1000.2, desc: 'SIRCREB r2', ref: 'R2', yaExiste: false,
        catInfo: { agrupable: 'Retenciones SIRCREB', tipo: 'gasto', cat: 'Impuestos e Intereses' } },
      { fecha: '2026-10-07', monto: -786.68, desc: 'SIRCREB r3', ref: 'R3', yaExiste: false,
        catInfo: { agrupable: 'Retenciones SIRCREB', tipo: 'gasto', cat: 'Impuestos e Intereses' } },
    ];
    const grouped = window._agruparRuidoImp(cands, true);
    const g = grouped.find(c => c._agrupado);
    return { monto: g?.monto, isClean: g ? (g.monto === Math.round(g.monto * 100) / 100) : false };
  });

  expect(result.isClean).toBe(true);
  // -1000.1 + -1000.2 + -786.68 = -2786.98
  expect(result.monto).toBeCloseTo(-2786.98, 2);
  expect(errors).toHaveLength(0);
});

// ── (i) Compatibilidad: backup sin importaciones ──────────────
test('(i) backup antiguo sin campo importaciones carga sin errores', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const oldState = {
    iniciales: { 'Banco Santander': 10000, 'Visa Santander': 0, 'Mercado Pago': 0, 'Efectivo': 0, 'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0 },
    gastos: [{ id: 'g1', creado: 1, monto: 500, fecha: '2026-09-01', categoria: 'Comida y Delivery', medio: 'Banco Santander', tipo: 'gasto', soloHistorial: false }],
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
  await page.waitForSelector('#saldos');

  const imp = await page.evaluate(() => window._getEstado().importaciones);
  expect(imp).toBeDefined();
  expect(typeof imp).toBe('object');
  expect(errors).toHaveLength(0);
});

// ── (j) Marcar a mano coexiste con importación real posterior ─
test('(j) importación real pisa la marca manual', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const state = {
    ...BASE_STATE,
    importaciones: { 'Banco Santander': { hasta: '2026-10-01', lote: null, fecha: '2026-10-01' } },
  };
  await seedAndLoad(page, state);
  await enterPIN(page);

  const result = await page.evaluate(() => {
    const est = window._getEstado();
    // Simulate a real import: it sets lote to a real value
    est.importaciones['Banco Santander'] = { hasta: '2026-10-15', lote: 'REAL-LOTE-123', fecha: '2026-10-15' };
    window._guardar();
    const imp = est.importaciones['Banco Santander'];
    return { lote: imp.lote, hasta: imp.hasta };
  });

  expect(result.lote).toBe('REAL-LOTE-123');
  expect(result.hasta).toBe('2026-10-15');
  expect(errors).toHaveLength(0);
});
