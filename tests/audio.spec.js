import { test, expect } from "@playwright/test";
import { AUDIO_FILES } from "../src/audio-manifest.js";

const sampleIds = Object.keys(AUDIO_FILES).sort();
const sampleUrls = [...new Set(Object.values(AUDIO_FILES))];
const pageErrors = new WeakMap();

test.beforeEach(async ({ page }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("roadster-manual-seen", "true");
    if (!localStorage.getItem("roadster-settings")) {
      localStorage.setItem("roadster-settings", JSON.stringify({
        quality: "low", muted: false, music: true, voices: true,
        haptics: false, shake: false,
      }));
    }
  });
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), "No uncaught audio or game errors").toEqual([]);
});

async function openGame(page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Begin test" })).toBeVisible();
  await page.waitForFunction(() => window.__roadster?.audio && !document.querySelector("#loading"));
}

async function snapshot(page) {
  return page.evaluate(() => window.__roadster.audio.debugSnapshot());
}

async function unlockMenuAudio(page) {
  // A trusted click unlocks Web Audio while leaving the game in its menu.
  await page.locator("#audio-button").click();
  await page.locator("#audio-button").click();
  await expect.poll(async () => (await snapshot(page)).contextState).toBe("running");
}

async function expectSamplesLoaded(page) {
  await expect.poll(async () => (await snapshot(page)).loaded.slice().sort(), {
    timeout: 60_000,
    message: "Every declared audio sample must decode successfully",
  }).toEqual(sampleIds);
  expect((await snapshot(page)).failed).toEqual([]);
  expect((await snapshot(page)).loading).toBe(0);
}

async function startLevel(page, index = 0) {
  await page.locator(`[data-level="${index}"]`).click();
  await page.getByRole("button", { name: "Begin test" }).click();
  await page.waitForFunction(() => window.__roadster.mode === "game" && window.__roadster.input.enabled);
}

async function returnToHangar(page) {
  await page.getByRole("button", { name: "Pause game" }).click();
  await page.getByRole("button", { name: "Return to hangar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Begin test" })).toBeVisible();
}

async function decodeSamples(page) {
  return page.evaluate(async (files) => {
    const context = new AudioContext();
    try {
      const decoded = [];
      // Sequential decoding avoids an artificial memory spike on mobile-class
      // runners while still validating every complete offline response.
      for (const [id, url] of Object.entries(files)) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        const byteLength = bytes.byteLength;
        const buffer = await context.decodeAudioData(bytes);
        let peak = 0;
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const samples = buffer.getChannelData(channel);
          for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
        }
        decoded.push({ id, bytes: byteLength, duration: buffer.duration,
          channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate, peak });
      }
      return decoded;
    } finally {
      await context.close();
    }
  }, AUDIO_FILES);
}

function expectValidSamples(decoded) {
  expect(decoded.map((sample) => sample.id).sort()).toEqual(sampleIds);
  for (const sample of decoded) {
    expect(sample.bytes, `${sample.id} has a complete response`).toBeGreaterThan(100);
    expect(sample.duration, `${sample.id} duration`).toBeGreaterThan(0.05);
    expect(sample.duration, `${sample.id} bounded duration`).toBeLessThan(180);
    expect([1, 2], `${sample.id} channel count`).toContain(sample.channels);
    expect(sample.sampleRate).toBeGreaterThanOrEqual(8_000);
    expect(sample.peak, `${sample.id} contains audible signal`).toBeGreaterThan(0.001);
  }
}

