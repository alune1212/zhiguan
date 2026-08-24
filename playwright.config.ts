import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL(".", import.meta.url));
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";

/**
 * Browser verification is intentionally a local, disposable gate.  It starts
 * the same loopback dev command used for the implementation preview and does
 * not install browsers, write a build, or contact a remote service.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.PLAYWRIGHT_JSON_REPORT
    ? [["list"], ["json", { outputFile: process.env.PLAYWRIGHT_JSON_REPORT }]]
    : [["list"]],
  use: {
    baseURL: BASE_URL,
    locale: "zh-CN",
    colorScheme: "light",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: "chromium-mobile",
      use: {
        // This is the narrow-screen browser project for 6.2.  iOS Safari is
        // a separate manual 6.3 target and is not silently substituted here.
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        cwd: REPO_ROOT,
        env: process.env,
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
