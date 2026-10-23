/**
 * Tests Tarea inicio-compacto:
 *  1. Botón 🔄 en cabecera al lado del ojo, mismo tamaño, ya no en ⚙️
 *  2. Cinta presente en Inicio (entre solapas y Mis cuentas) y en Evolución; ids únicos
 *  3. Efectivo a ancho completo, última del grupo Activos, importe centrado
 *  4. Sin overflow horizontal a 360, 412 y 450 px
 *  5. A 450×907, scrollHeight <= viewport en Inicio (sin aviso de backup)
 *  6. Al final del scroll el botón de voz no tapa .stat ni botones Transferir/Pagar tarjeta
 *  7. Modo ojo oculta importes y valores de cinta en Inicio
 */
// @ts-check
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const OJO_KEY = 'finanzas-v1-ocultar';
const TEST_PIN = '1234';
const BACKUP_META_K = 'finanzas-v1-backup-meta';

function buildEstado() {
  return {
    iniciales: {
      'Banco Santander': 120000,
      'Mercado Pago': 85000,
      'Efectivo': 45000,
      'Visa Santander': -62000,
      'Mastercard MP': -28000,
      'Astropay': 0,
      'American Express': 0,
    },
    gastos: [],
    items: [],
    patrimonioCargado: true,
    compromisos: [],
    importaciones: {},
  };
}

