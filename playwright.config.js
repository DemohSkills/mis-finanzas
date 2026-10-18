const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  use: {
    headless: true,
    acceptDownloads: true,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
