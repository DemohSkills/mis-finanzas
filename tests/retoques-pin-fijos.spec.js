const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const TEMAS = ['auto', 'claro', 'oscuro', 'negro', 'neon-azul', 'neon-turquesa', 'neon-violeta'];
const ANCHOS = [360, 412, 450];
const LARGO = 'Alquiler ficticio con nombre bastante largo del mes';

async function abrir(page, { tema = 'auto', ocultar = false, pin = true, estado } = {}) {
  const err = [];
  page.on('pageerror', e => err.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') err.push(m.text()); });
  await page.addInitScript(({ tema, ocultar, pin, estado }) => {
    localStorage.setItem('finanzas-v1-tema', JSON.stringify(tema));
    if (pin) localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    if (ocultar) localStorage.setItem('finanzas-v1-ocultar', 'true');
    if (estado) localStorage.setItem('finanzas-v1', JSON.stringify(estado));
  }, { tema, ocultar, pin, estado });
  await page.goto(INDEX);
  return err;
}

test.describe('PIN con logo y teclado abajo', () => {
  for (const tema of TEMAS) {
    for (const ancho of ANCHOS) {
      test(`${tema} a ${ancho}px (modo ojo ${tema === 'auto'})`, async ({ page }) => {
        await page.setViewportSize({ width: ancho, height: 740 });
        const err = await abrir(page, { tema, ocultar: tema === 'auto' });
        await expect(page.locator('#pinScr')).toBeVisible();
        const m = await page.evaluate(() => {
          const r = s => document.querySelector(s).getBoundingClientRect();
          const logo = r('#pinScr .pin-logo'), tit = r('#pinTitle'), pad = r('#pinScr .pin-pad'), aviso = r('#pinScr .pin-bottom');
          return {
            logoTop: logo.top, tituloTop: tit.top, logoBottom: logo.bottom,
            padBottom: aviso.bottom, vh: innerHeight,
            texto: document.querySelector('#pinScr .pin-logo').textContent.replace(/\s+/g, ' ').trim(),
            sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, padTop: pad.top, tituloBottom: tit.bottom,
          };
        });
        expect(m.texto).toContain('Di-Mi-Trip');
        expect(m.texto).toContain('Pulse Finance');
        expect(m.tituloTop - m.logoBottom).toBeLessThan(30);       // título pegado al logo
        expect(m.padTop - m.tituloBottom).toBeGreaterThan(40);       // teclado separado hacia abajo
        expect(m.vh - m.padBottom).toBeLessThan(40);                 // cerca del borde inferior
        expect(m.vh - m.padBottom).toBeGreaterThan(0);
        expect(m.sw).toBeLessThanOrEqual(m.cw);
        for (const d of '1234') await page.click(`button[data-d="${d}"]`);
        await expect(page.locator('#pinScr')).toBeHidden();
        expect(err).toEqual([]);
      });
    }
  }
});

test('nombre largo de un fijo solo se corta si no entra', async ({ page }) => {
  await page.setViewportSize({ width: 450, height: 900 });
  const estado = {
    iniciales: {}, gastos: [], items: [], patrimonioCargado: true,
    compromisos: [
      { id: 'f1', tipo: 'fijo', nombre: LARGO, categoria: 'Hogar y Materiales', monto: 300000, estimado: true, diaMes: 5, activo: true },
      { id: 'f2', tipo: 'fijo', nombre: 'Corto', categoria: 'Hogar y Materiales', monto: 80000, estimado: true, diaMes: 5, activo: true },
    ],
  };
  const err = await abrir(page, { estado });
  for (const d of '1234') await page.click(`button[data-d="${d}"]`);
  await page.locator('nav.tabs button[data-vista="evolucion"]').click();
  await page.waitForFunction(() => window._ci && window._ci['cF'], null, { timeout: 15000 });
  const labs = await page.evaluate(() => window._ci['cF'].scales.y.ticks.map(t => t.label));
  expect(labs).toContain('Corto');
  expect(labs[0].length).toBeGreaterThan(16);
  expect(err).toEqual([]);
});

test('botón de velocidad de la cinta con padding horizontal amplio', async ({ page }) => {
  await abrir(page);
  for (const d of '1234') await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
  const pad = await page.evaluate(() => parseFloat(getComputedStyle((() => { const b = document.createElement('button'); b.className = 'tk-btn'; document.body.appendChild(b); return b; })()).paddingLeft));
  expect(pad).toBeGreaterThanOrEqual(12);
});

test('con poco ancho el nombre largo sí se recorta con «…»', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  const estado = {
    iniciales: {}, gastos: [], items: [], patrimonioCargado: true,
    compromisos: [{ id: 'f1', tipo: 'fijo', nombre: LARGO, categoria: 'Hogar y Materiales', monto: 300000, estimado: true, diaMes: 5, activo: true }],
  };
  await abrir(page, { estado });
  for (const d of '1234') await page.click(`button[data-d="${d}"]`);
  await page.locator('nav.tabs button[data-vista="evolucion"]').click();
  await page.waitForFunction(() => window._ci && window._ci['cF'], null, { timeout: 15000 });
  const lab = await page.evaluate(() => window._ci['cF'].scales.y.ticks[0].label);
  expect(lab.endsWith('…')).toBe(true);
});
