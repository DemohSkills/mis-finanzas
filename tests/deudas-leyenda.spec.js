const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const TEST_PIN = '1234';
const TEMAS = ['claro', 'oscuro', 'negro', 'neon-azul', 'neon-turquesa', 'neon-violeta'];
// 'auto' sigue al sistema: se fuerza el esquema para cubrir los 7 temas
const SNAPS = [
  { d: '2026-09-13', n: 1, a: 1, dv: 1, dd: { vs: 10400000, mc: 4000000, bm: 2300000, cm: 690000 } },
  { d: '2026-10-13', n: 1, a: 1, dv: 1, dd: { vs: 10500000, mc: 4100000, bm: 2300000, cm: 691000 } },
  { d: '2026-10-20', n: 1, a: 1, dv: 1, dd: { vs: 10500000, mc: 4100000, bm: 2300000, cm: 691000 } },
];
const estado = {
  iniciales: { 'Efectivo': 100000 }, gastos: [],
  items: [{ id: 'ia1', nombre: 'Efectivo', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 100000 },
    { id: 'b', nombre: 'Boris MP', grupo: 'Otras deudas', tipo: 'deuda', monto: 2300000 },
    { id: 'c', nombre: 'Créditos MP 1', grupo: 'Otras deudas', tipo: 'deuda', monto: 691000 }],
  patrimonioCargado: true, compromisos: [],
};

async function arrancar(page, tema) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ est, sn, tema }) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(est));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    localStorage.setItem('finanzas-v1-snaps', JSON.stringify(sn));
    if (tema) localStorage.setItem('finanzas-v1-tema', JSON.stringify(tema));
  }, { est: estado, sn: SNAPS, tema });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
  await page.locator('nav.tabs button[data-vista="evolucion"]').click();
  await page.waitForFunction(() => typeof Chart !== 'undefined' && window._ci && window._ci.cD, null, { timeout: 10000 });
  await page.evaluate(() => { const d = document.getElementById('det-ev-cD'); if (d) d.open = true; });
  await page.waitForTimeout(500);
}
const leyenda = page => page.evaluate(() => {
  const c = window._ci.cD; c.update();
  const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
  return { muted, colores: c.legend.legendItems.map(i => i.fontColor), n: c.legend.legendItems.length };
});

for (const tema of TEMAS) {
  test(`cD: la leyenda usa --muted en tema ${tema}`, async ({ page }) => {
    await arrancar(page, tema);
    const r = await leyenda(page);
    expect(r.n).toBe(4);
    r.colores.forEach(c => expect(c).toBe(r.muted));
    const lum = await page.evaluate(m => {
      const e = document.createElement('i'); e.style.color = m; document.body.appendChild(e);
      const [R, G, B] = getComputedStyle(e).color.match(/\d+/g).map(Number); e.remove();
      const bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number);
      const L = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return { t: L(R, G, B), b: L(bg[0], bg[1], bg[2]) };
    }, r.muted);
    expect(Math.abs(lum.t - lum.b)).toBeGreaterThan(60);
  });
}
test('cD: la leyenda usa --muted también en el tema auto', async ({ page }) => {
  await arrancar(page, 'auto');
  const r = await leyenda(page);
  r.colores.forEach(c => expect(c).toBe(r.muted));
});

test('cD: cambiar de tema sin recargar actualiza el color de la leyenda', async ({ page }) => {
  await arrancar(page, 'oscuro');
  const a = await leyenda(page);
  await page.evaluate(() => aplicarTema('claro'));
  await page.waitForTimeout(500);
  const b = await leyenda(page);
  expect(b.muted).not.toBe(a.muted);
  b.colores.forEach(c => expect(c).toBe(b.muted));
  await page.evaluate(() => aplicarTema('neon-violeta'));
  await page.waitForTimeout(500);
  const c = await leyenda(page);
  c.colores.forEach(x => expect(x).toBe(c.muted));
});

test('cD: etiquetas de fin de línea dentro del canvas y sin pisarse', async ({ page }) => {
  await arrancar(page, 'oscuro');
  const r = await page.evaluate(() => {
    const c = window._ci.cD; const fin = [10500000, 4100000, 2300000, 691000]; c.data.datasets.forEach((d, i) => { d.data[d.data.length - 1] = fin[i]; }); c.update(); c.draw();
    return { w: c.canvas.width / (window.devicePixelRatio || 1), cw: c.width, labs: c.$cDLabs, top: c.chartArea.top, bottom: c.chartArea.bottom };
  });
  expect(r.labs.length).toBe(4);
  for (const l of r.labs) {
    expect(l.x + l.w).toBeLessThanOrEqual(r.cw);
    expect(l.y - l.h / 2).toBeGreaterThanOrEqual(r.top - 0.5);
    expect(l.y + l.h / 2).toBeLessThanOrEqual(r.bottom + 0.5);
  }
  const ys = r.labs.map(l => l.y).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(11.99);
});

test('cD: en modo ocultar no se dibujan etiquetas con valores', async ({ page }) => {
  await arrancar(page, 'oscuro');
  const n = await page.evaluate(() => { document.body.classList.add('ocultar'); const c = window._ci.cD; c.draw(); return c.$cDLabs.length; });
  expect(n).toBe(0);
});
