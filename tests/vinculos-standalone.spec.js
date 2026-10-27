// Tests para tarjetas standalone en Vínculos (items con persona fuera de Préstamos con personas)
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

function buildEstado() {
  return {
    iniciales: { 'Efectivo': 5000, 'Visa Santander': 0, 'Banco Santander': 0, 'Mercado Pago': 0, 'Astropay': 0, 'Mastercard MP': 0, 'American Express': 0 },
    gastos: [],
    items: [
      { id: 'meli-id', nombre: 'Meli Envíos extra', tipo: 'activo', monto: 1200, grupo: 'Cobros pendientes', persona: 'Semana 11/10 al 18/10', historial: [] },
      { id: 'boris-id', nombre: 'Boris', tipo: 'deuda', monto: 3000, grupo: 'Préstamos con personas', persona: 'Boris', historial: [] },
    ],
    compromisos: [],
    patrimonioCargado: true,
  };
}

async function seedAndUnlock(page, estado) {
  await page.addInitScript(({ sk, pk, pin, data }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) {
    await page.click(`button[data-d="${d}"]`);
  }
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

test.describe('vinculos-standalone', () => {
  test('ítem suelto: tarjeta de la persona con el ítem como fila, sin ± Ajustar', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await page.locator('[role=tab]', { hasText: 'Vínculos' }).click();
    await page.waitForSelector('#vinculos');

    const card = page.locator('#vinculos .persona').filter({ has: page.locator('summary .nombre', { hasText: 'Semana 11/10 al 18/10' }) });
    await expect(card).toHaveCount(1);
    await expect(card.locator('li .vinc-nom')).toHaveText('Meli Envíos extra');
    await expect(card.locator('button', { hasText: '± Ajustar' })).toHaveCount(0);
  });

  test('Préstamos con personas (Boris) sigue mostrando ± Ajustar', async ({ page }) => {
    await seedAndUnlock(page, buildEstado());
    await page.locator('[role=tab]', { hasText: 'Vínculos' }).click();
    await page.waitForSelector('#vinculos');

    const borisCard = page.locator('#vinculos .persona').filter({ hasText: 'Boris' }).first();
    await expect(borisCard.locator('button', { hasText: '± Ajustar' })).toBeVisible();
  });
});
