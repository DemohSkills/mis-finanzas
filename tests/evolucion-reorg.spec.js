const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';
const HOY = new Date().toISOString().slice(0, 10);
const MES = HOY.slice(0, 7);

const fijo = (id, nombre, monto, extra = {}) => ({
  id, tipo: 'fijo', nombre, categoria: 'Hogar y Materiales', monto, estimado: true, diaMes: 5,
  medioPago: 'Banco Santander', palabrasClave: '', activo: true, pagos: {}, cadaMeses: 1, mesBase: null, ...extra,
});

function estadoBase({ deudas = true } = {}) {
  const items = [
    { id: 'a1', nombre: 'Cuenta ficticia', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 1000000 },
  ];
  if (deudas) {
    items.push(
      { id: 'd1', nombre: 'Crédito Santander 1', grupo: 'Deudas', tipo: 'deuda', monto: 100000 },
      { id: 'd2', nombre: 'Crédito Santander 2', grupo: 'Deudas', tipo: 'deuda', monto: 50000 },
      { id: 'd3', nombre: 'Créditos MP 1', grupo: 'Deudas', tipo: 'deuda', monto: 80000 },
      { id: 'd4', nombre: 'Créditos MP 2', grupo: 'Deudas', tipo: 'deuda', monto: 20000 },
      { id: 'd5', nombre: 'Fondo MP reserva', grupo: 'Deudas', tipo: 'deuda', monto: 30000 },
      { id: 'd6', nombre: 'Préstamo ficticio A', grupo: 'Deudas', tipo: 'deuda', monto: 40000 },
      { id: 'd7', nombre: 'Préstamo ficticio B', grupo: 'Deudas', tipo: 'deuda', monto: 35000 },
      { id: 'd8', nombre: 'Préstamo ficticio C', grupo: 'Deudas', tipo: 'deuda', monto: 25000 },
      { id: 'd9', nombre: 'Préstamo ficticio D', grupo: 'Deudas', tipo: 'deuda', monto: 10000 },
    );
  }
  return {
    iniciales: { 'Banco Santander': 0, 'Mercado Pago': 0, 'Astropay': 0, 'Visa Santander': deudas ? -200000 : 0, 'Mastercard MP': 0, 'Efectivo': 0, 'American Express': 0 },
    gastos: [
      { id: 'g1', monto: 50000, fecha: MES + '-01', categoria: 'Comida', tipo: 'gasto', medio: 'Banco Santander', soloHistorial: true },
    ],
    items,
    patrimonioCargado: true,
    compromisos: [
      fijo('f1', 'Alquiler ficticio con nombre muy largo para abreviar', 300000),
      fijo('f2', 'Cochera', 80000),
      fijo('f3', 'Contadora', 150000),
      fijo('f4', 'Pausado', 999000, { activo: false }),
      fijo('f5', 'En dólares', 100, { moneda: 'USD' }),
    ],
  };
}

async function abrir(page, estado, tema, extraLS = {}) {
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
  await page.addInitScript(({ sk, pk, pin, data, tema, extraLS }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    if (tema) localStorage.setItem('finanzas-v1-tema', JSON.stringify(tema));
    for (const [k, v] of Object.entries(extraLS)) localStorage.setItem(k, v);
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado, tema, extraLS });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
  await page.locator('nav.tabs button[data-vista="evolucion"]').click();
  await page.waitForFunction(() => typeof Chart !== 'undefined' && window._ci && window._ci['cP'], null, { timeout: 15000 });
  await page.waitForTimeout(300);
  return errores;
}

test('orden de las tarjetas en Evolución', async ({ page }) => {
  const err = await abrir(page, estadoBase());
  const ids = await page.evaluate(() => [...document.querySelectorAll('#vista-evolucion > details, #vista-evolucion > .ev-sep, #vista-evolucion > .ev-gas-hd, #vista-evolucion > #evGastosCopias')].map(e => e.id || e.className));
  expect(ids).toEqual(['det-ev-cP', 'det-ev-cB', 'det-ev-cD', 'det-ev-cRend', 'det-ev-cF', 'ev-sep', 'ev-gas-hd', 'evGastosCopias']);
  const copias = await page.evaluate(() => [...document.querySelectorAll('#evGastosCopias > details')].map(e => e.id));
  expect(copias).toEqual(['det-ev-cGC_e', 'det-ev-cIC_e', 'det-ev-cG_e']);
  expect(err).toEqual([]);
});

