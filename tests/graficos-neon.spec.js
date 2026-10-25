const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const SNAPS_KEY = 'finanzas-v1-snaps';
const TEMA_KEY = 'finanzas-v1-tema';
const TEST_PIN = '1234';
const NEON = ['neon-azul', 'neon-turquesa', 'neon-violeta'];
const NO_NEON = ['auto', 'claro', 'oscuro', 'negro'];

function buildEstado() {
  return {
    iniciales: { 'Efectivo': 100000 },
    gastos: [
      { id: 'g1', monto: 5000, fecha: '2026-10-01', categoria: 'Comida', descripcion: 'test', tipo: 'gasto', soloHistorial: false },
      { id: 'g2', monto: 3000, fecha: '2026-09-15', categoria: 'Transporte', descripcion: 'test', tipo: 'gasto', soloHistorial: false },
    ],
    items: [
      { id: 'ia1', nombre: 'Efectivo', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 100000 },
      { id: 'id1', nombre: 'Visa Santander', grupo: 'Tarjetas de crédito', tipo: 'deuda', monto: 50000 },
    ],
    patrimonioCargado: true,
    compromisos: [
      { id: 'c1', nombre: 'Alquiler', entidad: 'Juan', monto: 30000, pendientes: 3, proxVenc: '2026-11-01', tipo: 'cuota' },
    ],
  };
}
const SNAPS3 = [
  { d: '2026-09-13', n: 80000, a: 90000, dv: 10000, dd: { vs: 10000, mc: 0, bm: 0, cm: 0 } },
  { d: '2026-10-13', n: 90000, a: 100000, dv: 10000, dd: { vs: 10000, mc: 5000, bm: 0, cm: 0 } },
  { d: '2026-10-20', n: 95000, a: 105000, dv: 10000, dd: { vs: 10000, mc: 5000, bm: 2000, cm: 0 } },
];

async function arrancar(page, { tema, estado = buildEstado(), snaps = SNAPS3 } = {}) {
  await page.addInitScript(({ sk, pk, pin, data, snk, sn, tk, tema }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    localStorage.setItem(snk, JSON.stringify(sn));
    if (tema) localStorage.setItem(tk, JSON.stringify(tema));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado, snk: SNAPS_KEY, sn: snaps, tk: TEMA_KEY, tema });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}
async function irEvolucion(page) {
  await page.locator('nav.tabs button[data-vista="evolucion"]').click();
  await page.waitForFunction(() => typeof Chart !== 'undefined' && window._ci && window._ci.cP, null, { timeout: 10000 });
  await page.waitForTimeout(300);
}
async function irAnalisis(page) {
  await page.locator('nav.tabs button[data-vista="analisis"]').click();
  await page.waitForFunction(() => typeof Chart !== 'undefined' && window._ci && window._ci.cIngD, null, { timeout: 10000 });
  await page.waitForTimeout(300);
}
const estadoGraficos = page => page.evaluate(() =>
  Object.keys(window._ci).map(id => ({ id, neon: !!window._ci[id].$neon, attr: window._ci[id].canvas.dataset.neon || null })));

