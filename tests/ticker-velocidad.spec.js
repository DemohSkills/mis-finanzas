const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const SK_TICKER = 'finanzas-v1-ticker-mode';
const TEST_PIN = '1234';

function buildEstado() {
  return {
    iniciales: {},
    gastos: [],
    items: [{ id: 'ia1', nombre: 'Efectivo', grupo: 'Cuentas y efectivo', tipo: 'activo', monto: 50000 }],
    patrimonioCargado: true,
    compromisos: [],
  };
}

async function seedAndUnlock(page, tkVal = null) {
  await page.addInitScript(({ sk, pk, pin, data, tkKey, tkVal }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    if (tkVal !== null) localStorage.setItem(tkKey, tkVal);
    else localStorage.removeItem(tkKey);
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: buildEstado(), tkKey: SK_TICKER, tkVal });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}

async function goToEvolucion(page) {
  await page.locator('nav.tabs button[data-vista="evolucion"]').click();
  await page.waitForTimeout(600);
}

test.describe('ticker-velocidad: ciclo de 4 estados', () => {
  test('(a) sin preferencia arranca en 1x con clase tk-v1 y etiqueta ▶', async ({ page }) => {
    await seedAndUnlock(page);
    await goToEvolucion(page);
    const hasV1 = await page.evaluate(() => !!document.querySelector('#tickerEvol .tk-wrap.tk-v1'));
    expect(hasV1).toBe(true);
    const label = await page.locator('#tickerEvol .tk-btn').textContent();
    expect(label).toBe('▶');
  });

  test('(b) ciclo completo: 1x → 2x → 3x → pause → 1x (etiquetas y clases)', async ({ page }) => {
    await seedAndUnlock(page, '1x');
    await goToEvolucion(page);

    // 1x → 2x
    await page.locator('#tickerEvol .tk-btn').click();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => !!document.querySelector('#tickerEvol .tk-wrap.tk-v2'))).toBe(true);
    expect(await page.locator('#tickerEvol .tk-btn').textContent()).toBe('▶▶');

    // 2x → 3x
    await page.locator('#tickerEvol .tk-btn').click();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => !!document.querySelector('#tickerEvol .tk-wrap.tk-v3'))).toBe(true);
    expect(await page.locator('#tickerEvol .tk-btn').textContent()).toBe('▶▶▶');

    // 3x → pause
    await page.locator('#tickerEvol .tk-btn').click();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => !!document.querySelector('#tickerEvol .tk-wrap.tk-pause'))).toBe(true);
    expect(await page.locator('#tickerEvol .tk-btn').textContent()).toBe('❙❙');

    // pause → 1x
    await page.locator('#tickerEvol .tk-btn').click();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => !!document.querySelector('#tickerEvol .tk-wrap.tk-v1'))).toBe(true);
    expect(await page.locator('#tickerEvol .tk-btn').textContent()).toBe('▶');
  });

  test('(c) migración: valor viejo "scroll" se trata como 1x', async ({ page }) => {
    await seedAndUnlock(page, 'scroll');
    await goToEvolucion(page);
    const hasV1 = await page.evaluate(() => !!document.querySelector('#tickerEvol .tk-wrap.tk-v1'));
    expect(hasV1).toBe(true);
    const hasSc = await page.evaluate(() => !!document.querySelector('#tickerEvol .tk-wrap.tk-scroll'));
    expect(hasSc).toBe(true);
  });

  test('(d) migración: valor viejo "fixed" se trata como pause', async ({ page }) => {
    await seedAndUnlock(page, 'fixed');
    await goToEvolucion(page);
    const hasPause = await page.evaluate(() => !!document.querySelector('#tickerEvol .tk-wrap.tk-pause'));
    expect(hasPause).toBe(true);
    const hasFixed = await page.evaluate(() => !!document.querySelector('#tickerEvol .tk-wrap.tk-fixed'));
    expect(hasFixed).toBe(true);
    expect(await page.locator('#tickerEvol .tk-btn').textContent()).toBe('❙❙');
  });

  test('(e) valor desconocido cae en 1x', async ({ page }) => {
    await seedAndUnlock(page, 'unknown-value');
    await goToEvolucion(page);
    const hasV1 = await page.evaluate(() => !!document.querySelector('#tickerEvol .tk-wrap.tk-v1'));
    expect(hasV1).toBe(true);
  });

  test('(f) migración: "2x" se trata como v1 (ya no es 2x)', async ({ page }) => {
    await seedAndUnlock(page, '2x');
    await goToEvolucion(page);
    const hasV1 = await page.evaluate(() => !!document.querySelector('#tickerEvol .tk-wrap.tk-v1'));
    expect(hasV1).toBe(true);
    expect(await page.locator('#tickerEvol .tk-btn').textContent()).toBe('▶');
  });

  test('(g) persistencia tras recargar — pause', async ({ page }) => {
    await seedAndUnlock(page, 'pause');
    await goToEvolucion(page);
    expect(await page.evaluate(() => !!document.querySelector('#tickerEvol .tk-wrap.tk-pause'))).toBe(true);
  });

  test('(h) el modo es compartido entre Inicio y Evolución', async ({ page }) => {
    await seedAndUnlock(page, '1x');
    await goToEvolucion(page);
    // Advance to 2x from Evolución
    await page.locator('#tickerEvol .tk-btn').click();
    await page.waitForTimeout(200);
    // Now check Inicio
    await page.locator('nav.tabs button[data-vista="inicio"]').click();
    await page.waitForTimeout(400);
    const inicioV2 = await page.evaluate(() => !!document.querySelector('#tickerInicio .tk-wrap.tk-v2'));
    expect(inicioV2).toBe(true);
  });

  test('(i) en modo animado (1x) los ítems están duplicados en el track', async ({ page }) => {
    await seedAndUnlock(page, '1x');
    await goToEvolucion(page);
    const itemCount = await page.locator('#tickerEvol .tk-track .tk-item').count();
    expect(itemCount).toBeGreaterThan(5); // 6 items × 2 copies = 12
  });

  test('(j) en modo pause los ítems NO están duplicados', async ({ page }) => {
    await seedAndUnlock(page, 'pause');
    await goToEvolucion(page);
    const itemCount = await page.locator('#tickerEvol .tk-track .tk-item').count();
    expect(itemCount).toBe(6);
  });

  test('(k) aria-label del botón es correcto para cada modo nativo', async ({ page }) => {
    const modos = [
      { mode: 'v1', expected: /1x.*2x/i },
      { mode: 'v2', expected: /2x.*3x/i },
      { mode: 'v3', expected: /3x.*pausar/i },
      { mode: 'pause', expected: /pausado.*1x/i },
    ];
    for (const { mode, expected } of modos) {
      await seedAndUnlock(page, mode);
      await goToEvolucion(page);
      const label = await page.locator('#tickerEvol .tk-btn').getAttribute('aria-label');
      expect(label).toMatch(expected);
    }
  });

  test('(m) migración completa de valores legado', async ({ page }) => {
    const cases = [
      { seed: '1x',  expectClass: 'tk-v1', expectLabel: '▶' },
      { seed: '2x',  expectClass: 'tk-v1', expectLabel: '▶' },
      { seed: 'scroll', expectClass: 'tk-v1', expectLabel: '▶' },
      { seed: '3x',  expectClass: 'tk-v2', expectLabel: '▶▶' },
      { seed: 'fixed', expectClass: 'tk-pause', expectLabel: '❙❙' },
      { seed: 'unknown-xyz', expectClass: 'tk-v1', expectLabel: '▶' },
    ];
    for (const { seed, expectClass, expectLabel } of cases) {
      await seedAndUnlock(page, seed);
      await goToEvolucion(page);
      const hasClass = await page.evaluate(cls => !!document.querySelector(`#tickerEvol .tk-wrap.${cls}`), expectClass);
      expect(hasClass, `seed="${seed}" expects class ${expectClass}`).toBe(true);
      const label = await page.locator('#tickerEvol .tk-btn').textContent();
      expect(label, `seed="${seed}" expects label ${expectLabel}`).toBe(expectLabel);
    }
  });

  test('(n) duraciones CSS: v1=16s, v2≈10.667s, v3=8s', async ({ page }) => {
    const cases = [
      { mode: 'v1', expectedDur: '16s' },
      { mode: 'v2', expectedDur: '10.667s' },
      { mode: 'v3', expectedDur: '8s' },
    ];
    for (const { mode, expectedDur } of cases) {
      await seedAndUnlock(page, mode);
      await goToEvolucion(page);
      const dur = await page.evaluate(() => {
        const track = document.querySelector('#tickerEvol .tk-track');
        if (!track) return null;
        return getComputedStyle(track).animationDuration;
      });
      expect(dur, `mode=${mode}`).toBe(expectedDur);
    }
  });
});

