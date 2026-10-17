import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

const failures = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  failures.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(failures.get(page)).toEqual([]);
});

test("the standalone page loads no game assets and runs one single-pixel context only on request", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.addInitScript(() => {
    window.graphicsCheckCalls = { contexts: [], clear: 0, readPixels: 0, createShader: 0 };
    const originalContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attributes) {
      if (type === "webgl2") window.graphicsCheckCalls.contexts.push({ width: this.width, height: this.height, attributes });
      return originalContext.call(this, type, attributes);
    };
    for (const name of ["clear", "readPixels", "createShader"]) {
      const original = WebGL2RenderingContext.prototype[name];
      WebGL2RenderingContext.prototype[name] = function (...args) {
        window.graphicsCheckCalls[name]++;
        return original.apply(this, args);
      };
    }
  });
  await page.goto("/graphics-check.html");
  expect(await page.evaluate(() => window.graphicsCheckCalls.contexts.length)).toBe(0);
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.getByRole("button", { name: "Run graphics check", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The single-pixel check passed." })).toBeVisible();
  const report = JSON.parse(await page.getByRole("textbox", { name: "Graphics report — select to copy", exact: true }).inputValue());
  expect(report.contextAttempts).toBe(1);
  expect(report.contextCreated).toBe(true);
  expect(report.contextLost).toBe(false);
  expect(report.actualAttributes.antialias).toBe(false);
  expect(report.pixelCheck).toMatchObject({ clearError: 0, readError: 0, matched: true });
  expect(report.route.pathname).toBe("/graphics-check.html");
  expect(report.limits.maxTextureSize).toBeGreaterThan(0);
  await page.evaluate(() => document.querySelector("#run-check").dispatchEvent(new MouseEvent("click")));
  expect(await page.evaluate(() => window.graphicsCheckCalls)).toEqual({
    contexts: [{ width: 1, height: 1, attributes: { antialias: false, powerPreference: "default", alpha: false } }],
    clear: 1,
    readPixels: 1,
    createShader: 0,
  });
  expect(requests).toEqual(["/graphics-check.html"]);
  await expect(page.locator("script[src], audio, video, link[rel=stylesheet]")).toHaveCount(0);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});

for (const queued of [false, true]) {
  test(`a ${queued ? "queued" : "synchronous"} blocked status is reported without another context attempt`, async ({ page }) => {
    await page.addInitScript((queued) => {
      const original = HTMLCanvasElement.prototype.getContext;
      window.graphicsCheckAttempts = 0;
      HTMLCanvasElement.prototype.getContext = function (type, attributes) {
        if (type !== "webgl2") return original.call(this, type, attributes);
        window.graphicsCheckAttempts++;
        const notify = () => {
          if (queued) this.dispatchEvent(new WebGLContextEvent("webglcontextcreationerror", { statusMessage: "Earlier GPU provider allocation failed" }));
          this.dispatchEvent(new WebGLContextEvent("webglcontextcreationerror", {
            statusMessage: "Web page caused context loss and was blocked",
          }));
        };
        if (queued) queueMicrotask(notify);
        else notify();
        return null;
      };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => { throw new DOMException("Clipboard unavailable", "NotAllowedError"); } },
      });
    }, queued);
    await page.goto("/graphics-check.html");
    await page.getByRole("button", { name: "Run graphics check", exact: true }).click();
    await expect(page.getByRole("heading", { name: "The browser blocked this check." })).toBeVisible();
    await page.getByRole("button", { name: "Copy graphics report", exact: true }).click();
    const field = page.getByRole("textbox", { name: "Graphics report — select to copy", exact: true });
    await expect(field).toBeFocused();
    const report = JSON.parse(await field.inputValue());
    expect(report.contextCreated).toBe(false);
    expect(report.contextAttempts).toBe(1);
    const expectedStatuses = queued
      ? ["Earlier GPU provider allocation failed", "Web page caused context loss and was blocked"]
      : ["Web page caused context loss and was blocked"];
    expect(report.contextStatus).toEqual(expectedStatuses);
    if (queued) {
      await page.evaluate(() => document.querySelector("canvas").dispatchEvent(new WebGLContextEvent("webglcontextcreationerror", { statusMessage: "Late GPU diagnostic follow-up" })));
      await expect(field).toBeFocused();
      expect(JSON.parse(await field.inputValue()).contextStatus).toEqual([...expectedStatuses, "Late GPU diagnostic follow-up"]);
    }
    await expect(page.locator("#copy-status")).toContainText("Nothing is sent automatically");
    const address = page.getByRole("textbox", { name: "Chrome diagnostics address", exact: true });
    await expect(address).toHaveValue("chrome://gpu");
    await address.focus();
    expect(await address.evaluate((element) => element.value.slice(element.selectionStart, element.selectionEnd))).toBe("chrome://gpu");
    await expect(page.getByText("Graphics Feature Status", { exact: true })).toBeVisible();
    await expect(page.getByText("Driver Information", { exact: true })).toBeVisible();
    await expect(page.getByText("Problems Detected", { exact: true })).toBeVisible();
    await expect(page.getByText("Log Messages", { exact: true })).toBeVisible();
    await expect(page.locator("#run-check")).toBeDisabled();
    await page.evaluate(() => document.querySelector("#run-check").dispatchEvent(new MouseEvent("click")));
    expect(await page.evaluate(() => window.graphicsCheckAttempts)).toBe(1);
  });
}
