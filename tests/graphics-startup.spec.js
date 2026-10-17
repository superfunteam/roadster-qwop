import { test, expect } from "@playwright/test";

test.skip(Boolean(process.env.PWA_TEST_URL), "Startup instrumentation uses development diagnostics.");
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

const failures = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  failures.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(failures.get(page), "Expected context failures must not become uncaught startup errors").toEqual([]);
});

async function simulateContextFailures(page, { all = true, clipboardFailure = false, delayedStatus = false, statusMessage = "Simulated GPU temporarily unavailable after reset" } = {}) {
  await page.addInitScript(({ all, clipboardFailure, delayedStatus, statusMessage }) => {
    if (!localStorage.getItem("roadster-settings")) localStorage.setItem("roadster-settings", JSON.stringify({ quality: "high", safeGraphics: false, muted: true }));
    localStorage.setItem("roadster-manual-seen", "true");
    const original = HTMLCanvasElement.prototype.getContext;
    const canvases = new WeakMap();
    let count = 0;
    const pendingStatus = [];
    window.emitStartupStatuses = () => pendingStatus.splice(0).forEach((notify) => notify());
    window.startupContextAttempts = [];
    HTMLCanvasElement.prototype.getContext = function (type, attributes) {
      if (type !== "webgl2") return original.call(this, type, attributes);
      if (!canvases.has(this)) canvases.set(this, ++count);
      const canvas = canvases.get(this);
      const blocked = all || canvas === 1;
      window.startupContextAttempts.push({ canvas, attributes: attributes || null, blocked });
      if (blocked) {
        const notify = () => this.dispatchEvent(new WebGLContextEvent("webglcontextcreationerror", { statusMessage }));
        if (delayedStatus === "manual") pendingStatus.push(notify);
        else if (delayedStatus) queueMicrotask(notify);
        else notify();
        return null;
      }
      return original.call(this, type, attributes);
    };
    if (clipboardFailure) Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new DOMException("Clipboard unavailable", "NotAllowedError"); } } });
  }, { all, clipboardFailure, delayedStatus, statusMessage });
}

const CHROME_BLOCK = "Web page caused context loss and was blocked";

