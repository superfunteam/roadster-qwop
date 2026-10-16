import { test, expect } from "@playwright/test";

// These exercise recovery through the live renderer/input/UI loop. The node
// physics suite covers contact geometry and the numerical flight envelopes.
test.skip(Boolean(process.env.PWA_TEST_URL), "Flight telemetry is development-only; production has separate smoke coverage.");

const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const messages = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem(
      "roadster-settings",
      JSON.stringify({ quality: "low", muted: true, haptics: false, shake: false }),
    );
    localStorage.setItem("roadster-manual-seen", "true");
  });
  await page.goto("/");
  await page.waitForFunction(
    () => window.__roadster && !document.querySelector("#loading"),
  );
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page), "Flight must run without browser errors").toEqual([]);
});

async function start(page, level) {
  await page.locator(`[data-level="${level}"]`).click();
  await page.getByRole("button", { name: "Begin test" }).click();
  await page.waitForFunction(
    () => window.__roadster.input.enabled && window.__roadster.physics.time > 0.05,
  );
}

async function putOnRoof(page) {
  await page.evaluate(() => {
    const p = window.__roadster.physics;
    // A soft roof placement avoids conflating recovery with explosion/reset.
    p.body.position.set(0, 0.69, 4);
    p.body.quaternion.setFromEuler(0, 0, Math.PI);
    p.body.velocity.setZero();
    p.body.angularVelocity.setZero();
    p.body.force.setZero();
    p.body.torque.setZero();
    p.body.previousPosition.copy(p.body.position);
    p.body.interpolatedPosition.copy(p.body.position);
    p.body.previousQuaternion.copy(p.body.quaternion);
    p.body.interpolatedQuaternion.copy(p.body.quaternion);
    p.body.aabbNeedsUpdate = true;
    p.body.wakeUp();
  });
}

async function waitForWarning(page) {
  await page.waitForFunction(
    () => window.__roadster.physics.state.recoveryRemaining !== null,
  );
  await expect(page.locator("#game-message")).toContainText("Upside down");
}

async function assertFreshReset(page) {
  await page.waitForFunction(() => {
    const { physics, input } = window.__roadster;
    return physics.time === 0 && !input.enabled;
  });
  const fresh = await page.evaluate(() => {
    const { physics: p, input, wreck, paused } = window.__roadster;
    return {
      pressure: p.pressure,
      damage: p.damage,
      velocity: p.body.velocity.length(),
      jets: [...p.boosterLevels],
      rearBoost: p.rearBoost,
      recoveryRemaining: p.state.recoveryRemaining,
      recoveryReady: p.state.recoveryReady,
      outcome: p.outcome,
      keys: input.keys.size,
      pointers: input.pointers.size,
      exploded: wreck.exploded,
      paused,
    };
  });
  expect(fresh).toEqual({
    pressure: 1,
    damage: 0,
    velocity: 0,
    jets: [0, 0, 0, 0],
    rearBoost: 0,
    recoveryRemaining: null,
    recoveryReady: false,
    outcome: null,
    keys: 0,
    pointers: 0,
    exploded: false,
    paused: false,
  });
  await expect(page.getByRole("dialog")).not.toBeVisible();
}

for (const [level, name] of [[0, "garage"], [1, "drag strip"], [2, "inversion"]]) {
  test(`a stranded roof landing automatically resets the ${name}`, async ({ page }) => {
    await start(page, level);
    await putOnRoof(page);
    // Four symmetric jets push an inverted car into the floor. Holding them
    // cannot prevent a genuinely stranded recovery, nor relaunch it afterward.
    const held = level === 1 ? ["q", "w", "o", "p"] : ["ArrowRight"];
    for (const key of held) await page.keyboard.down(key);
    await waitForWarning(page);
    expect(await page.evaluate(() => window.__roadster.physics.crashed)).toBe(false);
    await assertFreshReset(page);

    if (level === 1) {
      // Browser keyboard.down deliberately does not synthesize OS repetition.
      // Supply repeat events so this catches re-arming while a key is held.
      await page.evaluate(() => {
        for (const code of ["KeyQ", "KeyW", "KeyO", "KeyP"])
          window.dispatchEvent(new KeyboardEvent("keydown", { code, repeat: true }));
      });
      await page.waitForFunction(() => window.__roadster.input.enabled);
      await page.waitForTimeout(250);
      expect(await page.evaluate(() => [...window.__roadster.physics.boosterLevels]))
        .toEqual([0, 0, 0, 0]);
    }
    for (const key of held) await page.keyboard.up(key);
    await page.waitForFunction(() => window.__roadster.input.enabled);
    await page.keyboard.down("q");
    await expect.poll(() => page.evaluate(() => window.__roadster.physics.boosterLevels[0]))
      .toBeGreaterThan(0.3);
    await page.keyboard.up("q");
  });
}

