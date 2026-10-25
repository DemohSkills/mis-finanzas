// @ts-check
// Avisos en Inicio para comprar y pagar los dólares MEP de la Visa (datos de ejemplo)
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const AK = 'finanzas-v1-usd-aviso';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

// Lunes 26/10/2026 y sábado 24/10/2026 (hora local del dispositivo)
const lun = (h, m = 0) => new Date(2026, 9, 26, h, m, 0);
const sab = (h, m = 0) => new Date(2026, 9, 24, h, m, 0);

function buildEstado(extra = {}) {
  return {
    iniciales: { 'Banco Santander': 500000, 'Visa Santander': -200000 },
    gastos: [], items: [], patrimonioCargado: true,
    compromisos: [{
      id: 'cr-usd', nombre: 'Visa 4321', entidad: 'Visa Santander',
      monto: 100000, pagoMinimo: 20000, pendientes: 1,
      proxVenc: '2026-10-30', tipo: 'resumen', cierre: '2026-10-01',
      estimado: false, usd: 50, usdPagado: false, ...extra,
    }],
  };
}

async function abrir(page, ahora, estado, opts = {}) {
  await page.addInitScript(({ sk, pk, pin, data, theme, vib, activ }) => {
    if (!localStorage.getItem('__seeded')) {
      localStorage.setItem(sk, JSON.stringify(data));
      localStorage.setItem(pk, JSON.stringify(pin));
      if (theme) localStorage.setItem('finanzas-v1-tema', JSON.stringify(theme));
      localStorage.setItem('__seeded', '1');
    }
    window.__vib = [];
    if (vib) navigator.vibrate = (p) => { window.__vib.push(p); return true; };
    if (activ === false) Object.defineProperty(navigator, 'userActivation', { get: () => ({ hasBeenActive: false }) });
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado, theme: opts.theme, vib: opts.vib, activ: opts.activ });
  await page.clock.install({ time: ahora });
  await page.goto(INDEX);
  if (opts.sinPin) return;
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}
const EM = '#overlayUsdHora';
const BC = '#bannerUsdComprar_cr-usd';
const BP = '#bannerUsdPagar_cr-usd';
const avisoCfg = (page) => page.evaluate(k => JSON.parse(localStorage.getItem(k)), AK);
const tick = (page, ms = 60000) => page.clock.runFor(ms);

test.describe('usd-aviso: días de mercado', () => {
  test('cuenta lun–vie hasta el día anterior al vencimiento; hoy solo antes de las 16', async ({ page }) => {
    await abrir(page, lun(17), buildEstado());
    const calc = (venc, d) => page.evaluate(([v, t]) => diasMercadoUsd(v, new Date(t)), [venc, d.getTime()]);
    expect(await calc('2026-10-30', lun(11))).toBe(4);   // lun, mar, mié, jue
    expect(await calc('2026-10-30', lun(15, 59))).toBe(4);
    expect(await calc('2026-10-30', lun(16))).toBe(3);   // hoy ya no cuenta
    expect(await calc('2026-10-30', sab(11))).toBe(4);   // sábado: lun a jue
    expect(await calc('2026-10-26', lun(11))).toBe(0);   // vence hoy
    expect(await calc('2026-11-02', sab(11))).toBe(5);   // lun a vie
    expect(await calc('2026-10-20', lun(11))).toBe(0);   // vencido
  });
});