test("an explicit Chromium block skips the second canvas and explains browser-controlled reload", async ({ page }) => {
  await simulateContextFailures(page, { statusMessage: CHROME_BLOCK, clipboardFailure: true });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Chrome blocked the graphics." })).toBeVisible();
  await expect(page.getByText(/Compatibility mode is saved/)).toBeVisible();
  await expect(page.getByText(/Open Chrome’s menu and tap Reload, or tap the address bar and press Go/)).toBeVisible();
  await expect(page.getByText(/button inside this page cannot clear this block/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload safely", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => [...new Set(window.startupContextAttempts.map((attempt) => attempt.canvas))])).toEqual([1]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("roadster-settings")).safeGraphics)).toBe(true);
  const reportButton = page.getByRole("button", { name: "Copy graphics report", exact: true });
  await expect(reportButton).toHaveClass("primary-button");
  await reportButton.click();
  const report = JSON.parse(await page.getByRole("textbox", { name: "Graphics report", exact: true }).inputValue());
  expect(report.browserBlocked).toBe(true);
  expect(report.attempts).toHaveLength(1);
  expect(report.attempts[0].statusMessages).toContain(CHROME_BLOCK);
});

test("a queued Chromium block replaces generic guidance without wiping an open report", async ({ page }) => {
  await simulateContextFailures(page, { statusMessage: CHROME_BLOCK, clipboardFailure: true, delayedStatus: "manual" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Graphics could not start." })).toBeVisible();
  await page.getByRole("button", { name: "Copy graphics report", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Graphics report", exact: true });
  await expect(field).toBeVisible();
  const oldStatus = await page.getByRole("status").textContent();
  await page.evaluate(() => {
    window.existingReportField = document.querySelector(".graphics-startup-report textarea");
    window.emitStartupStatuses();
  });
  await expect(page.getByRole("heading", { name: "Chrome blocked the graphics." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload safely", exact: true })).toHaveCount(0);
  await expect(field).toBeFocused();
  expect(await page.evaluate(() => window.existingReportField === document.querySelector(".graphics-startup-report textarea"))).toBe(true);
  await expect(page.getByRole("status")).toHaveText(oldStatus);
  const report = JSON.parse(await field.inputValue());
  expect(report.browserBlocked).toBe(true);
  // Both attempts had already failed before the browser delivered its reason.
  expect(report.attempts).toHaveLength(2);
  expect(report.attempts.every((attempt) => attempt.statusMessages.includes(CHROME_BLOCK))).toBe(true);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => [...new Set(window.startupContextAttempts.map((attempt) => attempt.canvas))])).toEqual([1, 2]);
});

for (const url of ["/", "/player/"]) {
  test(`unavailable WebGL shows useful recovery without an uncaught error at ${url}`, async ({ page }) => {
    await simulateContextFailures(page);
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Graphics could not start." })).toBeVisible();
    await expect(page.getByText(/temporarily unavailable after a graphics crash/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload safely", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy graphics report", exact: true })).toBeVisible();
    await expect(page.locator("#game-canvas canvas")).toHaveCount(0);
    const state = await page.evaluate(() => ({
      attempts: window.startupContextAttempts,
      safe: JSON.parse(localStorage.getItem("roadster-settings")).safeGraphics,
      focused: document.activeElement.classList.contains("graphics-startup-panel"),
    }));
    expect([...new Set(state.attempts.map((attempt) => attempt.canvas))]).toEqual([1, 2]);
    expect(state.attempts.find((attempt) => attempt.canvas === 1).attributes.antialias).toBe(true);
    expect(state.attempts.find((attempt) => attempt.canvas === 2).attributes).toMatchObject({ antialias: false, powerPreference: "default" });
    expect(state.safe).toBe(true);
    expect(state.focused).toBe(true);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.startupContextAttempts.length)).toBe(state.attempts.length);
    // main.js stops before registering its viewport listeners. The recovery
    // screen must still follow rotation and allow scrolling to its actions.
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(() => page.locator("#loading").evaluate((element) => element.clientHeight)).toBe(390);
    const reload = page.getByRole("button", { name: "Reload safely", exact: true });
    await reload.scrollIntoViewIfNeeded();
    await expect(reload).toBeInViewport();
  });
}

test("a failed initial context retries on a fresh canvas and starts in compatibility mode", async ({ page }) => {
  await simulateContextFailures(page, { all: false });
  await page.goto("/");
  await page.waitForFunction(() => window.__roadster?.graphics && !document.querySelector("#loading"));
  const state = await page.evaluate(() => {
    const { renderer, settings, graphics } = window.__roadster;
    return {
      attempts: window.startupContextAttempts,
      antialias: renderer.getContext().getContextAttributes().antialias,
      safe: settings.safeGraphics,
      persisted: JSON.parse(localStorage.getItem("roadster-settings")).safeGraphics,
      plan: graphics.state,
    };
  });
  expect([...new Set(state.attempts.map((attempt) => attempt.canvas))]).toEqual([1, 2]);
  expect(state.antialias).toBe(false);
  expect(state.safe).toBe(true);
  expect(state.persisted).toBe(true);
  expect(state.plan.safeMode).toBe(true);
  expect(state.plan.postprocessing).toBe(false);
  expect(state.plan.pixelCount).toBeLessThanOrEqual(450_000);
});

test("startup diagnostics remain copyable when the clipboard is unavailable", async ({ page }) => {
  await simulateContextFailures(page, { clipboardFailure: true, delayedStatus: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Copy graphics report", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Graphics report", exact: true });
  await expect(field).toBeVisible();
  await expect(field).toBeFocused();
  const report = JSON.parse(await field.inputValue());
  expect(report.webgl).toBe("context creation failed");
  expect(report.browser).toContain("Chrome");
  expect(report.attempts).toHaveLength(2);
  expect(report.attempts[0].statusMessages).toContain("Simulated GPU temporarily unavailable after reset");
  expect(report.attempts[1].attributes.antialias).toBe(false);
  await expect(page.getByRole("status")).toContainText("Nothing is sent automatically");
});

test("safe reload is explicit and preserves the lighter startup settings", async ({ page }) => {
  await simulateContextFailures(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Reload safely", exact: true }).click();
  await page.waitForFunction(() => window.startupContextAttempts?.some((attempt) => attempt.canvas === 1 && attempt.attributes?.antialias === false));
  await expect(page.getByRole("heading", { name: "Graphics could not start." })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("roadster-settings")).safeGraphics)).toBe(true);
});

test("an unexpected entry-module failure shows a usable loading error", async ({ page }) => {
  await page.route(/\/src\/main\.js(?:\?.*)?$/, (route) => route.fulfill({
    contentType: "application/javascript",
    body: 'throw new Error("Simulated entry-module failure");',
  }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "The game could not start." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload game", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toBeFocused();
});

async function startSessionCase(page, { interrupted = false, denied = false } = {}) {
  await page.addInitScript(({ interrupted, denied }) => {
    if (!localStorage.getItem("roadster-settings")) localStorage.setItem("roadster-settings", JSON.stringify({ quality: "high", safeGraphics: false, muted: true }));
    localStorage.setItem("roadster-manual-seen", "true");
    if (interrupted) sessionStorage.setItem("roadster-graphics-active", "1");
    if (denied) Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() { throw new DOMException("Session storage is unavailable", "SecurityError"); },
    });
  }, { interrupted, denied });
  await page.goto("/");
  await page.waitForFunction(() => window.__roadster?.graphics && !document.querySelector("#loading"));
}

test("an interrupted visible session starts safely without changing the selected quality", async ({ page }) => {
  await startSessionCase(page, { interrupted: true });
  const state = await page.evaluate(() => ({
    plan: window.__roadster.graphics.state,
    settings: window.__roadster.settings,
    stored: JSON.parse(localStorage.getItem("roadster-settings")),
    antialias: window.__roadster.renderer.getContext().getContextAttributes().antialias,
  }));
  expect(state.plan.safeMode).toBe(true);
  expect(state.plan.pixelCount).toBeLessThanOrEqual(450_000);
  expect(state.antialias).toBe(false);
  expect(state.settings.quality).toBe("high");
  expect(state.stored).toMatchObject({ quality: "high", safeGraphics: true });
});

test("ordinary reload and hidden-tab transitions do not trigger crash recovery", async ({ page }) => {
  await startSessionCase(page);
  expect(await page.evaluate(() => window.__roadster.settings.safeGraphics)).toBe(false);
  expect(await page.evaluate(() => sessionStorage.getItem("roadster-graphics-active"))).toBe("1");
  const marks = await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    const hidden = sessionStorage.getItem("roadster-graphics-active");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    const visible = sessionStorage.getItem("roadster-graphics-active");
    delete document.visibilityState;
    return { hidden, visible };
  });
  expect(marks).toEqual({ hidden: null, visible: "1" });
  await page.reload();
  await page.waitForFunction(() => window.__roadster?.graphics && !document.querySelector("#loading"));
  const state = await page.evaluate(() => ({ settings: window.__roadster.settings, plan: window.__roadster.graphics.state }));
  expect(state.settings.safeGraphics).toBe(false);
  expect(state.settings.quality).toBe("high");
  expect(state.plan.safeMode).toBe(false);
});

test("unavailable session storage does not prevent startup or lifecycle handling", async ({ page }) => {
  await startSessionCase(page, { denied: true });
  expect(await page.evaluate(() => window.__roadster.settings.safeGraphics)).toBe(false);
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    window.dispatchEvent(new PageTransitionEvent("pageshow"));
  });
  expect(await page.evaluate(() => window.__roadster.renderer.getContext().isContextLost())).toBe(false);
});
