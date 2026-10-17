import { test, expect } from "@playwright/test";

// Browser GPU recovery is exercised with the real WEBGL_lose_context extension.
// Device emulation verifies mobile allocation policy, not a phone GPU driver.
test.skip(Boolean(process.env.PWA_TEST_URL), "GPU diagnostics are development-only.");

const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const messages = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page), "Rendering and recovery must not throw browser errors").toEqual([]);
});

async function openGame(page, quality = "high") {
  await page.addInitScript((quality) => {
    if (!localStorage.getItem("roadster-settings")) localStorage.setItem("roadster-settings", JSON.stringify({
      quality, muted: true, music: false, voices: false, haptics: false, shake: false,
    }));
    localStorage.setItem("roadster-manual-seen", "true");
  }, quality);
  await page.goto("/");
  await page.waitForFunction(() => window.__roadster?.graphics && !document.querySelector("#loading"));
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function snapshot(page) {
  await settle(page);
  return page.evaluate(() => {
    const { renderer, graphics, physics, input, paused, car } = window.__roadster;
    const gl = renderer.getContext();
    let carMeshes = 0;
    car.group.traverse((object) => { if (object.isMesh) carMeshes++; });
    return {
      graphics: graphics.diagnostics,
      contextLost: gl.isContextLost(),
      antialias: gl.getContextAttributes()?.antialias,
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      memory: { ...renderer.info.memory },
      programs: renderer.info.programs.length,
      time: physics.time,
      paused,
      keys: input.keys.size,
      pointers: input.pointers.size,
      pads: input.padPointers.size,
      enabled: input.enabled,
      carMeshes,
      reflection: window.__roadster.scene.environment?.uuid ?? null,
      graphicsLost: window.__roadster.graphicsLost,
    };
  });
}

async function quality(page, value) {
  await page.evaluate(() => window.__roadster.home());
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("#setting-quality").selectOption(value);
  await page.getByRole("button", { name: "Ready for liftoff" }).click();
  await settle(page);
}

async function start(page, index = 1) {
  await page.evaluate((index) => window.__roadster.startLevel(index), index);
  await page.waitForFunction(() => window.__roadster.input.enabled);
}

async function loseContext(page) {
  await page.evaluate(() => {
    window.testGPU = window.__roadster.renderer.getContext().getExtension("WEBGL_lose_context");
    if (!window.testGPU) throw new Error("WEBGL_lose_context is unavailable in this browser");
    window.testGPU.loseContext();
  });
  await page.waitForFunction(() => window.__roadster.renderer.getContext().isContextLost());
  await page.waitForFunction(() => window.__roadster.paused && !window.__roadster.input.enabled);
}

async function restoreContext(page) {
  // Let the queued context-lost event finish before asking the driver to restore.
  await page.waitForTimeout(100);
  await page.evaluate(() => window.testGPU.restoreContext());
  await page.waitForFunction(() => !window.__roadster.renderer.getContext().isContextLost() && !window.__roadster.graphicsLost);
  await expect(page.getByRole("heading", { name: "Graphics restored." })).toBeVisible();
  await settle(page);
}

test.describe("high-DPR mobile graphics", () => {
  test.use({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

  test("every quality and level stays within a bounded direct-render budget", async ({ page }) => {
    await openGame(page);
    for (const value of ["high", "balanced", "low"]) {
      await quality(page, value);
      for (const level of [0, 1, 2]) {
        await page.evaluate((level) => window.__roadster.startLevel(level), level);
        const state = await snapshot(page);
        expect(state.graphics.mobile).toBe(true);
        expect(state.graphics.quality).toBe(value);
        expect(state.graphics.postprocessing).toBe(false);
        expect(state.graphics.ambientOcclusion).toBe(false);
        expect(state.graphics.bloom).toBe(false);
        expect(state.graphics.pixelCount).toBeLessThanOrEqual(state.graphics.pixelBudget);
        expect(state.graphics.pixelCount).toBeLessThanOrEqual(800_000);
        expect(state.graphics.pixelRatio).toBeLessThanOrEqual(1.5);
        expect(state.graphics.allocationCount).toBe(0);
        expect(state.buffer[0] * state.buffer[1]).toBeLessThanOrEqual(800_000);
        expect(state.antialias).toBe(true);
        expect(state.contextLost).toBe(false);
        expect(state.carMeshes).toBeGreaterThan(50);
      }
    }
  });

  test("duplicate resize events do not reallocate GPU surfaces", async ({ page }) => {
    await openGame(page);
    const before = await snapshot(page);
    await page.evaluate(() => {
      for (let index = 0; index < 50; index++) {
        window.dispatchEvent(new Event("resize"));
        window.visualViewport?.dispatchEvent(new Event("resize"));
      }
    });
    await page.waitForTimeout(180);
    const duplicate = await snapshot(page);
    expect(duplicate.graphics.resizeCount).toBe(before.graphics.resizeCount);
    expect(duplicate.graphics.allocationCount).toBe(before.graphics.allocationCount);
    await page.setViewportSize({ width: 412, height: 915 });
    await page.waitForFunction(() => window.__roadster.graphics.state.width === 412);
    const rotated = await snapshot(page);
    expect(rotated.graphics.resizeCount - duplicate.graphics.resizeCount).toBe(1);
    expect(rotated.graphics.allocationCount).toBe(0);
    expect(rotated.graphics.pixelCount).toBeLessThanOrEqual(800_000);
    expect(rotated.buffer[0]).toBeLessThan(rotated.buffer[1]);
  });

  test("repeated quality changes, levels, and explosions release their resources", async ({ page }) => {
    test.setTimeout(120_000);
    await openGame(page);
    const counts = [];
    // Warm every shader variant before comparing complete cycles; first use
    // legitimately compiles and uploads resources needed by that scene.
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const value of ["low", "balanced", "high"]) {
        await quality(page, value);
        for (const level of [0, 1, 2]) {
          await page.evaluate((level) => window.__roadster.startLevel(level), level);
          await settle(page);
        }
      }
      await start(page, 1);
      await page.evaluate(() => {
        const p = window.__roadster.physics;
        p.addBox({ position: [0, 1.5, 5], size: [8, 3, 0.8] });
        p.body.velocity.set(0, 0, 32);
      });
      await page.waitForFunction(() => window.__roadster.wreck.exploded);
      await page.waitForTimeout(250);
      await page.evaluate(() => window.__roadster.home());
      const state = await snapshot(page);
      expect(state.contextLost).toBe(false);
      expect(state.graphics.allocationCount).toBe(0);
      expect(await page.evaluate(() => window.__roadster.wreck.debris.length)).toBe(0);
      counts.push(state);
    }
    for (const state of counts.slice(1)) {
      expect(state.memory.geometries).toBeLessThanOrEqual(counts[0].memory.geometries);
      expect(state.memory.textures).toBeLessThanOrEqual(counts[0].memory.textures);
      expect(state.programs).toBeLessThanOrEqual(counts[0].programs);
    }
  });

  test("context loss releases held controls, freezes the flight, and restores safely", async ({ page, context }) => {
    await openGame(page);
    await start(page);
    const cdp = await context.newCDPSession(page);
    const touches = [];
    for (const [index, selector] of [".touch-boost", '[data-touch-pad="drive"]'].entries()) {
      const box = await page.locator(selector).boundingBox();
      touches.push({ id: index + 1, x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touches });
    await page.keyboard.down("Space");
    await page.waitForFunction(() => window.__roadster.physics.rearBoost > 0.2);
    const before = await snapshot(page);
    expect(before.keys).toBeGreaterThan(0);
    expect(before.pointers).toBeGreaterThan(0);
    expect(before.pads).toBeGreaterThan(0);
    await loseContext(page);
    const lost = await snapshot(page);
    await expect(page.getByRole("heading", { name: "Restoring graphics…" })).toBeVisible();
    expect(lost.keys).toBe(0);
    expect(lost.pointers).toBe(0);
    expect(lost.pads).toBe(0);
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__roadster.physics.time)).toBe(lost.time);
    await restoreContext(page);
    const restored = await snapshot(page);
    expect(restored.paused).toBe(true);
    expect(restored.enabled).toBe(false);
    expect(restored.time).toBe(lost.time);
    expect(restored.reflection).not.toBe(before.reflection);
    expect(restored.graphics.safeMode).toBe(true);
    expect(restored.graphics.postprocessing).toBe(false);
    expect(restored.graphics.pixelCount).toBeLessThanOrEqual(450_000);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.keyboard.up("Space");
    await page.getByRole("button", { name: "Resume test", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__roadster.physics.time)).toBeGreaterThan(lost.time);
    expect(await page.evaluate(() => window.__roadster.input.state.boost)).toBe(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("roadster-settings")).safeGraphics)).toBe(true);
    await page.reload();
    await page.waitForFunction(() => window.__roadster?.graphics && !document.querySelector("#loading"));
    const restarted = await snapshot(page);
    expect(restarted.antialias).toBe(false);
    expect(restarted.graphics.safeMode).toBe(true);
    expect(restarted.graphics.quality).toBe("high");
    expect(restarted.graphics.pixelCount).toBeLessThanOrEqual(450_000);
  });

  test("context restoration also preserves an already-paused flight", async ({ page }) => {
    await openGame(page, "balanced");
    await start(page);
    await page.keyboard.press("Escape");
    const before = await snapshot(page);
    expect(before.paused).toBe(true);
    await loseContext(page);
    await restoreContext(page);
    const after = await snapshot(page);
    expect(after.paused).toBe(true);
    expect(after.enabled).toBe(false);
    expect(after.time).toBe(before.time);
    expect(after.contextLost).toBe(false);
  });
});

