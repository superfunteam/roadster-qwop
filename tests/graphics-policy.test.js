import test from "node:test";
import assert from "node:assert/strict";
import { AdaptiveResolution, graphicsPlan } from "../src/graphics-policy.js";

test("high-DPI phones preserve lighting without allocating HDR postprocessing", () => {
  for (const quality of ["high", "balanced", "low"]) {
    for (const [width, height] of [[412, 915], [915, 412], [1024, 1366]]) {
      const plan = graphicsPlan({ quality, width, height, devicePixelRatio: 3.5, mobile: true });
      assert.ok(plan.pixelCount <= plan.pixelBudget);
      assert.equal(plan.postprocessing, false);
      assert.equal(plan.ambientOcclusion, false);
      assert.equal(plan.bloom, false);
      assert.equal(plan.shadows, quality !== "low");
      assert.ok(plan.pixelRatio <= (quality === "high" ? 1.5 : quality === "balanced" ? 1.25 : 1));
    }
  }
});

test("4K desktop composition stays inside its pixel budget and hardware dimensions", () => {
  const high = graphicsPlan({ quality: "high", width: 3840, height: 2160, devicePixelRatio: 2 });
  assert.ok(high.pixelCount <= 2_300_000);
  assert.equal(high.postprocessing, true);
  assert.equal(high.ambientOcclusion, true);
  const narrow = graphicsPlan({ quality: "high", width: 12_000, height: 300, maxWidth: 1024, maxHeight: 512 });
  assert.ok(narrow.renderWidth <= 1024);
  assert.ok(narrow.renderHeight <= 512);
});

test("safe recovery and unsupported floating-point targets both bypass composition", () => {
  const safe = graphicsPlan({ quality: "high", width: 1920, height: 1080, safeMode: true });
  assert.equal(safe.postprocessing, false);
  assert.equal(safe.shadowSize, 512);
  assert.equal(safe.quality, "high", "recovery does not overwrite the user's selection");
  assert.ok(safe.pixelCount <= 450_000);
  const unsupported = graphicsPlan({ quality: "high", floatSupported: false });
  assert.equal(unsupported.postprocessing, false);
  assert.equal(unsupported.shadows, true);
});

test("adaptive reductions lower resolution before removing expensive effects", () => {
  const plans = [0, 1, 2, 3].map(adaptiveStep => graphicsPlan({ quality: "high", width: 1920, height: 1080, adaptiveStep }));
  plans.slice(1).forEach((plan, index) => assert.ok(plan.pixelCount < plans[index].pixelCount));
  assert.equal(plans[1].ambientOcclusion, true);
  assert.equal(plans[2].ambientOcclusion, false);
  assert.equal(plans[2].bloom, true);
  assert.equal(plans[3].postprocessing, false);
  assert.equal(plans[3].quality, "high");
});

function feed(adaptive, seconds, fps) {
  let changes = 0;
  for (let frame = 0; frame < seconds * fps; frame++) if (adaptive.observe(1000 / fps)) changes++;
  return changes;
}

test("a loading stall or one slow window cannot reduce quality", () => {
  const adaptive = new AdaptiveResolution();
  feed(adaptive, 5, 60);
  const elapsed = adaptive.elapsed;
  adaptive.observe(1400);
  assert.equal(adaptive.elapsed, elapsed, "a single startup stall is excluded");
  adaptive.observe(150);
  feed(adaptive, 3, 30);
  feed(adaptive, 8, 60);
  assert.equal(adaptive.step, 0);
});

test("sustained three-FPS rendering still adapts despite every frame exceeding 250 ms", () => {
  const adaptive = new AdaptiveResolution();
  assert.equal(feed(adaptive, 20, 3), 1);
  assert.equal(adaptive.step, 1);
  assert.ok(adaptive.elapsed < 20_000, "very long frames count conservatively");
  assert.equal(feed(adaptive, 60, 3), 2);
  assert.equal(adaptive.step, 3);
});

test("separated long stalls do not form a sustained slow-frame streak", () => {
  const adaptive = new AdaptiveResolution();
  for (let cycle = 0; cycle < 12; cycle++) {
    adaptive.observe(300);
    adaptive.observe(600);
    feed(adaptive, 1, 60);
  }
  assert.equal(adaptive.step, 0);
  assert.equal(adaptive.longFrameStreak, 0);
});

test("sustained slow rendering reduces resolution with a cooldown and no oscillation", () => {
  const adaptive = new AdaptiveResolution();
  assert.equal(feed(adaptive, 11, 30), 1);
  assert.equal(adaptive.step, 1);
  assert.equal(feed(adaptive, 5, 30), 0);
  assert.equal(feed(adaptive, 60, 30), 2);
  assert.equal(adaptive.step, 3);
  assert.equal(feed(adaptive, 30, 120), 0);
  assert.equal(adaptive.step, 3);
  adaptive.reset();
  assert.equal(adaptive.step, 0);
});
