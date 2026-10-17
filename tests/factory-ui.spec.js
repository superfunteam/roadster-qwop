import { test, expect } from "@playwright/test";

// Test the actual UI and stylesheet stack without a GPU, so a layout failure
// cannot be confused with a device's context-creation failure.
test.skip(Boolean(process.env.PWA_TEST_URL), "UI fixture imports development modules.");

async function openUI(browser, baseURL, width, height, player = false) {
  const context = await browser.newContext({
    baseURL, viewport: { width, height }, hasTouch: width < 1100,
    isMobile: width < 1100, deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.route("**/__factory-ui-test", (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html ${player ? 'data-player="true"' : ""}><head><meta name="viewport" content="width=device-width,initial-scale=1">${["style", "viewport", "responsive-menus", "responsive-controls", "embed", "touch-controls"].map((name) => `<link rel="stylesheet" href="/src/${name}.css">`).join("")}</head><body><div id="app"></div><script type="module">
      import { UI, LEVELS } from '/src/ui.js';
      window.levels = LEVELS;
      window.ui = new UI((action) => {
        if(action === 'start') ui.game(LEVELS[ui.selected]);
        if(action === 'home') ui.home();
        if(action === 'next') ui.selected + 1 < LEVELS.length ? ui.game(LEVELS[++ui.selected]) : ui.home();
      }, { muted: true });
      window.state = { time:12, maxSpeed:14, maxAltitude:8, damage:0, pressure:1,
        boosterLevels:[0,0,0,0], rearBoost:0, position:{z:0}, distance:0,
        grounded:false, ringCount:0, ringGoal:5, ringTotal:10 };
    </script></body></html>`,
  }));
  await page.goto("/__factory-ui-test");
  await page.waitForFunction(() => window.ui);
  return { context, page };
}

async function visibleBounds(page, selector) {
  return page.locator(selector).evaluateAll((elements) => elements
    .filter((element) => element.getClientRects().length)
    .map((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return {
        label: element.textContent.trim(), x: box.x, y: box.y,
        width: box.width, height: box.height, right: box.right, bottom: box.bottom,
        inView: box.x >= -1 && box.y >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1,
        tappable: hit === element || element.contains(hit),
        fits: element.scrollWidth <= element.clientWidth + 1,
      };
    }));
}

for (const [width, height, player] of [
  [320, 568, false], [390, 844, false], [768, 1024, false],
  [568, 320, false], [844, 390, false], [1024, 768, false],
  [1440, 900, false], [390, 590, true], [640, 480, true], [320, 240, true],
]) {
  test(`four tests and ring objective fit ${width}×${height}${player ? " player" : ""}`, async ({ browser, baseURL }) => {
    const { context, page } = await openUI(browser, baseURL, width, height, player);
    try {
      await expect(page.locator(".mission")).toHaveCount(4);
      for (const box of await visibleBounds(page, '.mission, [data-action="start"]')) {
        expect(box.inView, `${box.label}: in viewport`).toBe(true);
        expect(box.tappable, `${box.label}: receives tap`).toBe(true);
        expect(box.width, `${box.label}: width`).toBeGreaterThanOrEqual(44);
        expect(box.height, `${box.label}: height`).toBeGreaterThanOrEqual(44);
      }
      for (const box of await visibleBounds(page, ".mission-info h2"))
        expect(box.fits, `${box.label}: fits card`).toBe(true);
      if (width <= 1100) {
        const boxes = await visibleBounds(page, ".mission");
        expect(boxes[2].y).toBeGreaterThan(boxes[0].y);
      }
      await page.screenshot({ path: `reference/qa/factory-menu-${width}x${height}${player ? "-player" : ""}.png` });
      await page.locator('[data-level="3"]').click();
      await expect(page.locator('[data-level="3"]')).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Begin test" }).click();
      await expect(page.locator("#ring-count")).toHaveText("0 / 5");
      for (const box of await visibleBounds(page, ".ring-objective, .ring-objective-heading")) {
        expect(box.inView, "ring objective in viewport").toBe(true);
        expect(box.fits, "ring objective text fits").toBe(true);
      }
      const [ring] = await visibleBounds(page, ".ring-objective");
      const controls = await visibleBounds(page, '.telemetry, .flight-status, [data-action="pause"], .touch-controls, .game-toolbar');
      for (const box of controls) {
        const overlap = Math.min(ring.right, box.right) - Math.max(ring.x, box.x) > 1 &&
          Math.min(ring.bottom, box.bottom) - Math.max(ring.y, box.y) > 1;
        expect(overlap, `ring objective overlaps ${box.label}`).toBe(false);
      }
      await page.screenshot({ path: `reference/qa/factory-ui-${width}x${height}${player ? "-player" : ""}.png` });
    } finally { await context.close(); }
  });
}

test("ring progress resets and all four win screens navigate correctly", async ({ browser, baseURL }) => {
  const { context, page } = await openUI(browser, baseURL, 1100, 760);
  try {
    await page.evaluate(() => {
      ui.selected = 3;
      ui.game(levels[3]);
      ui.update({ ...state, ringCount: 3 }, levels[3]);
    });
    await expect(page.locator("#ring-count")).toHaveText("3 / 5");
    await expect(page.locator("#ring-total")).toHaveText("7 AVAILABLE");
    await expect(page.getByRole("progressbar", { name: "Rings cleared" })).toHaveAttribute("aria-valuenow", "3");
    await page.evaluate(() => ui.game(levels[3]));
    await expect(page.locator("#ring-count")).toHaveText("0 / 5");
    await page.evaluate(() => ui.game(levels[0]));
    await expect(page.locator("#ring-objective")).toBeHidden();
    for (const index of [0, 1, 2, 3]) {
      await page.evaluate((index) => {
        ui.selected = index;
        ui.game(levels[index]);
        ui.result({ ...state, outcome: "success", ringCount: 5 }, levels[index]);
      }, index);
      await expect(page.locator("#dialog-title")).not.toContainText("undefined");
      const next = page.getByRole("button", { name: index === 3 ? "Back to hangar" : "Next test" });
      await expect(next).toBeVisible();
      await next.click();
      if (index < 3)
        await expect(page.locator("#hud-level-name")).toHaveText(await page.evaluate((index) => levels[index + 1].name, index));
      else await expect(page.getByRole("button", { name: "Begin test" })).toBeVisible();
    }
  } finally { await context.close(); }
});