test.describe('usd-aviso: banner de falta comprar', () => {
  test('amarillo con más de 2 días de mercado', async ({ page }) => {
    await abrir(page, lun(17), buildEstado());
    const b = page.locator(BC);
    await expect(b).toBeVisible();
    await expect(b).toContainText('Falta comprar US$ 50 (dólar MEP) · Visa 4321 vence 30/10 · quedan 3 días de mercado');
    await expect(b).not.toHaveClass(/danger/);
    await expect(b.locator('.amt')).toHaveText('50');
  });

  test('rojo con 2 días de mercado o menos', async ({ page }) => {
    await abrir(page, lun(17), buildEstado({ proxVenc: '2026-10-29' }));
    await expect(page.locator(BC)).toHaveClass(/danger/);
    await expect(page.locator(BC)).toContainText('quedan 2 días de mercado');
  });

  test('singular con 1 día', async ({ page }) => {
    await abrir(page, lun(17), buildEstado({ proxVenc: '2026-10-28' }));
    await expect(page.locator(BC)).toContainText('quedan 1 día de mercado');
  });

  test('vencido: rojo y texto propio', async ({ page }) => {
    await abrir(page, lun(17), buildEstado({ proxVenc: '2026-10-20' }));
    await expect(page.locator(BC)).toHaveClass(/danger/);
    await expect(page.locator(BC)).toContainText('Los US$ 50 de Visa 4321 no figuran como comprados · venció el 20/10');
  });

  test('fin de semana: "el mercado abre el lunes"', async ({ page }) => {
    await abrir(page, sab(12), buildEstado());
    await expect(page.locator(BC)).toContainText('el mercado abre el lunes');
    await expect(page.locator(BC)).not.toContainText('quedan');
  });

  test('fuera de la ventana de 7 días no hay aviso', async ({ page }) => {
    await abrir(page, lun(17), buildEstado({ proxVenc: '2026-11-20' }));
    await expect(page.locator(BC)).toHaveCount(0);
  });

  test('está antes del banner de backup', async ({ page }) => {
    await abrir(page, lun(17), buildEstado());
    const orden = await page.evaluate(() => [...document.querySelector('#vista-inicio').children].map(e => e.id).slice(0, 3));
    expect(orden[0]).toBe('avisosUsd');
    const iBackup = orden.indexOf('bannerBackup');
    if (iBackup >= 0) expect(iBackup).toBeGreaterThan(0);
  });

  test('"Ya compré los USD" abre el modal de compra', async ({ page }) => {
    await abrir(page, lun(17), buildEstado());
    await page.locator(`${BC} button:has-text("Ya compré los USD")`).click();
    await expect(page.locator('#compraUsdModal')).toBeVisible();
  });

  test('guardar la compra saca el banner y pasa al aviso 2', async ({ page }) => {
    await abrir(page, lun(17), buildEstado());
    await page.locator(`${BC} button:has-text("Ya compré los USD")`).click();
    await page.locator('#compraUsdForm button[type="submit"]').click();
    await expect(page.locator(BC)).toHaveCount(0);
    await expect(page.locator(BP)).toBeVisible();
  });

  test('"Después (hasta mañana)" oculta hoy y vuelve al día siguiente', async ({ page }) => {
    await abrir(page, lun(17), buildEstado());
    await page.locator(`${BC} button:has-text("Después")`).click();
    await expect(page.locator(BC)).toHaveCount(0);
    expect((await avisoCfg(page)).silenciadoComprar).toBe('2026-10-26');
    await tick(page);
    await expect(page.locator(BC)).toHaveCount(0);
    await page.clock.fastForward('24:00:00');
    await tick(page);
    await expect(page.locator(BC)).toBeVisible();
  });
});

