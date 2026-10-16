import { test, expect } from "@playwright/test";

// Exercise the full game with actual touch input. The player-card sandbox has
// its own suite; these checks protect phone/tablet menus and thumb controls.
test.skip(Boolean(process.env.PWA_TEST_URL), "Runtime checks use development telemetry.");

const sizes = [
  [320, 568],
  [390, 844],
  [430, 932],
  [768, 1024],
  [1024, 768],
  [568, 320],
  [844, 390],
  [1440, 900],
];

async function openGame(browser, baseURL, width, height, { manualSeen = true } = {}) {
  const touch = width !== 1440;
  const context = await browser.newContext({
    baseURL,
    viewport: { width, height },
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ manualSeen }) => {
    if (!localStorage.getItem("roadster-settings"))
      localStorage.setItem("roadster-settings", JSON.stringify({
        quality: "low", muted: true, music: true, voices: true,
        haptics: false, shake: false,
      }));
    if (manualSeen) localStorage.setItem("roadster-manual-seen", "true");
  }, { manualSeen });
  await page.goto("/");
  await page.waitForFunction(() => window.__roadster && !document.querySelector("#loading"));
  return { context, page, errors, touch };
}

async function bounds(page, selector) {
  return page.locator(selector).evaluateAll((elements) => elements
    .filter((element) => element.getClientRects().length)
    .map((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return {
        name: element.getAttribute("aria-label") || element.textContent.trim(),
        x: box.x, y: box.y, width: box.width, height: box.height,
        right: box.right, bottom: box.bottom,
        visible: box.x >= -1 && box.y >= -1 &&
          box.right <= (visualViewport?.width || innerWidth) + 1 &&
          box.bottom <= (visualViewport?.height || innerHeight) + 1,
        receivesPointer: element === hit || element.contains(hit),
        textFits: element.scrollWidth <= element.clientWidth + 1,
      };
    }));
}

async function expectTappable(page, selector, minimum = 44) {
  const boxes = await bounds(page, selector);
  expect(boxes.length, selector).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.visible, `${box.name}: inside the screen`).toBe(true);
    expect(box.receivesPointer, `${box.name}: receives a tap`).toBe(true);
    expect(box.width, `${box.name}: touch width`).toBeGreaterThanOrEqual(minimum - 0.1);
    expect(box.height, `${box.name}: touch height`).toBeGreaterThanOrEqual(minimum - 0.1);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlapX = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      expect(overlapX > 1 && overlapY > 1, `${a.name} overlaps ${b.name}`).toBe(false);
    }
  }
}

async function activate(page, locator, touch = true) {
  if (touch) await locator.tap();
  else await locator.click();
}

async function start(page, index = 1, touch = true) {
  await activate(page, page.locator(`[data-level="${index}"]`), touch);
  await activate(page, page.getByRole("button", { name: "Begin test" }), touch);
  await page.waitForFunction(() => window.__roadster.input.enabled);
}

// Scroll using a finger gesture, never locator auto-scrolling or scrollTop.
// This catches touch-action:none on an ancestor, which mouse tests miss.
async function swipeDialog(page, session, direction = "up") {
  const box = await page.getByRole("dialog").boundingBox();
  const x = box.x + box.width * 0.62;
  const high = box.y + Math.min(76, box.height * 0.24);
  const low = box.y + box.height - 38;
  const from = direction === "up" ? low : high;
  const to = direction === "up" ? high : low;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart", touchPoints: [{ x, y: from, id: 9 }],
  });
  for (let i = 1; i <= 10; i++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: [{ x, y: from + (to - from) * i / 10, id: 9 }],
    });
    await page.waitForTimeout(18);
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(180);
}

async function revealByTouch(page, session, selector) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const [box] = await bounds(page, selector);
    if (box?.visible && box.receivesPointer) return;
    await swipeDialog(page, session);
  }
  const [box] = await bounds(page, selector);
  expect(box?.visible && box.receivesPointer, `${selector} can be reached by swiping`).toBe(true);
}

