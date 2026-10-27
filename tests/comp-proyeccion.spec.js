// "A pagar" (orden por vencimiento): las cuotas se proyectan en cada mes pendiente y los fijos en todos los meses mostrados
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const PIN = '1234';
const TEMAS = ['auto', 'claro', 'oscuro', 'negro', 'neon-azul', 'neon-turquesa', 'neon-violeta'];

const cuota = (id, nombre, pend, prox, monto = 10000) => ({ id, nombre, entidad: 'Banco', monto, pendientes: pend, proxVenc: prox, tipo: 'cuota' });
const fijo = (id, nombre, monto = 5000) => ({ id, nombre, tipo: 'fijo', categoria: 'Otros/Varios', monto, diaMes: 10, activo: true, pagos: {}, estimado: false });

async function abrir(page, compromisos, sort = 'venc') {
  await page.clock.setFixedTime(new Date('2026-10-27T12:00:00'));
  await page.addInitScript(({ est, sort }) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(est));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    localStorage.setItem('finanzas-v1-comp-sort', sort);
  }, { est: { iniciales: {}, gastos: [], items: [], patrimonioCargado: true, compromisos }, sort });
  await page.goto(INDEX);
  for (const d of PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForSelector('#pinScr', { state: 'hidden' });
  await page.locator('nav.tabs button[data-vista="compromisos"]').click();
  await page.waitForSelector('#compromisosList');
}
const mes = (page, lbl) => page.locator('#compromisosList details.comp-mes', { has: page.locator(`summary:has-text("${lbl}")`) });

test.describe('A pagar: proyección de cuotas y fijos', () => {
  test('3 pendientes desde 16/11: aparece en nov, dic y ene; solo noviembre tiene Pagar', async ({ page }) => {
    await abrir(page, [cuota('c1', 'Compu', 3, '2026-11-16')]);
    for (const m of ['Noviembre 2026', 'Diciembre 2026', 'Enero 2027']) await expect(mes(page, m).locator('[data-id="c1"]')).toHaveCount(1);
    await expect(mes(page, 'Febrero 2027').locator('[data-id="c1"]')).toHaveCount(0);
    await expect(mes(page, 'Noviembre 2026').locator('[data-id="c1"] button', { hasText: 'Pagar' })).toHaveCount(1);
    const dic = mes(page, 'Diciembre 2026').locator('[data-id="c1"]');
    await expect(dic).toContainText('cuota proyectada');
    await expect(dic).toContainText('16/12');
    await expect(dic.locator('button')).toHaveCount(1);
    await expect(dic.locator('button')).toHaveText('Editar');
    await expect(mes(page, 'Enero 2027').locator('[data-id="c1"] button', { hasText: 'Pagar' })).toHaveCount(0);
  });

  test('15 pendientes desde 02/11/2026 llega a enero de 2028', async ({ page }) => {
    await abrir(page, [cuota('c1', 'Larga', 15, '2026-11-02')]);
    await expect(mes(page, 'Enero 2028').locator('[data-id="c1"]')).toHaveCount(1);
    await expect(mes(page, 'Febrero 2028')).toHaveCount(0);
  });

  test('un fijo activo aparece en enero de 2027 y los meses lejanos arrancan plegados', async ({ page }) => {
    await abrir(page, [fijo('f1', 'Suscripción')]);
    await expect(mes(page, 'Enero 2027').locator('[data-fijo-id="f1"]')).toHaveCount(1);
    await expect(mes(page, 'Marzo 2027').locator('[data-fijo-id="f1"]')).toHaveCount(1);
    expect(await mes(page, 'Diciembre 2026').evaluate(d => d.open)).toBe(true);
    expect(await mes(page, 'Enero 2027').evaluate(d => d.open)).toBe(false);
    expect(await mes(page, 'Marzo 2027').evaluate(d => d.open)).toBe(false);
    // Pagué solo en los 3 primeros meses
    await expect(mes(page, 'Diciembre 2026').locator('button', { hasText: 'Pagué' })).toHaveCount(1);
    await expect(mes(page, 'Enero 2027').locator('button', { hasText: 'Pagué' })).toHaveCount(0);
  });

  test('pendientes 0 solo en Finalizados', async ({ page }) => {
    await abrir(page, [cuota('c0', 'Terminada', 0, '2026-11-16')]);
    await expect(page.locator('#compromisosList [data-id="c0"]')).toHaveCount(1);
    await expect(mes(page, 'Finalizados').locator('[data-id="c0"]')).toHaveCount(1);
    await expect(mes(page, 'Noviembre 2026')).toHaveCount(0);
  });

  test('total de diciembre = cuotas proyectadas + fijos', async ({ page }) => {
    await abrir(page, [cuota('c1', 'Compu', 3, '2026-11-16', 12000), cuota('c2', 'Moto', 2, '2026-11-20', 8000), fijo('f1', 'Suscripción', 5000)]);
    const sub = mes(page, 'Diciembre 2026').locator('summary .comp-mes-sub');
    await expect(sub).toContainText('Cuotas');
    await expect(sub).toContainText('20.000');
    await expect(sub).toContainText('Fijos');
    await expect(sub).toContainText('5.000');
    await expect(sub).toContainText('25.000');
  });

  test('vistas entidad y monto sin proyección', async ({ page }) => {
    await abrir(page, [cuota('c1', 'Compu', 3, '2026-11-16')], 'entidad');
    await expect(page.locator('#compromisosList [data-id="c1"]')).toHaveCount(1);
    await expect(page.locator('#compromisosList .comp-row--proy')).toHaveCount(0);
  });
  test('vista monto sin proyección', async ({ page }) => {
    await abrir(page, [cuota('c1', 'Compu', 3, '2026-11-16')], 'monto');
    await expect(page.locator('#compromisosList [data-id="c1"]')).toHaveCount(1);
  });

  test('cuota vencida se proyecta hacia adelante desde su mes; compromisosMes no cambia', async ({ page }) => {
    await abrir(page, [cuota('c1', 'Vieja', 3, '2026-10-05')]);
    await expect(mes(page, 'Octubre 2026').locator('[data-id="c1"] button', { hasText: 'Pagar' })).toHaveCount(1);
    await expect(mes(page, 'Noviembre 2026').locator('[data-id="c1"]')).toHaveCount(1);
    await expect(mes(page, 'Diciembre 2026').locator('[data-id="c1"]')).toHaveCount(1);
    const n = await page.evaluate(() => compromisosMes('2026-12').length);
    expect(n).toBe(1);
  });

  test('390 px sin scroll horizontal en los 7 temas', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await abrir(page, [cuota('c1', 'Compra con un nombre larguísimo de prueba', 6, '2026-11-16', 99999999), fijo('f1', 'Suscripción con nombre muy largo también')]);
    for (const t of TEMAS) {
      await page.evaluate(x => aplicarTema(x), t);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), t).toBe(true);
    }
  });
});