test.describe('usd-aviso: emergente', () => {
  test('aparece a las 11:00 con título, texto y tres botones', async ({ page }) => {
    await abrir(page, lun(11, 0), buildEstado());
    const e = page.locator(EM);
    await expect(e).toBeVisible();
    await expect(e).toContainText('💵 Es hora de comprar los dólares');
    await expect(e).toContainText('Hoy es lunes y el mercado está abierto hasta las 16:00. Faltan US$ 50 para Visa 4321 (vence el 30/10).');
    await expect(e.locator('button')).toHaveCount(3);
  });

  test('no aparece a las 10:59 y aparece al llegar a las 11:00', async ({ page }) => {
    await abrir(page, lun(10, 59), buildEstado());
    await expect(page.locator(EM)).toHaveCount(0);
    await tick(page);
    await expect(page.locator(EM)).toBeVisible();
  });

  test('no aparece a las 16:00', async ({ page }) => {
    await abrir(page, lun(16, 0), buildEstado());
    await expect(page.locator(EM)).toHaveCount(0);
  });

  test('no aparece en fin de semana', async ({ page }) => {
    await abrir(page, sab(12), buildEstado());
    await expect(page.locator(EM)).toHaveCount(0);
    await tick(page, 5 * 60000);
    await expect(page.locator(EM)).toHaveCount(0);
  });

  test('se repite a los 30 minutos si se lo ignora', async ({ page }) => {
    await abrir(page, lun(11, 0), buildEstado());
    await expect(page.locator(EM)).toBeVisible();
    await page.keyboard.press('Escape');            // cerrar = recordármelo
    await expect(page.locator(EM)).toHaveCount(0);
    await tick(page, 29 * 60000);
    await expect(page.locator(EM)).toHaveCount(0);
    await tick(page, 2 * 60000);
    await expect(page.locator(EM)).toBeVisible();
  });

  test('"Recordámelo en 30 min" cierra y reprograma', async ({ page }) => {
    await abrir(page, lun(11, 0), buildEstado());
    await page.locator('#usdEmRecordar').click();
    await expect(page.locator(EM)).toHaveCount(0);
    const prox = new Date((await avisoCfg(page)).proxEmergente).getTime();
    expect(prox - lun(11, 0).getTime()).toBeGreaterThanOrEqual(29 * 60000);
    await expect(page.locator(BC)).toBeVisible();     // el banner sigue
  });

  test('"Hoy no hay mercado" silencia el día y reaparece al siguiente', async ({ page }) => {
    await abrir(page, lun(11, 0), buildEstado());
    await page.locator('#usdEmNoMercado').click();
    await expect(page.locator(EM)).toHaveCount(0);
    await expect(page.locator(BC)).toBeVisible();      // el banner sigue visible
    const cfg = await avisoCfg(page);
    expect(cfg.silenciadoEmergente).toBe('2026-10-26');
    expect(cfg.silenciadoComprar || null).toBeNull();
    await tick(page, 60 * 60000);
    await expect(page.locator(EM)).toHaveCount(0);
    await expect(page.locator(BC)).toBeVisible();
    await page.clock.fastForward('24:00:00');          // martes 12:00
    await tick(page);
    await expect(page.locator(BC)).toBeVisible();
    await expect(page.locator(EM)).toBeVisible();
  });

  test('"Después" del banner también silencia el emergente', async ({ page }) => {
    await abrir(page, lun(17), buildEstado());
    await page.locator(`${BC} button:has-text("Después")`).click();
    await page.clock.setSystemTime(lun(12));
    await tick(page);
    await expect(page.locator(EM)).toHaveCount(0);
  });

  test('"Ya compré los USD" cierra y abre el modal de compra', async ({ page }) => {
    await abrir(page, lun(11, 0), buildEstado());
    await page.locator('#usdEmCompre').click();
    await expect(page.locator(EM)).toHaveCount(0);
    await expect(page.locator('#compraUsdModal')).toBeVisible();
  });

  test('no aparece con otro overlay abierto; aparece al cerrarlo', async ({ page }) => {
    await abrir(page, lun(10, 59), buildEstado());
    await page.evaluate(() => document.getElementById('compModal').removeAttribute('hidden'));
    await tick(page);
    await expect(page.locator(EM)).toHaveCount(0);
    await page.evaluate(() => document.getElementById('compModal').setAttribute('hidden', ''));
    await tick(page);
    await expect(page.locator(EM)).toBeVisible();
  });

  test('no aparece con el PIN visible', async ({ page }) => {
    await abrir(page, lun(11, 0), buildEstado(), { sinPin: true });
    await expect(page.locator('#pinScr')).toBeVisible();
    await tick(page, 3 * 60000);
    await expect(page.locator(EM)).toHaveCount(0);
  });

  test('no aparece con la voz grabando ni mostrando confirmación', async ({ page }) => {
    await abrir(page, lun(10, 59), buildEstado());
    await page.evaluate(() => document.getElementById('btnVoz').classList.add('listening'));
    await tick(page);
    await expect(page.locator(EM)).toHaveCount(0);
    await page.evaluate(() => {
      document.getElementById('btnVoz').classList.remove('listening');
      document.getElementById('voiceConfirm').hidden = false;
    });
    await tick(page);
    await expect(page.locator(EM)).toHaveCount(0);
    await page.evaluate(() => { document.getElementById('voiceConfirm').hidden = true; });
    await tick(page);
    await expect(page.locator(EM)).toBeVisible();
  });

  test('vibra solo con activación previa del usuario', async ({ page }) => {
    await abrir(page, lun(11, 0), buildEstado(), { vib: true });
    await expect(page.locator(EM)).toBeVisible();
    expect(await page.evaluate(() => window.__vib)).toEqual([[250, 120, 250]]);
  });

  test('no vibra sin activación previa y sin errores', async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await abrir(page, lun(11, 0), buildEstado(), { vib: true, activ: false });
    await expect(page.locator(EM)).toBeVisible();
    expect(await page.evaluate(() => window.__vib)).toEqual([]);
    expect(errs).toEqual([]);
  });

  test('con varios resúmenes el emergente es del más urgente', async ({ page }) => {
    const est = buildEstado();
    est.compromisos.push({ ...est.compromisos[0], id: 'cr-otro', nombre: 'Visa 9999', proxVenc: '2026-10-28', usd: 70 });
    await abrir(page, lun(11, 0), est);
    await expect(page.locator(EM)).toContainText('Visa 9999');
    await expect(page.locator('#avisosUsd .backup-warn')).toHaveCount(2);
  });
});

