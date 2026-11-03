// Gráfico «Patrimonio neto» (cP): rangos, media móvil con chips y tooltip por índice
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const PREF_KEY = 'finanzas-v1-pat-chart';
const TEST_PIN = '1234';

function estadoBase() {
  return {
    iniciales: { 'Efectivo': 5000, 'Visa Santander': 0, 'Banco Santander': 0, 'Mercado Pago': 0, 'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0 },
    gastos: [], items: [], compromisos: [], patrimonioCargado: true,
  };
}

// n snaps diarios terminando ayer (hoy lo agrega la app con el patrimonio actual)
function snaps(n) {
  const out = [];
  const base = new Date();
  for (let i = n; i >= 1; i--) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ d: ds, n: 100000 + (n - i) * 1000 });
  }
  return out;
}

async function abrir(page, { nSnaps = 120, pref = null } = {}) {
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  await page.addInitScript(({ sk, pk, pin, data, snaps, pref, prefKey }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    localStorage.setItem('finanzas-v1-snaps', JSON.stringify(snaps));
    if (pref) localStorage.setItem(prefKey, JSON.stringify(pref));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estadoBase(), snaps: snaps(nSnaps), pref, prefKey: PREF_KEY });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
  await page.locator('nav.tabs button[data-vista="evolucion"]').click();
  await page.waitForFunction(() => typeof Chart !== 'undefined' && window._ci && window._ci['cP'], null, { timeout: 15000 });
  await page.waitForTimeout(200);
  return errores;
}

const puntos = (page) => page.evaluate(() => window._ci.cP.data.datasets[0].data.length);

