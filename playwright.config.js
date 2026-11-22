/**
 * Browser E2E for DTOV / local Next (default :3010).
 * Expects the app already running (dtov:full-app starts it) unless PLAYWRIGHT_WEB_SERVER=1.
 */

const { defineConfig, devices } = require('@playwright/test');

const baseURL = (process.env.BASE_URL || 'http://127.0.0.1:3010').replace(/\/$/, '');

module.exports = defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.DTOV_RESET_RATE_LIMITS === '1'
    ? [['list'], ['./test/dtov/clear-rate-limits-reporter.cjs']]
    : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'pt-BR',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_WEB_SERVER === '1'
    ? {
        command: 'npx next dev -p 3010 -H 127.0.0.1',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
      }
    : undefined,
});
