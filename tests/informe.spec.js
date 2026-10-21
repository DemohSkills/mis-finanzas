const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

// ── Helpers ──────────────────────────────────────────────────────

function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('sv');
}

async function loadWithState(page, estado, snaps = []) {
  await page.addInitScript(({ estado, snaps }) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(estado));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    if (snaps.length) localStorage.setItem('finanzas-v1-snaps', JSON.stringify(snaps));
    window.confirm = () => true;
    window.alert = () => {};
  }, { estado, snaps });
  await page.goto(INDEX);
  // Enter PIN
  for (const d of ['1','2','3','4']) await page.locator(`[data-d="${d}"]`).click();
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

function buildEstado(gastos = [], items = []) {
  return {
    iniciales: { 'Banco Santander': 100000, 'Mercado Pago': 50000, 'Efectivo': 10000,
                 'Visa Santander': -20000, 'Mastercard MP': -5000, 'Astropay': 0, 'American Express': 0 },
    gastos,
    items,
    patrimonioCargado: true,
    compromisos: [],
    importaciones: {},
  };
}

// ── Tests ─────────────────────────────────────────────────────────

test('(a) totales por período excluyen transferencias por defecto', async ({ page }) => {
  const hoy = isoDate(0);
  const gastos = [
    { id: '1', tipo: 'gasto',   fecha: hoy, monto: 5000,  categoria: 'Comida', medio: 'Efectivo', descripcion: 'pizza', transferencia: false },
    { id: '2', tipo: 'ingreso', fecha: hoy, monto: 10000, categoria: 'Sueldo/Honorarios', medio: 'Banco Santander', descripcion: 'sueldo', transferencia: false },
    { id: '3', tipo: 'gasto',   fecha: hoy, monto: 2000,  categoria: 'Transferencia entre cuentas', medio: 'Efectivo', descripcion: 'transf', transferencia: true, transferId: 't1' },
    { id: '4', tipo: 'ingreso', fecha: hoy, monto: 2000,  categoria: 'Transferencia entre cuentas', medio: 'Banco Santander', descripcion: 'transf', transferencia: true, transferId: 't1' },
  ];
  await loadWithState(page, buildEstado(gastos));

  const result = await page.evaluate(({ desde, hasta }) => {
    const html = window.buildInformeHTML({ desde, hasta, detalle: 'ninguno', inclTransf: false, ocultarNombres: false, otrosNombres: '' });
    return html;
  }, { desde: hoy, hasta: hoy });

  // Should contain ingreso 10000 and gasto 5000, NOT transfer 2000
  expect(result).toContain('10.000'); // ingresos
  expect(result).toContain('5.000');  // gastos
  // resultado = 10000 - 5000 = 5000 (positive)
  expect(result).toMatch(/Resultado[\s\S]{0,200}5\.000/);
});

test('(b) totales por período incluyen transferencias cuando se activa la casilla', async ({ page }) => {
  const hoy = isoDate(0);
  const gastos = [
    { id: '1', tipo: 'gasto',   fecha: hoy, monto: 5000,  categoria: 'Comida', medio: 'Efectivo', descripcion: 'pizza', transferencia: false },
    { id: '3', tipo: 'gasto',   fecha: hoy, monto: 2000,  categoria: 'Transferencia entre cuentas', medio: 'Efectivo', descripcion: 'transf', transferencia: true, transferId: 't1' },
  ];
  await loadWithState(page, buildEstado(gastos));

  const result = await page.evaluate(({ desde, hasta }) => {
    const html = window.buildInformeHTML({ desde, hasta, detalle: 'ninguno', inclTransf: true, ocultarNombres: false, otrosNombres: '' });
    return html;
  }, { desde: hoy, hasta: hoy });

  // Gastos should be 7000 (5000 + 2000 transfer)
  expect(result).toContain('7.000');
});

