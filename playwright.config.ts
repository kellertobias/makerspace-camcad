import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/bench',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  outputDir: 'test-results/bench',
  use: {
    baseURL: 'http://127.0.0.1:3458',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3458',
    url: 'http://127.0.0.1:3458',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
