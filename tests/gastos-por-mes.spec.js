const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

function mesRel(delta) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + delta);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
const M0 = mesRel(0), M1 = mesRel(-1), M2 = mesRel(-2);
const CATS = ['Cat1', 'Cat2', 'Cat3', 'Cat4', 'Cat5', 'Cat6', 'Cat7', 'Cat8', 'Cat9', 'Cat10'];

function buildEstado() {
  const gastos = [];
  let n = 0;
  // Mes actual: 10 categorías (top 8 + Otras). Cat1 = 300000 (anterior 100000 → ▲ +200k)
  CATS.forEach((c, i) => gastos.push({ id: 'a' + n++, monto: (10 - i) * 30000, fecha: M0 + '-01', categoria: c, tipo: 'gasto', soloHistorial: false }));
  // Mes anterior: Cat1 100000, Cat2 500000 (▼ −500k+…), resto solo historial en Cat3
  gastos.push({ id: 'b1', monto: 100000, fecha: M1 + '-02', categoria: 'Cat1', tipo: 'gasto', soloHistorial: false });
  gastos.push({ id: 'b2', monto: 500000, fecha: M1 + '-03', categoria: 'Cat2', tipo: 'gasto', soloHistorial: false });
  gastos.push({ id: 'b3', monto: 60000, fecha: M1 + '-04', categoria: 'Cat3', tipo: 'gasto', soloHistorial: true });
  // Dos meses atrás
  gastos.push({ id: 'c1', monto: 1250000, fecha: M2 + '-05', categoria: 'Cat5', tipo: 'gasto', soloHistorial: false });
  // Ruido que no debe contar
  gastos.push({ id: 'x1', monto: 999999, fecha: M0 + '-02', categoria: 'Pago de créditos', tipo: 'gasto' });
  gastos.push({ id: 'x2', monto: 999999, fecha: M0 + '-02', categoria: 'Cat1', tipo: 'ingreso' });
  return {
    iniciales: { 'Banco Santander': 5000000, 'Mercado Pago': 1000000, 'Astropay': 0, 'Efectivo': 0 },
    gastos,
    items: [{ id: 'ia1', nombre: 'Banco Santander', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 5000000 }],
    patrimonioCargado: true,
    compromisos: [],
  };
}

async function abrir(page, estado = buildEstado(), tema) {
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
  await page.addInitScript(({ sk, pk, pin, data, tema }) => {
    if (tema) localStorage.setItem('finanzas-v1-tema', JSON.stringify(tema));
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado, tema });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
  await page.locator('nav.tabs button[data-vista="analisis"]').click();
  await page.waitForFunction(() => window._ci && window._ci['cG'] && window._ci['cIngD'] && window._ci['cGC'], null, { timeout: 10000 });
  await page.waitForTimeout(300);
  return errores;
}

const filas = page => page.evaluate(() => [...document.querySelectorAll('#gMesRank .gm-row')].map(r => ({
  cat: r.dataset.cat,
  v: +r.querySelector('.gm-amt').dataset.v,
  d: +r.querySelector('.gm-dif').dataset.d,
  difTxt: r.querySelector('.gm-dif').textContent.trim(),
  difCls: r.querySelector('.gm-dif').className,
})));

async function clickBarra(page, idx) {
  await page.locator('#cG').scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const pos = await page.evaluate(i => {
    const c = window._ci['cG'], b = c.getDatasetMeta(0).data[i], r = c.canvas.getBoundingClientRect();
    return { x: r.left + b.x, y: r.top + b.base - 4 };
  }, idx);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(200);
}

test('orden de tarjetas: comparativa, ingresos, gastos por mes', async ({ page }) => {
  await abrir(page);
  const ids = await page.evaluate(() => [...document.querySelectorAll('#vista-analisis > details.ev-card')].map(d => d.id));
  expect(ids).toEqual(['det-ev-cGC', 'det-ev-cIC', 'det-ev-cG']);
  await expect(page.locator('#btnPlegGas')).toBeVisible();
});

test('leyenda de cIngD abajo', async ({ page }) => {
  await abrir(page);
  expect(await page.evaluate(() => window._ci['cIngD'].options.plugins.legend.position)).toBe('bottom');
});