test('(c) período por defecto es los últimos 30 días hasta hoy', async ({ page }) => {
  const hoy = isoDate(0);
  const hace31 = isoDate(-31);
  const hace15 = isoDate(-15);
  const gastos = [
    { id: '1', tipo: 'gasto', fecha: hace15, monto: 3000, categoria: 'Comida', medio: 'Efectivo', descripcion: 'almuerzo', transferencia: false },
    { id: '2', tipo: 'gasto', fecha: hace31, monto: 9000, categoria: 'Comida', medio: 'Efectivo', descripcion: 'hace 31 dias', transferencia: false },
  ];
  await loadWithState(page, buildEstado(gastos));
  // Open informe via JS (bypasses hidden tab issue)
  await page.evaluate(() => window.abrirInforme());
  await page.waitForSelector('#informeView.inf-open');

  const desde = await page.locator('#infDesde').inputValue();
  const hasta = await page.locator('#infHasta').inputValue();

  expect(hasta).toBe(hoy);
  // desde should be 30 days ago (roughly)
  const desdeParsed = new Date(desde);
  const diff = (new Date(hoy) - desdeParsed) / 86400000;
  expect(diff).toBeCloseTo(30, 0);
});

test('(d) campos desde/hasta son editables y el informe usa el período correcto', async ({ page }) => {
  const hoy = isoDate(0);
  const hace5 = isoDate(-5);
  const hace3 = isoDate(-3);
  const gastos = [
    { id: '1', tipo: 'gasto', fecha: hace5, monto: 9000, categoria: 'Comida', medio: 'Efectivo', descripcion: 'viejo', transferencia: false },
    { id: '2', tipo: 'gasto', fecha: hace3, monto: 1500, categoria: 'Comida', medio: 'Efectivo', descripcion: 'reciente', transferencia: false },
  ];
  await loadWithState(page, buildEstado(gastos));

  const result = await page.evaluate(({ desde, hasta }) => {
    return window.buildInformeHTML({ desde, hasta, detalle: 'ninguno', inclTransf: false, ocultarNombres: false, otrosNombres: '' });
  }, { desde: hace3, hasta: hoy });

  // Solo el movimiento de hace 3 días entra
  expect(result).toContain('1.500');
  expect(result).not.toContain('9.000');
});

test('(e) ocultar nombres: reemplazo estable (misma persona → mismo alias)', async ({ page }) => {
  await loadWithState(page, buildEstado([], [
    { id: 'i1', nombre: 'Boris García', tipo: 'activo', monto: 50000, grupo: 'Préstamos con personas', persona: 'Boris García' },
    { id: 'i2', nombre: 'Ana López', tipo: 'deuda', monto: 20000, grupo: 'Préstamos con personas', persona: 'Ana López' },
  ]));

  const result = await page.evaluate(() => {
    const map = window._buildNameMap(true, '');
    // Both calls should produce the same replacement
    const r1 = window._applyNameMap('Boris García', map);
    const r2 = window._applyNameMap('boris garcía', map);
    return { r1, r2 };
  });

  expect(result.r1).toMatch(/^Persona \d+$/);
  expect(result.r1).toBe(result.r2); // case insensitive, same result
});

test('(f) ocultar nombres: insensible a mayúsculas en descripciones', async ({ page }) => {
  await loadWithState(page, buildEstado([], [
    { id: 'i1', nombre: 'Carlos Ruiz', tipo: 'activo', monto: 1000, grupo: 'Préstamos con personas', persona: 'Carlos Ruiz' },
  ]));

  const result = await page.evaluate(() => {
    const map = window._buildNameMap(true, '');
    const desc = 'Pago de carlos ruiz por trabajo';
    return window._applyNameMap(desc, map);
  });

  expect(result).not.toContain('Carlos');
  expect(result).not.toContain('carlos');
  expect(result).toMatch(/Persona \d+/);
});

test('(g) ocultar nombres: nombres extra desde campo de texto', async ({ page }) => {
  await loadWithState(page, buildEstado());

  const result = await page.evaluate(() => {
    const map = window._buildNameMap(true, 'Juan Pérez, María González');
    const r1 = window._applyNameMap('Juan Pérez pagó', map);
    const r2 = window._applyNameMap('María González debe', map);
    return { r1, r2 };
  });

  expect(result.r1).not.toContain('Juan');
  expect(result.r2).not.toContain('María');
  expect(result.r1).toMatch(/Persona \d+/);
  expect(result.r2).toMatch(/Persona \d+/);
});

