import { defineConfig } from '@playwright/test'

// One at a time: a test uses the OS clipboard, and every launch builds a WebView2 profile.
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 60_000,
  reporter: 'line'
})