test('fijos salen de compromisos y el badge suma los activos en ARS', async ({ page }) => {
  const err = await abrir(page, estadoBase());
  const r = await page.evaluate(() => {
    const c = window._ci['cF'];
    return { labels: c.data.labels, data: c.data.datasets[0].data, badge: document.getElementById('evBadgeF').textContent, nota: document.getElementById('evFinNota').textContent, nota_h: document.getElementById('evFinNota').hidden, alto: document.getElementById('evFinWrap').style.height, grid: !!document.getElementById('evFinGrid') };
  });
  expect(r.data).toEqual([300000, 150000, 80000]);
  expect(r.labels[0]).toMatch(/…$/);
  expect(r.badge).toBe('$530k/mes');
  expect(r.nota).toMatch(/1 fijo en otra moneda no incluido/);
  expect(r.nota_h).toBe(false);
  expect(parseInt(r.alto)).toBeGreaterThanOrEqual(3 * 30);
  expect(r.grid).toBe(false);
  expect(err).toEqual([]);
});

test('Activos vs Deudas: neto, cobertura, dona y agrupación', async ({ page }) => {
  const err = await abrir(page, estadoBase());
  const r = await page.evaluate(() => {
    const t = totales();
    const items = [...document.querySelectorAll('#avdDona .avd-di')].map(e => ({ n: e.querySelector('.avd-dn').textContent, v: +e.dataset.v }));
    const arcs = [...document.querySelectorAll('#avdDona circle[data-v]')].reduce((s, c) => s + +c.dataset.v, 0);
    return { t, items, arcs, cob: document.getElementById('avdCob').textContent, ley: document.getElementById('avdLey').textContent, netoCls: document.getElementById('avdNeto').className, netoTxt: document.getElementById('avdNeto').textContent, tit: document.querySelectorAll('#det-ev-cB h2').length, anchoA: document.querySelector('#avdTop .avd-barra i').style.width };
  });
  // activos 1.000.000 / deudas 200k(Visa)+390k(items) = 590k
  expect(r.t.deudas).toBe(590000);
  expect(r.t.neto).toBe(410000);
  expect(r.netoCls).toContain('pos');
  expect(r.cob).toContain('169,5%'); // 1.000.000/590.000
  expect(r.ley).toContain('Tus activos cubren el 169,5% de tus deudas');
  expect(r.anchoA).toBe('100%');
  const nombres = r.items.map(i => i.n);
  expect(nombres).toContain('Créditos Santander');
  expect(nombres).toContain('Créditos MP');
  expect(nombres).toContain('Fondo MP');
  expect(nombres).toContain('Otras');
  expect(r.items.length).toBe(7); // top 6 + Otras
  expect(r.items.find(i => i.n === 'Créditos Santander').v).toBe(150000);
  expect(r.items.find(i => i.n === 'Créditos MP').v).toBe(100000);
  expect(r.items.reduce((s, i) => s + i.v, 0)).toBe(r.t.deudas);
  expect(r.arcs).toBe(r.t.deudas);
  expect(r.tit).toBe(1);
  expect(err).toEqual([]);
});

test('Activos vs Deudas con deudas > activos: neto negativo en rojo y ancho proporcional', async ({ page }) => {
  const est = estadoBase();
  est.items[0].monto = 100000;
  const err = await abrir(page, est);
  const r = await page.evaluate(() => ({ cls: document.getElementById('avdNeto').className, w: document.querySelector('#avdTop .avd-barra i').style.width, cob: document.getElementById('avdCob').textContent }));
  expect(r.cls).toContain('neg');
  expect(parseFloat(r.w)).toBeCloseTo(100000 / 590000 * 100, 1);
  expect(r.cob).toContain('16,9%');
  expect(err).toEqual([]);
});

