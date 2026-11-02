const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const NEON = {
  'neon-azul': { n1: 'rgb(59, 130, 255)', n2: 'rgb(122, 92, 255)', ta: 'rgb(59,130,255)' },
  'neon-turquesa': { n1: 'rgb(0, 245, 224)', n2: 'rgb(30, 144, 255)', ta: 'rgb(0,245,224)' },
  'neon-violeta': { n1: 'rgb(179, 102, 255)', n2: 'rgb(255, 79, 216)', ta: 'rgb(179,102,255)' },
};
const NO_NEON = ['auto', 'claro', 'oscuro', 'negro'];

function fechaRel(mesesAtras, dia) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - mesesAtras);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
}
function estado() {
  const g = (id, fecha, monto) => ({ id, fecha, monto, categoria: 'Comida y Delivery', tipo: 'gasto', medio: 'Banco Santander', descripcion: 'x' + id });
  return {
    iniciales: { 'Banco Santander': 100000 }, items: [], patrimonioCargado: true, compromisos: [],
    gastos: [g('p1', fechaRel(1, 1), 3000), g('p2', fechaRel(1, 20), 5000), g('a1', fechaRel(0, 1), 4000)],
  };
}

async function abrir(page, tema, ancho = 390) {
  const err = [];
  page.on('pageerror', e => err.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') err.push(m.text()); });
  await page.setViewportSize({ width: ancho, height: 844 });
  await page.addInitScript(({ est, tema }) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(est));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    localStorage.setItem('finanzas-v1-tema', JSON.stringify(tema));
  }, { est: estado(), tema });
  await page.goto(INDEX);
  for (const d of '1234') await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
  return err;
}

for (const [tema, c] of Object.entries(NEON)) {
  test.describe(tema, () => {
    test('.ev-sep usa --neon-1/--neon-2 de la variante, con brillo', async ({ page }) => {
      const err = await abrir(page, tema);
      const r = await page.evaluate(() => {
        const el = document.querySelector('.ev-sep'); const cs = getComputedStyle(el);
        return { bg: cs.backgroundImage, sh: cs.boxShadow };
      });
      expect(r.bg).toContain(c.n1);
      expect(r.bg).toContain(c.n2);
      expect(r.bg).not.toContain('rgb(255, 77, 109)'); // el arcoíris fijo anterior
      expect(r.sh).not.toBe('none');
      expect(err).toEqual([]);
    });

    test('.tk-row, .imp-fijo-tag y aros toman var(--ok)/var(--danger) y brillo', async ({ page }) => {
      await abrir(page, tema);
      const r = await page.evaluate(() => {
        const mk = (html) => { const w = document.createElement('div'); w.innerHTML = html; document.body.appendChild(w); return w.firstElementChild; };
        const col = (el) => getComputedStyle(el).color;
        const ref = (v) => { const e = mk('<span style="color:var(' + v + ')">x</span>'); return col(e); };
        const pos = mk('<span class="tk-row pos"><span class="tk-arrow">▲</span></span>').querySelector('.tk-arrow');
        const neg = mk('<span class="tk-row neg"><span class="tk-arrow">▼</span></span>').querySelector('.tk-arrow');
        const tag = mk('<span class="imp-fijo-tag">✓ Fijo</span>');
        const arco = mk('<svg><path class="avd-arco" style="color:#f00"></path></svg>').firstElementChild;
        const seg = mk('<svg><circle class="avd-seg" style="color:#f00"></circle></svg>').firstElementChild;
        return {
          pos: col(pos), ok: ref('--ok'), neg: col(neg), danger: ref('--danger'), tag: col(tag),
          tagSh: getComputedStyle(tag).boxShadow,
          arco: getComputedStyle(arco).filter, seg: getComputedStyle(seg).filter,
        };
      });
      expect(r.pos).toBe(r.ok);
      expect(r.neg).toBe(r.danger);
      expect(r.tag).toBe(r.ok);
      expect(r.tagSh).not.toBe('none');
      expect(r.arco).toContain('drop-shadow');
      expect(r.seg).toContain('drop-shadow');
    });

    test('comparativa de gastos: la curva actual toma el tono del tema y la anterior sigue gris', async ({ page }) => {
      const err = await abrir(page, tema);
      await page.locator('nav.tabs button[data-vista="analisis"]').click();
      await page.waitForFunction(() => window._ci && window._ci.cGCurva, null, { timeout: 15000 });
      const ds = await page.evaluate(() => window._ci.cGCurva.data.datasets.map(d => ({ l: d.label, b: d.borderColor })));
      expect(ds.length).toBe(2);
      expect(ds[0].b).toBe('#94a3b8');
      expect(ds[1].b).toBe('rgb(' + c.ta.slice(4, -1) + ')');
      expect(err).toEqual([]);
    });
  });
}

for (const tema of NO_NEON) {
  test(`${tema}: sin cambios (ev-sep rojo→azul, tk-row y curva con sus colores)`, async ({ page }) => {
    await abrir(page, tema);
    const r = await page.evaluate(() => {
      const mk = (html) => { const w = document.createElement('div'); w.innerHTML = html; document.body.appendChild(w); return w.firstElementChild; };
      const pos = mk('<span class="tk-row pos"><span class="tk-arrow">▲</span></span>').querySelector('.tk-arrow');
      const arco = mk('<svg><path class="avd-arco" style="color:#f00"></path></svg>').firstElementChild;
      return { bg: getComputedStyle(document.querySelector('.ev-sep')).backgroundImage, pos: getComputedStyle(pos).color, arco: getComputedStyle(arco).filter };
    });
    expect(r.bg).toContain('rgb(239, 68, 68)');
    expect(r.pos).toBe('rgb(74, 222, 128)');
    expect(r.arco).toBe('none');
    await page.locator('nav.tabs button[data-vista="analisis"]').click();
    await page.waitForFunction(() => window._ci && window._ci.cGCurva, null, { timeout: 15000 });
    const b = await page.evaluate(() => window._ci.cGCurva.data.datasets.map(d => d.borderColor));
    expect(b).toEqual(['#94a3b8', '#fb923c']);
  });
}

for (const ancho of [360, 412, 450]) {
  test(`neón azul a ${ancho}px: sin overflow horizontal en Evolución y Análisis`, async ({ page }) => {
    const err = await abrir(page, 'neon-azul', ancho);
    for (const v of ['evolucion', 'analisis']) {
      await page.locator(`nav.tabs button[data-vista="${v}"]`).click();
      await page.waitForTimeout(600);
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(m.sw).toBeLessThanOrEqual(m.cw);
    }
    expect(err).toEqual([]);
  });
}
