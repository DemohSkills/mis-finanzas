const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

const baseState = { iniciales: {}, gastos: [], items: [], compromisos: [], patrimonioCargado: true };

async function seedAndUnlock(page, estado) {
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(600);
}

test.describe('1a: Orden de solapas', () => {
  test('⚙️ es la última solapa, Compromisos la penúltima', async ({ page }) => {
    await seedAndUnlock(page, baseState);
    const btns = await page.locator('nav.tabs button[role="tab"]').all();
    const n = btns.length;
    expect(n).toBeGreaterThanOrEqual(2);
    const lastText = await btns[n - 1].textContent();
    const prevText = await btns[n - 2].textContent();
    expect(lastText.trim()).toBe('⚙️');
    expect(prevText.trim()).toContain('Compromisos');
  });

  test('navegar a ⚙️ config funciona', async ({ page }) => {
    await seedAndUnlock(page, baseState);
    await page.locator('nav.tabs button[data-vista="config"]').click();
    await expect(page.locator('#vista-config')).toBeVisible();
  });

  test('navegar a compromisos funciona', async ({ page }) => {
    await seedAndUnlock(page, baseState);
    await page.locator('nav.tabs button[data-vista="compromisos"]').click();
    await expect(page.locator('#vista-compromisos')).toBeVisible();
  });
});
