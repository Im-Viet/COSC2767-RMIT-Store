// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000, // Increased timeout for potentially slow containers
  retries: 1, // Retry once on failure
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:8080',
    headless: true,
    // Add more debugging options
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [
    ['list'], 
    ['html', { outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'playwright-report/results.xml' }]
  ],
  // Run tests in sequence to avoid potential conflicts
  workers: 1,
});