test("recovery countdown pauses, cancels on righting, and manual reset clears it", async ({ page }) => {
  await start(page, 1);
  await putOnRoof(page);
  await waitForWarning(page);
  await page.keyboard.press("Escape");
  const stopped = await page.evaluate(() => ({
    time: window.__roadster.physics.time,
    remaining: window.__roadster.physics.state.recoveryRemaining,
  }));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => ({
    time: window.__roadster.physics.time,
    remaining: window.__roadster.physics.state.recoveryRemaining,
  }))).toEqual(stopped);
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__roadster.physics.state.recoveryRemaining))
    .toBeLessThan(stopped.remaining - 0.1);

  await page.evaluate(() => {
    const p = window.__roadster.physics;
    p.body.quaternion.set(0, 0, 0, 1);
    p.body.position.y = 0.74;
    p.body.velocity.setZero();
    p.body.angularVelocity.setZero();
    p.body.aabbNeedsUpdate = true;
    p.body.wakeUp();
  });
  await expect.poll(() => page.evaluate(() => window.__roadster.physics.state.recoveryRemaining))
    .toBe(null);
  await expect(page.locator("#game-message")).not.toContainText("Upside down");
  const rightedAt = await page.evaluate(() => window.__roadster.physics.time);
  await page.waitForFunction((time) => window.__roadster.physics.time > time + 3.1, rightedAt);
  expect(await page.evaluate(() => window.__roadster.physics.body.position.y)).toBeGreaterThan(0.7);
  expect(await page.evaluate(() => window.__roadster.physics.state.recoveryReady)).toBe(false);

  await putOnRoof(page);
  await waitForWarning(page);
  await page.keyboard.press("r");
  await assertFreshReset(page);
});

test("airborne inversions and a fast roof tumble retain player control", async ({ page }) => {
  await start(page, 1);
  await page.evaluate(() => {
    const p = window.__roadster.physics;
    p.body.position.set(0, 70, 20);
    p.body.quaternion.setFromEuler(0, 0, Math.PI);
    p.body.velocity.set(0, 15, 0);
    p.body.angularVelocity.set(0, 0, 0);
    p.body.aabbNeedsUpdate = true;
    p.body.wakeUp();
    window.flightStartedAt = p.time;
    window.inFlightRecovery = false;
    window.flightProbe = setInterval(() => {
      window.inFlightRecovery ||= p.state.recoveryRemaining !== null;
    }, 25);
  });
  // Longer than the full recovery dwell: inversion alone must never restart a
  // flight. This trajectory remains far above the ground for the entire check.
  await page.waitForFunction(() => window.__roadster.physics.time > window.flightStartedAt + 4.3);
  const airborne = await page.evaluate(() => {
    clearInterval(window.flightProbe);
    const { physics: p, input } = window.__roadster;
    return { altitude: p.state.altitude, recovery: window.inFlightRecovery, enabled: input.enabled, outcome: p.outcome };
  });
  expect(airborne.altitude).toBeGreaterThan(30);
  expect(airborne.recovery).toBe(false);
  expect(airborne.enabled).toBe(true);
  expect(airborne.outcome).toBe(null);

  await page.keyboard.press("r");
  await page.waitForFunction(() => window.__roadster.input.enabled);
  await putOnRoof(page);
  await page.evaluate(() => window.__roadster.physics.body.velocity.set(0, 0, 40));
  const slidingAt = await page.evaluate(() => window.__roadster.physics.time);
  await page.waitForFunction((time) => window.__roadster.physics.time > time + 1.8, slidingAt);
  const sliding = await page.evaluate(() => ({
    speed: window.__roadster.physics.body.velocity.length(),
    remaining: window.__roadster.physics.state.recoveryRemaining,
    enabled: window.__roadster.input.enabled,
  }));
  expect(sliding.speed).toBeGreaterThan(1);
  expect(sliding.remaining).toBe(null);
  expect(sliding.enabled).toBe(true);
});


test("rear thrust builds speed and adding front jets climbs without a tail-strike flip", async ({ page }) => {
  await start(page, 1);
  await page.keyboard.down("Space");
  const boostStartedAt = await page.evaluate(() => window.__roadster.physics.time);
  await page.waitForFunction((time) => window.__roadster.physics.time >= time + 3, boostStartedAt);
  const accelerated = await page.evaluate(() => ({
    speed: window.__roadster.physics.body.velocity.z,
    altitude: window.__roadster.physics.state.altitude,
    damage: window.__roadster.physics.damage,
  }));
  expect(accelerated.speed).toBeGreaterThan(40);
  expect(accelerated.altitude).toBeLessThan(0.08);
  expect(accelerated.damage).toBe(0);

  await page.keyboard.down("q");
  await page.keyboard.down("w");
  const frontStartedAt = await page.evaluate(() => window.__roadster.physics.time);
  await page.waitForFunction((time) => window.__roadster.physics.time >= time + 1, frontStartedAt);
  const climbing = await page.evaluate(() => {
    const p = window.__roadster.physics;
    const q = p.body.quaternion;
    return {
      altitude: p.state.altitude,
      upwardSpeed: p.body.velocity.y,
      upY: 1 - 2 * (q.x * q.x + q.z * q.z),
      pitchRate: p.body.angularVelocity.x,
      damage: p.damage,
    };
  });
  expect(climbing.altitude).toBeGreaterThan(1.5);
  expect(climbing.upwardSpeed).toBeGreaterThan(4);
  expect(climbing.upY).toBeGreaterThan(0.3);
  expect(climbing.pitchRate).toBeGreaterThan(-3);
  expect(climbing.pitchRate).toBeLessThan(-0.6);
  expect(climbing.damage).toBe(0);
  for (const key of ["Space", "q", "w"]) await page.keyboard.up(key);
});
