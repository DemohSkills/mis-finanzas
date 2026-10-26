// @ts-check
// Borradores de gastos: anotar sin tocar saldos y cruzar con los resúmenes al importar.
// Datos ficticios.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { buildVisaAoa } = require('./_visa-aoa');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';
const HOY = '2026-10-20';

function buildEstado(extra = {}) {
  return {
    iniciales: { 'Banco Santander': 500000, 'Mercado Pago': 100000, 'Efectivo': 20000 },
    gastos: [
      { id: 'g1', monto: 3000, fecha: '2026-10-01', categoria: 'Comida', descripcion: 'almuerzo', tipo: 'gasto', medio: 'Efectivo', creado: 1 },
    ],
    items: [], patrimonioCargado: true, compromisos: [],
    ...extra,
  };
}
const bor = (id, over = {}) => ({ id, creado: Number(id.replace(/\D/g, '')) || 1, fecha: '2026-10-18', monto: 1500, medio: 'Banco Santander', categoria: 'Comida', nota: 'pizza', ...over });

async function seedAndUnlock(page, estado) {
  await page.clock.setFixedTime(new Date(HOY + 'T12:00:00'));
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}
async function goToMovim(page) {
  await page.locator('nav.tabs button[data-vista="gastos"]').click();
  await page.waitForSelector('#busqMov');
}
const abrirBorr = (page) => page.locator('#det-borradores > summary').click();
const abrirManual = (page) => page.locator('#det-borr-manual > summary').click();
const estadoDe = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window._getEstado())));

/** Arma candidatos bancarios sintéticos, cruza y muestra el preview (sin confirmar). */
async function prepararImp(page, medio, filas) {
  await page.evaluate(({ medio, filas }) => {
    const cands = filas.map(f => ({
      fecha: f.fecha, desc: f.desc || 'Compra', concepto: f.desc || 'Compra', monto: -f.monto,
      catInfo: { tipo: 'gasto', cat: 'Otros/Varios', paraRevisar: false },
      refs: [], yaExiste: false, soloHistorial: false, paraRevisar: false,
      _revisar_sel: null, _recordar: false, _recordarTexto: '',
    }));
    window._deduplicarImp(cands, medio);
    window._cruzarBorradores(cands, medio);
    window._setImpState(cands, medio);
    document.getElementById('impModal').hidden = false;
    window._renderImpPreview();
  }, { medio, filas });
}
const cruces = (page) => page.evaluate(() => {
  // lee del DOM del preview: filas con marca de borrador
  return [...document.querySelectorAll('#impModalBody .imp-borr-tag')].length;
});

