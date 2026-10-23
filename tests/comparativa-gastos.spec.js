const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const MODO_KEY = 'finanzas-v1-gc-modo';
const TEST_PIN = '1234';

const g = (id, fecha, monto, categoria, extra = {}) => ({ id, fecha, monto, categoria, descripcion: 'x', tipo: 'gasto', medio: 'Efectivo', ...extra });

// Datos ficticios. Septiembre tiene 30 días.
function buildEstado({ sinAnterior = false, anteriorCero = false } = {}) {
  const sep = sinAnterior ? [] : anteriorCero ? [g('s0', '2026-09-10', 0, 'Comida')] : [
    g('s1', '2026-09-10', 1000, 'Comida'),
    g('s2', '2026-09-30', 2000, 'Transporte'),
    g('s3', '2026-09-20', 400, 'Hogar', { soloHistorial: true }),
    g('sx1', '2026-09-12', 9999, 'Pago de créditos'),
    g('sx2', '2026-09-13', 8888, 'Comida', { transferencia: true }),
    { id: 'si', fecha: '2026-09-14', monto: 7777, categoria: 'Ingresos extras', descripcion: 'x', tipo: 'ingreso', medio: 'Efectivo' },
  ];
  return {
    iniciales: { Efectivo: 100000 },
    gastos: [
      ...sep,
      g('o1', '2026-10-05', 1500, 'Comida'),
      g('o2', '2026-10-31', 700, 'Ocio'),
    ],
    items: [{ id: 'ia1', nombre: 'Efectivo', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 100000 }],
    patrimonioCargado: true,
    compromisos: [
      { id: 'c1', nombre: 'Cuota A', entidad: 'Banco', monto: 4000, pendientes: 4, proxVenc: '2026-10-31', tipo: 'cuota' },
    ],
  };
}

async function abrir(page, estado, { hoy = '2026-10-31T12:00:00', modo, width = 412 } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.clock.setFixedTime(new Date(hoy));
  await page.addInitScript(({ sk, pk, pin, data, mk, modo }) => {
    if (localStorage.getItem('__seeded')) return;
    localStorage.setItem('__seeded', '1');
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    if (modo) localStorage.setItem(mk, modo);
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado, mk: MODO_KEY, modo });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}

async function irAGastos(page) {
  await page.locator('nav.tabs button[data-vista="analisis"]').click();
  await page.waitForSelector('#gcBrow .bcard');
  await page.waitForTimeout(300);
}

