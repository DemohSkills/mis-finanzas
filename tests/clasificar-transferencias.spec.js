/**
 * Propósito de las transferencias recibidas (Mercado Pago / Santander).
 * Datos FICTICIOS; las líneas del PDF se arman igual que en importar-mp-reservas.spec.js.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

const fmtAR = n => Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function buildMPLineas(rows, saldoInicial, saldoFinal) {
  const lines = [
    { y: 10, text: 'RESUMEN DE CUENTA EN PESOS' },
    { y: 30, text: `Saldo inicial: $ ${fmtAR(saldoInicial)}` },
    { y: 40, text: `Saldo final: $ ${fmtAR(saldoFinal)}` },
    { y: 70, text: 'Fecha Descripción ID de la operación Valor Saldo' },
    { y: 71, text: '1/6' },
  ];
  let y = 80;
  for (const r of rows) {
    lines.push({ y, text: r.desc }); y += 10;
    lines.push({ y, text: `${r.fecha} ${r.id} $ ${fmtAR(r.valor)} $ ${fmtAR(r.saldo)}` }); y += 10;
  }
  return lines;
}

// [desc, valor] → filas con saldo corrido desde 300.000
function filas(defs) {
  let saldo = 300000;
  return defs.map(([desc, valor], i) => {
    saldo += valor;
    return { desc, fecha: `1${i + 1}-06-2026`, id: String(800000001 + i), valor, saldo };
  });
}

function estadoBase(extra = {}) {
  return {
    iniciales: { 'Banco Santander': 0, 'Visa Santander': 0, 'Mercado Pago': 300000, 'Efectivo': 0,
      'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0, 'Reservas MP': 0 },
    gastos: [
      { id: 'g1', creado: 1, monto: 5000, fecha: '2026-06-10', categoria: 'Comida y Delivery', medio: 'Efectivo', tipo: 'gasto' },
    ],
    items: [], patrimonioCargado: true, compromisos: [], importaciones: {}, ...extra,
  };
}

async function abrir(page, estado, nombre = 'Dimitri Urbanc') {
  await page.addInitScript(([s, n]) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(s));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    if (n) localStorage.setItem('finanzas-v1-mi-nombre-banco', n);
  }, [estado, nombre]);
  await page.goto(INDEX);
  for (const d of ['1', '2', '3', '4']) await page.locator(`[data-d="${d}"]`).click();
  await page.waitForSelector('#pinScr', { state: 'hidden' });
  page.on('dialog', d => d.accept());
}

// Replica el flujo del manejador del archivo y confirma la importación
async function importar(page, defs) {
  const fs = filas(defs);
  const lineas = buildMPLineas(fs, 300000, fs[fs.length - 1].saldo);
  await page.evaluate((ls) => {
    const parsed = parseMercadoPago(ls);
    const cands = parsed.map(f => {
      const catInfo = _categorizarMP(f.desc, f.monto);
      return { ...f, catInfo, refs: [f.ref], yaExiste: false, soloHistorial: false, paraRevisar: catInfo.paraRevisar,
        _revisar_sel: null, _recordar: false, _recordarTexto: '' };
    });
    _setImpState(cands, 'Mercado Pago');
    _deduplicarImp(cands, 'Mercado Pago');
    _confirmarImpBanco(false);
  }, lineas);
}

const estadoActual = (page) => page.evaluate(() => JSON.parse(JSON.stringify(_getEstado())));
const saldos = (page) => page.evaluate(() => ({ mp: saldoDe('Mercado Pago'), ef: saldoDe('Efectivo') }));
const totales = (page) => page.evaluate(() => {
  const l = _getEstado().gastos.filter(g => !g.transferencia);
  return {
    g: l.filter(x => (x.tipo || 'gasto') === 'gasto').reduce((s, x) => s + x.monto, 0),
    i: l.filter(x => x.tipo === 'ingreso').reduce((s, x) => s + x.monto, 0),
  };
});
const proposito = (page, texto) => page.evaluate((t) => {
  const g = _getEstado().gastos.find(x => (x.descripcion || '').includes(t));
  return g ? (g.proposito || null) : undefined;
}, texto);
const fila = (page, texto) => page.locator('#clasifLista .clasif-row', { hasText: texto });

test.describe('clasificar transferencias recibidas', () => {
  test('apellido propio → sugerencia familia, pero SIN propósito hasta Guardar', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await abrir(page, estadoBase());
    await importar(page, [['Transferencia recibida Veronica Urbanc', 80000]]);
    await expect(page.locator('#clasifModal')).toBeVisible();
    const f = fila(page, 'Veronica Urbanc');
    await expect(f.locator('.prop-chip[data-p="familia"]')).toHaveClass(/sel/);
    await expect(f).toContainText('Sugerido');
    // Recordar: tildada y alineada a la izquierda
    const rec = f.locator('.clasif-rec');
    await expect(rec.locator('input')).toBeChecked();
    const jf = await rec.evaluate(el => getComputedStyle(el).justifyContent);
    expect(jf).toBe('flex-start');
    expect(await proposito(page, 'Veronica Urbanc')).toBeNull();
    await page.locator('#btnClasifGuardar').click();
    await expect(page.locator('#clasifModal')).toBeHidden();
    expect(await proposito(page, 'Veronica Urbanc')).toBe('familia');
    const reglas = (await estadoActual(page)).reglasRemitente;
    expect(reglas).toEqual([{ clave: 'veronica urbanc', proposito: 'familia' }]);
    expect(errors).toEqual([]);
  });

  test('regla guardada (Boris Urbanc = prestamo): se sugiere y sigue pidiendo confirmación', async ({ page }) => {
    await abrir(page, estadoBase({ reglasRemitente: [{ clave: 'boris urbanc', proposito: 'prestamo' }] }));
    await importar(page, [['Transferencia recibida Boris Urbanc', 150000]]);
    await expect(page.locator('#clasifModal')).toBeVisible();
    const f = fila(page, 'Boris Urbanc');
    await expect(f.locator('.prop-chip[data-p="prestamo"]')).toHaveClass(/sel/);
    await expect(f).toContainText('regla');
    expect(await proposito(page, 'Boris Urbanc')).toBeNull();
    await page.locator('#btnClasifGuardar').click();
    expect(await proposito(page, 'Boris Urbanc')).toBe('prestamo');
  });

  test('regla de un remitente sin apellido propio también pide confirmación', async ({ page }) => {
    await abrir(page, estadoBase({ reglasRemitente: [{ clave: 'carlos gomez', proposito: 'reembolso' }] }));
    await importar(page, [['Transferencia recibida Carlos Gomez', 1000]]);
    await expect(fila(page, 'Carlos Gomez').locator('.prop-chip[data-p="reembolso"]')).toHaveClass(/sel/);
    expect(await proposito(page, 'Carlos Gomez')).toBeNull();
  });

  test('desconocidos: sin clasificar; "Marcar todas como Delux" no toca al apellido propio y el total coincide', async ({ page }) => {
    await abrir(page, estadoBase());
    await importar(page, [
      ['Transferencia recibida Ana Lopez', 100000],
      ['Transferencia recibida Pedro Ruiz', 250000.5],
      ['Transferencia recibida Francis Urbanc', 30000],
    ]);
    await expect(page.locator('#clasifLista .clasif-row')).toHaveCount(3);
    await expect(fila(page, 'Ana Lopez').locator('.prop-chip.sel')).toHaveCount(0);
    await page.locator('#btnClasifDelux').click();
    await expect(fila(page, 'Ana Lopez').locator('.prop-chip[data-p="sueldo-delux"]')).toHaveClass(/sel/);
    await expect(fila(page, 'Pedro Ruiz').locator('.prop-chip[data-p="sueldo-delux"]')).toHaveClass(/sel/);
    await expect(fila(page, 'Francis Urbanc').locator('.prop-chip[data-p="familia"]')).toHaveClass(/sel/);
    await expect(fila(page, 'Francis Urbanc').locator('.prop-chip[data-p="sueldo-delux"]')).not.toHaveClass(/sel/);
    const total = page.locator('#clasifTotal');
    await expect(total).toContainText('2 transferencias');
    const txt = (await total.innerText()).replace(/\./g, '').replace(',', '.');
    expect(parseFloat(txt.match(/[\d.]+/)[0])).toBeCloseTo(350000.5, 2);
    // El total se recalcula al tocar chips
    await fila(page, 'Pedro Ruiz').locator('.prop-chip[data-p="otro"]').click();
    await expect(total).toContainText('1 transferencia)');
    await page.locator('#btnClasifGuardar').click();
    expect(await proposito(page, 'Ana Lopez')).toBe('sueldo-delux');
    expect(await proposito(page, 'Pedro Ruiz')).toBe('otro');
    expect(await proposito(page, 'Francis Urbanc')).toBe('familia');
  });

  test('Sueldo Delux no crea regla (la casilla se oculta y la función lo rechaza)', async ({ page }) => {
    await abrir(page, estadoBase());
    await importar(page, [['Transferencia recibida Ana Lopez', 100000]]);
    await page.locator('#btnClasifDelux').click();
    await expect(fila(page, 'Ana Lopez').locator('.clasif-rec')).toBeHidden();
    // Aun forzando el estado interno de la casilla, no se guarda regla
    await page.evaluate(() => { _clasif.pend[0].rec = true; });
    await page.locator('#btnClasifGuardar').click();
    expect((await estadoActual(page)).reglasRemitente).toEqual([]);
    expect(await page.evaluate(() => [_guardarReglaRemitente('x', 'sueldo-delux'), _guardarReglaRemitente('x', 'otro-trabajo')])).toEqual([false, false]);
    // Pasar a préstamo sí la ofrece y la crea
    await page.evaluate(() => mostrarVista('gastos'));
    await page.locator('#btnAbrirClasif').click();
    await fila(page, 'Ana Lopez').locator('.prop-chip[data-p="prestamo"]').click();
    await expect(fila(page, 'Ana Lopez').locator('.clasif-rec input')).toBeChecked();
    await page.locator('#btnClasifGuardar').click();
    expect((await estadoActual(page)).reglasRemitente).toEqual([{ clave: 'ana lopez', proposito: 'prestamo' }]);
  });

  test('"Después" no cambia datos; el aviso en Movimientos reabre la pantalla', async ({ page }) => {
    await abrir(page, estadoBase());
    await importar(page, [['Transferencia recibida Ana Lopez', 100000], ['Transferencia recibida Boris Urbanc', 5000]]);
    const antes = await estadoActual(page);
    await page.locator('#btnClasifDelux').click();
    await page.locator('#btnClasifDespues').click();
    await expect(page.locator('#clasifModal')).toBeHidden();
    expect(await estadoActual(page)).toEqual(antes);
    expect(await proposito(page, 'Ana Lopez')).toBeNull();
    await page.evaluate(() => mostrarVista('gastos'));
    await expect(page.locator('#avisoTransf')).toContainText('2 transferencias sin clasificar');
    await page.locator('#btnAbrirClasif').click();
    await expect(page.locator('#clasifLista .clasif-row')).toHaveCount(2);
  });

  test('importadas antes: se clasifican desde el aviso y las ya clasificadas se pueden cambiar', async ({ page }) => {
    const gs = [
      { id: 'a1', creado: 1, monto: 70000, fecha: '2026-05-10', categoria: 'Transferencia recibida', medio: 'Mercado Pago', tipo: 'ingreso', descripcion: 'Transferencia recibida Luis Paz' },
      { id: 'a2', creado: 2, monto: 20000, fecha: '2026-05-11', categoria: 'Transferencia recibida', medio: 'Mercado Pago', tipo: 'ingreso', descripcion: 'Transferencia recibida Eva Soto', proposito: 'otro' },
      { id: 'a3', creado: 3, monto: 999, fecha: '2026-05-12', categoria: 'Transferencia recibida', medio: 'Mercado Pago', tipo: 'ingreso', descripcion: 'Transferencia recibida propia', transferencia: true },
    ];
    await abrir(page, estadoBase({ gastos: [...estadoBase().gastos, ...gs] }));
    await page.evaluate(() => mostrarVista('gastos'));
    await expect(page.locator('#avisoTransf')).toContainText('1 transferencia sin clasificar');
    await page.locator('#btnAbrirClasif').click();
    await expect(page.locator('#clasifLista .clasif-row')).toHaveCount(2);          // la propia (transferencia) no aparece
    await page.locator('.clasif-hechas summary').click();
    await fila(page, 'Eva Soto').locator('.prop-chip[data-p="reembolso"]').click();
    await fila(page, 'Luis Paz').locator('.prop-chip[data-p="sueldo-delux"]').click();
    await page.locator('#btnClasifGuardar').click();
    expect(await proposito(page, 'Eva Soto')).toBe('reembolso');
    expect(await proposito(page, 'Luis Paz')).toBe('sueldo-delux');
    await expect(page.locator('#avisoTransf')).toContainText('clasificadas');
  });

  test('backup/restore conserva proposito y reglasRemitente; un backup viejo carga sin error', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await abrir(page, estadoBase());
    await importar(page, [['Transferencia recibida Boris Urbanc', 150000]]);
    await fila(page, 'Boris Urbanc').locator('.prop-chip[data-p="prestamo"]').click();
    await page.locator('#btnClasifGuardar').click();
    const json = await page.evaluate(() => buildBackupJson());
    const b = JSON.parse(json);
    expect(b.estado.reglasRemitente).toEqual([{ clave: 'boris urbanc', proposito: 'prestamo' }]);
    expect(b.estado.gastos.find(g => (g.descripcion || '').includes('Boris')).proposito).toBe('prestamo');

    // Restaurar sobre un estado distinto
    await page.evaluate(() => { _getEstado().reglasRemitente = []; _getEstado().gastos.forEach(g => delete g.proposito); guardar(); });
    await page.evaluate(async (j) => {
      restaurarBackup(new File([j], 'b.json'));
      await new Promise(r => setTimeout(r, 300));
    }, json);
    const e = await estadoActual(page);
    expect(e.reglasRemitente).toEqual([{ clave: 'boris urbanc', proposito: 'prestamo' }]);
    expect(e.gastos.find(g => (g.descripcion || '').includes('Boris')).proposito).toBe('prestamo');

    // Backup viejo: sin reglasRemitente ni proposito
    delete b.estado.reglasRemitente;
    b.estado.gastos.forEach(g => delete g.proposito);
    await page.evaluate(async (j) => {
      restaurarBackup(new File([j], 'viejo.json'));
      await new Promise(r => setTimeout(r, 300));
    }, JSON.stringify(b));
    const v = await estadoActual(page);
    expect(v.reglasRemitente).toEqual([]);
    expect(v.gastos.length).toBe(b.estado.gastos.length);
    expect(errors).toEqual([]);
  });

  test('los saldos y totales no cambian al clasificar', async ({ page }) => {
    await abrir(page, estadoBase());
    await importar(page, [['Transferencia recibida Ana Lopez', 100000], ['Transferencia recibida Francis Urbanc', 30000]]);
    const s0 = await saldos(page), t0 = await totales(page);
    await page.locator('#btnClasifDelux').click();
    await page.locator('#btnClasifGuardar').click();
    expect(await saldos(page)).toEqual(s0);
    expect(await totales(page)).toEqual(t0);
    expect(s0.mp).toBeCloseTo(300000 + 130000, 2);
  });
});
