// Panel «⚙ Filtros» de Movimientos: categorías/subcategorías, períodos rápidos y rango manual, en AND con el texto
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');

const sv = d => d.toLocaleDateString('sv');
const hoyD = new Date();
const dia = (dm, dd) => sv(new Date(hoyD.getFullYear(), hoyD.getMonth() + dm, dd));

function estado() {
  const g = (id, f, monto, cat, desc, extra = {}) => ({ id, fecha: f, monto, categoria: cat, descripcion: desc, tipo: 'gasto', medio: 'Efectivo', creado: +id.slice(1), ...extra });
  return {
    iniciales: { Efectivo: 100000 },
    gastos: [
      g('g1', dia(0, 2), 1000, 'Comida', 'pizza', { subcategoria: 'Delivery' }),
      g('g2', dia(0, 3), 2000, 'Comida', 'verdura', { subcategoria: 'Súper' }),
      g('g3', dia(0, 4), 3000, 'Transporte', 'nafta pizza'),
      g('g4', dia(-1, 10), 4000, 'Comida', 'pizza mes pasado', { subcategoria: 'Delivery' }),
      g('g5', dia(-2, 10), 5000, 'Transporte', 'taxi'),
      g('g6', dia(-4, 10), 6000, 'Comida', 'viejo'),
      { id: 'g7', fecha: dia(0, 5), monto: 90000, categoria: 'Sueldo/Honorarios', descripcion: 'sueldo', tipo: 'ingreso', medio: 'Efectivo', creado: 7 },
    ],
    items: [], patrimonioCargado: true, compromisos: [],
  };
}

async function abrir(page, ancho = 390) {
  const err = [];
  page.on('pageerror', e => err.push(String(e)));
  await page.setViewportSize({ width: ancho, height: 844 });
  await page.addInitScript(est => {
    if (!localStorage.getItem('finanzas-v1')) localStorage.setItem('finanzas-v1', JSON.stringify(est));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
  }, estado());
  await page.goto(INDEX);
  for (const d of '1234') await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(300);
  await page.locator('nav.tabs button[data-vista="gastos"]').click();
  await page.waitForSelector('#busqMov');
  return err;
}
const filas = page => page.locator('#historial .gasto');
const abrirPanel = async page => { await page.click('#btnFiltrosMov'); await expect(page.locator('#det-filtro-mov')).toHaveJSProperty('open', true); };
const chipCat = (page, c) => page.locator('#fmCats .cat-chip', { hasText: new RegExp('^' + c + '$') });

test('lógica pura: _rangoPeriodo y filtro por rango/categoría/subcategoría', async ({ page }) => {
  await abrir(page);
  const r = await page.evaluate(() => ({
    mes: _rangoPeriodo('mes', '2026-11-04'), ant: _rangoPeriodo('ant', '2026-11-04'), t3: _rangoPeriodo('3m', '2026-11-04'),
    enero: _rangoPeriodo('ant', '2026-01-15'), t3enero: _rangoPeriodo('3m', '2026-01-15'), feb: _rangoPeriodo('mes', '2028-02-10'),
    vacio: _fmPred(_fmVacio()),
  }));
  expect(r.mes).toEqual({ desde: '2026-11-01', hasta: '2026-11-30' });
  expect(r.ant).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' });
  expect(r.t3).toEqual({ desde: '2026-09-01', hasta: '2026-11-30' });
  expect(r.enero).toEqual({ desde: '2025-12-01', hasta: '2025-12-31' });
  expect(r.t3enero).toEqual({ desde: '2025-11-01', hasta: '2026-01-31' });
  expect(r.feb).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' });
  expect(r.vacio).toBeNull();
  // rango inclusivo + categoría + subcategorías (la categoría sin subs elegidas pasa entera)
  const ids = await page.evaluate(() => {
    const L = [
      { id: 'a', fecha: '2026-10-01', categoria: 'Comida', subcategoria: 'Delivery' },
      { id: 'b', fecha: '2026-10-15', categoria: 'Comida', subcategoria: 'Súper' },
      { id: 'c', fecha: '2026-10-31', categoria: 'Transporte' },
      { id: 'd', fecha: '2026-11-01', categoria: 'Comida' },
    ];
    const f = o => filtrarMovimientos('', L, { ..._fmVacio(), ...o }).map(x => x.id).join('');
    return {
      rango: f({ desde: '2026-10-01', hasta: '2026-10-31' }), soloDesde: f({ desde: '2026-10-31' }), soloHasta: f({ hasta: '2026-10-01' }),
      cat: f({ cats: ['Comida'] }), sub: f({ cats: ['Comida'], subs: { Comida: ['Delivery'] } }),
      dos: f({ cats: ['Comida', 'Transporte'], subs: { Comida: ['Súper'] } }),
      ambos: f({ cats: ['Comida'], desde: '2026-10-10', hasta: '2026-10-31' }),
      texto: filtrarMovimientos('comida', L.map(x => ({ ...x, monto: 1, descripcion: 'x' })), { ..._fmVacio(), desde: '2026-10-10' }).map(x => x.id).join(''),
    };
  });
  expect(ids).toEqual({ rango: 'abc', soloDesde: 'cd', soloHasta: 'a', cat: 'abd', sub: 'a', dos: 'bc', ambos: 'b', texto: 'bd' });
});