test.describe('ticker-velocidad: responsive sin scroll horizontal', () => {
  let browser;
  test.beforeAll(async () => { browser = await chromium.launch(); });
  test.afterAll(async () => { await browser.close(); });

  async function openAt(width, mode) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 } });
    await ctx.addInitScript(({ sk, pk, pin, data, tkKey, tkVal }) => {
      localStorage.setItem(sk, JSON.stringify(data));
      localStorage.setItem(pk, JSON.stringify(pin));
      if (tkVal) localStorage.setItem(tkKey, tkVal);
    }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: buildEstado(), tkKey: SK_TICKER, tkVal: mode });
    const page = await ctx.newPage();
    await page.goto(INDEX);
    for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
    await page.waitForTimeout(400);
    await page.locator('nav.tabs button[data-vista="evolucion"]').click();
    await page.waitForTimeout(600);
    return { page, ctx };
  }

  for (const width of [360, 412, 450]) {
    for (const mode of ['1x', '2x', '3x', 'pause']) {
      test(`(l) a ${width}px modo ${mode}: sin scroll horizontal`, async () => {
        const { page, ctx } = await openAt(width, mode);
        try {
          const noHScroll = await page.evaluate(() =>
            document.documentElement.scrollWidth <= document.documentElement.clientWidth
          );
          expect(noHScroll).toBe(true);
        } finally { await ctx.close(); }
      });
    }
  }
});