/** Seed datos ficticios y desbloquear con PIN */
async function openAt(browser, width, height, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript(({ sk, pk, pin, data, ojoKey, ojoVal, backupKey, backupTs }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    // Suprimir aviso de backup (backup reciente)
    localStorage.setItem(backupKey, JSON.stringify({ ts: backupTs, method: 'descargado' }));
    if (ojoVal) localStorage.setItem(ojoKey, JSON.stringify(true));
  }, {
    sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: buildEstado(),
    ojoKey: OJO_KEY, ojoVal: opts.ojo || false,
    backupKey: BACKUP_META_K, backupTs: new Date().toISOString(),
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(INDEX);
  for (const d of TEST_PIN) {
    await page.locator('.pin-pad button').filter({ hasText: d }).first().click();
  }
  await page.waitForTimeout(400);
  await page.locator('nav.tabs button[data-vista="inicio"]').click();
  await page.waitForTimeout(300);
  return { page, ctx, errors };
}

test.describe('inicio-compacto: botón Actualizar en cabecera', () => {
  let browser;
  test.beforeAll(async () => { browser = await chromium.launch(); });
  test.afterAll(async () => { await browser.close(); });

  test('(a) #btnActualizarApp está en .app-hdr y es visible', async () => {
    const { page, ctx } = await openAt(browser, 450, 907);
    try {
      await expect(page.locator('.app-hdr #btnActualizarApp')).toBeVisible();
    } finally { await ctx.close(); }
  });

  test('(b) #btnActualizarApp aparece antes que #btnOjo en el DOM', async () => {
    const { page, ctx } = await openAt(browser, 450, 907);
    try {
      const order = await page.evaluate(() => {
        const hdr = document.querySelector('.app-hdr');
        const btns = Array.from(hdr.querySelectorAll('button'));
        return {
          iAct: btns.findIndex(b => b.id === 'btnActualizarApp'),
          iOjo: btns.findIndex(b => b.id === 'btnOjo'),
        };
      });
      expect(order.iAct).toBeGreaterThanOrEqual(0);
      expect(order.iOjo).toBeGreaterThanOrEqual(0);
      expect(order.iAct).toBeLessThan(order.iOjo);
    } finally { await ctx.close(); }
  });

  test('(c) #btnActualizarApp tiene mismo tamaño que #btnOjo', async () => {
    const { page, ctx } = await openAt(browser, 450, 907);
    try {
      const sizes = await page.evaluate(() => {
        const act = document.getElementById('btnActualizarApp');
        const ojo = document.getElementById('btnOjo');
        if (!act || !ojo) return null;
        const ra = act.getBoundingClientRect();
        const ro = ojo.getBoundingClientRect();
        return { wAct: Math.round(ra.width), hAct: Math.round(ra.height), wOjo: Math.round(ro.width), hOjo: Math.round(ro.height) };
      });
      expect(sizes).not.toBeNull();
      // Mismo tamaño ±4px (los emojis pueden diferir mínimamente)
      expect(Math.abs(sizes.wAct - sizes.wOjo)).toBeLessThanOrEqual(4);
      expect(Math.abs(sizes.hAct - sizes.hOjo)).toBeLessThanOrEqual(4);
    } finally { await ctx.close(); }
  });

  test('(d) #btnActualizarApp NO está suelto en la sección ⚙️', async () => {
    const { page, ctx } = await openAt(browser, 450, 907);
    try {
      await page.locator('nav.tabs button[data-vista="config"]').click();
      await page.waitForTimeout(200);
      const inCfg = await page.locator('#vista-config button#btnActualizarApp').count();
      expect(inCfg).toBe(0);
    } finally { await ctx.close(); }
  });
});

test.describe('inicio-compacto: cinta en Inicio y Evolución, ids únicos', () => {
  let browser;
  test.beforeAll(async () => { browser = await chromium.launch(); });
  test.afterAll(async () => { await browser.close(); });

  test('(e) #tickerInicio existe en la vista Inicio con ítems', async () => {
    const { page, ctx } = await openAt(browser, 450, 907);
    try {
      await expect(page.locator('#tickerInicio')).toBeVisible();
      const count = await page.locator('#tickerInicio .tk-item').count();
      expect(count).toBeGreaterThan(0);
    } finally { await ctx.close(); }
  });

  test('(f) #tickerInicio aparece entre las solapas y la sección .saldos-top', async () => {
    const { page, ctx } = await openAt(browser, 450, 907);
    try {
      const positions = await page.evaluate(() => {
        const ticker = document.getElementById('tickerInicio');
        const saldos = document.querySelector('.saldos-top');
        if (!ticker || !saldos) return null;
        const rt = ticker.getBoundingClientRect();
        const rs = saldos.getBoundingClientRect();
        return { tickerBottom: rt.bottom, saldosTop: rs.top };
      });
      expect(positions).not.toBeNull();
      expect(positions.tickerBottom).toBeLessThanOrEqual(positions.saldosTop + 2);
    } finally { await ctx.close(); }
  });

  test('(g) #tickerEvol también tiene ítems en la vista Evolución', async () => {
    const { page, ctx } = await openAt(browser, 450, 907);
    try {
      await page.locator('nav.tabs button[data-vista="evolucion"]').click();
      await page.waitForTimeout(600);
      await expect(page.locator('#tickerEvol')).toBeVisible();
      const count = await page.locator('#tickerEvol .tk-item').count();
      expect(count).toBeGreaterThan(0);
    } finally { await ctx.close(); }
  });

  test('(h) no hay ids duplicados tkTrack ni tkModeBtn en el DOM', async () => {
    const { page, ctx } = await openAt(browser, 450, 907);
    try {
      const dupes = await page.evaluate(() => ({
        tkTrack: document.querySelectorAll('#tkTrack').length,
        tkModeBtn: document.querySelectorAll('#tkModeBtn').length,
      }));
      expect(dupes.tkTrack).toBe(0);
      expect(dupes.tkModeBtn).toBe(0);
    } finally { await ctx.close(); }
  });
});

test.describe('inicio-compacto: Efectivo full-width, último en Activos', () => {
  let browser;
  test.beforeAll(async () => { browser = await chromium.launch(); });
  test.afterAll(async () => { await browser.close(); });

  test('(i) la tarjeta Efectivo tiene clase saldo-full (ancho completo)', async () => {
    const { page, ctx } = await openAt(browser, 450, 907);
    try {
      const hasFull = await page.evaluate(() => {
        const caja = Array.from(document.querySelectorAll('.saldo'))
          .find(el => el.querySelector('.nombre')?.textContent.trim() === 'Efectivo');
        return caja ? caja.classList.contains('saldo-full') : false;
      });
      expect(hasFull).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(j) la tarjeta Efectivo es la última del grupo Activos en el DOM', async () => {
    const { page, ctx } = await openAt(browser, 450, 907);
    try {
      const isLast = await page.evaluate(() => {
        // Buscar el título ACTIVOS y colectar lo que sigue hasta DEUDAS
        const titulos = Array.from(document.querySelectorAll('.saldo-grupo-titulo'));
        const activosTitle = titulos.find(el => el.textContent.trim() === 'ACTIVOS');
        if (!activosTitle) return false;
        // Recolectar saldos entre ACTIVOS y DEUDAS
        const all = Array.from(document.querySelectorAll('#saldos > *'));
        const iAct = all.indexOf(activosTitle);
        const deudas = titulos.find(el => el.textContent.trim() === 'DEUDAS');
        const iDeud = deudas ? all.indexOf(deudas) : all.length;
        const activosItems = all.slice(iAct + 1, iDeud).filter(el => el.classList.contains('saldo'));
        if (!activosItems.length) return false;
        const lastCard = activosItems[activosItems.length - 1];
        return lastCard.querySelector('.nombre')?.textContent.trim() === 'Efectivo';
      });
      expect(isLast).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(k) el importe de Efectivo está centrado entre nombre y botón', async () => {
    const { page, ctx } = await openAt(browser, 450, 907);
    try {
      const centered = await page.evaluate(() => {
        const caja = Array.from(document.querySelectorAll('.saldo.saldo-full'))
          .find(el => el.querySelector('.nombre')?.textContent.trim() === 'Efectivo');
        if (!caja) return false;
        const monto = caja.querySelector('.monto');
        return monto ? window.getComputedStyle(monto).textAlign === 'center' : false;
      });
      expect(centered).toBe(true);
    } finally { await ctx.close(); }
  });
});

test.describe('inicio-compacto: sin overflow horizontal', () => {
  let browser;
  test.beforeAll(async () => { browser = await chromium.launch(); });
  test.afterAll(async () => { await browser.close(); });

  for (const width of [360, 412, 450]) {
    test(`(l) a ${width}px sin scroll horizontal en Inicio`, async () => {
      const { page, ctx } = await openAt(browser, width, 844);
      try {
        const noHScroll = await page.evaluate(() =>
          document.documentElement.scrollWidth <= document.documentElement.clientWidth
        );
        expect(noHScroll).toBe(true);
      } finally { await ctx.close(); }
    });
  }
});

test.describe('inicio-compacto: cabe en 450×907 sin scroll', () => {
  let browser;
  test.beforeAll(async () => { browser = await chromium.launch(); });
  test.afterAll(async () => { await browser.close(); });

  test('(m) a 450×907 con datos ficticios el scrollHeight <= 907 en Inicio (sin aviso de backup)', async () => {
    const { page, ctx } = await openAt(browser, 450, 907);
    try {
      const scrollH = await page.evaluate(() => document.documentElement.scrollHeight);
      expect(scrollH).toBeLessThanOrEqual(907);
    } finally { await ctx.close(); }
  });
});

test.describe('inicio-compacto: botón voz no tapa contenido al final del scroll', () => {
  let browser;
  test.beforeAll(async () => { browser = await chromium.launch(); });
  test.afterAll(async () => { await browser.close(); });

  test('(n) al scrollear al final el #btnVoz no se superpone con .stat ni los botones de acción', async () => {
    const { page, ctx } = await openAt(browser, 450, 844);
    try {
      // Scroll al final
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(150);

      const ok = await page.evaluate(() => {
        const fab = document.getElementById('btnVoz');
        if (!fab) return true;
        const fr = fab.getBoundingClientRect();
        // Verificar .stat
        const stats = Array.from(document.querySelectorAll('.stat'));
        for (const el of stats) {
          const r = el.getBoundingClientRect();
          if (r.bottom < 0 || r.top > window.innerHeight) continue; // fuera del viewport
          const overlap = !(fr.right < r.left || fr.left > r.right || fr.bottom < r.top || fr.top > r.bottom);
          if (overlap) return false;
        }
        // Verificar botones Transferir / Pagar tarjeta
        const btns = [
          document.getElementById('btnTransferirInicio'),
          document.getElementById('btnPagarTarjetaInicio'),
        ].filter(Boolean);
        for (const el of btns) {
          const r = el.getBoundingClientRect();
          if (r.bottom < 0 || r.top > window.innerHeight) continue;
          const overlap = !(fr.right < r.left || fr.left > r.right || fr.bottom < r.top || fr.top > r.bottom);
          if (overlap) return false;
        }
        return true;
      });
      expect(ok).toBe(true);
    } finally { await ctx.close(); }
  });
});

test.describe('inicio-compacto: modo ojo oculta importes en Inicio', () => {
  let browser;
  test.beforeAll(async () => { browser = await chromium.launch(); });
  test.afterAll(async () => { await browser.close(); });

  test('(o) con modo ojo activo los importes .amt en Inicio no son visibles', async () => {
    const { page, ctx } = await openAt(browser, 450, 907, { ojo: true });
    try {
      const anyVisible = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#vista-inicio .amt')).some(el => {
          const cs = getComputedStyle(el);
          return parseFloat(cs.fontSize) > 0;
        })
      );
      expect(anyVisible).toBe(false);
    } finally { await ctx.close(); }
  });

  test('(p) con modo ojo activo los .tk-val de la cinta en Inicio no son visibles', async () => {
    const { page, ctx } = await openAt(browser, 450, 907, { ojo: true });
    try {
      const anyVisible = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#tickerInicio .tk-val')).some(el =>
          getComputedStyle(el).display !== 'none'
        )
      );
      expect(anyVisible).toBe(false);
    } finally { await ctx.close(); }
  });
});
