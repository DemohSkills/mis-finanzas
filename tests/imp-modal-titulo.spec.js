const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const PIN = '1234';

test('el título del modal de importación cambia según el importador', async ({ page }) => {
  await page.addInitScript(({ pin }) => {
    localStorage.setItem('finanzas-v1', JSON.stringify({ iniciales: {}, gastos: [], items: [], patrimonioCargado: true }));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify(pin));
  }, { pin: PIN });
  await page.goto(INDEX);
  for (const d of PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(600);
  const casos = [
    ['abrirImportModal', '📥 Importar Santander / Mercado Pago'],
    ['abrirImportMCModal', '📥 Importar Mastercard MP (PDF)'],
    ['abrirImportVisaModal', '📥 Importar Visa (Excel)'],
    ['abrirImportModal', '📥 Importar Santander / Mercado Pago'],
  ];
  for (const [fn, titulo] of casos) {
    await page.evaluate(f => window[f](), fn);
    await expect(page.locator('#impModalTitulo')).toHaveText(titulo);
  }
});
