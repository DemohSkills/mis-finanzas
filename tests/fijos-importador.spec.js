const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';
const TODAY = new Date().toISOString().slice(0, 10);
const MES = TODAY.slice(0, 7);

function mesAnterior() {
  const [y, m] = MES.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function mkFijo(overrides = {}) {
  return {
    id: 'fijo-test-1',
    tipo: 'fijo',
    nombre: 'Alquiler',
    categoria: 'Hogar y Materiales',
    monto: 50000,
    estimado: true,
    diaMes: 5,
    medioPago: 'Banco Santander',
    palabrasClave: 'alquiler',
    activo: true,
    pagos: {},
    ...overrides,
  };
}

function mkCand(overrides = {}) {
  return {
    yaExiste: false,
    _agrupado: false,
    catInfo: { tipo: 'gasto', cat: 'Hogar y Materiales', transf: false, transferPair: null, transferPairInv: false },
    fecha: TODAY,
    desc: 'ALQUILER DEPTO 503',
    concepto: 'ALQUILER DEPTO 503',
    monto: -50000,
    soloHistorial: false,
    _recordar: false,
    _recordarTexto: '',
    refs: [],
    medio: 'Banco Santander',
    ...overrides,
  };
}

function buildEstado(compromisos = [], gastos = []) {
  return {
    iniciales: { 'Banco Santander': 200000, 'Mercado Pago': 50000, 'Astropay': 0, 'Visa Santander': 0, 'Mastercard MP': 0, 'Efectivo': 0, 'American Express': 0 },
    gastos,
    items: [],
    patrimonioCargado: true,
    compromisos,
    importaciones: {},
  };
}

async function seedAndUnlock(page, estado) {
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    window.confirm = () => true;
    window._alerts = [];
    window.alert = msg => { window._alerts.push(String(msg)); };
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('(a) _fijoCoincide: coincide ignorando mayúsculas', async ({ page }) => {
  await seedAndUnlock(page, buildEstado());
  const result = await page.evaluate(() => {
    const fijo = { palabrasClave: 'Alquiler' };
    return {
      upper: window._fijoCoincide(fijo, 'ALQUILER DEPTO 503'),
      lower: window._fijoCoincide(fijo, 'alquiler mensual'),
      noMatch: window._fijoCoincide(fijo, 'SUELDO EMPRESA'),
    };
  });
  expect(result.upper).toBe(true);
  expect(result.lower).toBe(true);
  expect(result.noMatch).toBe(false);
});

test('(b) _fijoCoincide: coincide ignorando tildes', async ({ page }) => {
  await seedAndUnlock(page, buildEstado());
  const result = await page.evaluate(() => {
    const fijo1 = { palabrasClave: 'expensas' };
    const fijo2 = { palabrasClave: 'Arriendo' };
    return {
      // "expensas" matches description with accented "e" variant
      normMatch: window._fijoCoincide(fijo1, 'EXPÉNSAS ORDINARIAS'),
      // "Arriendo" (no tilde) matches "Arriéndo" (with tilde)
      tilde: window._fijoCoincide(fijo2, 'ARRIÉNDO MENSUAL'),
    };
  });
  expect(result.normMatch).toBe(true);
  expect(result.tilde).toBe(true);
});

test('(c) _fijoCoincide: palabrasClave vacío → false', async ({ page }) => {
  await seedAndUnlock(page, buildEstado());
  const result = await page.evaluate(() => {
    const f1 = { palabrasClave: '' };
    const f2 = { palabrasClave: '   ' };
    const f3 = {};
    return [
      window._fijoCoincide(f1, 'alquiler depto'),
      window._fijoCoincide(f2, 'alquiler depto'),
      window._fijoCoincide(f3, 'alquiler depto'),
    ];
  });
  expect(result).toEqual([false, false, false]);
});

test('(d) _fijoCoincide: palabra de < 4 caracteres es ignorada', async ({ page }) => {
  await seedAndUnlock(page, buildEstado());
  const result = await page.evaluate(() => {
    // "gas" = 3 chars → ignored; "luz" = 3 chars → ignored
    const f1 = { palabrasClave: 'gas' };
    const f2 = { palabrasClave: 'luz, gas' };
    const f3 = { palabrasClave: 'gaso' }; // 4 chars → valid
    return {
      gas: window._fijoCoincide(f1, 'pago de gas natural'),
      luzgas: window._fijoCoincide(f2, 'pago de luz y gas'),
      gaso: window._fijoCoincide(f3, 'gasolinera shell'),
    };
  });
  expect(result.gas).toBe(false);
  expect(result.luzgas).toBe(false);
  expect(result.gaso).toBe(true);
});

test('(m) _fijoCoincide: descripción con tab y espacios múltiples coincide con kw de varias palabras', async ({ page }) => {
  await seedAndUnlock(page, buildEstado());
  const result = await page.evaluate(() => {
    const fijo = { palabrasClave: 'debito automatico arca' };
    return {
      tab: window._fijoCoincide(fijo, 'Debito automatico \t Arca  ex afip   -20339692344'),
      multi: window._fijoCoincide(fijo, 'DEBITO  AUTOMATICO   ARCA SA'),
      noMatch: window._fijoCoincide(fijo, 'transferencia bancaria'),
    };
  });
  expect(result.tab).toBe(true);
  expect(result.multi).toBe(true);
  expect(result.noMatch).toBe(false);
});

test('(n) _fijoCoincide: palabra clave con espacios dobles escritos por el usuario también coincide', async ({ page }) => {
  await seedAndUnlock(page, buildEstado());
  const result = await page.evaluate(() => {
    const fijo = { palabrasClave: 'debito  automatico,  expensas  consorcio  ' };
    return {
      debito: window._fijoCoincide(fijo, 'DEBITO AUTOMATICO VISA'),
      expensas: window._fijoCoincide(fijo, 'pago expensas consorcio agosto'),
      noMatch: window._fijoCoincide(fijo, 'sueldo empresa'),
    };
  });
  expect(result.debito).toBe(true);
  expect(result.expensas).toBe(true);
  expect(result.noMatch).toBe(false);
});

test('(o) _fijoCoincide: caso exacto Santander — tab interno con kw "imp.afip"', async ({ page }) => {
  await seedAndUnlock(page, buildEstado());
  const result = await page.evaluate(() => {
    const fijo = { palabrasClave: 'imp.afip' };
    return window._fijoCoincide(fijo, 'Pago de servicios \t Imp.afip: 2033969234433969234');
  });
  expect(result).toBe(true);
});

test('(e) confirmar importación marca fijo como pagado', async ({ page }) => {
  const fijo = mkFijo();
  await seedAndUnlock(page, buildEstado([fijo]));

  await page.evaluate(({ cand, medio }) => {
    window._setImpState([cand], medio);
    window._confirmarImpBanco(false);
  }, { cand: mkCand(), medio: 'Banco Santander' });

  const result = await page.evaluate(({ mes }) => {
    const f = window._getEstado().compromisos[0];
    return f.pagos[mes] || null;
  }, { mes: MES });

  expect(result).not.toBeNull();
  expect(result.gastoId).toBeTruthy();
  expect(result.monto).toBe(50000);
  expect(result.lote).toBeTruthy();
});

test('(f) confirmar: movimiento de ingreso no marca fijo gasto', async ({ page }) => {
  const fijo = mkFijo();
  await seedAndUnlock(page, buildEstado([fijo]));

  await page.evaluate(({ cand, medio }) => {
    window._setImpState([cand], medio);
    window._confirmarImpBanco(false);
  }, { cand: mkCand({ catInfo: { tipo: 'ingreso', cat: 'Ingresos extras', transf: false, transferPair: null, transferPairInv: false }, monto: 50000 }), medio: 'Banco Santander' });

  const pago = await page.evaluate(({ mes }) => {
    return window._getEstado().compromisos[0].pagos[mes] || null;
  }, { mes: MES });

  expect(pago).toBeNull();
});

test('(g) confirmar: fijo agrupado no marca el pago', async ({ page }) => {
  const fijo = mkFijo();
  await seedAndUnlock(page, buildEstado([fijo]));

  await page.evaluate(({ cand, medio }) => {
    window._setImpState([cand], medio);
    window._confirmarImpBanco(false);
  }, { cand: mkCand({ _agrupado: true }), medio: 'Banco Santander' });

  const pago = await page.evaluate(({ mes }) => {
    return window._getEstado().compromisos[0].pagos[mes] || null;
  }, { mes: MES });

  expect(pago).toBeNull();
});

test('(h) deshacer importación quita el pago del fijo', async ({ page }) => {
  const fijo = mkFijo();
  await seedAndUnlock(page, buildEstado([fijo]));

  // Confirm
  await page.evaluate(({ cand, medio }) => {
    window._setImpState([cand], medio);
    window._confirmarImpBanco(false);
  }, { cand: mkCand(), medio: 'Banco Santander' });

  // Verify it was marked
  const pagoAntes = await page.evaluate(({ mes }) => window._getEstado().compromisos[0].pagos[mes] || null, { mes: MES });
  expect(pagoAntes).not.toBeNull();

  // Undo
  await page.evaluate(() => window._deshacerUltimaImp('Banco Santander'));

  // Verify cleared
  const pagoDespues = await page.evaluate(({ mes }) => window._getEstado().compromisos[0].pagos[mes] || null, { mes: MES });
  expect(pagoDespues).toBeNull();
});

test('(i) reimportar el mismo archivo no duplica el pago del fijo', async ({ page }) => {
  const fijo = mkFijo();
  const cand = mkCand();
  await seedAndUnlock(page, buildEstado([fijo]));

  // First import
  await page.evaluate(({ cand, medio }) => {
    window._setImpState([cand], medio);
    window._confirmarImpBanco(false);
  }, { cand, medio: 'Banco Santander' });

  const pago1 = await page.evaluate(({ mes }) => ({ ...window._getEstado().compromisos[0].pagos[mes] }), { mes: MES });

  // Second import: same candidate but already exists in gastos → yaExiste=true
  await page.evaluate(({ cand, medio }) => {
    const c = { ...cand, yaExiste: true }; // deduplication marks it
    window._setImpState([c], medio);
    window._confirmarImpBanco(false);
  }, { cand, medio: 'Banco Santander' });

  const pago2 = await page.evaluate(({ mes }) => ({ ...window._getEstado().compromisos[0].pagos[mes] }), { mes: MES });

  // Same gastoId (pago not overwritten)
  expect(pago2.gastoId).toBe(pago1.gastoId);
  expect(pago2.lote).toBe(pago1.lote);
});

test('(j) fijo de otro mes (cadaMeses=2) no se marca si el mes no corresponde', async ({ page }) => {
  // fijo bimestral con mesBase = mes actual → corresponde mes actual
  // pero el movimiento tiene fecha del mes anterior → no debe marcar
  const mesAnt = mesAnterior();
  const fijo = mkFijo({
    cadaMeses: 2,
    mesBase: MES, // corresponds to current month, NOT mesAnterior
  });
  await seedAndUnlock(page, buildEstado([fijo]));

  // Candidate has date in previous month
  const cand = mkCand({ fecha: mesAnt + '-10' });

  await page.evaluate(({ cand, medio }) => {
    window._setImpState([cand], medio);
    window._confirmarImpBanco(false);
  }, { cand, medio: 'Banco Santander' });

  const pago = await page.evaluate(({ mes }) => window._getEstado().compromisos[0].pagos[mes] || null, { mes: mesAnt });
  expect(pago).toBeNull();
});

test('(k) dos movimientos que coinciden con el mismo fijo: solo el primero lo marca', async ({ page }) => {
  const fijo = mkFijo();
  await seedAndUnlock(page, buildEstado([fijo]));

  const cand1 = mkCand({ fecha: MES + '-03' });
  const cand2 = mkCand({ fecha: MES + '-10', id: 'c2' });

  await page.evaluate(({ cands, medio }) => {
    window._setImpState(cands, medio);
    window._confirmarImpBanco(false);
  }, { cands: [cand1, cand2], medio: 'Banco Santander' });

  const result = await page.evaluate(({ mes }) => {
    const f = window._getEstado().compromisos[0];
    const pago = f.pagos[mes];
    // Count how many gastos were created
    const gastos = window._getEstado().gastos.filter(g => g.tipo === 'gasto');
    return { fecha: pago?.fecha, count: gastos.length };
  }, { mes: MES });

  // Both gastos created, but pago from first candidate
  expect(result.count).toBe(2);
  expect(result.fecha).toBe(MES + '-03'); // first candidate's date
});

test('(l) pago manual existente no es sobreescrito al importar', async ({ page }) => {
  const fijo = mkFijo({
    pagos: { [MES]: { fecha: TODAY, monto: 45000, gastoId: 'manual-1', lote: null } },
  });
  await seedAndUnlock(page, buildEstado([fijo]));

  await page.evaluate(({ cand, medio }) => {
    window._setImpState([cand], medio);
    window._confirmarImpBanco(false);
  }, { cand: mkCand(), medio: 'Banco Santander' });

  const pago = await page.evaluate(({ mes }) => window._getEstado().compromisos[0].pagos[mes], { mes: MES });

  // Should still be the manual payment
  expect(pago.gastoId).toBe('manual-1');
  expect(pago.monto).toBe(45000);
});