test.describe('borradores: sección y lista', () => {
  test('(a) plegada al abrir, con contador visible si hay borradores', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1'), bor('b2', { monto: 900 })] }));
    await goToMovim(page);
    await expect(page.locator('#det-borradores')).not.toHaveAttribute('open', '');
    expect(await page.locator('#det-borradores').evaluate(e => e.open)).toBe(false);
    await expect(page.locator('#borrContador')).toBeVisible();
    await expect(page.locator('#borrContador')).toHaveText('2 sin cruzar');
  });

  test('(a) sin borradores no hay contador', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [] }));
    await goToMovim(page);
    await expect(page.locator('#borrContador')).toBeHidden();
    await abrirBorr(page);
    await expect(page.locator('#borrLista')).toContainText('No hay borradores.');
  });

  test('está entre "Cargar movimiento" y el buscador', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    const orden = await page.evaluate(() => {
      const pos = id => document.getElementById(id).compareDocumentPosition(document.getElementById('det-borradores'));
      return { trasForm: !!(pos('det-form') & Node.DOCUMENT_POSITION_FOLLOWING), antesBusq: !!(document.getElementById('busqMov').compareDocumentPosition(document.getElementById('det-borradores')) & Node.DOCUMENT_POSITION_PRECEDING) };
    });
    expect(orden.trasForm).toBe(true);
    expect(orden.antesBusq).toBe(true);
  });

  test('(b) anotar un borrador lo lista y NO toca saldos ni gastos', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    const saldosAntes = await page.locator('#saldos').innerText();
    const antes = await estadoDe(page);
    await abrirBorr(page);
    await abrirManual(page);
    await page.fill('#borrMonto', '2500');
    await page.selectOption('#borrMedio', 'Mercado Pago');
    await page.fill('#borrNota', 'kiosco');
    await page.click('#btnAnotarBorrador');
    await expect(page.locator('#borrLista .borr-row')).toHaveCount(1);
    await expect(page.locator('#borrLista')).toContainText('kiosco');
    await expect(page.locator('#borrContador')).toHaveText('1 sin cruzar');
    const despues = await estadoDe(page);
    expect(despues.gastos).toEqual(antes.gastos);
    expect(despues.iniciales).toEqual(antes.iniciales);
    expect(despues.borradores).toHaveLength(1);
    expect(despues.borradores[0]).toMatchObject({ monto: 2500, medio: 'Mercado Pago', nota: 'kiosco', fecha: HOY });
    expect(await page.locator('#saldos').innerText()).toBe(saldosAntes);
    // formulario limpio
    expect(await page.inputValue('#borrMonto')).toBe('');
    expect(await page.inputValue('#borrNota')).toBe('');
    // no aparece en el historial ni en la búsqueda
    await page.fill('#busqMov', 'kiosco');
    await page.waitForTimeout(350);
    await expect(page.locator('#historial')).not.toContainText('kiosco');
  });

  test('(c) valida el monto: 0, vacío y negativo se rechazan', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    const msgs = [];
    page.on('dialog', d => { msgs.push(d.message()); d.accept(); });
    await abrirBorr(page);
    await abrirManual(page);
    for (const v of ['0', '', '-300']) {
      await page.fill('#borrMonto', v);
      await page.click('#btnAnotarBorrador');
    }
    expect(msgs).toHaveLength(3);
    expect((await estadoDe(page)).borradores).toHaveLength(0);
  });

  test('(d) borrar pide confirmación', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1')] }));
    await goToMovim(page);
    await abrirBorr(page);
    page.once('dialog', d => d.dismiss());
    await page.locator('#borrLista .borr-del').click();
    expect((await estadoDe(page)).borradores).toHaveLength(1);
    page.once('dialog', d => d.accept());
    await page.locator('#borrLista .borr-del').click();
    expect((await estadoDe(page)).borradores).toHaveLength(0);
    await expect(page.locator('#borrContador')).toBeHidden();
  });

  test('(e) más de 7 días se marca en amarillo; reciente no', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1', { fecha: '2026-10-10' }), bor('b2', { fecha: '2026-10-18', monto: 700 })] }));
    await goToMovim(page);
    await abrirBorr(page);
    const viejo = page.locator('#borrLista .borr-row[data-id="b1"]');
    const nuevo = page.locator('#borrLista .borr-row[data-id="b2"]');
    await expect(viejo.locator('.borr-hace')).toHaveText('hace 10 días sin cruzar');
    await expect(nuevo.locator('.borr-hace')).toHaveCount(0);
    const col = (loc) => loc.locator('.borr-monto').evaluate(e => getComputedStyle(e).color);
    const warn = await page.evaluate(() => { const s = document.createElement('i'); s.style.color = 'var(--warn)'; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; });
    expect(await col(viejo)).toBe(warn);
    expect(await col(nuevo)).not.toBe(warn);
  });
});

