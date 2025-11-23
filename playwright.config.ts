/** @format */

import { defineConfig, devices } from '@playwright/test'

const DEFAULT_PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100)
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${DEFAULT_PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  webServer: {
    command: 'pnpm dev',
    port: DEFAULT_PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: String(DEFAULT_PORT),
      HOSTNAME: '127.0.0.1',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
