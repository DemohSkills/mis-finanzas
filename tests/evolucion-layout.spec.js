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

async function goToEvolucion(page) {
  await page.locator('nav.tabs button[data-vista="evolucion"]').click();
  await page.waitForTimeout(500);
}

test.describe('Part 3: leyenda "Los gráficos…" al pie de Evolución', () => {
  test('(a) .ev-nota existe en la vista Evolución', async ({ page }) => {
    await seedAndUnlock(page);
    await goToEvolucion(page);
    await expect(page.locator('#vista-evolucion .ev-nota')).toBeVisible();
  });

  test('(b) .ev-nota está después del último details.ev-card', async ({ page }) => {
    await seedAndUnlock(page);
    await goToEvolucion(page);
    const isAfterLastCard = await page.evaluate(() => {
      const nota = document.querySelector('#vista-evolucion .ev-nota');
      const cards = document.querySelectorAll('#vista-evolucion details.ev-card');
      if (!nota || !cards.length) return false;
      const lastCard = cards[cards.length - 1];
      return !!(lastCard.compareDocumentPosition(nota) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(isAfterLastCard).toBe(true);
  });

  test('(c) .ev-nota contiene texto sobre snapshots y leyendas', async ({ page }) => {
    await seedAndUnlock(page);
    await goToEvolucion(page);
    const txt = await page.locator('#vista-evolucion .ev-nota').textContent();
    expect(txt).toMatch(/snapshots/i);
    expect(txt).toMatch(/leyenda/i);
  });

  test('(d) el div original .ev-notice no está al inicio de la vista Evolución', async ({ page }) => {
    await seedAndUnlock(page);
    await goToEvolucion(page);
    // The old ev-notice should not be the first child of #vista-evolucion
    const firstChildClass = await page.evaluate(() => {
      const vista = document.getElementById('vista-evolucion');
      if (!vista) return '';
      const first = Array.from(vista.children).find(c => !c.hidden);
      return first ? first.className : '';
    });
    expect(firstChildClass).not.toContain('ev-notice');
  });

  test('(e) .ev-nota tiene font-size menor o igual a .8rem (estilo discreto)', async ({ page }) => {
    await seedAndUnlock(page);
    await goToEvolucion(page);
    const fontSize = await page.evaluate(() => {
      const nota = document.querySelector('#vista-evolucion .ev-nota');
      if (!nota) return null;
      return parseFloat(getComputedStyle(nota).fontSize);
    });
    // 0.72rem * 16px = 11.52px; should be <= 13px
    expect(fontSize).toBeLessThanOrEqual(13);
  });

  test('(f) sin errores JS al navegar a Evolución', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedAndUnlock(page);
    await goToEvolucion(page);
    await page.waitForTimeout(300);
    expect(errors).toHaveLength(0);
  });
});