test('deudas = 0: "Sin deudas" sin errores', async ({ page }) => {
  const err = await abrir(page, estadoBase({ deudas: false }));
  const r = await page.evaluate(() => ({ cob: document.getElementById('avdCob').textContent, ley: document.getElementById('avdLey').textContent, donaHidden: document.getElementById('avdDona').hidden }));
  expect(r.cob).toContain('Sin deudas');
  expect(r.donaHidden).toBe(true);
  expect(r.ley).not.toMatch(/NaN|Infinity/);
  expect(err).toEqual([]);
});

test('copias de gastos: plegadas, se dibujan al abrir, sin ids duplicados, Plegar todo', async ({ page }) => {
  const err = await abrir(page, estadoBase());
  const ini = await page.evaluate(() => ({
    abiertas: [...document.querySelectorAll('#evGastosCopias > details')].map(d => d.open),
    charts: ['cGC_e', 'cGCurva_e', 'cIngD_e', 'cCmpD_e', 'cG_e'].map(c => !!window._ci[c]),
  }));
  expect(ini.abiertas).toEqual([false, false, false]);
  expect(ini.charts).toEqual([false, false, false, false, false]);
  const dup = await page.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map(e => e.id); return ids.filter((x, i) => ids.indexOf(x) !== i); });
  expect(dup).toEqual([]);
  // abrir una a una
  await page.locator('#det-ev-cGC_e > summary').click();
  await page.waitForFunction(() => window._ci['cGC_e'] || window._ci['cGCurva_e']);
  await page.locator('#det-ev-cIC_e > summary').click();
  await page.locator('#det-ev-cG_e > summary').click();
  await page.waitForFunction(() => window._ci['cIngD_e'] && window._ci['cCmpD_e'] && window._ci['cG_e']);
  const tex = await page.evaluate(() => ({ brow: document.getElementById('gcBrow_e').children.length, evb: document.getElementById('evBrow_e').children.length, tit: document.getElementById('gMesTit_e').textContent }));
  expect(tex.brow).toBeGreaterThan(0);
  expect(tex.evb).toBeGreaterThan(0);
  expect(tex.tit).toContain('·');
  const btn = page.locator('#btnPlegEvolGas');
  await expect(btn).toHaveText('Plegar todo');
  await btn.click();
  expect(await page.evaluate(() => [...document.querySelectorAll('#evGastosCopias > details')].map(d => d.open))).toEqual([false, false, false]);
  await expect(btn).toHaveText('Desplegar todo');
  // "Plegar todo" de arriba no toca las copias
  await btn.click();
  await page.locator('#btnPlegEvol').click();
  expect(await page.evaluate(() => [...document.querySelectorAll('#evGastosCopias > details')].every(d => d.open))).toBe(true);
  // estado persistido con clave nueva
  const k = await page.evaluate(() => localStorage.getItem('finanzas-v1-det-det-ev-cG_e'));
  expect(k).toBe('true');
  expect(err).toEqual([]);
});

test('modo día/mes y mes seleccionado coherentes entre copias y originales', async ({ page }) => {
  const err = await abrir(page, estadoBase(), null, { 'finanzas-v1-det-det-ev-cGC_e': 'true', 'finanzas-v1-det-det-ev-cG_e': 'true' });
  await page.waitForFunction(() => window._ci['cGCurva_e'] && window._ci['cG_e']);
  await page.locator('#det-ev-cGC_e [data-gcmodo="mes"]').click();
  const r = await page.evaluate(() => ({
    ls: localStorage.getItem('finanzas-v1-gc-modo'),
    pressed: [...document.querySelectorAll('[data-gcmodo="mes"]')].map(b => b.getAttribute('aria-pressed')),
    subE: document.getElementById('gcSub_e').textContent, sub: document.getElementById('gcSub').textContent,
  }));
  expect(r.ls).toBe('mes');
  expect(r.pressed).toEqual(['true', 'true']);
  expect(r.subE).toBe(r.sub);
  // seleccionar mes anterior desde la copia
  const meses = await page.evaluate(() => gastosMesesVentana());
  await page.evaluate(m => selGastoMes(m), meses[3]);
  const tit = await page.evaluate(() => [document.getElementById('gMesTit').textContent, document.getElementById('gMesTit_e').textContent]);
  expect(tit[0]).toBe(tit[1]);
  expect(err).toEqual([]);
});

