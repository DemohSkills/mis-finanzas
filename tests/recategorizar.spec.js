const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const TEMAS = ['auto', 'claro', 'oscuro', 'negro', 'neon-azul', 'neon-turquesa', 'neon-violeta'];

const g = (id, fecha, monto, categoria, extra = {}) => ({
  id, fecha, monto, categoria, tipo: 'gasto', medio: 'Banco Santander', descripcion: 'Mov ' + id, ...extra,
});
function estadoBase() {
  return {
    iniciales: {}, items: [], patrimonioCargado: true,
    gastos: [
      g('a1', '2026-01-10', 1000, 'Transporte/Auto', { subcategoria: 'Nafta', descripcion: 'YPF enero' }),
      g('a2', '2026-02-10', 2000, 'Transporte/Auto', { subcategoria: 'Nafta', descripcion: 'YPF febrero' }),
      g('a3', '2026-03-10', 3000, 'Transporte/Auto', { subcategoria: 'Peaje', descripcion: 'Autopista marzo' }),
      g('a4', '2026-04-10', 4000, 'Transporte/Auto', { descripcion: 'Taller sin subcategoría' }),
      g('b1', '2026-02-11', 500, 'Salud', { descripcion: 'Farmacia' }),
      g('i1', '2026-02-12', 9999, 'Transporte/Auto', { tipo: 'ingreso', descripcion: 'Ingreso con esa categoría' }),
      g('t1', '2026-02-13', 7777, 'Transporte/Auto', { transferencia: true, descripcion: 'Transferencia' }),
    ],
  };
}

