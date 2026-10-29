// Ganancia bruta del mes: las etiquetas largas envuelven en dos renglones, sin "…" y sin mover barra ni monto
const { test, expect } = require('@playwright/test');
const path = require('path');
const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const ing = (id, fecha, monto, categoria, extra = {}) => ({ id, tipo: 'ingreso', fecha, monto, medio: 'Banco Santander', categoria, descripcion: 'x ' + id, ...extra });
const GASTOS = [
  ing('a', '2026-10-05', 900000, 'Sueldo/Honorarios'),
  ing('b', '2026-10-06', 500000, 'Ingresos extras'),
  ing('c', '2026-10-07', 300000, 'Otros ingresos'),
  ing('d', '2026-10-08', 100000, 'Rendimientos'),
  ing('e', '2026-10-09', 50000, 'Transferencia recibida', { proposito: 'otro-trabajo' }),
];
const estado = { iniciales: { 'Banco Santander': 0, 'Mercado Pago': 0, 'Efectivo': 0 }, gastos: GASTOS, items: [], compromisos: [], patrimonioCargado: true };

for (const ancho of [390, 360]) {
  for (const tema of ['neon-azul', 'claro']) {
    test(`etiquetas completas a ${ancho}px (${tema})`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 900 });
      await page.clock.setFixedTime(new Date('2026-10-27T12:00:00'));
      await page.addInitScript(({ est, tema }) => {
        localStorage.setItem('finanzas-v1', JSON.stringify(est));
        localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
        localStorage.setItem('finanzas-v1-tema', JSON.stringify(tema));
      }, { est: estado, tema });
      await page.goto(INDEX);
      for (const d of '1234') await page.click(`button[data-d="${d}"]`);
      await page.waitForSelector('#pinScr', { state: 'hidden' });
      const filas = page.locator('#ganCard .gan-row');
      await expect(filas).toHaveCount(5);
      const r = await filas.evaluateAll(rows => rows.map(row => {
        const n = row.querySelector('.gm-nom'), b = row.querySelector('.gm-bar'), cs = getComputedStyle(n);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        return { txt: n.textContent, ellipsis: cs.textOverflow === 'ellipsis', corta: n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1,
          lineas: Math.round(n.getBoundingClientRect().height / lh), barX: b.getBoundingClientRect().left, barW: b.getBoundingClientRect().width };
      }));
      for (const x of r) { expect(x.ellipsis).toBe(false); expect(x.corta).toBe(false); expect(x.lineas).toBeLessThanOrEqual(2); }
      // la barra no se mueve entre filas
      expect(new Set(r.map(x => Math.round(x.barX))).size).toBe(1);
      await page.locator('#ganCard').screenshot({ path: path.resolve(__dirname, '..', 'capturas-tmp', `t4-ganancia-${ancho}-${tema}.png`) });
    });
  }
}