test('modo ojo oculta importes y porcentajes de Activos vs Deudas', async ({ page }) => {
  const err = await abrir(page, estadoBase());
  await page.locator('#btnOjo').click();
  const r = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#det-ev-cB .amt')];
    return { n: els.length, ocultos: els.every(e => getComputedStyle(e).fontSize === '0px'), body: document.body.classList.contains('ocultar') };
  });
  expect(r.body).toBe(true);
  expect(r.n).toBeGreaterThan(8);
  expect(r.ocultos).toBe(true);
  expect(err).toEqual([]);
});

for (const tema of ['claro', 'oscuro', 'negro', 'auto']) {
  test(`tema ${tema}: tarjetas renderizan sin errores`, async ({ page }) => {
    const err = await abrir(page, estadoBase(), tema);
    if (tema !== 'auto') expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(tema);
    await expect(page.locator('#det-ev-cB')).toBeVisible();
    await expect(page.locator('#avdDona')).toBeVisible();
    await expect(page.locator('.ev-sep')).toBeVisible();
    expect(err).toEqual([]);
  });
}

for (const w of [360, 412, 450]) {
  test(`sin overflow horizontal a ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    const err = await abrir(page, estadoBase(), null, { 'finanzas-v1-det-det-ev-cGC_e': 'true', 'finanzas-v1-det-det-ev-cIC_e': 'true', 'finanzas-v1-det-det-ev-cG_e': 'true' });
    await page.waitForFunction(() => window._ci['cG_e'] && window._ci['cIngD_e']);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const de = document.documentElement;
      const fuera = [...document.querySelectorAll('#det-ev-cB *, #det-ev-cF *')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > de.clientWidth + 0.5 || b.left < -0.5); }).map(e => e.className || e.tagName);
      return { sw: de.scrollWidth, cw: de.clientWidth, fuera };
    });
    expect(r.sw).toBeLessThanOrEqual(r.cw);
    expect(r.fuera).toEqual([]);
    expect(err).toEqual([]);
  });
}

for (const w of [360, 412, 450]) {
  for (const tema of ['claro', 'oscuro', 'negro', 'auto']) {
    test(`monto de "Deuda total" en una línea sin decimales a ${w}px, tema ${tema}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      const est = estadoBase();
      est.items.push({ id: 'dg', nombre: 'Deuda grande ficticia', grupo: 'Deudas', tipo: 'deuda', monto: 23041214.84 });
      const err = await abrir(page, est, tema);
      const r = await page.evaluate(() => {
        const b = document.getElementById('avdDTot'), wrap = document.querySelector('.avd-dwrap');
        const lh = parseFloat(getComputedStyle(b).lineHeight) || parseFloat(getComputedStyle(b).fontSize) * 1.3;
        return { txt: b.textContent, h: b.getBoundingClientRect().height, lh, bw: b.scrollWidth, ww: wrap.getBoundingClientRect().width };
      });
      expect(r.txt).toMatch(/^\$\d{1,3}(\.\d{3})+$/);
      expect(r.h).toBeLessThan(r.lh * 1.6);
      expect(r.bw).toBeLessThanOrEqual(r.ww * 0.62);
      await page.locator('#btnOjo').click();
      const oc = await page.evaluate(() => getComputedStyle(document.querySelector('#avdDTot .amt')).fontSize);
      expect(oc).toBe('0px');
      expect(err).toEqual([]);
    });
  }
}