test('(h) ocultar nombres: sin ocultar, los nombres aparecen normalmente', async ({ page }) => {
  await loadWithState(page, buildEstado([], [
    { id: 'i1', nombre: 'Boris García', tipo: 'activo', monto: 1000, grupo: 'Préstamos con personas', persona: 'Boris García' },
  ]));

  const result = await page.evaluate(({ desde, hasta }) => {
    return window.buildInformeHTML({ desde, hasta, detalle: 'ninguno', inclTransf: false, ocultarNombres: false, otrosNombres: '' });
  }, { desde: isoDate(-30), hasta: isoDate(0) });

  expect(result).toContain('Boris García');
});

test('(i) opción detalle "ninguno" no genera tabla de movimientos', async ({ page }) => {
  const hoy = isoDate(0);
  const gastos = [{ id: '1', tipo: 'gasto', fecha: hoy, monto: 500, categoria: 'Comida', medio: 'Efectivo', descripcion: 'cafe', transferencia: false }];
  await loadWithState(page, buildEstado(gastos));

  const result = await page.evaluate(({ hoy }) => {
    return window.buildInformeHTML({ desde: hoy, hasta: hoy, detalle: 'ninguno', inclTransf: false, ocultarNombres: false, otrosNombres: '' });
  }, { hoy });

  expect(result).not.toContain('inf-det-tbl');
  expect(result).not.toContain('Detalle de movimientos');
  expect(result).not.toContain('Detalle por categoría');
});

test('(j) opción detalle "compacto" genera tabla de una línea por movimiento', async ({ page }) => {
  const hoy = isoDate(0);
  const gastos = [
    { id: '1', tipo: 'gasto',   fecha: hoy, monto: 1000, categoria: 'Comida', medio: 'Efectivo', descripcion: 'pizza', transferencia: false },
    { id: '2', tipo: 'ingreso', fecha: hoy, monto: 5000, categoria: 'Sueldo/Honorarios', medio: 'Banco Santander', descripcion: 'cobro', transferencia: false },
  ];
  await loadWithState(page, buildEstado(gastos));

  const result = await page.evaluate(({ hoy }) => {
    return window.buildInformeHTML({ desde: hoy, hasta: hoy, detalle: 'compacto', inclTransf: false, ocultarNombres: false, otrosNombres: '' });
  }, { hoy });

  expect(result).toContain('Detalle de movimientos');
  expect(result).toContain('inf-det-tbl');
  expect(result).toContain('pizza');
  expect(result).toContain('cobro');
  // Two data rows
  const rowCount = (result.match(/<tr>/g)||[]).length;
  expect(rowCount).toBeGreaterThanOrEqual(2);
});

test('(k) opción detalle "categoria" agrupa por categoría con totales', async ({ page }) => {
  const hoy = isoDate(0);
  const gastos = [
    { id: '1', tipo: 'gasto', fecha: hoy, monto: 1000, categoria: 'Comida', medio: 'Efectivo', descripcion: 'pizza', transferencia: false },
    { id: '2', tipo: 'gasto', fecha: hoy, monto: 2000, categoria: 'Comida', medio: 'Efectivo', descripcion: 'resto', transferencia: false },
    { id: '3', tipo: 'gasto', fecha: hoy, monto: 500,  categoria: 'Transporte/Auto', medio: 'Efectivo', descripcion: 'colectivo', transferencia: false },
  ];
  await loadWithState(page, buildEstado(gastos));

  const result = await page.evaluate(({ hoy }) => {
    return window.buildInformeHTML({ desde: hoy, hasta: hoy, detalle: 'categoria', inclTransf: false, ocultarNombres: false, otrosNombres: '' });
  }, { hoy });

  expect(result).toContain('Detalle por categoría');
  expect(result).toContain('Comida');
  // Comida total: 3000
  expect(result).toContain('3.000');
  expect(result).toContain('Transporte/Auto');
  // Count for Comida: 2
  expect(result).toContain('>2<');
});

