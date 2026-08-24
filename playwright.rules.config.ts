import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL(".", import.meta.url));
const BASE_URL = process.env.PLAYWRIGHT_RULES_BASE_URL ?? "http://127.0.0.1:4174";

/**
 * The calculation rule vectors have a separate runner so that the pure
 * kernel is exercised in two JavaScript engines without widening the normal
 * UI browser matrix.  The .pw.ts suffix also keeps Vitest from collecting
 * this Playwright-only file.
 */
export default defineConfig({
  testDir: "./tests/browser-rules",
  testMatch: /.*\.pw\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: ".tmp/playwright-rule-vectors",
  use: {
    baseURL: BASE_URL,
    locale: "zh-CN",
    colorScheme: "light",
    serviceWorkers: "block",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "chromium-engine",
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: "webkit-engine",
      use: {
        browserName: "webkit",
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_RULES_BASE_URL
    ? undefined
    : {
        command: "npm exec -- vite --config tests/browser-rules/vite.config.ts",
        cwd: REPO_ROOT,
        env: process.env,
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
