// @ts-check
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const OJO_KEY = 'finanzas-v1-ocultar';
const TEMA_KEY = 'finanzas-v1-tema';
const TEST_PIN = '1234';

function buildEstadoVinculos() {
  return {
    iniciales: {
      'Banco Santander': 1000000,
      'Mercado Pago': 500000,
      'Efectivo': 100000,
      'Visa Santander': -200000,
      'Mastercard MP': -50000,
      'Astropay': 0,
      'American Express': 0,
    },
    gastos: [],
    items: [
      // Préstamos con personas — nombre largo, importe grande
      {
        id: 'it1', nombre: 'Préstamo personal largo larguísimo nombre de ítem',
        tipo: 'activo', monto: 99999999, grupo: 'Préstamos con personas', persona: 'Alejandrina Bustamante Villanueva',
        historial: [
          { id: 'h1', fecha: '2026-10-01', accion: 'preste', monto: 50000000, medio: 'Banco Santander' },
          { id: 'h2', fecha: '2026-10-10', accion: 'devolvio', monto: 12345678, medio: 'Mercado Pago' },
          { id: 'h3', fecha: '2026-10-15', accion: 'preste', monto: 9999999, medio: 'Efectivo' },
          { id: 'h4', fecha: '2026-10-18', accion: 'devolvio', monto: 1111111, medio: 'Mercado Pago transferencia directa cuenta' },
          { id: 'h5', fecha: '2026-10-20', accion: 'preste', monto: 99999999, medio: 'Banco Santander con descripción muy larga para probar wrap' },
        ],
      },
      {
        id: 'it2', nombre: 'Otro préstamo', tipo: 'pasivo', monto: 55000000,
        grupo: 'Préstamos con personas', persona: 'Alejandrina Bustamante Villanueva',
        historial: [],
      },
      // Segunda persona — nombre corto, importe pequeño
      {
        id: 'it3', nombre: 'Préstamo corto', tipo: 'pasivo', monto: 500000,
        grupo: 'Préstamos con personas', persona: 'Ana',
        historial: [
          { id: 'h6', fecha: '2026-09-01', accion: 'prestoMas', monto: 500000, medio: 'Efectivo' },
        ],
      },
      // Cobro pendiente standalone con persona y historial
      {
        id: 'it4', nombre: 'Cobro pendiente muy largo con texto extensísimo que no debería salir de pantalla',
        tipo: 'activo', monto: 99999999, grupo: 'Cobros pendientes', persona: 'Roberto Carlos Hernández Pérez',
        historial: [
          { id: 'h7', fecha: '2026-10-05', accion: 'cobre', monto: 40000000, neto: 38000000, medio: 'Mercado Pago' },
          { id: 'h8', fecha: '2026-10-12', accion: 'cobre', monto: 25000000, neto: 24000000, medio: 'Transferencia Banco Santander cuenta corriente' },
        ],
      },
    ],
    patrimonioCargado: true,
    compromisos: [],
  };
}