test.describe('borradores: cruce al importar', () => {
  test('(f) cruza con mismo medio, monto exacto y fecha ±5; toma la categoría', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1', { fecha: '2026-10-10', monto: 4200, categoria: 'Salud' })] }));
    await page.evaluate(() => { window.alert = () => {}; });
    await prepararImp(page, 'Banco Santander', [{ fecha: '2026-10-15', monto: 4200 }]);
    await expect(page.locator('#impModalBody')).toContainText('📝 cruzó con borrador: Salud');
    await expect(page.locator('#impModalBody')).not.toContainText('QUEDARON SIN CRUZAR');
  });

  test('(f) NO cruza: fecha fuera de ±5, distinto monto, distinto medio', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1', { fecha: '2026-10-10', monto: 4200, categoria: 'Salud' })] }));
    await prepararImp(page, 'Banco Santander', [
      { fecha: '2026-10-16', monto: 4200 },   // 6 días
      { fecha: '2026-10-11', monto: 4200.5 }, // otro importe
    ]);
    expect(await cruces(page)).toBe(0);
    await expect(page.locator('#impModalBody')).toContainText('QUEDARON SIN CRUZAR (1)');
    await prepararImp(page, 'Mercado Pago', [{ fecha: '2026-10-11', monto: 4200 }]); // otro medio
    expect(await cruces(page)).toBe(0);
    await expect(page.locator('#impModalBody')).not.toContainText('QUEDARON SIN CRUZAR');
  });

  test('(f) límite exacto de 5 días sí cruza', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1', { fecha: '2026-10-10', monto: 800 })] }));
    await prepararImp(page, 'Banco Santander', [{ fecha: '2026-10-15', monto: 800 }]);
    expect(await cruces(page)).toBe(1);
  });

  test('(g) un borrador cruza una sola vez (dos candidatos iguales)', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1', { monto: 1500 })] }));
    await prepararImp(page, 'Banco Santander', [{ fecha: '2026-10-18', monto: 1500 }, { fecha: '2026-10-19', monto: 1500 }]);
    expect(await cruces(page)).toBe(1);
  });

  test('(h) con dos borradores posibles gana el de fecha más cercana', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [
      bor('b1', { fecha: '2026-10-10', monto: 1500, categoria: 'Salud' }),
      bor('b2', { fecha: '2026-10-13', monto: 1500, categoria: 'Ocio' }),
    ] }));
    await prepararImp(page, 'Banco Santander', [{ fecha: '2026-10-14', monto: 1500 }]);
    await expect(page.locator('#impModalBody')).toContainText('📝 cruzó con borrador: Ocio');
    await expect(page.locator('#impModalBody')).toContainText('QUEDARON SIN CRUZAR (1)');
  });

  test('(i) el preview no consume; cancelar no elimina; confirmar elimina solo los usados', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1', { monto: 1500 }), bor('b2', { monto: 999, fecha: '2026-10-05' })] }));
    await page.evaluate(() => { window.alert = () => {}; });
    await prepararImp(page, 'Banco Santander', [{ fecha: '2026-10-18', monto: 1500 }]);
    expect((await estadoDe(page)).borradores).toHaveLength(2);
    // recalcular el preview (agrupar) no consume
    await page.locator('#impChkAgrupar').uncheck();
    await page.locator('#impChkAgrupar').check();
    expect((await estadoDe(page)).borradores).toHaveLength(2);
    expect(await cruces(page)).toBe(1);
    // cancelar
    await page.click('#btnCancelarImpPrev');
    expect((await estadoDe(page)).borradores).toHaveLength(2);
    // confirmar
    await prepararImp(page, 'Banco Santander', [{ fecha: '2026-10-18', monto: 1500 }]);
    await page.click('#btnConfirmarImp');
    const est = await estadoDe(page);
    expect(est.borradores.map(b => b.id)).toEqual(['b2']);
    const g = est.gastos.find(x => x.monto === 1500);
    expect(g.categoria).toBe('Comida');
    await expect(page.locator('#borrContador')).toHaveText('1 sin cruzar');
  });

  test('(i) un candidato que ya existe en la app no consume el borrador', async ({ page }) => {
    const e = buildEstado({ borradores: [bor('b1', { monto: 1500 })] });
    e.gastos.push({ id: 'g9', monto: 1500, fecha: '2026-10-18', categoria: 'Otros/Varios', descripcion: 'x', tipo: 'gasto', medio: 'Banco Santander', creado: 9 });
    await seedAndUnlock(page, e);
    await prepararImp(page, 'Banco Santander', [{ fecha: '2026-10-18', monto: 1500 }]);
    expect(await cruces(page)).toBe(0);
    await expect(page.locator('#impModalBody')).toContainText('QUEDARON SIN CRUZAR (1)');
  });

  test('(j) los que no cruzan se listan con la leyenda', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1', { monto: 777, nota: 'cafe', categoria: 'Comida' })] }));
    await prepararImp(page, 'Banco Santander', [{ fecha: '2026-10-18', monto: 1500 }]);
    const bloque = page.locator('#impBorrSin');
    await expect(bloque).toContainText('QUEDARON SIN CRUZAR (1)');
    await expect(bloque).toContainText('cafe · Comida');
    await expect(bloque).toContainText('Siguen en Borradores. Si el banco lo cobró con otro importe, borralo y cargá el movimiento a mano.');
  });

  test('Visa: cruza, habilita importar un movimiento sin categoría y consume al confirmar', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [
      bor('b1', { medio: 'Visa Santander', fecha: '2026-09-29', monto: 14000, categoria: 'Salud', nota: 'consulta' }),
      bor('b2', { medio: 'Visa Santander', fecha: '2026-09-29', monto: 555, categoria: 'Comida', nota: 'otro' }),
    ] }));
    const aoa = buildVisaAoa({
      cierre: '01/10/2026', vencimiento: '09/10/2026', totalPesos: 14000, totalUSD: 0,
      cards: [{ nombre: 'Titular', numero: '1111', tipo: 'titular', totalPesos: 14000, totalUSD: 0,
        movs: [{ fecha: '30/09/2026', desc: 'Zzqx comercio ficticio', comp: '001K', pesos: 14000 }] }],
    });
    await page.evaluate((aoa) => {
      window.alert = () => {};
      const data = window.parseVisaXlsx(aoa);
      document.getElementById('impModal').hidden = false;
      window._renderVisaPreview(data);
    }, aoa);
    const body = page.locator('#impModalBody');
    await expect(body).toContainText('📝 cruzó con borrador: Salud');
    await expect(body).toContainText('QUEDARON SIN CRUZAR (1)');
    await expect(page.locator('#btnConfirmarVisaImp')).toBeEnabled();
    expect((await estadoDe(page)).borradores).toHaveLength(2); // el preview no consume
    await page.click('#btnConfirmarVisaImp');
    const est = await estadoDe(page);
    expect(est.borradores.map(b => b.id)).toEqual(['b2']);
    expect(est.gastos.find(g => g.monto === 14000).categoria).toBe('Salud');
  });
});

