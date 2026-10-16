import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const localChrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  (process.platform === "darwin" && existsSync(localChrome)
    ? localChrome
    : undefined);

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  outputDir: process.env.PWA_TEST_URL
    ? "playwright-report/pwa-artifacts"
    : "test-results",
  use: {
    baseURL: process.env.PWA_TEST_URL || "http://localhost:5173",
    viewport: { width: 1100, height: 760 },
    deviceScaleFactor: 1,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath,
      args: ["--enable-webgl", "--enable-unsafe-swiftshader"],
    },
  },
  webServer: process.env.PWA_TEST_URL
    ? undefined
    : {
        command: "npm run dev -- --port 5173 --strictPort",
        url: "http://localhost:5173",
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
});
