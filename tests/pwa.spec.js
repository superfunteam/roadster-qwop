import { test, expect } from "@playwright/test";

// Build and serve first, then run:
// PWA_TEST_URL=http://localhost:4173 npx playwright test tests/pwa.spec.js
test.skip(
  !process.env.PWA_TEST_URL,
  "Production offline test needs a built preview in PWA_TEST_URL.",
);

test("published media stays online-only and never becomes an offline game download", async ({ page, context }) => {
  const mediaRequests = [];
  context.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/media/"))
      mediaRequests.push(request.url());
  });
  await page.goto("/graphics-check.html");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  expect(mediaRequests).toEqual([]);
  const online = await page.evaluate(async () => {
    const image = await fetch("/media/roadster-open-source-octocat.png");
    const video = await fetch("/media/roadster-trailer-v3.mp4", {
      headers: { Range: "bytes=0-127" },
    });
    return {
      imageStatus: image.status,
      imageType: image.headers.get("content-type"),
      videoStatus: video.status,
      videoType: video.headers.get("content-type"),
      videoRange: video.headers.get("content-range"),
      videoBytes: (await video.arrayBuffer()).byteLength,
    };
  });
  expect(online.imageStatus).toBe(200);
  expect(online.imageType).toContain("image/png");
  expect(online.videoStatus).toBe(206);
  expect(online.videoType).toContain("video/mp4");
  expect(online.videoRange).toMatch(/^bytes 0-127\/\d+$/);
  expect(online.videoBytes).toBe(128);
  const cachedPaths = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith("roadster-flight-test-"));
    return (await Promise.all(names.map(async (name) => {
      const cache = await caches.open(name);
      return (await cache.keys()).map((request) => new URL(request.url).pathname);
    }))).flat();
  });
  expect(cachedPaths).toContain("/index.html");
  expect(cachedPaths.filter((path) => path.startsWith("/media/"))).toEqual([]);

  // A direct media navigation while offline must fail as a media request,
  // never return the game shell or launch a WebGL workload.
  await context.setOffline(true);
  await page.route("**/media/**", (route) => route.abort("internetdisconnected"));
  await expect(page.goto("/media/roadster-trailer-v3.mp4")).rejects.toThrow();
  expect(await page.locator("#game-canvas").count()).toBe(0);
});

test("the offline diagnostic stays separate from the game shell", async ({ page, context }) => {
  await page.goto("/graphics-check.html");
  // Install the production worker explicitly for this test. The diagnostic
  // itself must neither register it nor import any game code.
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  // Netlify can serve this file through clean URL aliases too.
  for (const path of ["/graphics-check.html", "/graphics-check", "/graphics-check/"]) {
    await page.goto(`${path}?offline-check`);
    await expect(page).toHaveTitle("Roadster — Graphics check");
    await expect(page.getByRole("button", { name: "Run graphics check" })).toBeVisible();
    await expect(page.locator("#game-canvas")).toHaveCount(0);
    expect(await page.evaluate(() => typeof window.__roadster)).toBe("undefined");
  }
  await page.getByRole("button", { name: "Run graphics check" }).click();
  await expect(page.getByRole("heading", { name: "The single-pixel check passed." })).toBeVisible();
});

test("production assets, install metadata, and the playable game survive an offline reload", async ({
  page,
  context,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("roadster-manual-seen", "true");
    localStorage.setItem(
      "roadster-settings",
      JSON.stringify({
        quality: "low",
        muted: true,
        haptics: false,
        shake: false,
      }),
    );
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Begin test" })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const metadata = await page.evaluate(async () => {
    const manifest = await (await fetch("/manifest.webmanifest")).json();
    const iconResponses = await Promise.all(
      manifest.icons.map(async (icon) => ({
        ...icon,
        ok: (await fetch(icon.src)).ok,
      })),
    );
    const screenshots = await Promise.all(
      manifest.screenshots.map(async (screenshot) => {
        const image = new Image();
        image.src = screenshot.src;
        await image.decode();
        return {
          declared: screenshot.sizes,
          actual: `${image.naturalWidth}x${image.naturalHeight}`,
        };
      }),
    );
    const picture = new Image();
    picture.src = "/og-image.png";
    await picture.decode();
    return {
      manifest,
      iconResponses,
      screenshots,
      width: picture.naturalWidth,
      height: picture.naturalHeight,
      canonical: document.querySelector('link[rel="canonical"]').href,
      og: document.querySelector('meta[property="og:image"]').content,
    };
  });
  expect(metadata.manifest.start_url).toBe("/");
  expect(metadata.manifest.scope).toBe("/");
  expect(metadata.manifest.orientation).toBe("any");
  expect(metadata.iconResponses.every((icon) => icon.ok)).toBe(true);
  expect(
    metadata.iconResponses.some((icon) => icon.purpose === "maskable"),
  ).toBe(true);
  expect(
    metadata.screenshots.every(
      (screenshot) => screenshot.declared === screenshot.actual,
    ),
  ).toBe(true);
  expect([metadata.width, metadata.height]).toEqual([1200, 630]);
  expect(metadata.canonical).toBe("https://roadster.superfun.games/");
  expect(metadata.og).toBe("https://roadster.superfun.games/og-image.png");
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Begin test" })).toBeVisible();
  await page.getByRole("button", { name: "Begin test" }).click();
  await expect(page.locator("#hud-level-name")).toHaveText("The garage");
  await expect
    .poll(() => page.locator("#timer").textContent())
    .not.toBe("00:00.00");
  await page.keyboard.down("q");
  await expect(page.locator('[data-control="q"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.up("q");
  await expect(page.locator('[data-control="q"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.keyboard.down("ArrowUp");
  await expect
    .poll(async () => Number(await page.locator("#speed").textContent()))
    .toBeGreaterThan(0);
  await page.keyboard.up("ArrowUp");
  for (const [id, index, name] of [
    ["drag", 1, "The quarter mile"],
    ["ramp", 2, "The inversion"],
    ["factory", 3, "The Gigafactory"],
  ]) {
    await page.goto(`/?test=${id}`);
    await expect(page.locator(`[data-level="${index}"]`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Begin test" }).click();
    await expect(page.locator("#hud-level-name")).toHaveText(name);
  }
  // An installed full-game worker may control the separate player URL too.
  // Its offline navigation fallback must return the player HTML entry.
  await page.goto("/player/");
  await expect(page).toHaveTitle("Roadster — But Can It Fly? | Play");
  await expect(page.locator("html")).toHaveAttribute("data-player", "true");
  await expect(page.getByRole("button", { name: "Begin test" })).toBeVisible();
  await expect(page.locator("#install-button")).toBeHidden();
  await page.getByRole("button", { name: "Begin test" }).click();
  await expect(page.locator("#hud-level-name")).toHaveText("The garage");
  expect(errors).toEqual([]);
});