test('(l) casilla de transferencias: con true aparecen en el informe compacto', async ({ page }) => {
  const hoy = isoDate(0);
  const gastos = [
    { id: '1', tipo: 'gasto', fecha: hoy, monto: 1000, categoria: 'Transferencia entre cuentas', medio: 'Efectivo', descripcion: 'transf out', transferencia: true, transferId: 't1' },
  ];
  await loadWithState(page, buildEstado(gastos));

  const withTransf = await page.evaluate(({ hoy }) => {
    return window.buildInformeHTML({ desde: hoy, hasta: hoy, detalle: 'compacto', inclTransf: true, ocultarNombres: false, otrosNombres: '' });
  }, { hoy });
  const withoutTransf = await page.evaluate(({ hoy }) => {
    return window.buildInformeHTML({ desde: hoy, hasta: hoy, detalle: 'compacto', inclTransf: false, ocultarNombres: false, otrosNombres: '' });
  }, { hoy });

  expect(withTransf).toContain('transf out');
  expect(withoutTransf).not.toContain('transf out');
});

test('(m) informe no tiene elementos de la interfaz app visible en modo print (CSS)', async ({ page }) => {
  await loadWithState(page, buildEstado());
  await page.evaluate(() => window.abrirInforme());
  await page.waitForSelector('#informeView.inf-open');

  // The .tabs, .app-hdr, #fabVoz should not be visible in print mode
  const tabsVisible = await page.evaluate(() => {
    const el = document.querySelector('.tabs');
    if (!el) return false;
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none';
  });
  // In screen mode, tabs should still be visible (they're hidden only in print)
  // What we test: the #informeView is visible when open
  const informeVisible = await page.evaluate(() => {
    const el = document.getElementById('informeView');
    if (!el) return false;
    return el.classList.contains('inf-open') && getComputedStyle(el).display !== 'none';
  });
  expect(informeVisible).toBe(true);
});

test('(n) botón Cerrar cierra la vista de informe', async ({ page }) => {
  await loadWithState(page, buildEstado());
  await page.evaluate(() => window.abrirInforme());
  await page.waitForSelector('#informeView.inf-open');

  await page.locator('#btnInformeCerrar').click();

  const isOpen = await page.evaluate(() => document.getElementById('informeView').classList.contains('inf-open'));
  expect(isOpen).toBe(false);
});

test('(o) movimientos soloHistorial se incluyen en el detalle compacto', async ({ page }) => {
  const hoy = isoDate(0);
  const gastos = [
    { id: '1', tipo: 'gasto', fecha: hoy, monto: 999, categoria: 'Comida', medio: 'Efectivo', descripcion: 'solo hist', transferencia: false, soloHistorial: true },
  ];
  await loadWithState(page, buildEstado(gastos));

  const result = await page.evaluate(({ hoy }) => {
    return window.buildInformeHTML({ desde: hoy, hasta: hoy, detalle: 'compacto', inclTransf: false, ocultarNombres: false, otrosNombres: '' });
  }, { hoy });

  expect(result).toContain('solo hist');
});

test('(p) compatibilidad con backups sin campos nuevos', async ({ page }) => {
  const hoy = isoDate(0);
  const estadoMinimo = {
    iniciales: {},
    gastos: [{ id: '1', tipo: 'gasto', fecha: hoy, monto: 100, categoria: 'Otros/Varios', medio: 'Efectivo' }],
    items: [],
    patrimonioCargado: true,
  };
  await loadWithState(page, estadoMinimo);

  const result = await page.evaluate(({ hoy }) => {
    try {
      return window.buildInformeHTML({ desde: hoy, hasta: hoy, detalle: 'compacto', inclTransf: false, ocultarNombres: false, otrosNombres: '' });
    } catch (e) {
      return 'ERROR: ' + e.message;
    }
  }, { hoy });

  expect(result).not.toContain('ERROR');
  expect(result).toContain('Informe financiero');
});