test.describe('usd-aviso: comprados, falta pagarlos', () => {
  const compra = { usd: 50, cotizacion: 1200, pesos: 60000, fecha: '2026-10-25' };

  test('solo banner, sin emergente; amarillo con más de 2 días', async ({ page }) => {
    await abrir(page, lun(11, 0), buildEstado({ usdCompra: compra }));
    const b = page.locator(BP);
    await expect(b).toContainText('💳 Tenés US$ 50 comprados: pagalos a la Visa junto con los pesos antes del 30/10 · quedan 4 días');
    await expect(b).not.toHaveClass(/danger/);
    await expect(b.locator('.amt')).toHaveText('50');
    await expect(page.locator(EM)).toHaveCount(0);
    await expect(page.locator(BC)).toHaveCount(0);
  });

  test('rojo con 2 días o menos y vencido', async ({ page }) => {
    await abrir(page, lun(11, 0), buildEstado({ usdCompra: compra, proxVenc: '2026-10-28' }));
    await expect(page.locator(BP)).toHaveClass(/danger/);
    await expect(page.locator(BP)).toContainText('quedan 2 días');
  });

  test('vencido muestra "venció el"', async ({ page }) => {
    await abrir(page, lun(11, 0), buildEstado({ usdCompra: compra, proxVenc: '2026-10-20' }));
    await expect(page.locator(BP)).toHaveClass(/danger/);
    await expect(page.locator(BP)).toContainText('venció el 20/10');
    await expect(page.locator(BP)).toContainText('pagalos a la Visa junto con los pesos · venció el 20/10');
    await expect(page.locator(BP)).not.toContainText('antes del');
  });

  test('sin vencer conserva "antes del" y los días que quedan', async ({ page }) => {
    await abrir(page, lun(11, 0), buildEstado({ usdCompra: compra }));
    await expect(page.locator(BP)).toContainText('pagalos a la Visa junto con los pesos antes del 30/10 · quedan 4 días');
  });

  test('valores viejos de la clave (sin silenciadoEmergente) siguen funcionando', async ({ page }) => {
    await page.addInitScript((k) => {
      if (!localStorage.getItem('__seeded')) localStorage.setItem(k, JSON.stringify({ silenciadoComprar: null, silenciadoPagar: null, proxEmergente: null }));
    }, AK);
    await abrir(page, lun(11, 0), buildEstado());
    await expect(page.locator(EM)).toBeVisible();
    await expect(page.locator(BC)).toBeVisible();
  });

  test('"Ya pagué los USD" saca el banner; deshacer lo trae de vuelta', async ({ page }) => {
    await abrir(page, lun(11, 0), buildEstado({ usdCompra: compra }));
    await page.locator(`${BP} button:has-text("Ya pagué los USD")`).click();
    await expect(page.locator(BP)).toHaveCount(0);
    await page.evaluate(() => deshacerUsd('cr-usd'));
    await expect(page.locator(BP)).toBeVisible();
  });

  test('"Después (hasta mañana)" silencia hoy y vuelve mañana', async ({ page }) => {
    await abrir(page, lun(11, 0), buildEstado({ usdCompra: compra }));
    await page.locator(`${BP} button:has-text("Después")`).click();
    await expect(page.locator(BP)).toHaveCount(0);
    expect((await avisoCfg(page)).silenciadoPagar).toBe('2026-10-26');
    await page.clock.fastForward('24:00:00');
    await tick(page);
    await expect(page.locator(BP)).toBeVisible();
  });

  test('deshacer la compra vuelve al aviso de comprar', async ({ page }) => {
    await abrir(page, lun(17), buildEstado({ usdCompra: compra }));
    await page.evaluate(() => deshacerCompraUsd('cr-usd'));
    await expect(page.locator(BP)).toHaveCount(0);
    await expect(page.locator(BC)).toBeVisible();
  });
});

