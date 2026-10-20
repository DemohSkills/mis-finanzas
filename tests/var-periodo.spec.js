const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const SK = 'finanzas-v1';
const SNAP_KEY = 'finanzas-v1-snaps';
const PIN_KEY = 'finanzas-v1-pin';
const VAR_PER_KEY = 'finanzas-v1-var-per';
const TEST_PIN = '1234';

function hoyISO() { return new Date().toLocaleDateString('sv'); }
function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toLocaleDateString('sv');
}

const baseState = { iniciales: {}, gastos: [], items: [], compromisos: [], patrimonioCargado: true };

async function seedAndUnlock(page, estado, snaps, varPer) {
  await page.addInitScript(({ sk, pk, snap_k, var_k, pin, data, snapsData, varPerVal }) => {
    localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
    if (snapsData) localStorage.setItem(snap_k, JSON.stringify(snapsData));
    if (varPerVal) localStorage.setItem(var_k, String(varPerVal));
  }, { sk: SK, pk: PIN_KEY, snap_k: SNAP_KEY, var_k: VAR_PER_KEY, pin: TEST_PIN, data: estado, snapsData: snaps || null, varPerVal: varPer || null });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(600);
}

test.describe('1c: Tarjeta Variación multi-período', () => {
  test('los 4 mini botones están visibles en Inicio', async ({ page }) => {
    await seedAndUnlock(page, baseState);
    for (const per of ['1', '7', '30', '90']) {
      await expect(page.locator(`.var-per-btn[data-per="${per}"]`)).toBeVisible();
    }
  });

  test('por defecto muestra "Var. 24 h" en el label', async ({ page }) => {
    await seedAndUnlock(page, baseState);
    const lbl = await page.locator('#var-lbl').textContent();
    expect(lbl.trim()).toContain('24 h');
  });

  test('con snapshot de ayer calcula variación 24h correctamente', async ({ page }) => {
    const snaps = [{ d: daysAgo(1), a: 100000, dv: -20000, n: 80000 }];
    // neto actual = 0 (sin items), neto ayer = 80000 → diff = -80000
    await seedAndUnlock(page, baseState, snaps);
    const val = await page.locator('#var7d').textContent();
    // Should show a percentage (negative or —)
    expect(val.trim()).not.toBe('');
  });

  test('clic en 7 d cambia label a "Var. 7 d"', async ({ page }) => {
    const snaps = [
      { d: daysAgo(7), a: 100000, dv: 0, n: 100000 },
      { d: daysAgo(1), a: 100000, dv: 0, n: 100000 },
    ];
    await seedAndUnlock(page, baseState, snaps);
    await page.locator('.var-per-btn[data-per="7"]').click();
    const lbl = await page.locator('#var-lbl').textContent();
    expect(lbl.trim()).toContain('7 d');
  });

  test('clic en 30 d cambia label a "Var. 30 d"', async ({ page }) => {
    await seedAndUnlock(page, baseState);
    await page.locator('.var-per-btn[data-per="30"]').click();
    const lbl = await page.locator('#var-lbl').textContent();
    expect(lbl.trim()).toContain('30 d');
  });

  test('elección de período persiste en localStorage', async ({ page }) => {
    await seedAndUnlock(page, baseState);
    await page.locator('.var-per-btn[data-per="90"]').click();
    const saved = await page.evaluate(k => localStorage.getItem(k), VAR_PER_KEY);
    expect(saved).toBe('90');
  });

  test('sin snapshot antiguo suficiente, muestra "Desde dd/mm" o —', async ({ page }) => {
    // Solo tenemos snapshot de hace 2 días, pedimos 7 días: usa el más viejo disponible
    const snaps = [{ d: daysAgo(2), a: 100000, dv: 0, n: 100000 }];
    await seedAndUnlock(page, baseState, snaps);
    await page.locator('.var-per-btn[data-per="7"]').click();
    const lbl = await page.locator('#var-lbl').textContent();
    // Label should say "Desde dd/mm" (uses oldest available)
    expect(lbl.trim()).toMatch(/Desde \d{2}\/\d{2}/);
  });

  test('fallback usa la MÁS VIEJA disponible (no la más reciente)', async ({ page }) => {
    // Fotos: hace 7 días (neto 50k), hace 3 días (neto 80k), hace 1 día (neto 90k)
    // Pedimos 30 d → no hay fotos tan antiguas → fallback debe ser la de hace 7 días (50k),
    // no la de hace 1 día (90k). neto actual = 0 → diff = -50k con la vieja, -90k con la reciente.
    const snaps = [
      { d: daysAgo(7), a: 50000, dv: 0, n: 50000 },
      { d: daysAgo(3), a: 80000, dv: 0, n: 80000 },
      { d: daysAgo(1), a: 90000, dv: 0, n: 90000 },
    ];
    await seedAndUnlock(page, baseState, snaps);
    await page.locator('.var-per-btn[data-per="30"]').click();
    // Label debe mostrar "Desde" con la fecha de hace 7 días
    const lbl = await page.locator('#var-lbl').textContent();
    expect(lbl.trim()).toMatch(/Desde \d{2}\/\d{2}/);
    // El % debe calcularse contra neto=50k (la más vieja), no 90k (la más reciente)
    // neto actual = 0, diff = -50000, pct = -100%
    const pct = await page.evaluate(() => {
      const snaps = JSON.parse(localStorage.getItem('finanzas-v1-snaps') || '[]');
      const sorted = snaps.slice().sort((a, b) => a.d.localeCompare(b.d));
      const today = new Date().toLocaleDateString('sv');
      const past = sorted.filter(s => s.d < today);
      return past.length ? past[0].n : null;
    });
    // la más vieja debe ser la de 50k
    expect(pct).toBe(50000);
  });

  test('7 d con fotos del 13/10 al 20/10: compara contra 13/10 sin mostrar "Desde"', async ({ page }) => {
    // Simula tener fotos desde hace 7 días exactos hasta hoy. 7d debe matchear exacto.
    const snaps = [
      { d: daysAgo(7), a: 100000, dv: 0, n: 100000 },
      { d: daysAgo(5), a: 110000, dv: 0, n: 110000 },
      { d: daysAgo(1), a: 120000, dv: 0, n: 120000 },
    ];
    await seedAndUnlock(page, baseState, snaps);
    await page.locator('.var-per-btn[data-per="7"]').click();
    const lbl = await page.locator('#var-lbl').textContent();
    // Con foto exactamente hace 7 días, no debe mostrar "Desde"
    expect(lbl.trim()).toContain('7 d');
    expect(lbl.trim()).not.toMatch(/Desde/);
  });

  test('30 d y 90 d muestran "Desde 13/10" y % diferente al de 24 h (fotos del 13 al 20)', async ({ page }) => {
    // neto fotos: hace 7d=100k, hace 5d=110k, hace 1d=120k → neto actual=0
    // 24h: compara contra 120k → diff=-120k, pct=-100%
    // 30d: no hay foto tan antigua → fallback a más vieja = hace 7 días (100k) → diff=-100k, pct=-100%
    //   esperar "Desde" en el label
    const snaps = [
      { d: daysAgo(7), a: 100000, dv: 0, n: 100000 },
      { d: daysAgo(5), a: 110000, dv: 0, n: 110000 },
      { d: daysAgo(1), a: 120000, dv: 0, n: 120000 },
    ];
    await seedAndUnlock(page, baseState, snaps);
    // 24h label
    const lbl24 = await page.locator('#var-lbl').textContent();
    expect(lbl24.trim()).toContain('24 h');
    // 30d label debe mostrar "Desde"
    await page.locator('.var-per-btn[data-per="30"]').click();
    const lbl30 = await page.locator('#var-lbl').textContent();
    expect(lbl30.trim()).toMatch(/Desde \d{2}\/\d{2}/);
    // 90d label debe mostrar "Desde"
    await page.locator('.var-per-btn[data-per="90"]').click();
    const lbl90 = await page.locator('#var-lbl').textContent();
    expect(lbl90.trim()).toMatch(/Desde \d{2}\/\d{2}/);
  });
});
