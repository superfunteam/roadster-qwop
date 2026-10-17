import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

// Use real touchscreen events so pointer capture, simultaneous thumbs, and
// release behavior are verified through the browser rather than mocked input.
test.skip(Boolean(process.env.PWA_TEST_URL), "Control state is development-only telemetry.");
const jetKeys = ["q", "w", "o", "p"];

async function openGame(browser, baseURL, width = 390, height = 844, options = {}) {
  const touch = options.touch ?? true;
  const context = await browser.newContext({
    baseURL, viewport: { width, height }, hasTouch: touch,
    isMobile: touch, deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ hybrid }) => {
    localStorage.setItem("roadster-manual-seen", "true");
    localStorage.setItem("roadster-settings", JSON.stringify({
      quality: "low", muted: true, music: false, voices: false,
      shake: false, haptics: false,
    }));
    // A laptop with a touchscreen still has a fine primary mouse pointer.
    if (hybrid) Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
  }, { hybrid: options.hybrid ?? false });
  await page.goto("/");
  await page.waitForFunction(() => window.__roadster && !document.querySelector("#loading"));
  const session = await context.newCDPSession(page);
  return { page, context, session, errors };
}

async function start(page, touch = true, index = 1) {
  const activate = (locator) => touch ? locator.tap() : locator.click();
  await activate(page.locator(`[data-level="${index}"]`));
  await activate(page.getByRole("button", { name: "Begin test" }));
  await page.waitForFunction(() => window.__roadster.input.enabled);
}

async function point(page, selector, id, xFraction = 0.5, yFraction = 0.5) {
  const box = await page.locator(selector).boundingBox();
  expect(box, `${selector} is rendered`).toBeTruthy();
  return { id, x: box.x + box.width * xFraction, y: box.y + box.height * yFraction, radiusX: 3, radiusY: 3, force: 1 };
}

async function touch(session, type, points = []) {
  await session.send("Input.dispatchTouchEvent", { type, touchPoints: points });
}

async function expectJets(page, selected) {
  await expect.poll(() => page.evaluate((keys) => ({
    enabled: window.__roadster.input.enabled,
    jets: keys.filter((key) => window.__roadster.input.state[key] === 1),
  }), jetKeys), `Only the selected corner jets (${selected || "none"}) are engaged`).toEqual({
    enabled: true, jets: jetKeys.filter((key) => selected.includes(key)),
  });
}

async function expectReleased(page) {
  await expect.poll(() => page.evaluate(() => {
    const state = window.__roadster.input.state;
    return [state.q, state.w, state.o, state.p, state.throttle, state.brake, state.steer, state.boost].some(Boolean);
  })).toBe(false);
}

async function expectNoKeyboardHints(page) {
  await expect(page.locator("#game-canvas canvas")).toHaveAttribute("aria-label", /left pad.*right pad/);
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/\b(?:SPACE|ESC|WASD)\b|Q\s*\+\s*W|Each key fires|Press [QWRCO]/i);
  expect(await page.locator("kbd").evaluateAll((elements) =>
    elements.filter((element) => element.getClientRects().length).map((element) => element.textContent)),
  "Touch instructions contain no visible keyboard caps").toEqual([]);
}

for (const [width, height] of [[320, 568], [390, 844], [844, 390], [768, 1024]]) {
  test(`touch-specific menus, manual, and thumb controls fit ${width}×${height}`, async ({ browser, baseURL }) => {
    const { page, context, errors } = await openGame(browser, baseURL, width, height);
    try {
      await expect(page.locator("html")).toHaveAttribute("data-input", "touch");
      await expectNoKeyboardHints(page);
      await page.getByRole("button", { name: "Flight manual" }).tap();
      await expectNoKeyboardHints(page);
      const manual = await page.getByRole("dialog").innerText();
      expect(manual).toMatch(/thumb|pad/i);
      await page.getByRole("button", { name: "Close dialog", exact: true }).tap();
      await start(page);
      await expect(page.locator(".booster-console")).toBeHidden();
      await expect(page.locator(".drive-controls")).toBeHidden();
      await expect(page.locator(".touch-controls")).toBeVisible();
      await expectNoKeyboardHints(page);
      const boxes = await page.locator('[data-touch-pad="drive"], [data-jets], .touch-boost').evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return { label: element.getAttribute("aria-label"), width: rect.width, height: rect.height,
          inside: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
          receives: element === hit || element.contains(hit) };
      }));
      expect(boxes).toHaveLength(11);
      for (const box of boxes) {
        expect(box.inside, `${box.label}: on screen`).toBe(true);
        expect(box.receives, `${box.label}: unobstructed`).toBe(true);
        expect(box.width, `${box.label}: thumb width`).toBeGreaterThanOrEqual(43.9);
        expect(box.height, `${box.label}: thumb height`).toBeGreaterThanOrEqual(43.9);
      }
      await mkdir("reference/qa/mobile-ux", { recursive: true });
      await page.screenshot({ path: `reference/qa/mobile-ux/play-${width}x${height}.png` });
      await page.getByRole("button", { name: "Pause game" }).tap();
      await expect(page.getByRole("heading", { name: "Take a breath." })).toBeVisible();
      expect(await page.evaluate(() => window.__roadster.paused)).toBe(true);
      await expectNoKeyboardHints(page);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}

