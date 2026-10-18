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

const VALID_BACKUP = JSON.stringify({
  version: 1, fecha: '2024-01-01',
  estado: { iniciales: {}, gastos: [], items: [], patrimonioCargado: true, compromisos: [] },
  snaps: [], cats: [], catsIncome: [], reglas: [],
}, null, 2);

/** hoursAgo: positive = in the past */
function tsAgo(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
}

async function seedAndLoad(page, { backupMeta = null, shareMode = 'resolve', apiKey = null } = {}) {
  await page.addInitScript(({ state, pin, backupMeta, shareMode, apiKey }) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(state));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify(pin));
    localStorage.removeItem('finanzas-v1-backup-date');
    localStorage.removeItem('finanzas-v1-backup-meta');
    localStorage.removeItem('finanzas-v1-backup-snooze');

    if (backupMeta) {
      localStorage.setItem('finanzas-v1-backup-meta', JSON.stringify(backupMeta));
      // legacy date for compat
      localStorage.setItem('finanzas-v1-backup-date',
        JSON.stringify(new Date(backupMeta.ts).toLocaleDateString('sv')));
    }
    if (apiKey) {
      localStorage.setItem('finanzas-v1-apikey', JSON.stringify(apiKey));
    }

    window._shareData = null;

    if (shareMode !== 'disabled') {
      Object.defineProperty(navigator, 'canShare', {
        value: () => true, writable: true, configurable: true,
      });
      Object.defineProperty(navigator, 'share', {
        value: async (data) => {
          window._shareData = data;
          if (shareMode === 'abort') throw new DOMException('User cancelled', 'AbortError');
          if (shareMode === 'error') throw new Error('share failed');
        },
        writable: true, configurable: true,
      });
    } else {
      Object.defineProperty(navigator, 'share',   { value: undefined, writable: true, configurable: true });
      Object.defineProperty(navigator, 'canShare', { value: undefined, writable: true, configurable: true });
    }
  }, { state: BASE_STATE, pin: '1234', backupMeta, shareMode, apiKey });

  await page.goto(INDEX);
}

async function enterPIN(page) {
  for (const d of ['1', '2', '3', '4']) {
    await page.locator(`[data-d="${d}"]`).click();
  }
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

// ─── tests ────────────────────────────────────────────────────

test('(a) no JS errors on load and unlock', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await seedAndLoad(page);        // no backup at all → banner "Nunca"
  await enterPIN(page);
  await page.waitForSelector('#vista-inicio');
  expect(errors).toEqual([]);
});

test('(b) share sends .txt file with text/plain that parses as valid JSON', async ({ page }) => {
  await seedAndLoad(page, { backupMeta: { ts: tsAgo(30), method: 'compartido' } });
  await enterPIN(page);
  await page.locator('#bannerBackup button', { hasText: 'Compartir' }).click();
  await page.waitForFunction(() => window._shareData !== null);

  const result = await page.evaluate(async () => {
    const file = window._shareData?.files?.[0];
    if (!file) return null;
    return { name: file.name, type: file.type, text: await file.text() };
  });

  expect(result).not.toBeNull();
  expect(result.name).toMatch(/^finanzas-backup-\d{4}-\d{2}-\d{2}\.txt$/);
  expect(result.type).toBe('text/plain');

  const json = JSON.parse(result.text);
  expect(json).toHaveProperty('estado');
  expect(json).toHaveProperty('snaps');
  expect(json).toHaveProperty('cats');
});

test('(c) restaurarBackup accepts a .txt file with JSON content', async ({ page }) => {
  // Override confirm/alert before page load so FileReader's async flow can complete
  await page.addInitScript(() => {
    window.confirm = () => true;
    window._alerts = [];
    window.alert = msg => { window._alerts.push(String(msg)); };
  });
  await seedAndLoad(page, { backupMeta: { ts: tsAgo(30), method: 'descargado' } });
  await enterPIN(page);

  await page.evaluate(json => {
    const file = new File([json], 'backup.txt', { type: 'text/plain' });
    window.restaurarBackup(file);
  }, VALID_BACKUP);

  // restaurarBackup calls alert('Backup restaurado correctamente.') on success
  await page.waitForFunction(
    () => window._alerts?.some(m => m.includes('restaurado')),
    { timeout: 3000 }
  );
});

test('(d) banner visible >24h, hidden <24h', async ({ page: page1 }) => {
  // >24h → banner shows
  await seedAndLoad(page1, { backupMeta: { ts: tsAgo(25), method: 'descargado' } });
  await enterPIN(page1);
  await expect(page1.locator('#bannerBackup')).toBeVisible();
});

test('(d2) banner hidden <24h', async ({ page }) => {
  // <24h → no banner
  await seedAndLoad(page, { backupMeta: { ts: tsAgo(1), method: 'descargado' } });
  await enterPIN(page);
  await expect(page.locator('#bannerBackup')).not.toBeAttached();
});

test('(e) Después snoozes 4 h; after snooze expires banner returns', async ({ page }) => {
  await seedAndLoad(page, { backupMeta: { ts: tsAgo(30), method: 'descargado' } });
  await enterPIN(page);
  await expect(page.locator('#bannerBackup')).toBeVisible();

  // click "Después"
  await page.locator('#bannerBackup button', { hasText: 'Después' }).click();
  await expect(page.locator('#bannerBackup')).not.toBeAttached();

  // snooze is active → banner should still be hidden
  await page.evaluate(() => window.verificarAvisoBackup());
  await expect(page.locator('#bannerBackup')).not.toBeAttached();

  // expire snooze manually (set it 1 ms in the past)
  await page.evaluate(() => {
    localStorage.setItem('finanzas-v1-backup-snooze',
      JSON.stringify(new Date(Date.now() - 1).toISOString()));
  });
  await page.evaluate(() => window.verificarAvisoBackup());
  await expect(page.locator('#bannerBackup')).toBeVisible();
});

test('(f) banner has danger class when backup is >48 h ago', async ({ page }) => {
  await seedAndLoad(page, { backupMeta: { ts: tsAgo(50), method: 'descargado' } });
  await enterPIN(page);
  const banner = page.locator('#bannerBackup');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveClass(/danger/);
});

test('(g) AbortError does not register backup in BACKUP_META_K', async ({ page }) => {
  await seedAndLoad(page, { backupMeta: { ts: tsAgo(30), method: 'descargado' }, shareMode: 'abort' });
  await enterPIN(page);
  await page.locator('#bannerBackup button', { hasText: 'Compartir' }).click();
  await page.waitForTimeout(300);

  const meta = await page.evaluate(() => JSON.parse(localStorage.getItem('finanzas-v1-backup-meta')));
  // ts should still be the old one (>24h ago), not a recent one
  const hoursAgo = (Date.now() - new Date(meta.ts).getTime()) / 3600000;
  expect(hoursAgo).toBeGreaterThan(20);
});
