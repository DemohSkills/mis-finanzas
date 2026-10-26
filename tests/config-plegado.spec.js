// @ts-check
// Configuración: orden de las 12 secciones, todas plegadas por defecto, accesos programáticos
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const ORDEN = [
  '🌗 Apariencia', '📄 Informe financiero', '🏦 Importar resúmenes', '💾 Copia de seguridad',
  '💵 Dólar de referencia (MEP)', '🤖 Reglas de categorización automática', '🏷 Categorías de gastos',
  '🏷 Categorías de ingresos', '🔒 PIN de acceso', '👤 Mi nombre en los bancos',
  '🎙 API key de Claude (para voz)', '📷 Fotos del gráfico',
];
const CLAVES = ['cfg-apariencia', 'cfg-informe', 'cfg-importar', 'cfg-backup', 'cfg-usdref', 'cfg-reglas',
  'cfg-cats-gastos', 'cfg-cats-ingresos', 'cfg-pin', 'cfg-nombre', 'cfg-apikey', 'cfg-fotos'];

async function abrir(page, { conSR = false } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((sr) => {
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    localStorage.setItem('finanzas-v1', JSON.stringify({ iniciales: {}, gastos: [], items: [], patrimonioCargado: true }));
    if (sr) window.SpeechRecognition = function () { this.start = () => {}; this.stop = () => {}; };
  }, conSR);
  await page.goto(INDEX);
  for (const d of ['1', '2', '3', '4']) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
}
const irConfig = (page) => page.locator('nav.tabs button[data-vista="config"]').click();
const estados = (page) => page.evaluate(() => [...document.querySelectorAll('#vista-config > details.cfg-section')].map(d => d.open));

test('orden de los 12 títulos y sección 3 renombrada', async ({ page }) => {
  await abrir(page);
  await irConfig(page);
  const titulos = await page.locator('#vista-config > details.cfg-section > summary h2').allTextContents();
  expect(titulos).toEqual(ORDEN);
  const claves = await page.locator('#vista-config > details.cfg-section').evaluateAll(els => els.map(e => e.dataset.cfg));
  expect(claves).toEqual(CLAVES);
  await expect(page.locator('#detFotos')).toHaveCount(1);
});

test('todas cerradas al entrar; se abre solo la tocada; al volver a entrar vuelven a cerrarse', async ({ page }) => {
  await abrir(page);
  await irConfig(page);
  expect(await estados(page)).toEqual(Array(12).fill(false));
  const sums = page.locator('#vista-config > details.cfg-section > summary');
  for (let i = 0; i < 12; i++) {
    await expect(sums.nth(i)).toBeVisible();
    const box = await sums.nth(i).boundingBox();
    expect(box && box.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.locator('#cfgUsdRef')).toBeHidden();
  await page.locator('#cfg-usdref > summary').click();
  await expect(page.locator('#cfgUsdRef')).toBeVisible();
  const e = await estados(page);
  expect(e.filter(Boolean).length).toBe(1);
  expect(e[4]).toBe(true);
  // abrir otra no cierra la primera (independientes)
  await page.locator('#cfg-pin > summary').click();
  expect((await estados(page)).filter(Boolean).length).toBe(2);
  // salir y volver a entrar: todo cerrado
  await page.locator('nav.tabs button[data-vista="inicio"]').click();
  await irConfig(page);
  expect(await estados(page)).toEqual(Array(12).fill(false));
  // recargar: también cerradas
  await page.locator('#cfg-pin > summary').click();
  await page.reload();
  for (const d of ['1', '2', '3', '4']) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(400);
  await irConfig(page);
  expect(await estados(page)).toEqual(Array(12).fill(false));
});

test('renderConfig no cambia el estado abierto/cerrado', async ({ page }) => {
  await abrir(page);
  await irConfig(page);
  await page.locator('#cfg-reglas > summary').click();
  await page.evaluate(() => renderConfig());
  const e = await estados(page);
  expect(e.filter(Boolean).length).toBe(1);
  expect(e[5]).toBe(true);
});

test('acceso programático: dictado sin API key abre la sección de API key', async ({ page }) => {
  await abrir(page, { conSR: true });
  page.on('dialog', d => d.accept());
  await page.locator('#btnVoz').click();
  await expect(page.locator('#vista-config')).toBeVisible();
  await expect(page.locator('#cfg-apikey')).toHaveJSProperty('open', true);
  await expect(page.locator('#cfgApiKey')).toBeVisible();
  expect((await estados(page)).filter(Boolean).length).toBe(1);
});

test('abrirCfg abre la sección pedida (dólar de referencia, copia de seguridad)', async ({ page }) => {
  await abrir(page);
  for (const [k, input] of [['cfg-usdref', '#cfgUsdRef'], ['cfg-backup', '#btnExportBackup']]) {
    await page.evaluate((key) => abrirCfg(key), k);
    await expect(page.locator(`[data-cfg="${k}"]`)).toHaveJSProperty('open', true);
    await expect(page.locator(input)).toBeVisible();
  }
});