test.describe('borradores: backup y compatibilidad', () => {
  test('(k) el backup incluye borradores y restaurar los recupera', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1'), bor('b2', { monto: 321 })] }));
    const json = await page.evaluate(() => window.buildBackupJson());
    expect(JSON.parse(json).estado.borradores).toHaveLength(2);
    // vaciar y restaurar
    await page.evaluate(() => { window._getEstado().borradores = []; window._guardar(); });
    page.on('dialog', d => d.accept());
    await page.locator('#backupFile').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(json) });
    await page.waitForTimeout(400);
    expect((await estadoDe(page)).borradores.map(b => b.id)).toEqual(['b1', 'b2']);
  });

  test('(k) un backup viejo sin el campo restaura sin errores', async ({ page }) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await seedAndUnlock(page, buildEstado({ borradores: [bor('b1')] }));
    const viejo = JSON.stringify({ version: 1, fecha: '2026-01-01', estado: { iniciales: {}, gastos: [], items: [], patrimonioCargado: true, compromisos: [] }, snaps: [], cats: [], catsIncome: [], reglas: [] });
    page.on('dialog', d => d.accept());
    await page.locator('#backupFile').setInputFiles({ name: 'v.json', mimeType: 'application/json', buffer: Buffer.from(viejo) });
    await page.waitForTimeout(400);
    expect((await estadoDe(page)).borradores).toEqual([]);
    expect(errores).toHaveLength(0);
  });

  test('(l) un estado viejo sin borradores carga bien', async ({ page }) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    expect((await estadoDe(page)).borradores).toEqual([]);
    await expect(page.locator('#borrContador')).toBeHidden();
    expect(errores).toHaveLength(0);
  });
});

test.describe('buscador con lupa', () => {
  test('(m) conserva #busqMov y filtra; muestra etiqueta, lupa y placeholder nuevo', async ({ page }) => {
    const e = buildEstado();
    e.gastos.push({ id: 'g2', monto: 5000, fecha: '2026-10-15', categoria: 'Comida', descripcion: 'pizza', tipo: 'gasto', medio: 'Efectivo', creado: 2 });
    await seedAndUnlock(page, e);
    await goToMovim(page);
    await expect(page.locator('section:has(#busqMov)')).toContainText('BUSCAR EN MOVIMIENTOS');
    await expect(page.locator('.busq-lupa')).toBeVisible();
    await expect(page.locator('#busqMov')).toHaveAttribute('placeholder', 'Buscar… ej: pizza 15/10');
    await page.fill('#busqMov', 'pizza');
    await page.waitForTimeout(350);
    await expect(page.locator('#historial')).toContainText('pizza');
    await expect(page.locator('#historial')).not.toContainText('almuerzo');
  });

  for (const tema of ['auto', 'claro', 'oscuro', 'negro']) {
    test(`(m) se ve bien a 360px sin overflow (tema ${tema})`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.addInitScript((t) => localStorage.setItem('finanzas-v1-tema', JSON.stringify(t)), tema);
      await seedAndUnlock(page, buildEstado({ borradores: [bor('b1', { fecha: '2026-10-01', nota: 'una nota bastante larga para probar el corte de línea' })] }));
      await goToMovim(page);
      await abrirBorr(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
      const caja = await page.locator('#busqMov').boundingBox();
      expect(caja.width).toBeGreaterThan(150);
    });
  }
});