for (const [width, height] of sizes) {
  test(`title, all level cards, and game controls fit ${width}×${height}`, async ({ browser, baseURL }) => {
    const { page, context, errors, touch } = await openGame(browser, baseURL, width, height);
    try {
      await expectTappable(page, '.topbar a.brand, .topbar button:not([hidden]), #hangar [data-level], #hangar [data-action="start"]', touch ? 44 : 20);
      for (const box of await bounds(page, ".roadster-wordmark, .mission-info h2")) {
        expect(box.visible, `${box.name}: visible heading`).toBe(true);
        expect(box.textFits, `${box.name}: no clipped heading`).toBe(true);
      }
      for (const index of [0, 1, 2]) {
        await activate(page, page.locator(`[data-level="${index}"]`), touch);
        await expect(page.locator(`[data-level="${index}"]`)).toHaveAttribute("aria-pressed", "true");
      }
      await start(page, 1, touch);
      // A realistic three-digit speed must fit beside the other instruments.
      await page.evaluate(() => window.__roadster.physics.body.velocity.set(0, 0, 42));
      await expect.poll(async () => Number(await page.locator("#speed").textContent())).toBeGreaterThan(99);
      for (const box of await bounds(page, ".telemetry, .speed-readout, .telemetry-detail")) {
        expect(box.visible, `${box.name}: readable telemetry`).toBe(true);
        expect(box.textFits, `${box.name}: telemetry fits at speed`).toBe(true);
      }
      await expectTappable(page, '#hud [data-control], #hud [data-action], .topbar button:not([hidden])', touch ? 44 : 20);
      const title = await page.locator(".mission-title").boundingBox();
      const status = await page.locator(".flight-status").boundingBox();
      if (status?.width && status?.height) {
        expect(status.y >= title.y + title.height || status.x >= title.x + title.width ||
          title.y >= status.y + status.height || title.x >= status.x + status.width,
          "Flight status must not cover the objective").toBe(true);
      }
      await activate(page, page.getByRole("button", { name: "Pause game" }), touch);
      await expectTappable(page, '#dialog [data-action="close"], #dialog [data-action="reset"], #dialog [data-action="home"]', touch ? 44 : 20);
      await activate(page, page.getByRole("button", { name: "Return to hangar", exact: true }), touch);
      await expect(page.getByRole("button", { name: "Begin test" })).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

for (const [width, height] of [[320, 568], [568, 320], [768, 1024]]) {
  test(`help, preferences, and install instructions work with finger scrolling at ${width}×${height}`, async ({ browser, baseURL }) => {
    const { page, context, errors } = await openGame(browser, baseURL, width, height);
    const session = await context.newCDPSession(page);
    try {
      await page.getByRole("button", { name: "Flight manual" }).tap();
      const scrollable = await page.getByRole("dialog").evaluate((element) => element.scrollHeight > element.clientHeight + 2);
      if (scrollable) {
        await swipeDialog(page, session);
        expect(await page.getByRole("dialog").evaluate((element) => element.scrollTop), "Manual reacts to a real finger swipe").toBeGreaterThan(15);
      }
      await revealByTouch(page, session, '#dialog .primary-button[data-action="close"]');
      if (scrollable) {
        // Starting a swipe on a large action must not trap scrolling inside
        // the button itself. Move down toward the earlier manual content.
        const action = await page.getByRole("button", { name: "Understood. Probably." }).boundingBox();
        const before = await page.getByRole("dialog").evaluate((element) => element.scrollTop);
        const x = action.x + action.width / 2;
        const from = action.y + action.height / 2;
        const to = height - 5;
        await session.send("Input.dispatchTouchEvent", {
          type: "touchStart", touchPoints: [{ x, y: from, id: 11 }],
        });
        for (let step = 1; step <= 10; step++) {
          await session.send("Input.dispatchTouchEvent", {
            type: "touchMove", touchPoints: [{ x, y: from + (to - from) * step / 10, id: 11 }],
          });
          await page.waitForTimeout(18);
        }
        await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await expect.poll(() => page.getByRole("dialog").evaluate((element) => element.scrollTop),
          "A swipe beginning on the primary button also scrolls the manual").toBeLessThan(before - 5);
        await revealByTouch(page, session, '#dialog .primary-button[data-action="close"]');
      }
      await page.getByRole("button", { name: "Understood. Probably." }).tap();
      await page.getByRole("button", { name: "Settings", exact: true }).tap();
      expect(await page.getByRole("dialog").evaluate((element) => element.scrollTop), "A new dialog starts at the top").toBe(0);
      await revealByTouch(page, session, "#setting-music");
      await page.locator('label:has(#setting-music)').tap();
      await expect(page.locator("#setting-music")).not.toBeChecked();
      await revealByTouch(page, session, "#setting-quality");
      await page.locator("#setting-quality").selectOption("balanced");
      await revealByTouch(page, session, '#dialog [data-action="save-settings"]');
      await page.getByRole("button", { name: "Ready for liftoff" }).tap();
      await page.reload();
      await page.waitForFunction(() => window.__roadster && !document.querySelector("#loading"));
      await page.getByRole("button", { name: "Settings", exact: true }).tap();
      await expect(page.locator("#setting-music")).not.toBeChecked();
      await expect(page.locator("#setting-quality")).toHaveValue("balanced");
      await page.getByRole("button", { name: "Close dialog", exact: true }).tap();
      await page.getByRole("button", { name: "Install Roadster on this device" }).tap();
      await expect(page.getByRole("heading", { name: "Take flight from your home screen." })).toBeVisible();
      await revealByTouch(page, session, '#dialog .primary-button[data-action="close"]');
      await page.getByRole("button", { name: "Got it", exact: true }).tap();
      await expect(page.getByRole("dialog")).not.toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test("phone first-run manual, all three levels, results, and rotation remain operable", async ({ browser, baseURL }) => {
  const { page, context, errors } = await openGame(browser, baseURL, 390, 844, { manualSeen: false });
  const session = await context.newCDPSession(page);
  try {
    await page.getByRole("button", { name: "Begin test" }).tap();
    expect(await page.evaluate(() => window.__roadster.paused)).toBe(true);
    await revealByTouch(page, session, '#dialog .primary-button[data-action="close"]');
    await page.getByRole("button", { name: "Understood. Probably." }).tap();
    await page.waitForFunction(() => window.__roadster.input.enabled);
    // Drive across the physical finish boundary to get the actual results flow.
    await page.evaluate(() => {
      window.__roadster.physics.body.position.set(0, 0.74, 23.9);
      window.__roadster.physics.body.velocity.set(0, 0, 2);
    });
    await expect(page.getByRole("heading", { name: /Garage departed/ })).toBeVisible();
    await revealByTouch(page, session, '#dialog [data-action="next"]');
    await page.getByRole("button", { name: "Next test", exact: true }).tap();
    await page.waitForFunction(() => window.__roadster.input.enabled);
    await expect(page.locator("#hud-level-name")).toHaveText("The quarter mile");
    const q = await page.locator('[data-control="q"]').boundingBox();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart", touchPoints: [{ x: q.x + q.width / 2, y: q.y + q.height / 2, id: 1 }],
    });
    await expect.poll(() => page.evaluate(() => window.__roadster.input.state.q)).toBe(1);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(() => page.evaluate(() => window.__roadster.input.state.q), "Rotation releases held thrusters").toBe(0);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expectTappable(page, '#hud [data-control], #hud [data-action]');
    await page.getByRole("button", { name: "Pause game" }).tap();
    await page.getByRole("button", { name: "Restart test", exact: true }).tap();
    await page.waitForFunction(() => window.__roadster.input.enabled);
    expect(await page.evaluate(() => window.__roadster.physics.damage)).toBe(0);
    // Set up an out-of-bounds trajectory so the real solver ends the run.
    await page.evaluate(() => window.__roadster.physics.body.position.set(181, 3, 0));
    await expect(page.getByRole("heading", { name: "We have lost the vehicle." })).toBeVisible();
    await revealByTouch(page, session, '#dialog [data-action="home"]');
    await page.getByRole("button", { name: "Return to hangar", exact: true }).tap();
    await start(page, 2);
    await expect(page.locator("#hud-level-name")).toHaveText("The inversion");
    await expect(page.locator("#drive-label")).toHaveText("AUTODRIVE ON");
    await page.getByRole("button", { name: "Pause game" }).tap();
    await page.getByRole("button", { name: "Return to hangar", exact: true }).tap();
    await page.setViewportSize({ width: 390, height: 844 });
    await expectTappable(page, '#hangar [data-level], #hangar [data-action="start"]');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

for (const [width, height] of [[568, 320], [844, 390]]) {
  test(`success and failure results expose both actions in ${width}×${height} landscape`, async ({ browser, baseURL }) => {
    const { page, context, errors } = await openGame(browser, baseURL, width, height);
    try {
      await start(page, 0);
      await page.evaluate(() => {
        window.__roadster.physics.body.position.set(0, 0.74, 23.9);
        window.__roadster.physics.body.velocity.set(0, 0, 2);
      });
      await expect(page.getByRole("heading", { name: /Garage departed/ })).toBeVisible();
      await expectTappable(page, '#dialog [data-action="next"], #dialog [data-action="reset"]');
      await page.getByRole("button", { name: "Next test", exact: true }).tap();
      await page.waitForFunction(() => window.__roadster.input.enabled);
      await page.evaluate(() => window.__roadster.physics.body.position.set(181, 3, 0));
      await expect(page.getByRole("heading", { name: "We have lost the vehicle." })).toBeVisible();
      await expectTappable(page, '#dialog [data-action="reset"], #dialog [data-action="home"]');
      await page.getByRole("button", { name: "Return to hangar", exact: true }).tap();
      await expect(page.getByRole("button", { name: "Begin test" })).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
