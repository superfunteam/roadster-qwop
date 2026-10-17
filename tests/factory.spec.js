import { test, expect } from "@playwright/test";

test.skip(Boolean(process.env.PWA_TEST_URL), "Flight telemetry requires development modules.");

// Advance the complete game loop at 60 Hz. Keyboard/touch events still enter
// through the real input controller; no vehicle state or flight rules change.
async function boot(page) {
  await page.addInitScript(() => {
    localStorage.setItem("roadster-manual-seen", "true");
    localStorage.setItem("roadster-settings", JSON.stringify({
      quality: "low", muted: true, haptics: false, shake: false,
    }));
    let next = 1, now = 0;
    const callbacks = new Map();
    window.requestAnimationFrame = (callback) => {
      const id = next++;
      callbacks.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => callbacks.delete(id);
    Object.defineProperty(performance, "now", { value: () => now });
    window.flightTick = (frames = 1) => {
      for (let frame = 0; frame < frames; frame++) {
        now += 1000 / 60;
        const pending = [...callbacks.values()];
        callbacks.clear();
        for (const callback of pending) callback(now);
      }
    };
  });
  await page.goto("/?test=factory", { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__roadster && !document.querySelector("#loading"), null, { polling: 100 });
  await page.evaluate(() => {
    window.__roadster.graphics.observeFrame = () => false;
    window.flightTick(2);
  });
}

async function tick(page, frames) {
  await page.evaluate((frames) => window.flightTick(frames), frames);
}

async function start(page, index) {
  await page.evaluate((index) => {
    const game = window.__roadster;
    game.ui.select(index);
    document.querySelector('[data-action="start"]').click();
    for (let i = 0; i < 120 && !game.input.enabled; i++) window.flightTick();
  }, index);
}

async function telemetry(page) {
  return page.evaluate(() => {
    const game = window.__roadster, s = game.physics.state;
    return {
      count: s.ringCount, ids: s.collectedRings, damage: s.damage,
      outcome: s.outcome, exploded: game.wreck.exploded, time: s.time,
      position: [...s.position.toArray()], wheels: game.car.wheels.filter((wheel) => wheel.visible).length,
      collected: game.environment.rings.filter((ring) => ring.collected).map((ring) => ring.id),
    };
  });
}

async function reachInversionLaunch(page) {
  const stage = await page.evaluate(() => {
    const game = window.__roadster;
    for (let i = 0; i < 1200 && game.physics.state.rampStage !== "airborne" && !game.physics.outcome; i++) {
      window.flightTick();
    }
    return game.physics.state.rampStage;
  });
  expect(stage).toBe("airborne");
}

async function expectInversionLanding(page, screenshot) {
  const result = await page.evaluate(() => {
    const game = window.__roadster;
    for (let i = 0; i < 1200 && !game.physics.outcome; i++) window.flightTick();
    const landingPosition = game.physics.body.position.toArray();
    // Let the complete loop display its result and verify it keeps the win.
    window.flightTick(45);
    return {
      outcome: game.physics.outcome,
      damage: game.physics.damage,
      caught: game.physics._landingCaught,
      exploded: game.wreck.exploded,
      wheels: game.car.wheels.filter((wheel) => wheel.visible).length,
      landingPosition,
    };
  });
  expect(result).toMatchObject({ outcome: "success", caught: true, exploded: false, wheels: 4 });
  expect(result.damage).toBeLessThan(1);
  // The side-flip lands on the visible concrete beyond the former 14 m gate.
  expect(Math.abs(result.landingPosition[0])).toBeGreaterThan(14);
  await expect(page.getByRole("dialog").locator(".eyebrow")).toHaveText("TEST 03 / COMPLETE");
  await expect(page.getByRole("button", { name: "Next test" })).toBeVisible();
  if (screenshot) await page.screenshot({ path: screenshot });
  await page.getByRole("button", { name: "Next test" }).click();
  await tick(page, 90);
  await expect(page.locator("#hud-level-name")).toHaveText("The Gigafactory");
  await expect(page.locator("#ring-count")).toHaveText("0 / 5");
}

const errors = new WeakMap();
test.beforeEach(({ page }) => {
  const messages = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

test("keyboard flight clears five real gates, banks the win, and replay resets the course", async ({ page }) => {
  await boot(page);
  await expect(page.locator('[data-level="3"]')).toHaveAttribute("aria-pressed", "true");
  await start(page, 3);
  await expect(page.locator("#ring-count")).toHaveText("0 / 5");
  await page.screenshot({ path: "reference/qa/factory-spawn-desktop.png" });
  await page.keyboard.down("Space");
  await tick(page, 45);
  for (const key of ["q", "w", "o", "p"]) await page.keyboard.down(key);
  await tick(page, 48);
  for (const key of ["q", "w", "o", "p"]) await page.keyboard.up(key);
  await tick(page, 60);
  const midway = await telemetry(page);
  expect(midway.count).toBeGreaterThan(0);
  expect(midway.count).toBeLessThan(5);
  await page.screenshot({ path: "reference/qa/factory-gameplay-desktop.png" });
  await tick(page, 180);
  const win = await telemetry(page);
  expect(win.count).toBe(5);
  expect(win.ids).toEqual([1, 2, 3, 4, 5]);
  expect(win.collected).toEqual(win.ids);
  expect(win.outcome).toBe("success");
  expect(win.damage).toBe(0);
  expect(win.exploded).toBe(false);
  expect(win.wheels).toBe(4);
  await expect(page.locator("#ring-count")).toHaveText("5 / 5");
  await expect(page.locator("#dialog-title")).toHaveText("Five rings.One whole car.");
  await expect(page.getByRole("button", { name: "Back to hangar" })).toBeVisible();
  await tick(page, 180);
  expect(await telemetry(page)).toEqual(win);
  await page.keyboard.up("Space");
  await page.getByRole("button", { name: "Replay test" }).click();
  await tick(page, 60);
  const fresh = await telemetry(page);
  expect(fresh.count).toBe(0);
  expect(fresh.collected).toEqual([]);
  expect(fresh.outcome).toBeNull();
  expect(fresh.damage).toBe(0);
  await expect(page.locator("#ring-count")).toHaveText("0 / 5");
});

test("the real inversion flip lands without exploding and Next test opens the factory", async ({ page }) => {
  await boot(page);
  await start(page, 2);
  const result = await page.evaluate(() => {
    const game = window.__roadster;
    let launchTime = null, held = [];
    for (let i = 0; i < 1200 && !game.physics.outcome; i++) {
      const s = game.physics.state;
      if (s.rampStage === "airborne" && launchTime === null) launchTime = s.time;
      const phase = launchTime === null ? -1 : s.time - launchTime;
      const keys = phase >= 0 && phase < 0.85 ? ["KeyQ", "KeyW"] : phase >= 0.85 && phase < 1.35 ? ["KeyO", "KeyP"] : [];
      for (const code of held) if (!keys.includes(code)) window.dispatchEvent(new KeyboardEvent("keyup", { code }));
      for (const code of keys) if (!held.includes(code)) window.dispatchEvent(new KeyboardEvent("keydown", { code }));
      held = keys;
      window.flightTick();
    }
    window.flightTick(45);
    return { outcome: game.physics.outcome, damage: game.physics.damage, caught: game.physics._landingCaught, exploded: game.wreck.exploded, wheels: game.car.wheels.filter((wheel) => wheel.visible).length };
  });
  expect(result).toMatchObject({ outcome: "success", caught: true, exploded: false, wheels: 4 });
  expect(result.damage).toBeLessThan(1);
  await expect(page.getByRole("button", { name: "Next test" })).toBeVisible();
  await page.getByRole("button", { name: "Next test" }).click();
  await tick(page, 90);
  await expect(page.locator("#hud-level-name")).toHaveText("The Gigafactory");
  await expect(page.locator("#ring-count")).toHaveText("0 / 5");
});

for (const [side, pair] of [["left", ["q", "o"]], ["right", ["w", "p"]]]) {
  test(`inversion ${side} barrel roll followed by all four jets lands on the apron and completes`, async ({ page }) => {
    await boot(page);
    await start(page, 2);
    await reachInversionLaunch(page);
    for (const key of pair) await page.keyboard.down(key);
    await tick(page, 48);
    for (const key of ["q", "w", "o", "p"]) if (!pair.includes(key)) await page.keyboard.down(key);
    await tick(page, 48);
    for (const key of ["q", "w", "o", "p"]) await page.keyboard.up(key);
    await expectInversionLanding(page);
  });
}

test.describe("touch flight", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("sliding from side jets to Lift lands the inversion on the apron and completes", async ({ page, context }) => {
    await boot(page);
    await start(page, 2);
    await reachInversionLaunch(page);
    const cdp = await context.newCDPSession(page);
    const point = async (jets) => {
      const bounds = await page.locator(`[data-jets="${jets}"]`).boundingBox();
      return { id: 1, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, radiusX: 4, radiusY: 4, force: 1 };
    };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [await point("qo")] });
    await expect(page.locator('[data-jets="qo"]')).toHaveAttribute("aria-pressed", "true");
    await tick(page, 48);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [await point("qwop")] });
    await expect(page.locator('[data-jets="qwop"]')).toHaveAttribute("aria-pressed", "true");
    await tick(page, 48);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expectInversionLanding(page, "reference/qa/inversion-apron-mobile-complete.png");
  });

  test("two fingers on Boost and Lift can finish the factory course", async ({ page, context }) => {
    await boot(page);
    await start(page, 3);
    await page.screenshot({ path: "reference/qa/factory-spawn-mobile.png" });
    const cdp = await context.newCDPSession(page);
    const center = async (selector, id) => {
      const b = await page.locator(selector).boundingBox();
      return { id, x: b.x + b.width / 2, y: b.y + b.height / 2, radiusX: 4, radiusY: 4, force: 1 };
    };
    const boost = await center(".touch-boost", 1);
    const lift = await center(".touch-jet-center", 2);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [boost] });
    await tick(page, 45);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [boost, lift] });
    await tick(page, 48);
    // CDP names the finger being lifted, not the finger remaining on screen.
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [lift] });
    await tick(page, 60);
    await page.screenshot({ path: "reference/qa/factory-gameplay-mobile.png" });
    await tick(page, 180);
    const win = await telemetry(page);
    expect(win.outcome).toBe("success");
    expect(win.count).toBe(5);
    expect(win.damage).toBe(0);
    expect(win.exploded).toBe(false);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.getByRole("button", { name: "Back to hangar" })).toBeVisible();
    await page.getByRole("button", { name: "Back to hangar" }).click();
    await tick(page, 2);
    await expect(page.getByRole("button", { name: "Begin test" })).toBeVisible();
  });
});
