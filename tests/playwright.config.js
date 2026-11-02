const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.QA_WEB_BASE_URL || 'http://127.0.0.1:3000',
    headless: true,
  },
});
