const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

const BASE_STATE = {
  iniciales: {},
  gastos: [],
  items: [],
  patrimonioCargado: true,
  compromisos: [],
};

function todayISO() {
  return new Date().toLocaleDateString('sv'); // 'sv' locale = YYYY-MM-DD
}

async function seedAndLoad(page, backupDate, shareMode = 'resolve', apiKey = null) {
  await page.addInitScript(({ state, pin, backupDate, shareMode, apiKey }) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(state));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify(pin));
    if (backupDate !== null) {
      localStorage.setItem('finanzas-v1-backup-date', JSON.stringify(backupDate));
    } else {
      localStorage.removeItem('finanzas-v1-backup-date');
    }
    if (apiKey) {
      localStorage.setItem('finanzas-v1-apikey', JSON.stringify(apiKey));
    }

    window._shareData = null;

    if (shareMode !== 'disabled') {
      Object.defineProperty(navigator, 'canShare', {
        value: () => true,
        writable: true, configurable: true,
      });
      Object.defineProperty(navigator, 'share', {
        value: async (data) => {
          window._shareData = data;
          if (shareMode === 'abort') {
            throw new DOMException('User cancelled', 'AbortError');
          }
          if (shareMode === 'error') {
            throw new Error('share failed');
          }
          // 'resolve' — just succeeds
        },
        writable: true, configurable: true,
      });
    } else {
      // Remove any native share support
      Object.defineProperty(navigator, 'share', { value: undefined, writable: true, configurable: true });
      Object.defineProperty(navigator, 'canShare', { value: undefined, writable: true, configurable: true });
    }
  }, { state: BASE_STATE, pin: '1234', backupDate, shareMode, apiKey });

  await page.goto(INDEX);
}

async function enterPIN(page) {
  for (const d of ['1', '2', '3', '4']) {
    await page.locator(`[data-d="${d}"]`).click();
  }
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

async function readShareFileText(page) {
  return page.evaluate(async () => {
    if (!window._shareData?.files?.[0]) return null;
    return window._shareData.files[0].text();
  });
}

// ─── tests ────────────────────────────────────────────────────

test('(a) no JS errors on load and unlock', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await seedAndLoad(page, null);
  await enterPIN(page);
  await page.waitForSelector('#vista-inicio');
  expect(errors).toEqual([]);
});

test('(b) banner appears when no backup today', async ({ page }) => {
  await seedAndLoad(page, '2020-01-01');
  await enterPIN(page);
  await expect(page.locator('#bannerBackup')).toBeVisible();
});

test('(c) no banner when backup is today', async ({ page }) => {
  await seedAndLoad(page, todayISO());
  await enterPIN(page);
  await expect(page.locator('#bannerBackup')).not.toBeAttached();
});

test('(d) Compartir passes a valid JSON File with estado, snaps, cats', async ({ page }) => {
  await seedAndLoad(page, '2020-01-01', 'resolve');
  await enterPIN(page);
  await page.locator('#bannerBackup button', { hasText: 'Compartir' }).click();

  // wait for async share to complete
  await page.waitForFunction(() => window._shareData !== null);

  const text = await readShareFileText(page);
  expect(text).not.toBeNull();

  const fname = await page.evaluate(() => window._shareData?.files?.[0]?.name ?? '');
  expect(fname).toMatch(/^finanzas-backup-\d{4}-\d{2}-\d{2}\.json$/);

  const json = JSON.parse(text);
  expect(json).toHaveProperty('estado');
  expect(json).toHaveProperty('snaps');
  expect(json).toHaveProperty('cats');
});

test('(e) AbortError does not mark backup as done', async ({ page }) => {
  await seedAndLoad(page, '2020-01-01', 'abort');
  await enterPIN(page);
  await page.locator('#bannerBackup button', { hasText: 'Compartir' }).click();

  // give async share time to reject
  await page.waitForTimeout(300);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('finanzas-v1-backup-date')));
  expect(stored).toBe('2020-01-01');
});

test('(f) no share support falls to download and marks backup done', async ({ page }) => {
  await seedAndLoad(page, '2020-01-01', 'disabled');
  await enterPIN(page);

  const dl = page.waitForEvent('download');
  await page.locator('#bannerBackup button', { hasText: 'Compartir' }).click();
  await dl;

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('finanzas-v1-backup-date')));
  expect(stored).toBe(new Date().toLocaleDateString('sv'));
});

test('(g) backup JSON does not contain the API key', async ({ page }) => {
  await seedAndLoad(page, '2020-01-01', 'resolve', 'sk-ant-test-key-9999');
  await enterPIN(page);
  await page.locator('#bannerBackup button', { hasText: 'Compartir' }).click();
  await page.waitForFunction(() => window._shareData !== null);

  const text = await readShareFileText(page);
  expect(text).not.toContain('sk-ant-test-key-9999');
  expect(text).not.toContain('apikey');
});