test.describe('Gráficos neón: flag según tema', () => {
  for (const tema of NEON) {
    test(`${tema}: todos los gráficos creados llevan el estilo neón`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await arrancar(page, { tema });
      await irEvolucion(page);
      await irAnalisis(page);
      const gs = await estadoGraficos(page);
      expect(gs.map(g => g.id)).toEqual(expect.arrayContaining(['cP', 'cD', 'cIngD']));
      for (const g of gs) { expect(g.neon, g.id).toBe(true); expect(g.attr, g.id).toBe('1'); }
      expect(await page.evaluate(() => window._ci.cD.config.plugins.some(p => p.id === 'neonGrafico'))).toBe(true);
      expect(errors).toEqual([]);
    });
  }
  for (const tema of NO_NEON) {
    test(`${tema}: ningún gráfico lleva el estilo neón`, async ({ page }) => {
      await arrancar(page, { tema });
      await irEvolucion(page);
      await irAnalisis(page);
      const gs = await estadoGraficos(page);
      expect(gs.length).toBeGreaterThan(0);
      for (const g of gs) { expect(g.neon, g.id).toBe(false); expect(g.attr, g.id).toBeNull(); }
      expect(await page.evaluate(() => (window._ci.cP.config.plugins || []).some(p => p.id === 'neonGrafico'))).toBe(false);
      // sin cambios: línea de patrimonio sigue como antes
      expect(await page.evaluate(() => window._ci.cP.data.datasets[0].borderWidth)).toBe(2);
    });
  }
  test('neón: línea con grosor 3, punto final visible y resto sin marcador', async ({ page }) => {
    await arrancar(page, { tema: 'neon-azul' });
    await irEvolucion(page);
    const r = await page.evaluate(() => {
      const ds = window._ci.cP.data.datasets[0];
      const rad = i => ds.pointRadius({ dataIndex: i });
      return { w: ds.borderWidth, n: ds.data.length, first: rad(0), last: rad(ds.data.length - 1) };
    });
    expect(r.w).toBe(3);
    expect(r.first).toBe(0);
    expect(r.last).toBe(5);
  });
});

test.describe('Gráficos neón: cambio de tema', () => {
  test('neón → oscuro → neón recrea los gráficos sin errores', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
    await arrancar(page, { tema: 'neon-violeta' });
    await irEvolucion(page);
    await irAnalisis(page);
    await page.evaluate(() => aplicarTema('oscuro'));
    await page.waitForTimeout(300);
    for (const g of await estadoGraficos(page)) expect(g.neon, g.id).toBe(false);
    await page.evaluate(() => aplicarTema('neon-turquesa'));
    await page.waitForTimeout(300);
    const gs = await estadoGraficos(page);
    expect(gs.length).toBeGreaterThan(0);
    for (const g of gs) expect(g.neon, g.id).toBe(true);
    expect(errors).toEqual([]);
  });

  test('copia de Gastos plegada en Evolución se dibuja neón al abrirla tras cambiar de tema', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await arrancar(page, { tema: 'oscuro' });
    await irEvolucion(page);
    await page.evaluate(() => { document.getElementById('det-ev-cG_e').open = true; });
    await page.waitForFunction(() => window._ci.cG_e, null, { timeout: 5000 });
    await page.evaluate(() => { document.getElementById('det-ev-cG_e').open = false; });
    await page.evaluate(() => aplicarTema('neon-azul'));
    await page.evaluate(() => { document.getElementById('det-ev-cG_e').open = true; });
    await page.waitForFunction(() => window._ci.cG_e && window._ci.cG_e.$neon, null, { timeout: 5000 });
    expect(errors).toEqual([]);
  });
});