test.describe('patrimonio-grafico', () => {
  test('_pFiltrarRango: 7/30/90/ALL cuentan hacia atrás desde el último snap', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(() => {
      const data = [];
      for (let i = 0; i < 120; i++) { const d = new Date(Date.UTC(2026, 0, 1 + i)); data.push({ d: d.toISOString().slice(0, 10), n: i }); }
      const f = k => _pFiltrarRango(data, k);
      return { total: data.length, c7: f('7').length, c30: f('30').length, c90: f('90').length, all: f('all').length, ult7: f('7')[0].d, ult: data[119].d, corta: _pFiltrarRango(data.slice(0, 3), '90').length, vacio: _pFiltrarRango([], '7').length };
    });
    expect(r.c7).toBe(8);     // últimos 7 días, ambos extremos
    expect(r.c30).toBe(31);
    expect(r.c90).toBe(91);
    expect(r.all).toBe(120);
    expect(r.corta).toBe(3);  // menos historia que el rango: muestra todo
    expect(r.vacio).toBe(0);
    expect(r.ult7 < r.ult).toBe(true);
  });

  test('default 30 días; los botones filtran el gráfico y se guardan', async ({ page }) => {
    const errores = await abrir(page);
    expect(await puntos(page)).toBe(31);
    for (const [k, n] of [['7', 8], ['90', 91], ['all', 121], ['30', 31]]) {
      await page.locator(`#pCtl [data-rango="${k}"]`).click();
      expect(await puntos(page)).toBe(n);
      expect(JSON.parse(await page.evaluate(p => localStorage.getItem(p), PREF_KEY)).rango).toBe(k);
    }
    expect(errores).toEqual([]);
  });

  test('menos historia que el rango: muestra todo lo que hay', async ({ page }) => {
    const errores = await abrir(page, { nSnaps: 5 });
    await page.locator('#pCtl [data-rango="90"]').click();
    expect(await puntos(page)).toBe(6);
    expect(errores).toEqual([]);
  });

  test('ciclo de períodos: 3,5,10,20,50,100,200 y vuelve a 3', async ({ page }) => {
    await abrir(page, { nSnaps: 120, pref: { rango: 'all' } });
    const vistos = [];
    for (let i = 0; i < 8; i++) {
      vistos.push(await page.evaluate(() => _pPrefs().mm));
      await page.locator('#pCtl .p-chip-per').click();
    }
    expect(vistos).toEqual([3, 5, 10, 20, 50, 100, 200, 3]);
    await expect(page.locator('#pCtl .p-chip-per')).toHaveText('Media móvil (5 períodos)');
    expect(await page.evaluate(() => _pSigPeriodo(200))).toBe(3);
  });

  test('la media móvil se calcula sobre el rango visible', async ({ page }) => {
    await abrir(page, { pref: { rango: '7', mm: 3 } });
    const r = await page.evaluate(() => { const d = window._ci.cP.data.datasets; return { p: d[0].data, m: d[1].data, label: d[1].label }; });
    expect(r.label).toBe('Media móvil (3 períodos)');
    expect(r.m[0]).toBe(r.p[0]);
    expect(r.m[2]).toBeCloseTo((r.p[0] + r.p[1] + r.p[2]) / 3, 5);
  });

  test('tocar la rayita de un chip oculta/muestra la serie sin borrarla y persiste', async ({ page }) => {
    await abrir(page);
    const vis = i => page.evaluate(i => window._ci.cP.isDatasetVisible(i), i);
    expect(await vis(0)).toBe(true);
    expect(await vis(1)).toBe(true);
    await page.locator('#pCtl [data-serie="mm"] .p-chip-sw').click();
    expect(await vis(1)).toBe(false);
    expect(await page.evaluate(() => window._ci.cP.data.datasets.length)).toBe(2);
    await page.locator('#pCtl [data-serie="p"] .p-chip-sw').click();
    expect(await vis(0)).toBe(false);
    const pref = JSON.parse(await page.evaluate(p => localStorage.getItem(p), PREF_KEY));
    expect(pref.verP).toBe(false);
    expect(pref.verMM).toBe(false);
    await page.locator('#pCtl [data-serie="mm"] .p-chip-sw').click();
    expect(await vis(1)).toBe(true);
    // cambiar de rango conserva la visibilidad elegida
    await page.locator('#pCtl [data-rango="7"]').click();
    expect(await vis(0)).toBe(false);
    expect(await vis(1)).toBe(true);
  });

  test('las preferencias guardadas se aplican al abrir', async ({ page }) => {
    await abrir(page, { pref: { rango: '90', mm: 20, verP: true, verMM: false } });
    expect(await puntos(page)).toBe(91);
    await expect(page.locator('#pCtl .p-chip-per')).toHaveText('Media móvil (20 períodos)');
    expect(await page.evaluate(() => window._ci.cP.isDatasetVisible(1))).toBe(false);
  });

  test('tooltip: interaction mode index, intersect false', async ({ page }) => {
    await abrir(page);
    const i = await page.evaluate(() => window._ci.cP.options.interaction);
    expect(i.mode).toBe('index');
    expect(i.intersect).toBe(false);
  });

  test('período mayor a los snaps visibles: no dibuja la media y no rompe', async ({ page }) => {
    const errores = await abrir(page, { pref: { rango: '7', mm: 200 } });
    const m = await page.evaluate(() => window._ci.cP.data.datasets[1].data);
    expect(m.length).toBeGreaterThan(0);
    expect(m.every(v => v === null)).toBe(true);
    expect(await page.evaluate(() => _pMediaMovil([1, 2, 3], 5))).toBeNull();
    await page.locator('#pCtl .p-chip-per').click(); // 200 → 3
    const m2 = await page.evaluate(() => window._ci.cP.data.datasets[1].data);
    expect(m2.some(v => v !== null)).toBe(true);
    expect(errores).toEqual([]);
  });

  test('sin texto de ayuda visible en los controles', async ({ page }) => {
    await abrir(page);
    const txt = (await page.locator('#pCtl').innerText()).toLowerCase();
    expect(txt).not.toContain('tocá');
    expect(txt).not.toContain('tocar');
  });

  test('relleno de la media móvil: parte del primer punto y llega exacto al primer valor real', async ({ page }) => {
    await abrir(page, { nSnaps: 120, pref: { rango: 'all', mm: 10 } });
    const r = await page.evaluate(() => {
      const d = window._ci.cP.data.datasets;
      const vals = d[0].data, m = d[1].data;
      const real = _pMediaMovil(vals, 10);
      return { m, p0: vals[0], real9: real[9], desde: d[1].mmDesde, alfa: [0, 9, 20].map(i => _pMMAlfa(i, 10)),
        seg: [0, 4, 9].map(i => d[1].segment.borderColor({ p0DataIndex: i })), dash: d[1].borderDash || null, pr: d[1].pointRadius };
    });
    expect(r.desde).toBe(9);
    expect(r.m[0]).toBe(r.p0);
    expect(r.m[9]).toBeCloseTo(r.real9, 6);
    const paso = (r.m[9] - r.m[0]) / 9;
    for (let i = 1; i <= 9; i++) expect(r.m[i] - r.m[i - 1]).toBeCloseTo(paso, 5);
    expect(r.m.every(v => v != null)).toBe(true);
    expect(r.alfa[0]).toBeCloseTo(0.15, 5);
    expect(r.alfa[1]).toBe(1);
    expect(r.alfa[2]).toBe(1);
    expect(r.seg[0]).toBe('rgba(251,191,36,0.150)');
    expect(r.seg[1]).toBe('rgba(251,191,36,0.575)');
    expect(r.seg[2]).toBe('#fbbf24');
    expect(r.dash).toBeNull();
    expect(r.pr).toBe(0);
  });

  test('sin relleno si el período supera los puntos visibles', async ({ page }) => {
    await abrir(page, { nSnaps: 120, pref: { rango: '7', mm: 20 } });
    const r = await page.evaluate(() => { const d = window._ci.cP.data.datasets[1]; return { m: d.data, desde: d.mmDesde }; });
    expect(r.m.every(v => v === null)).toBe(true);
    expect(r.desde).toBe(0);
  });

  test('serie apagada: no se dibuja nada (dataset oculto)', async ({ page }) => {
    await abrir(page, { nSnaps: 120, pref: { rango: 'all', mm: 10, verMM: false } });
    expect(await page.evaluate(() => window._ci.cP.isDatasetVisible(1))).toBe(false);
  });

  test('chip: texto "N períodos" para cada valor del ciclo', async ({ page }) => {
    await abrir(page, { nSnaps: 120, pref: { rango: 'all' } });
    for (const n of [3, 5, 10, 20, 50, 100, 200]) {
      await expect(page.locator('#pCtl .p-chip-per')).toHaveText('Media móvil (' + n + ' períodos)');
      await page.locator('#pCtl .p-chip-per').click();
    }
    await expect(page.locator('#pCtl .p-chip-per')).toHaveText('Media móvil (3 períodos)');
  });
});