test.describe('vinculos-responsive: sin overflow horizontal en Vínculos a 360/412/450 px', () => {
  let browser;
  test.beforeAll(async () => { browser = await chromium.launch(); });
  test.afterAll(async () => { await browser.close(); });

  async function openVinculos(width, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 } });
    await ctx.addInitScript(({ sk, pk, pin, data, ojoKey, ojoVal, temaKey, temaVal }) => {
      localStorage.setItem(sk, JSON.stringify(data));
      localStorage.setItem(pk, JSON.stringify(pin));
      if (ojoVal) localStorage.setItem(ojoKey, '1');
      if (temaVal) localStorage.setItem(temaKey, temaVal);
    }, {
      sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: buildEstadoVinculos(),
      ojoKey: OJO_KEY, ojoVal: opts.ojo || false,
      temaKey: TEMA_KEY, temaVal: opts.tema || null,
    });
    const page = await ctx.newPage();
    await page.goto(INDEX);
    for (const d of TEST_PIN) {
      await page.locator('.pin-pad button').filter({ hasText: d }).first().click();
    }
    await page.waitForTimeout(300);
    await page.locator('nav.tabs button[data-vista="vinculos"]').click();
    await page.waitForTimeout(200);
    return { page, ctx };
  }

  // helper: opens all <details class="persona"> so historial is visible
  async function abrirTarjetas(page) {
    await page.evaluate(() => {
      document.querySelectorAll('details.persona').forEach(d => { d.open = true; });
    });
    await page.waitForTimeout(100);
  }

  // helper: opens all .vinc-hist details inside #vista-vinculos
  async function abrirHistorial(page) {
    await page.evaluate(() => {
      document.querySelectorAll('#vista-vinculos details.vinc-hist').forEach(d => { d.open = true; });
    });
    await page.waitForTimeout(100);
  }

  // ── Tarjetas plegadas ──────────────────────────────────────────
  test('(a) 360 px — tarjetas plegadas: sin scroll horizontal', async () => {
    const { page, ctx } = await openVinculos(360);
    try {
      const ok = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(ok).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(b) 412 px — tarjetas plegadas: sin scroll horizontal', async () => {
    const { page, ctx } = await openVinculos(412);
    try {
      const ok = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(ok).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(c) 450 px — tarjetas plegadas: sin scroll horizontal', async () => {
    const { page, ctx } = await openVinculos(450);
    try {
      const ok = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(ok).toBe(true);
    } finally { await ctx.close(); }
  });

  // ── Importe en summary siempre visible ────────────────────────
  test('(d) 360 px — importe en summary no desborda su contenedor', async () => {
    const { page, ctx } = await openVinculos(360);
    try {
      const results = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return Array.from(document.querySelectorAll('#vista-vinculos details.persona > summary .estado')).map(el => ({
          text: el.textContent?.trim(),
          right: el.getBoundingClientRect().right,
          vw,
          fits: el.scrollWidth <= el.clientWidth,
        }));
      });
      for (const r of results) {
        expect(r.right, `importe "${r.text}" (right=${r.right}) sale del viewport (${r.vw}px)`).toBeLessThanOrEqual(r.vw + 1);
        expect(r.fits, `importe "${r.text}" desborda su propio contenedor`).toBe(true);
      }
    } finally { await ctx.close(); }
  });

  test('(e) 412 px — importe en summary no desborda su contenedor', async () => {
    const { page, ctx } = await openVinculos(412);
    try {
      const results = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return Array.from(document.querySelectorAll('#vista-vinculos details.persona > summary .estado')).map(el => ({
          text: el.textContent?.trim(),
          right: el.getBoundingClientRect().right,
          vw,
          fits: el.scrollWidth <= el.clientWidth,
        }));
      });
      for (const r of results) {
        expect(r.right, `importe "${r.text}" (right=${r.right}) sale del viewport (${r.vw}px)`).toBeLessThanOrEqual(r.vw + 1);
      }
    } finally { await ctx.close(); }
  });

  // ── Tarjetas desplegadas ───────────────────────────────────────
  test('(f) 360 px — tarjetas desplegadas: sin scroll horizontal', async () => {
    const { page, ctx } = await openVinculos(360);
    try {
      await abrirTarjetas(page);
      const ok = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(ok).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(g) 412 px — tarjetas desplegadas: sin scroll horizontal', async () => {
    const { page, ctx } = await openVinculos(412);
    try {
      await abrirTarjetas(page);
      const ok = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(ok).toBe(true);
    } finally { await ctx.close(); }
  });

  // ── Historial desplegado ───────────────────────────────────────
  test('(h) 360 px — historial desplegado: sin scroll horizontal', async () => {
    const { page, ctx } = await openVinculos(360);
    try {
      await abrirTarjetas(page);
      await abrirHistorial(page);
      const ok = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(ok).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(i) 412 px — historial desplegado: sin scroll horizontal', async () => {
    const { page, ctx } = await openVinculos(412);
    try {
      await abrirTarjetas(page);
      await abrirHistorial(page);
      const ok = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(ok).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(j) 450 px — historial desplegado: sin scroll horizontal', async () => {
    const { page, ctx } = await openVinculos(450);
    try {
      await abrirTarjetas(page);
      await abrirHistorial(page);
      const ok = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(ok).toBe(true);
    } finally { await ctx.close(); }
  });

  // ── Ningún elemento hijo sobresale del viewport ────────────────
  test('(k) 360 px — historial desplegado: ningún elemento desborda el viewport', async () => {
    const { page, ctx } = await openVinculos(360);
    try {
      await abrirTarjetas(page);
      await abrirHistorial(page);
      const offenders = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const vinculos = document.getElementById('vista-vinculos');
        if (!vinculos) return [];
        const all = Array.from(vinculos.querySelectorAll('*'));
        return all
          .filter(el => {
            // Skip elements inside intentional scroll containers
            const style = getComputedStyle(el);
            if (style.overflowX === 'auto' || style.overflowX === 'hidden') return false;
            const r = el.getBoundingClientRect();
            return r.right > vw + 2; // 2px tolerance
          })
          .map(el => ({ tag: el.tagName, cls: el.className, right: Math.round(el.getBoundingClientRect().right), vw }));
      });
      expect(offenders, `Elementos que salen del viewport: ${JSON.stringify(offenders)}`).toHaveLength(0);
    } finally { await ctx.close(); }
  });

  test('(l) 412 px — historial desplegado: ningún elemento desborda el viewport', async () => {
    const { page, ctx } = await openVinculos(412);
    try {
      await abrirTarjetas(page);
      await abrirHistorial(page);
      const offenders = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const vinculos = document.getElementById('vista-vinculos');
        if (!vinculos) return [];
        const all = Array.from(vinculos.querySelectorAll('*'));
        return all
          .filter(el => {
            const style = getComputedStyle(el);
            if (style.overflowX === 'auto' || style.overflowX === 'hidden') return false;
            const r = el.getBoundingClientRect();
            return r.right > vw + 2;
          })
          .map(el => ({ tag: el.tagName, cls: el.className, right: Math.round(el.getBoundingClientRect().right), vw }));
      });
      expect(offenders, `Elementos que salen del viewport: ${JSON.stringify(offenders)}`).toHaveLength(0);
    } finally { await ctx.close(); }
  });

  // ── Botón "Deshacer último" dentro de pantalla ─────────────────
  test('(m) 360 px — botón "Deshacer último" no sale del viewport', async () => {
    const { page, ctx } = await openVinculos(360);
    try {
      await abrirTarjetas(page);
      await abrirHistorial(page);
      const results = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return Array.from(document.querySelectorAll('#vista-vinculos .vinc-hist-undo')).map(el => ({
          right: el.getBoundingClientRect().right,
          vw,
        }));
      });
      for (const r of results) {
        expect(r.right, `botón Deshacer (right=${r.right}) sale del viewport (${r.vw}px)`).toBeLessThanOrEqual(r.vw + 2);
      }
    } finally { await ctx.close(); }
  });

  // ── Modo ojo: oculta importes sin romper layout ─────────────────
  test('(n) 360 px modo ojo — tarjetas plegadas: sin scroll horizontal', async () => {
    const { page, ctx } = await openVinculos(360, { ojo: true });
    try {
      const ok = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(ok).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(o) 360 px modo ojo — historial desplegado: sin scroll horizontal', async () => {
    const { page, ctx } = await openVinculos(360, { ojo: true });
    try {
      await abrirTarjetas(page);
      await abrirHistorial(page);
      const ok = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(ok).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(p) 360 px modo ojo — activar ojo y verificar sin scroll horizontal', async () => {
    const { page, ctx } = await openVinculos(360);
    try {
      await abrirTarjetas(page);
      await abrirHistorial(page);
      // Activate ojo mode via button
      await page.locator('#btnOjo').click();
      await page.waitForTimeout(100);
      const hasClass = await page.evaluate(() => document.body.classList.contains('ocultar'));
      expect(hasClass).toBe(true);
      const ok = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(ok).toBe(true);
    } finally { await ctx.close(); }
  });

  // ── Temas ──────────────────────────────────────────────────────
  test('(q) 360 px tema oscuro — historial desplegado: sin scroll horizontal', async () => {
    const { page, ctx } = await openVinculos(360, { tema: 'oscuro' });
    try {
      await abrirTarjetas(page);
      await abrirHistorial(page);
      const ok = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(ok).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(r) 360 px tema negro — historial desplegado: sin scroll horizontal', async () => {
    const { page, ctx } = await openVinculos(360, { tema: 'negro' });
    try {
      await abrirTarjetas(page);
      await abrirHistorial(page);
      const ok = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(ok).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(s) 360 px tema claro — historial desplegado: sin scroll horizontal', async () => {
    const { page, ctx } = await openVinculos(360, { tema: 'claro' });
    try {
      await abrirTarjetas(page);
      await abrirHistorial(page);
      const ok = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(ok).toBe(true);
    } finally { await ctx.close(); }
  });
});