test("desktop High keeps its richer renderer with bounded targets", async ({ page }) => {
  await openGame(page);
  const state = await snapshot(page);
  expect(state.graphics.mobile).toBe(false);
  expect(state.graphics.postprocessing).toBe(true);
  expect(state.graphics.ambientOcclusion).toBe(true);
  expect(state.graphics.bloom).toBe(true);
  expect(state.graphics.shadows).toBe(true);
  expect(state.graphics.pixelCount).toBeLessThanOrEqual(2_300_000);
  expect(state.graphics.allocationCount).toBe(1);
  expect(state.graphics.renderTargetSamples).toBe(0);
  expect(state.contextLost).toBe(false);
});


test("missing floating-point framebuffer support uses a playable direct fallback", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.addInitScript(() => {
    const original = WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = function (name) {
      if (name === "EXT_color_buffer_float") return null;
      return original.call(this, name);
    };
  });
  await openGame(page);
  const state = await snapshot(page);
  expect(state.graphics.floatSupported).toBe(false);
  expect(state.graphics.postprocessing).toBe(false);
  expect(state.graphics.allocationCount).toBe(0);
  expect(state.reflection).toBeNull();
  await start(page);
  await page.keyboard.down("ArrowUp");
  await expect.poll(() => page.evaluate(() => window.__roadster.physics.body.position.z)).toBeGreaterThan(1);
  await page.keyboard.up("ArrowUp");
  expect(await page.evaluate(() => window.__roadster.renderer.getContext().getError())).toBe(0);
  expect(consoleErrors).toEqual([]);
});