test("the inversion teaches touch controls during its automatic approach and airborne transition", async ({ browser, baseURL }) => {
  const { page, context, errors } = await openGame(browser, baseURL);
  try {
    await start(page, true, 2);
    await expect(page.locator(".touch-drive-status")).toHaveText("AUTO DRIVE");
    await expect(page.locator("#game-message")).toContainText("Pulse Nose up");
    await expectNoKeyboardHints(page);
    // Let the actual ramp autopilot reach the lip; this is not a forced stage.
    await expect(page.locator("#game-message")).toHaveText("Nose up · Rotate. Tail up · Catch it.", { timeout: 15_000 });
    expect(await page.evaluate(() => window.__roadster.physics.state.rampStage)).toBe("airborne");
    await expectNoKeyboardHints(page);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("two thumbs drive and fly, slide between jet combinations, and release independently", async ({ browser, baseURL }) => {
  const { page, context, session, errors } = await openGame(browser, baseURL);
  try {
    await start(page);
    const drive = await point(page, '[data-touch-pad="drive"]', 1, 0.82, 0.14);
    const center = await point(page, '[data-jets="qwop"]', 2);
    await touch(session, "touchStart", [drive, center]);
    await expectJets(page, "qwop");
    const driving = await page.evaluate(() => window.__roadster.input.state);
    expect(driving.throttle).toBeGreaterThan(0.6);
    expect(driving.steer).toBeGreaterThan(0.5);
    expect(driving.brake).toBe(0);
    await expect(page.locator('[data-jets="qwop"]')).toHaveAttribute("aria-pressed", "true");
    // A keyboard event during active touches must not remove the thumb pads.
    await page.keyboard.press("c");
    await expect(page.locator("html")).toHaveAttribute("data-input", "touch");
    const nose = await point(page, '[data-jets="qw"]', 2);
    await touch(session, "touchMove", [drive, nose]);
    await expectJets(page, "qw");
    await expect(page.locator('[data-jets="qwop"]')).toHaveAttribute("aria-pressed", "false");
    const corner = await point(page, '[data-jets="q"]', 2);
    await touch(session, "touchMove", [drive, corner]);
    await expectJets(page, "q");
    // CDP touchEnd names the fingers to release, not the fingers remaining.
    await touch(session, "touchEnd", [corner]);
    await expectJets(page, "");
    expect((await page.evaluate(() => window.__roadster.input.state)).throttle).toBeGreaterThan(0.6);
    const neutral = await point(page, '[data-touch-pad="drive"]', 1);
    await touch(session, "touchMove", [neutral]);
    await expectReleased(page);
    const reverse = await point(page, '[data-touch-pad="drive"]', 1, 0.18, 0.86);
    await touch(session, "touchMove", [reverse]);
    await expect.poll(() => page.evaluate(() => window.__roadster.input.state.brake)).toBeGreaterThan(0.6);
    const braking = await page.evaluate(() => window.__roadster.input.state);
    expect(braking.steer).toBeLessThan(-0.5);
    expect(braking.throttle).toBe(0);
    await touch(session, "touchCancel");
    await expectReleased(page);
    await page.keyboard.down("q");
    await expect(page.locator("html")).toHaveAttribute("data-input", "keyboard");
    await expectJets(page, "q");
    await page.keyboard.up("q");
    await page.locator('#hud [data-action="camera"]').tap();
    await expect(page.locator("html")).toHaveAttribute("data-input", "touch");
    await expect(page.locator(".touch-controls")).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("boost, flight pad capture, reset, pause, and rotation cannot leave touch controls stuck", async ({ browser, baseURL }) => {
  const { page, context, session, errors } = await openGame(browser, baseURL);
  try {
    await start(page);
    const missedPause = await point(page, '#hud [data-action="pause"]', 10);
    await touch(session, "touchStart", [missedPause]);
    await touch(session, "touchMove", [{ ...missedPause, x: missedPause.x - 80 }]);
    await touch(session, "touchEnd");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    expect(await page.evaluate(() => window.__roadster.paused)).toBe(false);
    const boost = await point(page, '.touch-boost', 1);
    const center = await point(page, '[data-jets="qwop"]', 2);
    await touch(session, "touchStart", [boost, center]);
    await expectJets(page, "qwop");
    expect((await page.evaluate(() => window.__roadster.input.state)).boost).toBe(1);
    const outside = { ...center, y: (await page.locator('[data-touch-pad="flight"]').boundingBox()).y - 30 };
    await touch(session, "touchMove", [boost, outside]);
    await expectJets(page, "");
    expect((await page.evaluate(() => window.__roadster.input.state)).boost).toBe(1);
    await touch(session, "touchMove", [boost, center]);
    await expectJets(page, "qwop");
    // Trigger the actual game reset while physical pointers are still down.
    await page.evaluate(() => window.__roadster.reset());
    await expectReleased(page);
    await page.waitForFunction(() => window.__roadster.input.enabled);
    expect(await page.evaluate(() => window.__roadster.input.pointers.size)).toBe(0);
    await touch(session, "touchMove", [boost, center]);
    await expectReleased(page);
    await touch(session, "touchEnd");
    const newCenter = await point(page, '[data-jets="qwop"]', 3);
    await touch(session, "touchStart", [newCenter]);
    await expectJets(page, "qwop");
    const pause = await point(page, '#hud [data-action="pause"]', 4);
    await touch(session, "touchStart", [newCenter, pause]);
    await touch(session, "touchEnd", [pause]);
    await expect(page.getByRole("button", { name: "Resume test" })).toBeVisible();
    await expectReleased(page);
    expect(await page.evaluate(() => window.__roadster.input.pointers.size)).toBe(0);
    // An older flight finger can lift long after the HUD compatibility click.
    await page.waitForTimeout(1_000);
    await touch(session, "touchEnd");
    await expect(page.getByRole("button", { name: "Resume test" })).toBeVisible();
    await page.getByRole("button", { name: "Resume test" }).tap();
    const rotating = await point(page, '[data-jets="qwop"]', 5);
    await touch(session, "touchStart", [rotating]);
    await expectJets(page, "qwop");
    await page.setViewportSize({ width: 844, height: 390 });
    await expectReleased(page);
    await touch(session, "touchEnd");
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("shared jet holds and lost pointer capture release only the affected finger", async ({ browser, baseURL }) => {
  const { page, context, session, errors } = await openGame(browser, baseURL);
  try {
    await start(page);
    const first = await point(page, '[data-jets="q"]', 1, 0.35, 0.5);
    const second = await point(page, '[data-jets="q"]', 2, 0.65, 0.5);
    await touch(session, "touchStart", [first, second]);
    await expectJets(page, "q");
    await touch(session, "touchEnd", [first]);
    await expectJets(page, "q");
    await expect(page.locator('[data-jets="q"]')).toHaveAttribute("aria-pressed", "true");
    await touch(session, "touchCancel");
    await expectReleased(page);
    await expect(page.locator('[data-jets="q"]')).toHaveAttribute("aria-pressed", "false");
    const center = await point(page, '[data-jets="qwop"]', 3);
    await touch(session, "touchStart", [center]);
    await expectJets(page, "qwop");
    // Ask the real DOM to lose capture, as can happen in an interrupted webview.
    await page.evaluate(() => {
      const input = window.__roadster.input;
      for (const [id, element] of input.captureTargets) element.releasePointerCapture(id);
    });
    await touch(session, "touchMove", [{ ...center, x: center.x + 1 }]);
    await expectReleased(page);
    await touch(session, "touchEnd");
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("a compatibility click on the gameplay HUD does not select its level identifier as a mission", async ({ browser, baseURL }) => {
  const { page, context, errors } = await openGame(browser, baseURL);
  try {
    await start(page);
    await expect(page.locator("#hud")).toHaveAttribute("data-level", "drag");
    await page.locator("#hud-level-name").dispatchEvent("click");
    expect(await page.evaluate(() => ({
      selected: window.__roadster.ui.selected,
      level: window.__roadster.selected,
      mode: window.__roadster.mode,
    }))).toEqual({ selected: 1, level: 1, mode: "game" });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

for (const options of [{ name: "narrow desktop", width: 390, hybrid: false }, { name: "hybrid laptop", width: 1100, hybrid: true }]) {
  test(`${options.name} retains keyboard instructions and every physical driving control`, async ({ browser, baseURL }) => {
    const { page, context, errors } = await openGame(browser, baseURL, options.width, 844, { touch: false, hybrid: options.hybrid });
    try {
      await expect(page.locator("html")).toHaveAttribute("data-input", "keyboard");
      await expect(page.locator("#game-canvas canvas")).toHaveAttribute("aria-label", /Use Q, W, O and P/);
      await page.getByRole("button", { name: "Flight manual" }).click();
      await expect(page.getByRole("dialog")).toContainText("Q + W");
      await expect(page.getByRole("dialog")).toContainText("SPACE");
      await page.getByRole("button", { name: "Close dialog", exact: true }).click();
      await start(page, false);
      await expect(page.locator(".touch-controls")).toBeHidden();
      await expect(page.locator(".booster-console")).toBeVisible();
      for (const key of ["q", "w", "o", "p", "ArrowUp", "ArrowRight", "Space"]) await page.keyboard.down(key);
      await expectJets(page, "qwop");
      expect(await page.evaluate(() => window.__roadster.input.state)).toMatchObject({ throttle: 1, brake: 0, steer: 1, boost: 1 });
      for (const key of ["q", "w", "o", "p", "ArrowUp", "ArrowRight", "Space"]) await page.keyboard.up(key);
      await expectReleased(page);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