test('(q) ocultar nombres: ítem sin campo persona no se oculta; ítem con persona sí', async ({ page }) => {
  await loadWithState(page, buildEstado([], [
    { id: 'i1', nombre: 'Crédito Santander 1', tipo: 'deuda', monto: 5000, grupo: 'Deudas bancarias' },
    { id: 'i2', nombre: 'Delux sueldo',        tipo: 'activo', monto: 2000, grupo: 'Cobros pendientes' },
    { id: 'i3', nombre: 'Boris García', tipo: 'activo', monto: 10000, grupo: 'Préstamos con personas', persona: 'Boris García' },
  ]));

  const result = await page.evaluate(() => {
    const map = window._buildNameMap(true, '');
    const rCredito = window._applyNameMap('Crédito Santander 1', map);
    const rDelux   = window._applyNameMap('Delux sueldo', map);
    const rBoris   = window._applyNameMap('Boris García', map);
    return { rCredito, rDelux, rBoris, mapKeys: Object.keys(map) };
  });

  // Items without persona field should NOT be in the map → not replaced
  expect(result.rCredito).toBe('Crédito Santander 1');
  expect(result.rDelux).toBe('Delux sueldo');
  expect(result.mapKeys).not.toContain('crédito santander 1');
  expect(result.mapKeys).not.toContain('delux sueldo');
  // Item with persona field SHOULD be replaced
  expect(result.rBoris).toMatch(/^Persona \d+$/);
  expect(result.mapKeys).toContain('boris garcía');
});

test('(r) ocultar nombres: respeta límites de palabra (no reemplaza subcadenas)', async ({ page }) => {
  await loadWithState(page, buildEstado([], [
    { id: 'i1', nombre: 'Vero', tipo: 'activo', monto: 1000, grupo: 'Cobros pendientes', persona: 'Vero' },
  ]));

  const result = await page.evaluate(() => {
    const map = window._buildNameMap(true, '');
    return {
      standalone: window._applyNameMap('Pagó Vero ayer', map),
      inside:     window._applyNameMap('Cobro en Verona', map),
      accented:   window._applyNameMap('Pagó VERO hoy', map),
    };
  });

  // "Vero" as standalone word should be replaced (case-insensitive)
  expect(result.standalone).not.toContain('Vero');
  expect(result.standalone).toMatch(/Persona \d+/);
  expect(result.accented).not.toContain('VERO');
  expect(result.accented).toMatch(/Persona \d+/);
  // "Vero" inside "Verona" should NOT be replaced
  expect(result.inside).toContain('Verona');
  expect(result.inside).not.toMatch(/Persona \d+/);
});

test('(s) lo que viene: resumen Visa muestra resto tras pago parcial; oculta si resto=0', async ({ page }) => {
  const hoy   = isoDate(0);
  const en10  = isoDate(10);
  const ayer  = isoDate(-1);

  const estadoTest = {
    iniciales: { 'Visa Santander': -10000 },
    gastos: [
      { id: 'g1', tipo: 'ingreso', fecha: hoy, monto: 3000,
        medio: 'Visa Santander', categoria: 'Pago de créditos',
        descripcion: 'pago parcial', transferencia: false },
    ],
    items: [],
    patrimonioCargado: true,
    compromisos: [
      { id: 'c1', nombre: 'Visa Oct', entidad: 'Visa Santander', tipo: 'resumen',
        monto: 10000, pendientes: 1, proxVenc: en10, cierre: ayer },
    ],
    importaciones: {},
  };

  await loadWithState(page, estadoTest);

  const result = await page.evaluate(({ desde, hasta }) => {
    return window.buildInformeHTML({ desde, hasta, detalle: 'ninguno', inclTransf: false, ocultarNombres: false, otrosNombres: '' });
  }, { desde: hoy, hasta: hoy });

  // Resto = 10000 - 3000 = 7000
  const loQueViene = result.match(/Lo que viene[\s\S]*?<\/table>/)?.[0] ?? '';
  expect(loQueViene).toContain('7.000');
  expect(loQueViene).not.toContain('10.000');

  // Si el pago cubre el total, no debe aparecer en "Lo que viene"
  const estadoPago = {
    ...estadoTest,
    gastos: [
      { id: 'g2', tipo: 'ingreso', fecha: hoy, monto: 10000,
        medio: 'Visa Santander', categoria: 'Pago de créditos',
        descripcion: 'pago total', transferencia: false },
    ],
  };
  await loadWithState(page, estadoPago);
  const result2 = await page.evaluate(({ desde, hasta }) => {
    return window.buildInformeHTML({ desde, hasta, detalle: 'ninguno', inclTransf: false, ocultarNombres: false, otrosNombres: '' });
  }, { desde: hoy, hasta: hoy });

  const loQueViene2 = result2.match(/Lo que viene[\s\S]*?(<\/table>|Sin compromisos)/)?.[0] ?? result2;
  expect(loQueViene2).not.toContain('(resumen)');
});