test.describe('Gráficos neón: casos límite', () => {
  test('sin datos (sin snapshots ni gastos): sin errores', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const vacio = { iniciales: {}, gastos: [], items: [], patrimonioCargado: true, compromisos: [] };
    await arrancar(page, { tema: 'neon-azul', estado: vacio, snaps: [] });
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForFunction(() => typeof Chart !== 'undefined', null, { timeout: 10000 });
    await page.locator('nav.tabs button[data-vista="analisis"]').click();
    await page.waitForTimeout(600);
    expect(errors).toEqual([]);
  });

  test('un solo dato (un snapshot): sin errores', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await arrancar(page, { tema: 'neon-turquesa', snaps: [SNAPS3[0]] });
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForFunction(() => typeof Chart !== 'undefined', null, { timeout: 10000 });
    await page.waitForTimeout(600);
    expect(errors).toEqual([]);
  });

  test('mkChart neón con datasets vacíos, un punto, nulls y canvas oculto: sin errores', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await arrancar(page, { tema: 'neon-violeta' });
    await irEvolucion(page);
    const r = await page.evaluate(async () => {
      const mk = (id, hidden) => {
        const c = document.createElement('canvas'); c.id = id; c.style.cssText = hidden ? 'display:none' : 'width:200px;height:100px';
        document.body.appendChild(c);
      };
      mk('t1'); mk('t2'); mk('t3'); mk('t4', true); mk('t5');
      const base = { responsive: true, maintainAspectRatio: false };
      mkChart('t1', { type: 'line', data: { labels: [], datasets: [] }, options: base });
      mkChart('t2', { type: 'line', data: { labels: ['a'], datasets: [{ label: 'x', data: [5], borderColor: '#60a5fa', fill: true }] }, options: base });
      mkChart('t3', { type: 'line', data: { labels: ['a', 'b', 'c'], datasets: [{ label: 'x', data: [null, null, null], borderColor: '#f87171', fill: true }] }, options: base });
      mkChart('t4', { type: 'bar', data: { labels: ['a'], datasets: [{ label: 'x', data: [1], backgroundColor: 'rgba(1,2,3,.5)' }] }, options: base });
      mkChart('t5', { type: 'bar', data: { labels: ['a', 'b'], datasets: [{ label: 'x', data: [0, NaN], backgroundColor: ['#fff', 'transparent'] }] }, options: { ...base, indexAxis: 'y' } });
      await new Promise(r => setTimeout(r, 500));
      ['t1', 't2', 't3', 't4', 't5'].forEach(id => window._ci[id].update());
      return ['t1', 't2', 't3', 't4', 't5'].every(id => window._ci[id].$neon);
    });
    expect(r).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('Gráficos neón: mostrar/ocultar series', () => {
  test('leyenda de cD oculta y muestra series en neón y persiste', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await arrancar(page, { tema: 'neon-azul' });
    await irEvolucion(page);
    const r = await page.evaluate(() => {
      const ch = window._ci.cD;
      const click = i => ch.options.plugins.legend.onClick({}, ch.legend.legendItems[i], ch.legend);
      click(0);
      const oculta = !ch.isDatasetVisible(0);
      const guardado = JSON.parse(localStorage.getItem('finanzas-v1-chart-vis-cD'));
      ch.update();
      click(0);
      return { oculta, guardado, visible: ch.isDatasetVisible(0), limpio: localStorage.getItem('finanzas-v1-chart-vis-cD') === null };
    });
    expect(r.oculta).toBe(true);
    expect(r.guardado).toEqual(['Visa Santander']);
    expect(r.visible).toBe(true);
    expect(r.limpio).toBe(true);
    expect(errors).toEqual([]);
  });

  test('serie oculta en Gastos (cGCurva / cIngD) sigue funcionando en neón', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await arrancar(page, { tema: 'neon-turquesa' });
    await irAnalisis(page);
    const r = await page.evaluate(() => {
      const ch = window._ci.cIngD;
      ch.hide(0); ch.update();
      const oculta = !ch.isDatasetVisible(0);
      window.showAllChartSeries('cIngD');
      return { oculta, visible: ch.isDatasetVisible(0) };
    });
    expect(r.oculta).toBe(true);
    expect(r.visible).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('Activos vs Deudas: resplandor del medidor y el anillo', () => {
  const filtros = page => page.evaluate(() => {
    const f = s => { const e = document.querySelector(s); return e ? getComputedStyle(e).filter : null; };
    return { arco: f('.avd-arco'), seg: f('.avd-seg') };
  });
  for (const tema of NEON) {
    test(`${tema}: medidor y anillo tienen filter distinto de none`, async ({ page }) => {
      await arrancar(page, { tema });
      await irEvolucion(page);
      const r = await filtros(page);
      expect(r.arco).toContain('drop-shadow');
      expect(r.seg).toContain('drop-shadow');
    });
  }
  for (const tema of NO_NEON) {
    test(`${tema}: medidor y anillo sin filter`, async ({ page }) => {
      await arrancar(page, { tema });
      await irEvolucion(page);
      const r = await filtros(page);
      expect(r.arco).toBe('none');
      expect(r.seg).toBe('none');
    });
  }
});