test.describe('borradores: deshacer importación los devuelve', () => {
  const B1 = () => bor('b1', { monto: 1500, nota: 'pizza', categoria: 'Comida', fecha: '2026-10-18', creado: 111 });
  const B2 = () => bor('b2', { monto: 999, fecha: '2026-10-05' });
  const siempreSi = (page) => page.evaluate(() => { window.alert = () => {}; window.confirm = () => true; });

  async function importarVisa(page) {
    const aoa = buildVisaAoa({
      cierre: '01/10/2026', vencimiento: '09/10/2026', totalPesos: 14000, totalUSD: 0,
      cards: [{ nombre: 'Titular', numero: '1111', tipo: 'titular', totalPesos: 14000, totalUSD: 0,
        movs: [{ fecha: '30/09/2026', desc: 'Zzqx comercio ficticio', comp: '001K', pesos: 14000 }] }],
    });
    await page.evaluate((aoa) => {
      const data = window.parseVisaXlsx(aoa);
      document.getElementById('impModal').hidden = false;
      window._renderVisaPreview(data);
    }, aoa);
    await page.click('#btnConfirmarVisaImp');
  }

  for (const medio of ['Banco Santander', 'Mercado Pago']) {
    test(`${medio}: deshacer devuelve el borrador idéntico y no duplica si se repite`, async ({ page }) => {
      await seedAndUnlock(page, buildEstado({ borradores: [{ ...B1(), medio }, B2()] }));
      await siempreSi(page);
      const original = (await estadoDe(page)).borradores.find(b => b.id === 'b1');
      await prepararImp(page, medio, [{ fecha: '2026-10-18', monto: 1500 }]);
      await page.click('#btnConfirmarImp');
      let est = await estadoDe(page);
      expect(est.borradores.map(b => b.id)).toEqual(['b2']);
      expect(est.importaciones[medio].borradoresUsados).toEqual([original]);
      await page.evaluate((m) => window._deshacerUltimaImp(m), medio);
      est = await estadoDe(page);
      expect(est.borradores.find(b => b.id === 'b1')).toEqual(original);
      expect(est.borradores).toHaveLength(2);
      expect(est.gastos.find(g => g.monto === 1500)).toBeUndefined();
      await page.evaluate((m) => window._deshacerUltimaImp(m), medio);
      expect((await estadoDe(page)).borradores).toHaveLength(2);
    });
  }

  test('un borrador anotado después de importar no se pisa al deshacer', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [B1()] }));
    await siempreSi(page);
    await prepararImp(page, 'Banco Santander', [{ fecha: '2026-10-18', monto: 1500 }]);
    await page.click('#btnConfirmarImp');
    await page.evaluate(() => {
      window._getEstado().borradores.push({ id: 'b9', creado: 999, fecha: '2026-10-20', monto: 321, medio: 'Efectivo', categoria: 'Otros/Varios', nota: 'nuevo' });
      window._guardar();
    });
    await page.evaluate(() => window._deshacerUltimaImp('Banco Santander'));
    const est = await estadoDe(page);
    expect(est.borradores.map(b => b.id).sort()).toEqual(['b1', 'b9']);
    expect(est.borradores.find(b => b.id === 'b9')).toMatchObject({ monto: 321, nota: 'nuevo' });
  });

  test('si el id ya existe no se duplica ni se pisa', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [B1()] }));
    await siempreSi(page);
    await prepararImp(page, 'Banco Santander', [{ fecha: '2026-10-18', monto: 1500 }]);
    await page.click('#btnConfirmarImp');
    await page.evaluate(() => {
      window._getEstado().borradores.push({ id: 'b1', creado: 5, fecha: '2026-10-21', monto: 42, medio: 'Efectivo', categoria: 'Otros/Varios', nota: 'otro' });
      window._guardar();
    });
    await page.evaluate(() => window._deshacerUltimaImp('Banco Santander'));
    const bs = (await estadoDe(page)).borradores;
    expect(bs).toHaveLength(1);
    expect(bs[0].monto).toBe(42);
  });

  test('Visa: deshacer devuelve el borrador idéntico y no duplica si se repite', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [
      bor('b1', { medio: 'Visa Santander', fecha: '2026-09-29', monto: 14000, categoria: 'Salud', nota: 'consulta', creado: 222 }),
      bor('b2', { medio: 'Visa Santander', fecha: '2026-09-29', monto: 555, categoria: 'Comida', nota: 'otro' }),
    ] }));
    await siempreSi(page);
    const original = (await estadoDe(page)).borradores.find(b => b.id === 'b1');
    await importarVisa(page);
    let est = await estadoDe(page);
    expect(est.borradores.map(b => b.id)).toEqual(['b2']);
    expect(est.importaciones['Visa Santander'].borradoresUsados).toEqual([original]);
    await page.evaluate(() => window._deshacerUltimaImpVisa());
    est = await estadoDe(page);
    expect(est.borradores.find(b => b.id === 'b1')).toEqual(original);
    expect(est.borradores).toHaveLength(2);
    await page.evaluate(() => window._deshacerUltimaImpVisa());
    expect((await estadoDe(page)).borradores).toHaveLength(2);
  });

  test('el registro del lote sobrevive a backup y restauración', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [B1()] }));
    await siempreSi(page);
    const original = (await estadoDe(page)).borradores[0];
    await prepararImp(page, 'Banco Santander', [{ fecha: '2026-10-18', monto: 1500 }]);
    await page.click('#btnConfirmarImp');
    const json = await page.evaluate(() => window.buildBackupJson());
    await page.evaluate(() => { const e = window._getEstado(); e.importaciones = {}; e.gastos = []; e.borradores = []; window._guardar(); });
    page.on('dialog', d => d.accept());
    await page.locator('#backupFile').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(json) });
    await page.waitForTimeout(400);
    await siempreSi(page);
    await page.evaluate(() => window._deshacerUltimaImp('Banco Santander'));
    expect((await estadoDe(page)).borradores).toEqual([original]);
  });

  test('el placeholder del buscador entra completo a 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    const ok = await page.evaluate(() => {
      const el = document.getElementById('busqMov');
      const cs = getComputedStyle(el);
      const c = document.createElement('canvas').getContext('2d');
      c.font = cs.font;
      const ancho = c.measureText(el.placeholder).width;
      const util = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return ancho <= util;
    });
    expect(ok).toBe(true);
  });
});

