// El micrófono flotante no tapa el final de las pestañas
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const INDEX = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const PIN = '1234';
const items = Array.from({ length: 6 }, (_, i) => ({ id: 'i' + i, nombre: 'Ítem ' + i, monto: 1000 * (i + 1), grupo: 'Cobros pendientes', activo: true, persona: 'Persona ' + (i % 2) }));
const gastos = Array.from({ length: 25 }, (_, i) => ({ id: 'g' + i, creado: i, monto: 100 + i, fecha: '2026-10-' + String(1 + (i % 26)).padStart(2, '0'), categoria: 'Varios', medio: 'Efectivo', descripcion: 'Mov ' + i, tipo: 'gasto', soloHistorial: false }));
const estado = { iniciales: { 'Mercado Pago': 0, 'Banco Santander': 0, 'Efectivo': 0 }, gastos, items, compromisos: [], patrimonioCargado: true,
  cobrosSemanales: [{ id: 'cs1', nombre: 'Meli Extra', persona: 'Meli Envíos', medioCobro: 'Mercado Pago', entradas: [{ id: 'e1', fecha: '2026-10-26', monto: 5000, tipo: 'dia' }], cobradas: [] }] };

async function abrir(page, tema) {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.clock.setFixedTime(new Date('2026-10-27T12:00:00'));
  await page.addInitScript(({ est, pin, tema }) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(est));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify(pin));
    localStorage.setItem('finanzas-v1-tema', JSON.stringify(tema));
  }, { est: estado, pin: PIN, tema });
  await page.goto(INDEX);
  for (const d of PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

for (const tema of ['neon-azul', 'claro']) {
  for (const [tab, vista] of [['Patrimonio', 'patrimonio'], ['Vínculos', 'vinculos'], ['Movimientos', 'gastos']]) {
    test(`${tab}: al final del scroll todo queda sobre el micrófono (${tema})`, async ({ page }) => {
      await abrir(page, tema);
      await page.locator('[role=tab]', { hasText: tab }).click();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const r = await page.evaluate(v => {
        const main = document.querySelector('main');
        const pb = parseFloat(getComputedStyle(main).paddingBottom);
        const fab = document.getElementById('btnVoz').getBoundingClientRect();
        const kids = [...document.getElementById('vista-' + v).querySelectorAll('*')].filter(e => e.getBoundingClientRect().height > 0);
        const fondo = Math.max(...kids.map(e => e.getBoundingClientRect().bottom));
        return { pb, fabTop: fab.top, fabH: fab.height, fondo };
      }, vista);
      expect(r.pb).toBeGreaterThanOrEqual(r.fabH + 16 + 24);
      expect(r.fondo).toBeLessThanOrEqual(r.fabTop - 24 + 1);
      await page.screenshot({ path: path.resolve(__dirname, '..', 'capturas-tmp', `t3-${vista}-fondo-${tema}.png`) });
    });
  }
}