test.describe('Comparativa de gastos', () => {
  test('"mismo día": hoy 31 y mes anterior de 30 días corta en el 30; cuenta soloHistorial y excluye pago de créditos/transferencias/ingresos', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await abrir(page, buildEstado());
    await irAGastos(page);
    const D = await page.evaluate(() => datosCompGastos());
    expect(D.mesAnt).toBe('2026-09');
    expect(D.diasAnt).toBe(30);
    expect(D.dHoy).toBe(31);
    expect(D.diaCorte).toBe(30);
    expect(D.antDia).toBe(3400); // 1000 + 2000 + 400 (soloHistorial)
    expect(D.antMes).toBe(3400);
    expect(D.act).toBe(2200);
    expect(D.hayAnt).toBe(true);
    expect(errors).toHaveLength(0);
  });

  test('"mismo día" corta el anterior en el día de hoy; "mes completo" usa el anterior entero', async ({ page }) => {
    await abrir(page, buildEstado(), { hoy: '2026-10-15T12:00:00' });
    await irAGastos(page);
    const D = await page.evaluate(() => datosCompGastos());
    expect(D.diaCorte).toBe(15);
    expect(D.antDia).toBe(1000);
    expect(D.antMes).toBe(3400);
    expect(D.act).toBe(1500);
    await expect(page.locator('#gcBrow')).toContainText('+50,0%');
    await page.locator('[data-gcmodo="mes"]').click();
    await expect(page.locator('#gcBrow')).toContainText('−55,9%');
    await expect(page.locator('#gcNota')).toContainText('en curso');
    expect(await page.evaluate(k => localStorage.getItem(k), MODO_KEY)).toBe('mes');
  });

  test('el modo elegido se recuerda al recargar', async ({ page }) => {
    await abrir(page, buildEstado(), { hoy: '2026-10-15T12:00:00', modo: 'mes' });
    await irAGastos(page);
    await expect(page.locator('[data-gcmodo="mes"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-gcmodo="dia"]')).toHaveAttribute('aria-pressed', 'false');
  });

  test('flecha y signo (no solo color): gastar de más ▲ +, gastar de menos ▼ −', async ({ page }) => {
    await abrir(page, buildEstado(), { hoy: '2026-10-15T12:00:00' });
    await irAGastos(page);
    const up = page.locator('#gcBrow .gc-var');
    await expect(up).toContainText('▲');
    await expect(up).toContainText('+');
    await expect(up).toHaveClass(/gc-neg/);
    await page.locator('[data-gcmodo="mes"]').click();
    await expect(page.locator('#gcBrow .gc-var')).toContainText('▼');
    await expect(page.locator('#gcBrow .gc-var')).toHaveClass(/gc-pos/);
  });

  test('proyección mínima = gastado hasta hoy + compromisos del mes', async ({ page }) => {
    await abrir(page, buildEstado());
    await irAGastos(page);
    const txt = await page.locator('#gcBrow .bcard').nth(2).innerText();
    expect(txt).toContain('Proyección mínima fin de mes');
    expect(txt).toContain('no incluye gastos variables');
    // 2200 gastado + 4000 de la cuota de octubre = 6200
    expect(txt.replace(/\D/g, '')).toContain('6200');
  });

  test('próximos meses: 3 mini-tarjetas con comprometido', async ({ page }) => {
    await abrir(page, buildEstado());
    await irAGastos(page);
    const cards = page.locator('#gcProx .bcard');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText('Nov');
    await expect(cards.nth(2)).toContainText('Ene');
    await expect(cards.nth(0)).toContainText('4.000');
  });

  test('sin datos del mes anterior: mensaje y solo el actual, sin NaN', async ({ page }) => {
    await abrir(page, buildEstado({ sinAnterior: true }));
    await irAGastos(page);
    await expect(page.locator('#gcNota')).toHaveText('Aún no hay datos del mes anterior');
    const txt = await page.locator('#det-ev-cGC').innerText();
    expect(txt).not.toMatch(/NaN|Infinity|undefined/);
    expect(await page.evaluate(() => Object.keys(_ci).includes('cGCurva') && _ci.cGCurva.data.datasets.length)).toBe(1);
  });

  test('mes anterior en $0: variación "—", sin división por cero', async ({ page }) => {
    await abrir(page, buildEstado({ anteriorCero: true }));
    await irAGastos(page);
    const txt = await page.locator('#det-ev-cGC').innerText();
    expect(txt).not.toMatch(/NaN|Infinity/);
    await expect(page.locator('#gcBrow')).toContainText('Variación: —');
    await expect(page.locator('#evBadgeGC')).toHaveText('—');
  });

  test('curva acumulada: el mes actual termina en hoy y no hay proyección', async ({ page }) => {
    await abrir(page, buildEstado(), { hoy: '2026-10-15T12:00:00' });
    await irAGastos(page);
    const r = await page.evaluate(() => {
      const ds = _ci.cGCurva.data.datasets;
      const act = ds[ds.length - 1].data;
      return { n: ds.length, ultimo: act.lastIndexOf(act.filter(v => v !== null).pop()), nulos: act.slice(15).every(v => v === null), v15: act[14] };
    });
    expect(r.n).toBe(2);
    expect(r.nulos).toBe(true);
    expect(r.v15).toBe(1500);
  });

  test('la cinta muestra "Gastos vs mes ant." (modo mismo día) y al tocarla navega a la tarjeta', async ({ page }) => {
    await abrir(page, buildEstado(), { hoy: '2026-10-15T12:00:00', modo: 'mes' });
    const item = page.locator('#tickerInicio [data-nav="gastos-comp"]').first();
    await expect(item).toContainText('Gastos vs mes ant.');
    await expect(item).toContainText('+50.0%'); // siempre "al mismo día", aunque el modo guardado sea "mes"
    await item.dispatchEvent('click');
    await expect(page.locator('#vista-analisis')).toBeVisible();
    await expect(page.locator('#det-ev-cGC')).toHaveJSProperty('open', true);
  });

  for (const width of [360, 412, 450]) {
    test(`sin overflow horizontal ni texto cortado a ${width}px`, async ({ page }) => {
      await abrir(page, buildEstado(), { width });
      await irAGastos(page);
      const r = await page.evaluate(() => {
        const card = document.getElementById('det-ev-cGC');
        const cr = card.getBoundingClientRect();
        const fuera = [...card.querySelectorAll('*')].filter(el => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && (b.right > cr.right + 1 || b.left < cr.left - 1);
        }).map(el => el.tagName + '.' + el.className);
        const cortado = [...card.querySelectorAll('.bcard .bv, .gc-tabla td')].filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent.trim());
        return { docOverflow: document.documentElement.scrollWidth > window.innerWidth, fuera, cortado };
      });
      expect(r.docOverflow).toBe(false);
      expect(r.fuera).toEqual([]);
      expect(r.cortado).toEqual([]);
    });
  }

  test('modo ojo oculta importes (bloques, tabla, ejes de monto y etiquetas) pero conserva los nombres de categoría', async ({ page }) => {
    await abrir(page, buildEstado());
    await irAGastos(page);
    await page.locator('#btnOjo').click();
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({
      amts: [...document.querySelectorAll('#det-ev-cGC .amt')].every(el => getComputedStyle(el).fontSize === '0px'),
      xCat: _ci.cGC.options.scales.x.ticks.display,
      yCat: _ci.cGC.options.scales.y.ticks.display,
      yCurva: _ci.cGCurva.options.scales.y.ticks.display,
    }));
    expect(r.amts).toBe(true);
    expect(r.xCat).toBe(false);
    expect(r.yCat).not.toBe(false);
    expect(r.yCurva).toBe(false);
  });

  for (const tema of ['claro', 'oscuro', 'negro', 'auto']) {
    test(`tema ${tema}: renderiza sin errores`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(t => { try { localStorage.setItem('finanzas-v1-tema', JSON.stringify(t)); } catch {} }, tema);
      await abrir(page, buildEstado());
      await irAGastos(page);
      await expect(page.locator('#cGC')).toBeVisible();
      await expect(page.locator('#cGCurva')).toBeVisible();
      expect(errors).toHaveLength(0);
    });
  }
});