test('panel plegado por defecto, el botón lo abre/cierra y recuerda el estado', async ({ page }) => {
  await abrir(page);
  await expect(page.locator('#det-filtro-mov')).toHaveJSProperty('open', false);
  await expect(page.locator('#fmCats')).toBeHidden();
  await abrirPanel(page);
  await expect(page.locator('#fmCats')).toBeVisible();
  await page.waitForFunction(() => localStorage.getItem('finanzas-v1-det-det-filtro-mov') === 'true'); // el estado se guarda en el evento toggle
  await page.reload();
  for (const d of '1234') await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(300);
  await page.locator('nav.tabs button[data-vista="gastos"]').click();
  await expect(page.locator('#det-filtro-mov')).toHaveJSProperty('open', true);
  expect(await page.evaluate(() => localStorage.getItem('finanzas-v1-det-det-filtro-mov'))).toBe('true');
  await page.click('#btnFiltrosMov');
  await expect(page.locator('#det-filtro-mov')).toHaveJSProperty('open', false);
});

test('chips de categoría: gastos e ingresos, selección múltiple y filtrado al aplicar (cierra el panel)', async ({ page }) => {
  const err = await abrir(page);
  await abrirPanel(page);
  await expect(chipCat(page, 'Comida')).toBeVisible();
  await expect(chipCat(page, 'Sueldo/Honorarios')).toBeVisible();   // categoría de ingreso
  await chipCat(page, 'Transporte').click();
  await expect(chipCat(page, 'Transporte')).toHaveClass(/on/);
  expect(await filas(page).count()).toBe(7);  // nada se aplica hasta «Aplicar»
  await page.click('#fmAplicar');
  await expect(page.locator('#det-filtro-mov')).toHaveJSProperty('open', false);
  expect(await filas(page).count()).toBe(2);
  await abrirPanel(page);
  await chipCat(page, 'Sueldo/Honorarios').click();   // múltiple
  await page.click('#fmAplicar');
  expect(await filas(page).count()).toBe(3);
  await expect(page.locator('#fmBadge')).toHaveText('2');
  expect(err).toEqual([]);
});

test('subcategorías reales de la categoría elegida y filtrado por subcategoría', async ({ page }) => {
  await abrir(page);
  await abrirPanel(page);
  await expect(page.locator('#fmSubs .fm-sub')).toHaveCount(0);
  await chipCat(page, 'Comida').click();
  const subs = await page.locator('#fmSubs .fm-sub').allTextContents();
  expect(subs).toEqual(['Delivery', 'Súper']);                      // solo las que existen en los gastos
  await page.locator('#fmSubs .fm-sub', { hasText: 'Delivery' }).click();
  await page.click('#fmAplicar');
  expect(await filas(page).count()).toBe(2);                        // g1 y g4
  // quitar la categoría quita sus subcategorías
  await abrirPanel(page);
  await chipCat(page, 'Comida').click();
  await expect(page.locator('#fmSubs .fm-sub')).toHaveCount(0);
});

