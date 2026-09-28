import { defineConfig } from "playwright/test"

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:5199",
    // Use a system-provided chromium (e.g. from the NixOS flake dev shell)
    // when available; otherwise fall back to the playwright-managed browser.
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: "npx vite --config e2e/vite.config.ts",
    url: "http://localhost:5199",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  reporter: [["list"]],
})