async function abrir(page, { tema = 'auto', ocultar = false, ancho = 390, alto = 844 } = {}) {
  const err = [];
  page.on('pageerror', e => err.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') err.push(m.text()); });
  await page.setViewportSize({ width: ancho, height: alto });
  await page.addInitScript(({ est, tema, ocultar }) => {
    if (!localStorage.getItem('finanzas-v1')) localStorage.setItem('finanzas-v1', JSON.stringify(est));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    localStorage.setItem('finanzas-v1-tema', JSON.stringify(tema));
    if (ocultar) localStorage.setItem('finanzas-v1-ocultar', 'true');
  }, { est: estadoBase(), tema, ocultar });
  await page.goto(INDEX);
  for (const d of '1234') await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
  await page.locator('nav.tabs button[data-vista="config"]').click();
  await page.locator('#cfg-recat > summary').click();
  return err;
}
const gastosLS = page => page.evaluate(() => JSON.parse(localStorage.getItem('finanzas-v1')).gastos);
const ids = page => page.locator('#recatLista .recat-chk').evaluateAll(els => els.map(e => e.value));

async function buscar(page, { cat = 'Transporte/Auto', sub = '', desde = '', hasta = '' } = {}) {
  await page.selectOption('#recatCat', cat);
  await page.selectOption('#recatSubFiltro', sub);
  await page.fill('#recatDesde', desde);
  await page.fill('#recatHasta', hasta);
  await page.click('#btnRecatBuscar');
}

test('filtro por categoría: solo gastos de esa categoría (sin ingresos ni transferencias), más nuevos primero', async ({ page }) => {
  const err = await abrir(page);
  await buscar(page);
  await expect(page.locator('#recatPaso2')).toBeVisible();
  expect(await ids(page)).toEqual(['a4', 'a3', 'a2', 'a1']);
  await expect(page.locator('#recatLista .recat-fila').first()).toContainText('Taller sin subcategoría');
  expect(err).toEqual([]);
});

test('la subcategoría del filtro se puebla según la categoría y filtra', async ({ page }) => {
  await abrir(page);
  const opts = () => page.locator('#recatSubFiltro option').allTextContents();
  expect(await opts()).toEqual(['Todas', 'Nafta', 'Peaje']);
  await page.selectOption('#recatCat', 'Salud');
  expect(await opts()).toEqual(['Todas']);
  await buscar(page, { sub: 'Nafta' });
  expect(await ids(page)).toEqual(['a2', 'a1']);
});

test('filtro por rango de fechas (desde/hasta, inclusivo) y vacío trae todo', async ({ page }) => {
  await abrir(page);
  await buscar(page, { desde: '2026-02-01', hasta: '2026-03-10' });
  expect(await ids(page)).toEqual(['a3', 'a2']);
  await page.click('#btnRecatVolver');
  await buscar(page, { desde: '2026-03-11' });
  expect(await ids(page)).toEqual(['a4']);
  await page.click('#btnRecatVolver');
  await buscar(page, { sub: 'Peaje', desde: '2026-01-01', hasta: '2026-02-28' });
  await expect(page.locator('#recatPaso1')).toBeVisible();
  await expect(page.locator('#recatMsg')).toContainText('No hay gastos');
});

test('selección parcial, seleccionar todos y botón deshabilitado sin selección', async ({ page }) => {
  await abrir(page);
  await buscar(page);
  const sig = page.locator('#btnRecatSig');
  await expect(sig).toBeDisabled();
  await expect(sig).toHaveText('Recategorizar 0 seleccionados →');
  await page.locator('.recat-chk[value="a1"]').check();
  await expect(sig).toBeEnabled();
  await expect(sig).toHaveText('Recategorizar 1 seleccionado →');
  await page.locator('.recat-chk[value="a3"]').check();
  await expect(sig).toHaveText('Recategorizar 2 seleccionados →');
  await page.check('#recatTodos');
  await expect(sig).toHaveText('Recategorizar 4 seleccionados →');
  await page.uncheck('#recatTodos');
  await expect(sig).toBeDisabled();
});

test('recategorizar actualiza categoría y subcategoría solo de los seleccionados y persiste', async ({ page }) => {
  const err = await abrir(page);
  await buscar(page);
  await page.locator('.recat-chk[value="a1"]').check();
  await page.locator('.recat-chk[value="a3"]').check();
  await page.click('#btnRecatSig');
  await expect(page.locator('#recatPaso3')).toBeVisible();
  await expect(page.locator('#btnRecatConfirmar')).toBeDisabled();
  await page.locator('#recatDestChips .cat-chip[data-c="Hogar y Materiales"]').click();
  await page.fill('#recatSubNueva', 'Auto');
  await page.click('#btnRecatConfirmar');
  await expect(page.locator('#recatPaso1')).toBeVisible();
  await expect(page.locator('#recatMsg')).toContainText('2 gastos recategorizados a «Hogar y Materiales»');
  const gs = Object.fromEntries((await gastosLS(page)).map(x => [x.id, x]));
  expect(gs.a1).toMatchObject({ categoria: 'Hogar y Materiales', subcategoria: 'Auto' });
  expect(gs.a3).toMatchObject({ categoria: 'Hogar y Materiales', subcategoria: 'Auto' });
  expect(gs.a2).toMatchObject({ categoria: 'Transporte/Auto', subcategoria: 'Nafta' });
  expect(gs.a4).toMatchObject({ categoria: 'Transporte/Auto' });
  expect(gs.a4.subcategoria).toBeUndefined();
  expect(gs.b1.categoria).toBe('Salud');
  expect(gs.i1.categoria).toBe('Transporte/Auto');
  expect(gs.t1.categoria).toBe('Transporte/Auto');
  expect(err).toEqual([]);
});

test('subcategoría nueva vacía no toca la subcategoría de cada gasto', async ({ page }) => {
  await abrir(page);
  await buscar(page, { sub: 'Nafta' });
  await page.check('#recatTodos');
  await page.click('#btnRecatSig');
  await page.locator('#recatDestChips .cat-chip[data-c="Comida y Delivery"]').click();
  await page.click('#btnRecatConfirmar');
  const gs = Object.fromEntries((await gastosLS(page)).map(x => [x.id, x]));
  expect(gs.a1).toMatchObject({ categoria: 'Comida y Delivery', subcategoria: 'Nafta' });
  expect(gs.a2).toMatchObject({ categoria: 'Comida y Delivery', subcategoria: 'Nafta' });
  expect(gs.a3).toMatchObject({ categoria: 'Transporte/Auto', subcategoria: 'Peaje' });
});

test('crear categoría nueva desde el paso 3 y aplicarla', async ({ page }) => {
  await abrir(page);
  await buscar(page);
  await page.locator('.recat-chk[value="a2"]').check();
  await page.click('#btnRecatSig');
  page.once('dialog', d => d.accept('Auto Propio'));
  await page.click('#btnRecatNuevaCat');
  const nueva = page.locator('#recatDestChips .cat-chip[data-c="Auto Propio"]');
  await expect(nueva).toHaveClass(/on/);
  await expect(page.locator('#btnRecatConfirmar')).toBeEnabled();
  await page.click('#btnRecatConfirmar');
  const gs = Object.fromEntries((await gastosLS(page)).map(x => [x.id, x]));
  expect(gs.a2.categoria).toBe('Auto Propio');
  expect(gs.a1.categoria).toBe('Transporte/Auto');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('finanzas-v1-cats')))).toContain('Auto Propio');
  await expect(page.locator('#recatCat option', { hasText: 'Auto Propio' })).toHaveCount(1);
});