test.describe('usd-aviso: chip del resumen', () => {
  test('el chip indica "lun–vie 11 a 16 hs"', async ({ page }) => {
    await abrir(page, lun(17), buildEstado());
    await page.locator('nav.tabs button[data-vista="compromisos"]').click();
    await expect(page.locator('.comp-row[data-id="cr-usd"] .chip-usd')).toContainText('dólar MEP, lun–vie 11 a 16 hs');
  });
});

test.describe('usd-aviso: layout y consola', () => {
  for (const tema of ['auto', 'claro', 'oscuro', 'negro']) {
    for (const w of [360, 412, 450]) {
      test(`sin overflow, ids únicos y sin errores · tema ${tema} · ${w}px`, async ({ page }) => {
        const errs = [];
        page.on('pageerror', e => errs.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
        await page.setViewportSize({ width: w, height: 800 });
        const est = buildEstado({ proxVenc: '2026-10-28' });
        est.compromisos.push({ ...est.compromisos[0], id: 'cr-pag', nombre: 'Visa 7777', usdCompra: { usd: 50, cotizacion: null, pesos: null, fecha: '2026-10-25' } });
        await abrir(page, lun(11, 0), est, { theme: tema });
        await expect(page.locator(EM)).toBeVisible();
        let r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        expect(r.sw).toBeLessThanOrEqual(r.cw);
        await page.keyboard.press('Escape');
        await expect(page.locator('#avisosUsd .backup-warn')).toHaveCount(2);
        r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        expect(r.sw).toBeLessThanOrEqual(r.cw);
        const dup = await page.evaluate(() => {
          const ids = [...document.querySelectorAll('[id]')].map(e => e.id);
          return ids.filter((x, i) => ids.indexOf(x) !== i);
        });
        expect(dup).toEqual([]);
        expect(errs).toEqual([]);
      });
    }
  }
});
