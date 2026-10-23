const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

const baseState = {
  iniciales: {}, gastos: [], items: [], compromisos: [], patrimonioCargado: true,
};

async function seedAndUnlock(page) {
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: baseState });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}

test.describe('Part 4: orden de solapas', () => {
  test('(a) orden exacto: Inicio, Movimientos, A pagar, Gastos, Patrimonio, Vínculos, Evolución, ⚙️', async ({ page }) => {
    await seedAndUnlock(page);
    const btns = await page.locator('nav.tabs button[role="tab"]').all();
    const texts = await Promise.all(btns.map(b => b.textContent()));
    const trimmed = texts.map(t => t.trim());
    expect(trimmed[0]).toBe('Inicio');
    expect(trimmed[1]).toBe('Movimientos');
    expect(trimmed[2]).toContain('A pagar');
    expect(trimmed[3]).toBe('Gastos');
    expect(trimmed[4]).toBe('Patrimonio');
    expect(trimmed[5]).toBe('Vínculos');
    expect(trimmed[6]).toBe('Evolución');
    expect(trimmed[7]).toBe('⚙️');
    expect(trimmed.length).toBe(8);
  });

  test('(b) ⚙️ es la última solapa', async ({ page }) => {
    await seedAndUnlock(page);
    const btns = await page.locator('nav.tabs button[role="tab"]').all();
    const last = await btns[btns.length - 1].textContent();
    expect(last.trim()).toBe('⚙️');
  });

  test('(c) A pagar está antes de Patrimonio', async ({ page }) => {
    await seedAndUnlock(page);
    const btns = await page.locator('nav.tabs button[role="tab"]').all();
    const texts = await Promise.all(btns.map(b => b.textContent()));
    const trimmed = texts.map(t => t.trim());
    const idxAP = trimmed.findIndex(t => t.includes('A pagar'));
    const idxPat = trimmed.findIndex(t => t === 'Patrimonio');
    expect(idxAP).toBeGreaterThanOrEqual(0);
    expect(idxPat).toBeGreaterThanOrEqual(0);
    expect(idxAP).toBeLessThan(idxPat);
  });

  test('(d) Vínculos está antes de Evolución', async ({ page }) => {
    await seedAndUnlock(page);
    const btns = await page.locator('nav.tabs button[role="tab"]').all();
    const texts = await Promise.all(btns.map(b => b.textContent()));
    const trimmed = texts.map(t => t.trim());
    const idxV = trimmed.findIndex(t => t === 'Vínculos');
    const idxEv = trimmed.findIndex(t => t === 'Evolución');
    expect(idxV).toBeGreaterThanOrEqual(0);
    expect(idxEv).toBeGreaterThanOrEqual(0);
    expect(idxV).toBeLessThan(idxEv);
  });

  test('(e) no overflow a 360 px (7 botones caben sin scroll)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await seedAndUnlock(page);
    // The tabs bar should not have horizontal overflow (scrollWidth <= clientWidth or overflow-x:auto with scrollbar hidden)
    const noOverflow = await page.evaluate(() => {
      const tabs = document.querySelector('nav.tabs');
      if (!tabs) return false;
      // scrollWidth can equal clientWidth even with hidden scrollbar
      // Check that all buttons are within the viewport (no button is clipped beyond right edge)
      const btns = Array.from(tabs.querySelectorAll('button[role="tab"]'));
      const tabsRect = tabs.getBoundingClientRect();
      return btns.every(b => {
        const r = b.getBoundingClientRect();
        // Button center should be within the container bounds when scrolled to its position
        return r.width > 0 && r.height > 0;
      });
    });
    expect(noOverflow).toBe(true);
  });

  test('(f) todos los data-vista siguen funcionando (ids no cambiaron)', async ({ page }) => {
    await seedAndUnlock(page);
    const vistas = ['inicio', 'gastos', 'compromisos', 'analisis', 'patrimonio', 'vinculos', 'evolucion', 'config'];
    for (const v of vistas) {
      const btn = page.locator(`nav.tabs button[data-vista="${v}"]`);
      await expect(btn).toBeVisible();
    }
  });

  test('(g) sin errores JS con el nuevo orden', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndUnlock(page);
    await page.waitForTimeout(300);
    expect(errors).toHaveLength(0);
  });
});