test('cancelar en el paso 3 vuelve a la lista y en el paso 2 al filtro, sin cambios', async ({ page }) => {
  await abrir(page);
  const antes = await gastosLS(page);
  await buscar(page);
  await page.check('#recatTodos');
  await page.click('#btnRecatSig');
  await page.locator('#recatDestChips .cat-chip[data-c="Salud"]').click();
  await page.click('#btnRecatCancelar3');
  await expect(page.locator('#recatPaso2')).toBeVisible();
  await page.click('#btnRecatVolver');
  await expect(page.locator('#recatPaso1')).toBeVisible();
  expect(await gastosLS(page)).toEqual(antes);
});

test('Categorías de gastos muestra subcategorías y «↻ Recategorizar» preselecciona la categoría', async ({ page }) => {
  await abrir(page);
  await page.locator('#cfg-cats-gastos > summary').click();
  const bloque = page.locator('#catChips .cat-blk', { has: page.locator('.cat-chip', { hasText: /^Transporte\/Auto$/ }) });
  expect(await bloque.locator('.cat-sub').allTextContents()).toEqual(['Nafta', 'Peaje']);
  await expect(page.locator('#catChips .cat-blk', { has: page.locator('.cat-chip', { hasText: /^Salud$/ }) }).locator('.cat-sub')).toHaveCount(0);
  await bloque.locator('.recat-btn').click();
  await expect(page.locator('#cfg-recat')).toHaveJSProperty('open', true);
  await expect(page.locator('#recatCat')).toHaveValue('Transporte/Auto');
  await expect(page.locator('#recatPaso1')).toBeVisible();
  await buscar(page);
  expect((await ids(page)).length).toBe(4);
});

for (const tema of TEMAS) {
  for (const ancho of [360, 412, 450]) {
    test(`sin overflow ni errores: ${tema} a ${ancho}px (modo ojo ${tema === 'neon-azul'})`, async ({ page }) => {
      const err = await abrir(page, { tema, ancho, ocultar: tema === 'neon-azul' });
      await page.selectOption('#recatCat', 'Transporte/Auto');
      await page.click('#btnRecatBuscar');
      await page.check('#recatTodos');
      await page.click('#btnRecatSig');
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(m.sw).toBeLessThanOrEqual(m.cw);
      await page.click('#btnRecatCancelar3');
      const m2 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(m2.sw).toBeLessThanOrEqual(m2.cw);
      expect(err).toEqual([]);
    });
  }
}