test.describe("sample audio integration", () => {
  test.skip(Boolean(process.env.PWA_TEST_URL), "Development hooks are intentionally absent in production.");

  test("every declared sample decodes and menu music starts after a user gesture", async ({ page }) => {
    await openGame(page);
    await unlockMenuAudio(page);
    await expectSamplesLoaded(page);
    expectValidSamples(await decodeSamples(page));
    await expect.poll(async () => (await snapshot(page)).music.activeSources).toBeGreaterThan(0);
    expect((await snapshot(page)).scene).toBe("menu");
    expect((await snapshot(page)).voice).toMatchObject({ id: null, pending: 0 });
  });

  test("unavailable samples retain playable synthesized effects without runtime errors", async ({ page }) => {
    await page.route("**/audio/**", (route) => route.fulfill({ status: 503, body: "Temporarily unavailable" }));
    await openGame(page);
    await startLevel(page, 1);
    await expect.poll(async () => (await snapshot(page)).failed.slice().sort()).toEqual(sampleIds);
    expect((await snapshot(page)).loaded).toEqual([]);
    expect((await snapshot(page)).contextState).toBe("running");
    const fallback = await page.evaluate(() => {
      const audio = window.__roadster.audio;
      audio.impact(12);
      return audio.debugSnapshot();
    });
    expect(fallback.oneShots).toBeGreaterThan(0);
    for (const key of ["q", "w", "o", "p"]) await page.keyboard.down(key);
    await expect.poll(() => page.evaluate(() => window.__roadster.physics.state.altitude)).toBeGreaterThan(0.4);
    for (const key of ["q", "w", "o", "p"]) await page.keyboard.up(key);
    await returnToHangar(page);
    expect(await snapshot(page)).toMatchObject({ scene: "menu", oneShots: 0, voice: { id: null, pending: 0 } });
  });

  test("delayed samples never block play or replay a previous run's voice", async ({ page }) => {
    let releaseDownloads;
    const gate = new Promise((resolve) => { releaseDownloads = resolve; });
    await page.route("**/audio/**", async (route) => {
      await gate;
      await route.continue();
    });
    try {
      await openGame(page);
      await startLevel(page);
      const loading = await snapshot(page);
      expect(loading.contextState).toBe("running");
      expect(loading.loading).toBeGreaterThan(0);
      expect(loading.loaded).toEqual([]);
      await returnToHangar(page);
      const returned = await snapshot(page);
      expect(returned.runGeneration).toBeGreaterThan(loading.runGeneration);
      expect(returned.voice).toMatchObject({ id: null, pending: 0 });
      releaseDownloads();
      await expectSamplesLoaded(page);
      await expect.poll(async () => (await snapshot(page)).music.activeSources).toBeGreaterThan(0);
      // Allow the former launch cue's scheduling window to pass after decoding.
      await page.waitForTimeout(1_600);
      expect(await snapshot(page)).toMatchObject({
        scene: "menu", paused: false, voice: { id: null, pending: 0 },
      });
    } finally {
      releaseDownloads();
      await page.unrouteAll({ behavior: "wait" });
    }
  });

  test("music and voices save independently while the master controls the whole mix", async ({ page }) => {
    await openGame(page);
    await unlockMenuAudio(page);
    await expectSamplesLoaded(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("#setting-sound")).toBeChecked();
    await expect(page.locator("#setting-music")).toBeChecked();
    await expect(page.locator("#setting-voices")).toBeChecked();
    await page.locator("#setting-music").uncheck();
    await page.getByRole("button", { name: "Ready for liftoff" }).click();
    expect((await snapshot(page)).preferences).toEqual({ music: false, voices: true });
    expect((await snapshot(page)).muted).toBe(false);
    await expect.poll(async () => (await snapshot(page)).music.activeSources).toBe(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator("#setting-music").check();
    await page.locator("#setting-voices").uncheck();
    await page.getByRole("button", { name: "Ready for liftoff" }).click();
    expect((await snapshot(page)).preferences).toEqual({ music: true, voices: false });
    await expect.poll(async () => (await snapshot(page)).music.activeSources).toBeGreaterThan(0);
    await page.locator("#audio-button").click();
    await expect.poll(async () => (await snapshot(page)).masterGain).toBeLessThan(0.001);
    expect((await snapshot(page)).muted).toBe(true);
    expect((await snapshot(page)).preferences).toEqual({ music: true, voices: false });
    await page.locator("#audio-button").click();
    await expect.poll(async () => (await snapshot(page)).masterGain).toBeGreaterThan(0.1);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__roadster?.audio));
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("#setting-sound")).toBeChecked();
    await expect(page.locator("#setting-music")).toBeChecked();
    await expect(page.locator("#setting-voices")).not.toBeChecked();
    await page.getByRole("button", { name: "Ready for liftoff" }).click();
    await startLevel(page);
    await expectSamplesLoaded(page);
    await page.waitForTimeout(1_600);
    expect((await snapshot(page)).voice).toMatchObject({ id: null, pending: 0 });
  });

  test("scene music follows each test and pause/reset clears transient playback", async ({ page }) => {
    await openGame(page);
    await unlockMenuAudio(page);
    await expectSamplesLoaded(page);
    for (const [index, scene] of ["garage", "drag", "ramp"].entries()) {
      await startLevel(page, index);
      expect((await snapshot(page)).scene).toBe(scene);
      await expect.poll(async () => (await snapshot(page)).music.activeSources).toBeGreaterThan(0);
      await page.getByRole("button", { name: "Pause game" }).click();
      await expect.poll(async () => (await snapshot(page)).contextState).toBe("suspended");
      const pausedAt = (await snapshot(page)).contextTime;
      await page.waitForTimeout(250);
      expect((await snapshot(page)).contextTime).toBe(pausedAt);
      const generation = (await snapshot(page)).runGeneration;
      await page.keyboard.press("r");
      await expect.poll(async () => (await snapshot(page)).contextState).toBe("running");
      expect((await snapshot(page)).runGeneration).toBeGreaterThan(generation);
      expect((await snapshot(page)).paused).toBe(false);
      expect((await snapshot(page)).scene).toBe(scene);
      await page.waitForFunction(() => window.__roadster.input.enabled);
      await returnToHangar(page);
      expect(await snapshot(page)).toMatchObject({ scene: "menu", voice: { id: null, pending: 0 }, oneShots: 0 });
    }
  });

  test("reset cancels active result commentary and queued voice work", async ({ page }) => {
    await openGame(page);
    await unlockMenuAudio(page);
    await expectSamplesLoaded(page);
    await startLevel(page);
    await page.evaluate(() => window.__roadster.audio.finish("wrecked"));
    await expect.poll(async () => (await snapshot(page)).voice.id).toBe("mission-fail");
    const result = await snapshot(page);
    expect(result.scene).toBe("result");
    expect(result.voice.generation).toBe(result.runGeneration);
    const cleared = await page.evaluate(() => {
      const audio = window.__roadster.audio;
      audio.reset();
      audio.setScene("menu");
      return audio.debugSnapshot();
    });
    expect(cleared.runGeneration).toBeGreaterThan(result.runGeneration);
    expect(cleared.voice).toMatchObject({ id: null, generation: null, pending: 0 });
    expect(cleared.oneShots).toBe(0);
    await page.waitForTimeout(2_000);
    expect((await snapshot(page)).voice).toMatchObject({ id: null, pending: 0 });
  });
});

test("production precaches every audio file and decodes the full soundpack offline", async ({ page, context }) => {
  test.skip(!process.env.PWA_TEST_URL, "Set PWA_TEST_URL to a built preview for offline checks.");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Begin test" })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const cached = await page.evaluate(async (urls) => {
    return Promise.all(urls.map(async (url) => ({ url, cached: Boolean(await caches.match(url)) })));
  }, sampleUrls);
  expect(cached.filter((item) => !item.cached), "Every sound is precached before offline mode").toEqual([]);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Begin test" })).toBeVisible();
  expectValidSamples(await decodeSamples(page));
  await page.getByRole("button", { name: "Begin test" }).click();
  await expect(page.locator("#hud-level-name")).toHaveText("The garage");
  await expect.poll(() => page.locator("#timer").textContent()).not.toBe("00:00.00");
});
