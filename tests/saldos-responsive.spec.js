// @ts-check
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const OJO_KEY = 'finanzas-v1-ocultar';
const TEMA_KEY = 'finanzas-v1-tema';
const TEST_PIN = '1234';

// 8-digit balances to stress-test card layout
function buildEstadoGrande() {
  return {
    iniciales: {
      'Banco Santander': 15915760,
      'Mercado Pago': 22503814,
      'Efectivo': 10000000,
      'Visa Santander': -22503814,
      'Mastercard MP': -12345678,
      'Astropay': 0,
      'American Express': 0,
    },
    gastos: [],
    items: [],
    patrimonioCargado: true,
    compromisos: [],
  };
}

test.describe('saldos-responsive: tarjetas "Mis cuentas" sin overflow a 360/390/412 px', () => {
  let browser;
  test.beforeAll(async () => { browser = await chromium.launch(); });
  test.afterAll(async () => { await browser.close(); });

  async function openAt(width, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 } });
    await ctx.addInitScript(({ sk, pk, pin, data, ojoKey, ojoVal, temaKey, temaVal }) => {
      localStorage.setItem(sk, JSON.stringify(data));
      localStorage.setItem(pk, JSON.stringify(pin));
      if (ojoVal) localStorage.setItem(ojoKey, '1');
      if (temaVal) localStorage.setItem(temaKey, temaVal);
    }, {
      sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: buildEstadoGrande(),
      ojoKey: OJO_KEY, ojoVal: opts.ojo || false,
      temaKey: TEMA_KEY, temaVal: opts.tema || null,
    });
    const page = await ctx.newPage();
    await page.goto(INDEX);
    for (const d of TEST_PIN) {
      await page.locator('.pin-pad button').filter({ hasText: d }).first().click();
    }
    await page.waitForTimeout(300);
    // Ensure we're on Inicio tab (default)
    await page.locator('nav.tabs button[data-vista="inicio"]').click();
    await page.waitForTimeout(200);
    return { page, ctx };
  }

  test('(a) a 360 px: sin scroll horizontal en Inicio', async () => {
    const { page, ctx } = await openAt(360);
    try {
      const noHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(noHScroll).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(b) a 360 px: scrollWidth <= clientWidth en cada tarjeta .monto', async () => {
    const { page, ctx } = await openAt(360);
    try {
      const result = await page.evaluate(() => {
        const montos = Array.from(document.querySelectorAll('.saldo .monto'));
        return montos.map(el => ({
          text: el.textContent?.trim(),
          fits: el.scrollWidth <= el.clientWidth,
        }));
      });
      for (const { text, fits } of result) {
        expect(fits, `monto "${text}" desborda`).toBe(true);
      }
    } finally { await ctx.close(); }
  });

  test('(c) a 390 px: sin scroll horizontal en Inicio', async () => {
    const { page, ctx } = await openAt(390);
    try {
      const noHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(noHScroll).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(d) a 390 px: scrollWidth <= clientWidth en cada tarjeta .monto', async () => {
    const { page, ctx } = await openAt(390);
    try {
      const allFit = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.saldo .monto')).every(el => el.scrollWidth <= el.clientWidth)
      );
      expect(allFit).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(e) a 412 px: sin scroll horizontal en Inicio', async () => {
    const { page, ctx } = await openAt(412);
    try {
      const noHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(noHScroll).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(f) a 412 px: scrollWidth <= clientWidth en cada tarjeta .monto', async () => {
    const { page, ctx } = await openAt(412);
    try {
      const allFit = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.saldo .monto')).every(el => el.scrollWidth <= el.clientWidth)
      );
      expect(allFit).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(g) a 360 px: botón "Ajustar saldo" visible en todas las tarjetas', async () => {
    const { page, ctx } = await openAt(360);
    try {
      const allVisible = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.saldo button')).every(
          btn => btn.offsetWidth > 0 && btn.offsetHeight > 0
        )
      );
      expect(allVisible).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(h) a 360 px tema oscuro: sin scroll horizontal', async () => {
    const { page, ctx } = await openAt(360, { tema: 'oscuro' });
    try {
      const noHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(noHScroll).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(i) a 360 px tema negro: sin scroll horizontal', async () => {
    const { page, ctx } = await openAt(360, { tema: 'negro' });
    try {
      const noHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(noHScroll).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(j) a 360 px tema claro: sin scroll horizontal', async () => {
    const { page, ctx } = await openAt(360, { tema: 'claro' });
    try {
      const noHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(noHScroll).toBe(true);
    } finally { await ctx.close(); }
  });

  test('(k) a 360 px modo ojo: sin scroll horizontal', async () => {
    const { page, ctx } = await openAt(360, { ojo: true });
    try {
      const noHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(noHScroll).toBe(true);
    } finally { await ctx.close(); }
  });
});
