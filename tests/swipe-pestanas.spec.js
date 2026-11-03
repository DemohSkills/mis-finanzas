const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const ORDEN = ['inicio', 'gastos', 'compromisos', 'analisis', 'patrimonio', 'vinculos', 'evolucion', 'config'];

async function abrir(page, vista = 'inicio') {
  const err = [];
  page.on('pageerror', e => err.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') err.push(m.text()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ vista }) => {
    localStorage.setItem('finanzas-v1', JSON.stringify({ iniciales: {}, gastos: [], items: [], patrimonioCargado: true }));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    localStorage.setItem('finanzas-v1-vista', vista);
  }, { vista });
  await page.goto(INDEX);
  for (const d of '1234') await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(300);
  return err;
}
const vistaActiva = page => page.evaluate(() => document.querySelector('.tabs button[aria-selected="true"]').dataset.vista);
function swipe(page, x0, y0, x1, y1) {
  return page.evaluate(([x0, y0, x1, y1]) => {
    const mk = (x, y) => new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y });
    const ev = (tipo, x, y, fin) => document.body.dispatchEvent(new TouchEvent(tipo, {
      bubbles: true, cancelable: true,
      touches: fin ? [] : [mk(x, y)], changedTouches: [mk(x, y)],
    }));
    ev('touchstart', x0, y0); ev('touchmove', (x0 + x1) / 2, (y0 + y1) / 2); ev('touchend', x1, y1, true);
  }, [x0, y0, x1, y1]);
}

test('swipe a la izquierda desde el borde derecho avanza en el orden de la barra', async ({ page }) => {
  const err = await abrir(page);
  for (let i = 1; i < ORDEN.length; i++) {
    await swipe(page, 385, 400, 200, 410);
    expect(await vistaActiva(page)).toBe(ORDEN[i]);
    await expect(page.locator('#vista-' + ORDEN[i])).toBeVisible();
  }
  expect(err).toEqual([]);
});

test('swipe a la derecha desde el borde izquierdo retrocede', async ({ page }) => {
  await abrir(page, 'evolucion');
  await swipe(page, 5, 400, 200, 400);
  expect(await vistaActiva(page)).toBe('vinculos');
  await swipe(page, 5, 400, 200, 400);
  expect(await vistaActiva(page)).toBe('patrimonio');
});

test('no pasa de los extremos (primero y último)', async ({ page }) => {
  await abrir(page, 'inicio');
  await swipe(page, 5, 400, 250, 400);
  expect(await vistaActiva(page)).toBe('inicio');
});

test('último tab: swipe a la izquierda no hace nada', async ({ page }) => {
  await abrir(page, 'config');
  await swipe(page, 385, 400, 100, 400);
  expect(await vistaActiva(page)).toBe('config');
});

test('swipe que no empieza en el borde no hace nada', async ({ page }) => {
  await abrir(page);
  await swipe(page, 200, 400, 20, 400);
  expect(await vistaActiva(page)).toBe('inicio');
  await swipe(page, 60, 400, 300, 400);
  expect(await vistaActiva(page)).toBe('inicio');
});

test('gesto corto o mayormente vertical desde el borde no cambia de pestaña', async ({ page }) => {
  await abrir(page, 'gastos');
  await swipe(page, 385, 400, 350, 400); // corto
  expect(await vistaActiva(page)).toBe('gastos');
  await swipe(page, 385, 200, 300, 500); // diagonal vertical
  expect(await vistaActiva(page)).toBe('gastos');
});

test('no rompe el scroll vertical normal con contenido largo', async ({ page }) => {
  await abrir(page, 'gastos');
  await page.evaluate(() => {
    const d = document.createElement('div'); d.id = 'relleno'; d.style.height = '3000px';
    document.getElementById('vista-gastos').appendChild(d);
  });
  await swipe(page, 385, 700, 380, 200); // vertical desde el borde
  expect(await vistaActiva(page)).toBe('gastos');
  await page.mouse.move(200, 400);
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  expect(await vistaActiva(page)).toBe('gastos');
});

test('con un overlay abierto el swipe no actúa y los botones de la barra siguen andando', async ({ page }) => {
  await abrir(page);
  await page.click('.tabs button[data-vista="vinculos"]');
  expect(await vistaActiva(page)).toBe('vinculos');
  await page.evaluate(() => { const o = document.createElement('div'); o.className = 'overlay'; o.id = 'ovTest'; document.body.appendChild(o); });
  await swipe(page, 385, 400, 100, 400);
  expect(await vistaActiva(page)).toBe('vinculos');
  await page.evaluate(() => document.getElementById('ovTest').remove());
  await swipe(page, 385, 400, 100, 400);
  expect(await vistaActiva(page)).toBe('evolucion');
});
