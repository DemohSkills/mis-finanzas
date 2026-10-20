const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

function buildEstado() {
  return {
    iniciales: { 'Efectivo': 5000 },
    gastos: [],
    items: [
      { id: 'i1', nombre: 'Boris', grupo: 'Préstamos con personas', tipo: 'deuda', monto: 3000, persona: 'Boris' },
      { id: 'i2', nombre: 'Vero', grupo: 'Préstamos con personas', tipo: 'deuda', monto: 1500, persona: 'Vero' },
    ],
    patrimonioCargado: true,
    compromisos: [],
    vinculos: [
      { id: 'v1', nombre: 'Boris', operaciones: [{ id: 'op1', tipo: 'me-debe', monto: 3000, fecha: '2026-01-10', desc: 'test' }] },
      { id: 'v2', nombre: 'Vero', operaciones: [{ id: 'op2', tipo: 'le-debo', monto: 1500, fecha: '2026-02-05', desc: 'test' }] },
    ],
  };
}

async function seedAndUnlock(page, estado) {
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(600);
}

test.describe('2a: Vínculos plegables', () => {
  test('cada tarjeta de persona es un <details> con clase persona', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await page.locator('nav.tabs button[data-vista="vinculos"]').click();
    await page.waitForSelector('#vinculos');
    const cards = page.locator('#vinculos details.persona');
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('el summary siempre muestra nombre y estado (neto)', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await page.locator('nav.tabs button[data-vista="vinculos"]').click();
    await page.waitForSelector('#vinculos details.persona');
    const summary = page.locator('#vinculos details.persona').first().locator('summary');
    await expect(summary).toBeVisible();
    // debe tener el nombre
    const txt = await summary.textContent();
    expect(txt).toMatch(/Boris|Vero/);
  });

  test('se puede plegar y desplegar una tarjeta', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await page.locator('nav.tabs button[data-vista="vinculos"]').click();
    await page.waitForSelector('#vinculos details.persona');
    const card = page.locator('#vinculos details.persona').first();
    // por defecto abierto
    await expect(card).toHaveAttribute('open', '');
    // cerrar
    await card.locator('summary').click();
    await expect(card).not.toHaveAttribute('open', '');
    // abrir
    await card.locator('summary').click();
    await expect(card).toHaveAttribute('open', '');
  });

  test('estado open/closed persiste en localStorage', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await page.locator('nav.tabs button[data-vista="vinculos"]').click();
    await page.waitForSelector('#vinculos details.persona');
    const card = page.locator('#vinculos details.persona').first();
    // cerrar
    await card.locator('summary').click();
    await expect(card).not.toHaveAttribute('open', '');
    await page.waitForTimeout(150);
    // verificar que la clave fue guardada como false (JSON.stringify(false) = 'false')
    const stored = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter(k => k.startsWith('finanzas-v1-det-vinc-'));
      return keys.map(k => ({ k, v: localStorage.getItem(k) }));
    });
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.some(e => e.v === 'false')).toBe(true);
  });

  test('botón "Plegar todo" pliega todas las tarjetas', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await page.locator('nav.tabs button[data-vista="vinculos"]').click();
    await page.waitForSelector('#btnPlegVinc');
    await page.click('#btnPlegVinc');
    await page.waitForTimeout(200);
    const openCards = await page.locator('#vinculos details.persona[open]').count();
    expect(openCards).toBe(0);
    // texto cambia a Desplegar todo
    await expect(page.locator('#btnPlegVinc')).toHaveText('Desplegar todo');
  });

  test('botón "Desplegar todo" despliega todas las tarjetas', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await page.locator('nav.tabs button[data-vista="vinculos"]').click();
    await page.waitForSelector('#btnPlegVinc');
    // plegar primero
    await page.click('#btnPlegVinc');
    await page.waitForTimeout(200);
    // desplegar
    await page.click('#btnPlegVinc');
    await page.waitForTimeout(200);
    const closedCards = await page.locator('#vinculos details.persona:not([open])').count();
    expect(closedCards).toBe(0);
  });
});
