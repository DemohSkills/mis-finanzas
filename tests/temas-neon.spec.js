// @ts-check
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const META = 'meta[name="theme-color"]';
const NEON = ['neon-azul', 'neon-turquesa', 'neon-violeta'];
const ESPERADO = {
  'neon-azul':     { accent: '#3b82ff', bg: '#060914', ok: '#4dffb0' },
  'neon-turquesa': { accent: '#00f5e0', bg: '#060914', ok: '#b6ff5c' },
  'neon-violeta':  { accent: '#b366ff', bg: '#060914', ok: '#4dffb0' },
};

async function abrir(browser, tema, ancho = 360) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: 800 }, colorScheme: 'light' });
  await ctx.addInitScript(t => {
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    localStorage.setItem('finanzas-v1', JSON.stringify({ iniciales: {}, gastos: [], items: [], patrimonioCargado: true }));
    if (t) localStorage.setItem('finanzas-v1-tema', JSON.stringify(t));
  }, tema);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(FILE_URL);
  for (const d of ['1', '2', '3', '4']) {
    await page.locator('.pin-pad button').filter({ hasText: d }).first().click();
  }
  await expect(page.locator('#app')).not.toBeHidden({ timeout: 3000 });
  return { page, ctx, errors };
}

const variable = (page, n) => page.evaluate(v => getComputedStyle(document.documentElement).getPropertyValue(v).trim(), n);
const attr = page => page.evaluate(() => document.documentElement.getAttribute('data-theme'));

function lum(hex) {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contraste(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test.describe('Temas neón', () => {
  let browser;
  test.beforeAll(async () => { browser = await chromium.launch(); });
  test.afterAll(async () => { await browser.close(); });

  for (const t of NEON) {
    test(`(a) ${t}: data-theme y variables esperadas`, async () => {
      const { page, ctx, errors } = await abrir(browser, t);
      expect(await attr(page)).toBe(t);
      expect(await variable(page, '--accent')).toBe(ESPERADO[t].accent);
      expect(await variable(page, '--bg')).toBe(ESPERADO[t].bg);
      expect(await variable(page, '--ok')).toBe(ESPERADO[t].ok);
      expect(errors).toEqual([]);
      await ctx.close();
    });

    test(`(b) ${t}: meta theme-color #060914 al arrancar`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
      await ctx.addInitScript(x => localStorage.setItem('finanzas-v1-tema', JSON.stringify(x)), t);
      const page = await ctx.newPage();
      await page.goto(FILE_URL, { waitUntil: 'commit' });
      await page.waitForSelector('.pin-pad button');
      expect(await page.evaluate(s => document.querySelector(s).content, META)).toBe('#060914');
      await ctx.close();
    });

    test(`(f) ${t}: contraste WCAG >= 4.5 (text/bg y muted/card)`, async () => {
      const { page, ctx } = await abrir(browser, t);
      const [text, bg, muted, card] = await Promise.all(['--text', '--bg', '--muted', '--card'].map(v => variable(page, v)));
      expect(contraste(text, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contraste(muted, card)).toBeGreaterThanOrEqual(4.5);
      await ctx.close();
    });

    test(`(h) ${t}: captura de Inicio a 360px sin errores de consola`, async ({}, testInfo) => {
      const { page, ctx, errors } = await abrir(browser, t, 360);
      await page.waitForTimeout(300);
      await page.screenshot({ path: testInfo.outputPath(`inicio-${t}.png`), fullPage: false });
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }

  test('(b2/c) cambiar en Configuración: meta, botón activo y sin desborde a 360px', async () => {
    const { page, ctx, errors } = await abrir(browser, null, 360);
    await page.locator('.tabs button[data-vista="config"]').click();
    for (const t of NEON) {
      await page.locator(`.tema-btn[data-tema="${t}"]`).click();
      expect(await attr(page)).toBe(t);
      expect(await page.evaluate(s => document.querySelector(s).content, META)).toBe('#060914');
      await expect(page.locator(`.tema-btn[data-tema="${t}"]`)).toHaveClass(/primary/);
      expect(await page.locator('.tema-btn.primary').count()).toBe(1);
      const ov = await page.evaluate(() => {
        const c = document.getElementById('temaOpciones');
        return { sw: c.scrollWidth, cw: c.clientWidth, doc: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth };
      });
      expect(ov.sw).toBeLessThanOrEqual(ov.cw);
      expect(ov.doc).toBeLessThanOrEqual(ov.vw);
    }
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('(d) Pulse recorre los 7 temas en orden y vuelve a auto, con nombre legible en el toast', async () => {
    const { page, ctx, errors } = await abrir(browser, null, 390);
    const orden = ['claro', 'oscuro', 'negro', 'neon-azul', 'neon-turquesa', 'neon-violeta', null];
    const nombres = { 'neon-azul': 'Neón azul', 'neon-turquesa': 'Neón turquesa', 'neon-violeta': 'Neón violeta' };
    for (const t of orden) {
      await page.locator('.app-hdr h1 .pulse').click();
      await page.waitForTimeout(150);
      expect(await attr(page)).toBe(t);
      if (nombres[t]) {
        expect(await page.evaluate(() => document.getElementById('toastActualizar')?.textContent)).toContain(nombres[t]);
      }
    }
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('(e) tema guardado desconocido cae en auto sin errores', async () => {
    const { page, ctx, errors } = await abrir(browser, 'tema-del-futuro');
    expect(await attr(page)).toBeNull();
    expect(await page.evaluate(s => document.querySelector(s).content, META)).toBe('#f4f6fa');
    await page.locator('.tabs button[data-vista="config"]').click();
    await expect(page.locator('.tema-btn[data-tema="auto"]')).toHaveClass(/primary/);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('(g) los temas anteriores no cambiaron', async () => {
    const esperado = {
      oscuro: { '--bg': '#0f172a', '--card': '#1e293b', '--accent': '#60a5fa', '--ok': '#4ade80', '--border': '#334155', '--grid-color': '#334155' },
      negro:  { '--bg': '#000', '--card': '#0b0b0d', '--accent': '#60a5fa', '--ok': '#4ade80', '--border': '#222', '--grid-color': 'rgba(255,255,255,.08)' },
      claro:  { '--bg': '#f4f6fa', '--card': '#fff', '--accent': '#2563eb', '--ok': '#16a34a', '--border': '#e2e8f0', '--grid-color': '#e2e8f0' },
    };
    for (const [t, vars] of Object.entries(esperado)) {
      const { page, ctx } = await abrir(browser, t);
      for (const [v, val] of Object.entries(vars)) expect(await variable(page, v)).toBe(val);
      // sin reglas neón: las tarjetas conservan su radio de 12px
      const rad = await page.evaluate(() => getComputedStyle(document.querySelector('section')).borderRadius);
      expect(rad).toBe('12px');
      await ctx.close();
    }
  });
});