test("three repeated context losses stop recovery and focus a safe reload", async ({ page }) => {
  await openGame(page);
  await start(page);
  for (let attempt = 0; attempt < 2; attempt++) {
    await loseContext(page);
    await restoreContext(page);
  }
  const before = await snapshot(page);
  await loseContext(page);
  await page.waitForTimeout(100);
  await page.evaluate(() => window.testGPU.restoreContext());
  await expect(page.getByRole("heading", { name: "Graphics need a restart." })).toBeVisible();
  const reload = page.getByRole("button", { name: "Reload safely", exact: true });
  await expect(reload).toBeVisible();
  await expect(reload).toBeFocused();
  expect(await page.evaluate(() => window.__roadster.graphicsLosses)).toBe(3);
  expect(await page.evaluate(() => window.__roadster.graphicsLost)).toBe(true);
  expect(await page.evaluate(() => window.__roadster.physics.time)).toBe(before.time);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__roadster.physics.time)).toBe(before.time);
  await reload.click();
  await page.waitForFunction(() => window.__roadster?.graphics && !document.querySelector("#loading"));
  const restarted = await snapshot(page);
  expect(restarted.graphicsLost).toBe(false);
  expect(restarted.graphics.safeMode).toBe(true);
  expect(restarted.graphics.postprocessing).toBe(false);
  expect(await page.evaluate(() => window.__roadster.graphicsLosses)).toBe(0);
});

test("a pipeline constructed after context loss waits for restored capabilities", async ({ page }) => {
  await openGame(page);
  await loseContext(page);
  const lost = await page.evaluate(async () => {
    const { GraphicsPipeline } = await import("/src/graphics.js");
    const game = window.__roadster;
    window.testLostPipeline = new GraphicsPipeline(game.renderer, game.scene, game.camera);
    return window.testLostPipeline.diagnostics;
  });
  expect(lost.maxWidth).toBe(1);
  expect(lost.maxHeight).toBe(1);
  expect(lost.floatSupported).toBe(false);
  expect(lost.allocationCount).toBe(0);
  await restoreContext(page);
  const restored = await page.evaluate(() => {
    const game = window.__roadster;
    const probe = window.testLostPipeline;
    probe.restore({
      quality: "low", width: game.viewport.width, height: game.viewport.height,
      devicePixelRatio: 1, mobile: false, safeMode: true,
    });
    const diagnostics = probe.diagnostics;
    probe.dispose();
    // The probe shares this renderer, so return its size/shadow settings to
    // the live game's unchanged graphics plan before leaving the page.
    game.graphics.restore();
    return diagnostics;
  });
  expect(restored.maxWidth).toBeGreaterThan(1);
  expect(restored.maxHeight).toBeGreaterThan(1);
  expect(restored.renderWidth).toBeGreaterThan(1);
  expect(restored.renderHeight).toBeGreaterThan(1);
  expect(restored.allocationCount).toBe(0);
});