test('períodos rápidos: selección única y filtran por mes calendario', async ({ page }) => {
  await abrir(page);
  await abrirPanel(page);
  const chip = t => page.locator('#fmPer .cat-chip', { hasText: t });
  await chip('Este mes').click();
  await chip('Mes anterior').click();
  await expect(chip('Este mes')).not.toHaveClass(/on/);
  await expect(chip('Mes anterior')).toHaveClass(/on/);
  await page.click('#fmAplicar');
  expect(await filas(page).count()).toBe(1);                        // solo g4
  await abrirPanel(page);
  await chip('Este mes').click();
  await page.click('#fmAplicar');
  expect(await filas(page).count()).toBe(4);                        // g1,g2,g3,g7
  await abrirPanel(page);
  await chip('Últimos 3 meses').click();
  await page.click('#fmAplicar');
  expect(await filas(page).count()).toBe(6);                        // todos menos g6 (hace 4 meses)
});

test('rango manual desde/hasta y exclusión mutua con el período rápido', async ({ page }) => {
  await abrir(page);
  await abrirPanel(page);
  await page.locator('#fmPer .cat-chip', { hasText: 'Este mes' }).click();
  await page.fill('#fmDesde', dia(0, 3));
  await expect(page.locator('#fmPer .cat-chip.on')).toHaveCount(0);   // usar fechas deselecciona el período
  await page.fill('#fmHasta', dia(0, 4));
  await page.click('#fmAplicar');
  expect(await filas(page).count()).toBe(2);                          // g2 y g3 (inclusive)
  await abrirPanel(page);
  await page.locator('#fmPer .cat-chip', { hasText: 'Mes anterior' }).click();   // y viceversa
  await expect(page.locator('#fmDesde')).toHaveValue('');
  await expect(page.locator('#fmHasta')).toHaveValue('');
  // desde posterior a hasta: no aplica y avisa
  await page.fill('#fmDesde', dia(0, 9));
  await page.fill('#fmHasta', dia(0, 2));
  await page.click('#fmAplicar');
  await expect(page.locator('#fmMsg')).toContainText('posterior');
  await expect(page.locator('#det-filtro-mov')).toHaveJSProperty('open', true);
  expect(await filas(page).count()).toBe(2);                          // sigue el filtro anterior
});

test('el panel se combina en AND con el texto tipeado y Limpiar resetea panel + texto', async ({ page }) => {
  await abrir(page);
  await page.fill('#busqMov', 'pizza');
  await page.waitForTimeout(400);
  expect(await filas(page).count()).toBe(3);                          // g1, g3, g4
  await abrirPanel(page);
  await chipCat(page, 'Comida').click();
  await page.locator('#fmPer .cat-chip', { hasText: 'Este mes' }).click();
  await page.click('#fmAplicar');
  expect(await filas(page).count()).toBe(1);                          // solo g1: pizza ∧ Comida ∧ este mes
  await expect(page.locator('#busqMov')).toHaveValue('pizza');        // no lo reemplaza
  await expect(page.locator('#busqSummary')).toContainText('1 resultado');
  await abrirPanel(page);
  await page.click('#fmLimpiar');
  await expect(page.locator('#busqMov')).toHaveValue('');
  await expect(page.locator('#fmBadge')).toBeHidden();
  await expect(page.locator('#fmCats .cat-chip.on')).toHaveCount(0);
  expect(await filas(page).count()).toBe(7);
});

test('los tokens existentes siguen andando (fecha, monto, texto) y sin panel nada cambia', async ({ page }) => {
  await abrir(page);
  await page.fill('#busqMov', '>2500');
  await page.waitForTimeout(400);
  expect(await filas(page).count()).toBe(5);                          // 3000, 4000, 5000, 6000 y el sueldo
  await page.fill('#busqMov', `${String(hoyD.getDate()).padStart(2, '0')}/${String(hoyD.getMonth() + 1).padStart(2, '0')}/${hoyD.getFullYear()}`);
  await page.waitForTimeout(400);
  expect(await page.locator('#historial').textContent()).not.toMatch(/undefined|NaN/);
  await page.fill('#busqMov', '');
  await page.waitForTimeout(400);
  expect(await filas(page).count()).toBe(7);
});

for (const w of [360, 412]) {
  test(`el panel no desborda a ${w} px`, async ({ page }) => {
    await abrir(page, w);
    await abrirPanel(page);
    await chipCat(page, 'Comida').click();
    const r = await page.evaluate(() => ({ s: document.documentElement.scrollWidth <= document.documentElement.clientWidth, d: (() => { const p = document.getElementById('det-filtro-mov').getBoundingClientRect(); return p.right <= innerWidth; })() }));
    expect(r.s).toBe(true);
    expect(r.d).toBe(true);
  });
}
