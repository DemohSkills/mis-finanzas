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

test('cada fila muestra la cuenta en un badge y tiene su select con «— no mover —» por defecto', async ({ page }) => {
  await abrir(page);
  await buscar(page);
  const fila = page.locator('#recatLista .recat-fila[data-id="a1"]');
  await expect(fila.locator('.recat-medio')).toHaveText('Banco Santander');
  await expect(fila.locator('.meta')).toContainText('Nafta');
  await expect(fila.locator('.recat-dest')).toHaveValue('');
  await expect(fila.locator('.recat-dest option').first()).toHaveText('— no mover —');
  const cats = await page.evaluate(() => getCats());
  expect(await fila.locator('.recat-dest option').count()).toBe(cats.length + 1);
  await expect(page.locator('#recatPaso3')).toHaveCount(0);
});

test('barra «Mover a»: deshabilitada sin tildados; Aplicar prellena solo las tildadas y no guarda; Guardar se habilita', async ({ page }) => {
  await abrir(page);
  const antes = await gastosLS(page);
  await buscar(page);
  await expect(page.locator('#recatNTild')).toHaveText('0 tildados');
  await expect(page.locator('#recatMoverA')).toBeDisabled();
  await expect(page.locator('#btnRecatAplicar')).toBeDisabled();
  await expect(page.locator('#btnRecatGuardar')).toBeDisabled();
  await page.locator('.recat-chk[value="a1"]').check();
  await expect(page.locator('#recatNTild')).toHaveText('1 tildado');
  await expect(page.locator('#recatMoverA')).toBeEnabled();
  await expect(page.locator('#btnRecatAplicar')).toBeDisabled();
  await page.locator('.recat-chk[value="a3"]').check();
  await expect(page.locator('#recatNTild')).toHaveText('2 tildados');
  await page.selectOption('#recatMoverA', 'Hogar y Materiales');
  await expect(page.locator('#btnRecatAplicar')).toBeEnabled();
  await page.click('#btnRecatAplicar');
  const dest = id => page.locator(`.recat-fila[data-id="${id}"] .recat-dest`).inputValue();
  expect([await dest('a1'), await dest('a2'), await dest('a3'), await dest('a4')]).toEqual(['Hogar y Materiales', '', 'Hogar y Materiales', '']);
  await expect(page.locator('#btnRecatGuardar')).toBeEnabled();
  expect(await gastosLS(page)).toEqual(antes); // todavía nada guardado
  await page.uncheck('.recat-chk[value="a1"]');
  await page.uncheck('.recat-chk[value="a3"]');
  await expect(page.locator('#btnRecatGuardar')).toBeEnabled(); // el destino ya prellenado se mantiene
  await page.check('#recatTodos');
  await expect(page.locator('#recatNTild')).toHaveText('4 tildados');
  await page.uncheck('#recatTodos');
  await expect(page.locator('#recatNTild')).toHaveText('0 tildados');
});

test('mezcla: tildadas + Aplicar y select individual (sin tildar); Guardar cambia categoría, vacía subcategoría y persiste', async ({ page }) => {
  const err = await abrir(page);
  await buscar(page);
  // a1 y a3 por barra (tildadas), a2 por su propio select (sin tildar), a4 queda sin mover
  await page.locator('.recat-chk[value="a1"]').check();
  await page.locator('.recat-chk[value="a3"]').check();
  await page.selectOption('#recatMoverA', 'Hogar y Materiales');
  await page.click('#btnRecatAplicar');
  await page.selectOption('.recat-fila[data-id="a2"] .recat-dest', 'Salud');
  // el select individual pisa lo prellenado en a3
  await page.selectOption('.recat-fila[data-id="a3"] .recat-dest', 'Comida y Delivery');
  await page.click('#btnRecatGuardar');
  await expect(page.locator('#recatPaso1')).toBeVisible();
  await expect(page.locator('#recatMsg')).toHaveText('✓ 3 gastos recategorizados.');
  const gs = Object.fromEntries((await gastosLS(page)).map(x => [x.id, x]));
  expect(gs.a1.categoria).toBe('Hogar y Materiales');
  expect(gs.a2.categoria).toBe('Salud');
  expect(gs.a3.categoria).toBe('Comida y Delivery');
  for (const id of ['a1', 'a2', 'a3']) expect(gs[id].subcategoria).toBeUndefined();
  expect(gs.a4).toMatchObject({ categoria: 'Transporte/Auto' });
  expect(gs.b1.categoria).toBe('Salud');
  expect(gs.i1.categoria).toBe('Transporte/Auto');
  expect(gs.t1.categoria).toBe('Transporte/Auto');
  expect(err).toEqual([]);
  // los cambios se ven en Movimientos y el filtro ya no trae los movidos
  await buscar(page);
  expect(await ids(page)).toEqual(['a4']);
});

test('elegir en el select la misma categoría actual no cuenta como cambio', async ({ page }) => {
  await abrir(page);
  const antes = await gastosLS(page);
  await buscar(page);
  await page.selectOption('.recat-fila[data-id="a1"] .recat-dest', 'Transporte/Auto');
  await expect(page.locator('#btnRecatGuardar')).toBeDisabled();
  expect(await gastosLS(page)).toEqual(antes);
});

test('cancelar vuelve al filtro sin cambios', async ({ page }) => {
  await abrir(page);
  const antes = await gastosLS(page);
  await buscar(page);
  await page.selectOption('.recat-fila[data-id="a1"] .recat-dest', 'Salud');
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
      await page.selectOption('#recatMoverA', 'Salud');
      await page.click('#btnRecatAplicar');
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(m.sw).toBeLessThanOrEqual(m.cw);
      await page.click('#btnRecatVolver');
      await page.click('#btnRecatBuscar');
      const m2 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(m2.sw).toBeLessThanOrEqual(m2.cw);
      expect(err).toEqual([]);
    });
  }
}