test.describe('borradores: Carga manual plegable', () => {
  const manualAbierto = (page) => page.locator('#det-borr-manual').evaluate(e => e.open);

  test('(1) al abrir Borradores, Carga manual está cerrada y la lista visible', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [{ id: 'b1', creado: 1, fecha: '2026-10-18', monto: 1500, medio: 'Efectivo', categoria: 'Comida', nota: 'pizza' }] }));
    await goToMovim(page);
    await abrirBorr(page);
    expect(await manualAbierto(page)).toBe(false);
    await expect(page.locator('#formBorrador')).toBeHidden();
    await expect(page.locator('.borr-rotulo')).toBeVisible();
    await expect(page.locator('#borrLista .borr-row')).toBeVisible();
  });

  test('(2) el ✎ abre Carga manual y carga el borrador', async ({ page }) => {
    await seedAndUnlock(page, buildEstado({ borradores: [{ id: 'b1', creado: 1, fecha: '2026-10-18', monto: 1500, medio: 'Efectivo', categoria: 'Comida', nota: 'pizza' }] }));
    await goToMovim(page);
    await abrirBorr(page);
    await page.locator('#borrLista .borr-edit').click();
    expect(await manualAbierto(page)).toBe(true);
    await expect(page.locator('#formBorrador')).toBeVisible();
    expect(await page.inputValue('#borrNota')).toBe('pizza');
    // cancelar no la cierra
    await page.click('#btnCancelarBorrador');
    expect(await manualAbierto(page)).toBe(true);
  });

  test('(3) anotar un borrador deja la sección abierta', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    await abrirBorr(page);
    await abrirManual(page);
    await page.fill('#borrMonto', '900');
    await page.click('#btnAnotarBorrador');
    await expect(page.locator('#borrLista .borr-row')).toHaveCount(1);
    expect(await manualAbierto(page)).toBe(true);
  });

  test('(4) al recargar la app arranca cerrada', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await goToMovim(page);
    await abrirBorr(page);
    await abrirManual(page);
    expect(await manualAbierto(page)).toBe(true);
    await page.reload();
    for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
    await page.waitForTimeout(400);
    expect(await manualAbierto(page)).toBe(false);
  });
});
