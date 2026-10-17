import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { AUDIO_FILES } from "../src/audio-manifest.js";

// A real second origin is essential here. A same-origin iframe (or a mocked
// module response) would miss the sandbox's opaque-origin CORS/storage failures.
let host;
let parentOrigin;
const failures = new WeakMap();
const workerRequests = new WeakMap();
const production = Boolean(process.env.PWA_TEST_URL);

test.beforeAll(async () => {
  host = createServer((request, response) => {
    const query = new URL(request.url, "http://localhost").searchParams;
    const source = query.get("source");
    const width = Number(query.get("width")) || 640;
    const height = Number(query.get("height")) || 480;
    const sandbox =
      query.get("trusted") === "true"
        ? "allow-scripts allow-same-origin allow-popups"
        : "allow-scripts allow-popups";
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Player sandbox test</title><style>html,body{margin:0;background:#eef0f3}iframe{display:block;border:0;width:${width}px;height:${height}px}button{margin:8px}</style></head><body><iframe title="Roadster player" sandbox="${sandbox}" allow="autoplay; fullscreen" src="${source?.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></iframe><button id="outside">Focus the timeline</button></body></html>`,
    );
  });
  await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
  parentOrigin = `http://127.0.0.1:${host.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolve, reject) =>
    host.close((error) => (error ? reject(error) : resolve())),
  );
});

test.beforeEach(async ({ page }) => {
  const errors = [];
  const requests = [];
  failures.set(page, errors);
  workerRequests.set(page, requests);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/sw.js")
      requests.push(request.url());
  });
});

test.afterEach(async ({ page }) => {
  expect(
    failures.get(page),
    "The player must have no uncaught browser errors",
  ).toEqual([]);
  expect(
    workerRequests.get(page),
    "Embedded games must not register a service worker",
  ).toEqual([]);
});

async function openFrame(
  page,
  baseURL,
  { width = 640, height = 480, trusted = false } = {},
) {
  const source = new URL("/player/", baseURL).href;
  const query = new URLSearchParams({ source, width, height, trusted });
  await page.goto(`${parentOrigin}/?${query}`);
  await expect(
    page.frameLocator("iframe").getByRole("button", { name: "Begin test" }),
  ).toBeVisible();
  const frame = page.frames().find((item) => item.url().startsWith(source));
  expect(
    frame,
    "Player document loaded into a distinct child frame",
  ).toBeTruthy();
  await expect(frame.locator("#loading")).toHaveCount(0);
  if (!production)
    await frame.waitForFunction(() => Boolean(window.__roadster));
  return frame;
}

async function start(frame, index = 1) {
  await frame.locator(`[data-level="${index}"]`).click();
  await frame.getByRole("button", { name: "Begin test" }).click();
  await expect(frame.locator("#hud-level-name")).toBeVisible();
  await expect(frame.getByRole("dialog")).not.toBeVisible();
  if (!production)
    await frame.waitForFunction(() => window.__roadster.input.enabled);
  else
    await expect
      .poll(() => frame.locator("#timer").textContent())
      .not.toBe("00:00.00");
}

async function expectControlsAccessible(frame, selectors, availableHeight) {
  const boxes = await frame.evaluate(
    ({ selectors, availableHeight }) => {
      const height = availableHeight ?? innerHeight;
      return [...document.querySelectorAll(selectors)]
        .filter((element) => element.getClientRects().length)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const center = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          );
          return {
            name:
              element.getAttribute("aria-label") || element.textContent.trim(),
            width: rect.width,
            height: rect.height,
            inBounds:
              rect.left >= -1 &&
              rect.top >= -1 &&
              rect.right <= innerWidth + 1 &&
              rect.bottom <= height + 1,
            receivesPointer: element === center || element.contains(center),
          };
        });
    },
    { selectors, availableHeight },
  );
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.width, `${box.name}: visible width`).toBeGreaterThan(12);
    expect(box.height, `${box.name}: visible height`).toBeGreaterThan(12);
    expect(
      box.inBounds,
      `${box.name}: fully inside the usable player area`,
    ).toBe(true);
    expect(
      box.receivesPointer,
      `${box.name}: no other control covers its center`,
    ).toBe(true);
  }
}

const menuControls = '#hangar [data-level], #hangar [data-action="start"]';
const gameControls =
  '#hud [data-control], #hud [data-touch-pad="drive"], #hud [data-jets], #hud [data-action="reset"], #hud [data-action="pause"]';

test.describe("sandboxed player runtime", () => {
  test.skip(
    production,
    "Runtime telemetry is development-only; production has a separate smoke test.",
  );

  test("opaque-origin sandbox plays with denied storage, gesture-only audio, keyboard jets, pause and reset", async ({
    page,
    baseURL,
  }) => {
    const frame = await openFrame(page, baseURL);
    const before = await frame.evaluate(() => {
      let storageDenied = false;
      try {
        localStorage.setItem("player-probe", "1");
      } catch {
        storageDenied = true;
      }
      return {
        opaque: window.origin === "null",
        storageDenied,
        drawn: window.__roadster.renderer.info.render.calls > 0,
        audio: window.__roadster.audio.debugSnapshot(),
      };
    });
    expect(before).toMatchObject({
      opaque: true,
      storageDenied: true,
      drawn: true,
    });
    expect(before.audio.contextState).toBe("uninitialized");
    expect(before.audio.music.activeSources).toBe(0);
    await expect(frame.locator("#install-button")).toBeHidden();
    await start(frame);
    await expect
      .poll(() =>
        frame.evaluate(
          () => window.__roadster.audio.debugSnapshot().contextState,
        ),
      )
      .toBe("running");
    await expect
      .poll(() =>
        frame.evaluate(
          () => window.__roadster.audio.debugSnapshot().loaded.length,
        ),
      )
      .toBe(Object.keys(AUDIO_FILES).length);
    expect(
      await frame.evaluate(
        () => window.__roadster.audio.debugSnapshot().failed,
      ),
    ).toEqual([]);
    for (const key of ["q", "w", "o", "p"]) await page.keyboard.down(key);
    await expect
      .poll(() =>
        frame.evaluate(() => window.__roadster.physics.state.altitude),
      )
      .toBeGreaterThan(0.4);
    for (const key of ["q", "w", "o", "p"]) await page.keyboard.up(key);
    await page.keyboard.press("Escape");
    await expect(
      frame.getByRole("heading", { name: "Take a breath." }),
    ).toBeVisible();
    await expect
      .poll(() =>
        frame.evaluate(
          () => window.__roadster.audio.debugSnapshot().contextState,
        ),
      )
      .toBe("suspended");
    const time = await frame.evaluate(() => window.__roadster.physics.time);
    await page.waitForTimeout(200);
    expect(await frame.evaluate(() => window.__roadster.physics.time)).toBe(
      time,
    );
    await page.keyboard.press("r");
    await expect(frame.getByRole("dialog")).not.toBeVisible();
    expect(
      await frame.evaluate(() => ({
        damage: window.__roadster.physics.damage,
        pressed: [...window.__roadster.input.keys],
      })),
    ).toEqual({ damage: 0, pressed: [] });
  });

  test("switching focus to the host releases held controls and pauses, then resumes deliberately", async ({
    page,
    baseURL,
  }) => {
    const frame = await openFrame(page, baseURL, { trusted: true });
    expect(await frame.evaluate(() => window.origin)).toBe(
      new URL(baseURL).origin,
    );
    await start(frame);
    await page.keyboard.down("q");
    await page.keyboard.down("ArrowUp");
    await expect
      .poll(() => frame.evaluate(() => window.__roadster.input.state.q))
      .toBe(1);
    await page.locator("#outside").click();
    await expect(
      frame.getByRole("heading", { name: "Take a breath." }),
    ).toBeVisible();
    expect(
      await frame.evaluate(() => ({
        keys: window.__roadster.input.keys.size,
        pointers: window.__roadster.input.pointers.size,
        paused: window.__roadster.paused,
      })),
    ).toEqual({ keys: 0, pointers: 0, paused: true });
    await page.keyboard.up("q");
    await page.keyboard.up("ArrowUp");
    await frame.getByRole("button", { name: "Resume test" }).click();
    await expect
      .poll(() => frame.evaluate(() => window.__roadster.paused))
      .toBe(false);
    await frame.locator('#hud [data-action="reset"]').click();
    expect(await frame.evaluate(() => window.__roadster.physics.time)).toBe(0);
  });
});

for (const [width, height] of [
  [640, 480],
  [320, 240],
]) {
  test(`player controls fit and remain clickable inside a ${width}×${height} card`, async ({
    page,
    baseURL,
  }) => {
    const frame = await openFrame(page, baseURL, { width, height });
    await expect(
      frame.getByRole("link", { name: "Open full game" }),
    ).toHaveAttribute("href", "https://roadster.superfun.games/");
    await expect(
      frame.getByRole("link", { name: "Open full game" }),
    ).toHaveAttribute("target", "_blank");
    await expect(
      frame.getByRole("link", { name: "Open full game" }),
    ).toHaveAttribute("rel", /noopener/);
    await expectControlsAccessible(frame, menuControls);
    await start(frame);
    await expectControlsAccessible(frame, gameControls);
    await frame.getByRole("button", { name: "Pause game" }).click();
    await expectControlsAccessible(
      frame,
      '#dialog [data-action="close"], #dialog [data-action="reset"], #dialog [data-action="home"]',
    );
    await frame.getByRole("button", { name: "Resume test" }).click();
  });
}

test.describe("touch player", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("portrait iframe uses its full allocated height and accepts four simultaneous jet touches", async ({
    page,
    context,
    baseURL,
  }) => {
    const frame = await openFrame(page, baseURL, { width: 390, height: 600 });
    await expectControlsAccessible(frame, menuControls);
    await start(frame);
    await expectControlsAccessible(frame, gameControls);
    const canvasHeight = await frame
      .locator("#game-canvas")
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(canvasHeight).toBeCloseTo(600, 0);
    const points = [];
    for (const [index, key] of ["q", "w", "o", "p"].entries()) {
      const rect = await frame.locator(`[data-jets="${key}"]`).boundingBox();
      points.push({
        id: index + 1,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        radiusX: 3,
        radiusY: 3,
        force: 1,
      });
    }
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: points,
    });
    for (const key of ["q", "w", "o", "p"])
      await expect(frame.locator(`[data-jets="${key}"]`)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    if (!production)
      await expect
        .poll(() =>
          frame.evaluate(() =>
            window.__roadster.physics.boosterLevels.every(
              (amount) => amount > 0.3,
            ),
          ),
        )
        .toBe(true);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    for (const key of ["q", "w", "o", "p"])
      await expect(frame.locator(`[data-jets="${key}"]`)).toHaveAttribute(
        "aria-pressed",
        "false",
      );
  });

  test("top-level mobile player keeps play and dialog controls clear of a bottom 30% host panel", async ({
    page,
  }) => {
    await page.goto("/player/");
    await expect(
      page.getByRole("button", { name: "Begin test" }),
    ).toBeVisible();
    await expect(page.locator("#loading")).toHaveCount(0);
    await page.evaluate(() => {
      const panel = document.createElement("div");
      panel.id = "test-host-panel";
      panel.style.cssText =
        "position:fixed;bottom:0;left:0;width:100%;height:30%;z-index:2147483647;background:#222";
      document.body.append(panel);
    });
    const usableHeight = 844 * 0.7;
    await expectControlsAccessible(page, menuControls, usableHeight);
    await start(page);
    await expectControlsAccessible(page, gameControls, usableHeight);
    await page.getByRole("button", { name: "Pause game" }).click();
    await expectControlsAccessible(
      page,
      '#dialog [data-action="close"], #dialog [data-action="reset"], #dialog [data-action="home"]',
      usableHeight,
    );
    await page.getByRole("button", { name: "Resume test" }).click();
  });
});
