// End-to-end tests (spec 016 tech §1): run against a production build in mock mode, so no external service or key
// is needed. Limits are switched off only for this mock server (RATE_LIMIT_MODE=off is ignored in live mode).
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      MOCK_EXTERNALS: '1',
      RATE_LIMIT_MODE: 'off',
      PUBLIC_DATA_MODE: 'fixture',
      MOCK_SIGN_IN: '1',
      // The demo Google account is the owner in tests (admin views); the GitHub one is not.
      ADMIN_USER_IDS: '0190f5a8-0000-7000-8000-00000000a001',
    },
  },
});