test('mes actual seleccionado por defecto; cambia al tocar otra barra', async ({ page }) => {
  await abrir(page);
  const col = () => page.evaluate(() => window._ci['cG'].data.datasets[0].backgroundColor);
  let c = await col();
  expect(c).toHaveLength(6);
  expect(c[5]).toContain('.95');
  expect(c.slice(0, 5).every(x => x.includes('.3)'))).toBe(true);
  const f0 = await filas(page);
  expect(f0[0].cat).toBe('Cat1');
  await clickBarra(page, 4); // índice 5 = mes actual, 4 = mes anterior
  c = await col();
  expect(c[4]).toContain('.95');
  const f1 = await filas(page);
  expect(f1.map(f => f.cat)).toEqual(['Cat2', 'Cat1', 'Cat3']);
  expect(f1[0].v).toBe(500000);
});

test('diferencias con signo y color; top 8 + Otras suman el total', async ({ page }) => {
  await abrir(page);
  const f = await filas(page);
  expect(f).toHaveLength(9);
  expect(f[8].cat).toBe('Otras');
  const total = 55 * 30000; // (10+9+...+1)*30000
  expect(f.reduce((s, r) => s + r.v, 0)).toBe(total);
  const cat1 = f.find(r => r.cat === 'Cat1');
  expect(cat1.d).toBe(200000);
  expect(cat1.difTxt).toBe('▲ +$200k');
  expect(cat1.difCls).toContain('gc-neg');
  // Cat2 gastó 270000 ahora vs 500000 antes → baja 230k, verde
  const cat2 = f.find(r => r.cat === 'Cat2');
  expect(cat2.difTxt).toBe('▼ −$230k');
  expect(cat2.difCls).toContain('gc-pos');
  // Cat4: sin dato previo → todo el total como aumento
  const cat4 = f.find(r => r.cat === 'Cat4');
  expect(cat4.difTxt).toBe('▲ +$210k');
  // Cat3 anterior es soloHistorial y cuenta: 240000 - 60000
  expect(f.find(r => r.cat === 'Cat3').d).toBe(180000);
  // título con total
  await expect(page.locator('#gMesTit')).toContainText('$1,65M');
});

test('mes sin datos: mensaje vacío', async ({ page }) => {
  await abrir(page);
  await clickBarra(page, 0);
  await expect(page.locator('#gMesRank')).toContainText('Sin gastos en este mes');
});

test('modo ojo oculta importes y diferencias, conserva nombres', async ({ page }) => {
  await abrir(page);
  await page.locator('#btnOjo').click();
  await page.waitForTimeout(300);
  const vis = await page.evaluate(() => {
    const r = document.querySelector('#gMesRank .gm-row');
    const v = el => getComputedStyle(el).visibility;
    return { amt: v(r.querySelector('.gm-amt')), dif: v(r.querySelector('.gm-dif')), nom: v(r.querySelector('.gm-nom')), txt: r.querySelector('.gm-nom').textContent };
  });
  expect(vis.amt).toBe('hidden');
  expect(vis.dif).toBe('hidden');
  expect(vis.nom).toBe('visible');
  expect(vis.txt).toBe('Cat1');
});

for (const tema of ['auto', 'claro', 'oscuro', 'negro']) {
  test(`tema ${tema}: sin errores y gráfico presente`, async ({ page }) => {
    const errores = await abrir(page, buildEstado(), tema);
    expect(await page.evaluate(() => !!window._ci['cG'])).toBe(true);
    expect(errores).toEqual([]);
  });
}

for (const w of [360, 412, 450]) {
  test(`sin overflow horizontal a ${w}px y sin errores`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 800 });
    const errores = await abrir(page);
    const r = await page.evaluate(() => {
      const root = document.documentElement;
      const rk = document.getElementById('gMesRank');
      const filaDesborda = [...rk.querySelectorAll('.gm-row')].some(f => f.scrollWidth > f.clientWidth + 1);
      const amtCortado = [...rk.querySelectorAll('.gm-amt,.gm-dif')].some(e => e.scrollWidth > e.clientWidth + 1);
      return { page: root.scrollWidth > root.clientWidth, fila: filaDesborda, amt: amtCortado };
    });
    expect(r).toEqual({ page: false, fila: false, amt: false });
    expect(errores).toEqual([]);
  });
}
