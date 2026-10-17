import { test, expect } from "@playwright/test";

const pageErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(
    pageErrors.get(page),
    "The game must run without uncaught browser errors",
  ).toEqual([]);
});

async function openGame(page, { manualSeen = true } = {}) {
  await page.addInitScript(
    ({ manualSeen }) => {
      if (!localStorage.getItem("roadster-settings"))
        localStorage.setItem(
          "roadster-settings",
          JSON.stringify({
            quality: "low",
            muted: true,
            haptics: false,
            shake: false,
          }),
        );
      if (manualSeen) localStorage.setItem("roadster-manual-seen", "true");
    },
    { manualSeen },
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Begin test" })).toBeVisible();
  await page.waitForFunction(
    () => window.__roadster && !document.querySelector("#loading"),
  );
}

async function startLevel(page, index = 0) {
  await page.locator(`[data-level="${index}"]`).click();
  await expect(page.locator(`[data-level="${index}"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Begin test" }).click();
  await page.waitForFunction(
    () => window.__roadster.mode === "game" && window.__roadster.input.enabled,
  );
}

async function returnToHangar(page) {
  await page.getByRole("button", { name: "Pause game" }).click();
  await page
    .getByRole("button", { name: "Return to hangar", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Begin test" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__roadster.mode))
    .toBe("menu");
}

test("first-run manual, pause, return to hangar, and saved preferences", async ({
  page,
}) => {
  await openGame(page, { manualSeen: false });
  await expect(page).toHaveTitle(/Roadster.*But Can It Fly/);
  await expect(page.locator(".mission")).toHaveCount(4);
  await page.getByRole("button", { name: "Begin test" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /A little thrust/ }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__roadster.paused)).toBe(true);
  await page.getByRole("button", { name: "Understood. Probably." }).click();
  await page.waitForFunction(() => window.__roadster.input.enabled);
  await expect
    .poll(() => page.evaluate(() => window.__roadster.physics.time))
    .toBeGreaterThan(0.1);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Take a breath." }),
  ).toBeVisible();
  const pausedTime = await page.evaluate(() => window.__roadster.physics.time);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.__roadster.physics.time)).toBe(
    pausedTime,
  );
  await page.keyboard.press("Escape");
  await expect
    .poll(() => page.evaluate(() => window.__roadster.physics.time))
    .toBeGreaterThan(pausedTime);
  await returnToHangar(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("#setting-haptics").check();
  await page.locator("#setting-sound").check();
  await page.locator("#setting-quality").selectOption("balanced");
  await page.getByRole("button", { name: "Ready for liftoff" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Begin test" })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator("#setting-haptics")).toBeChecked();
  await expect(page.locator("#setting-sound")).toBeChecked();
  await expect(page.locator("#setting-quality")).toHaveValue("balanced");
});

test("four keyboard jets lift, one jet rotates, and reset restores a fresh car", async ({
  page,
}) => {
  await openGame(page);
  await startLevel(page, 1);
  for (const key of ["q", "w", "o", "p"]) await page.keyboard.down(key);
  await expect
    .poll(() => page.evaluate(() => window.__roadster.physics.state.altitude))
    .toBeGreaterThan(0.4);
  const lifted = await page.evaluate(() => ({
    velocity: window.__roadster.physics.body.velocity.y,
    grounded: window.__roadster.physics.state.grounded,
    boosters: [...window.__roadster.physics.boosterLevels],
  }));
  expect(lifted.velocity).toBeGreaterThan(1);
  expect(lifted.grounded).toBe(false);
  expect(lifted.boosters.every((value) => value > 0.5)).toBe(true);
  for (const key of ["q", "w", "o", "p"]) await page.keyboard.up(key);
  await page.locator('#hud [data-action="reset"]').click();
  const reset = await page.evaluate(() => ({
    pressure: window.__roadster.physics.pressure,
    boosters: [...window.__roadster.physics.boosterLevels],
    velocity: window.__roadster.physics.body.velocity.length(),
    time: window.__roadster.physics.time,
    outcome: window.__roadster.physics.state.outcome,
  }));
  expect(reset).toEqual({
    pressure: 1,
    boosters: [0, 0, 0, 0],
    velocity: 0,
    time: 0,
    outcome: null,
  });
  await page.waitForFunction(() => window.__roadster.input.enabled);
  // First lift clear of the suspension using real controls. A single jet on
  // the ground is partially opposed by the other wheel contact forces.
  for (const key of ["q", "w", "o", "p"]) await page.keyboard.down(key);
  await expect
    .poll(() => page.evaluate(() => window.__roadster.physics.state.altitude))
    .toBeGreaterThan(1);
  for (const key of ["w", "o", "p"]) await page.keyboard.up(key);
  await expect
    .poll(() =>
      page.evaluate(() => window.__roadster.physics.body.angularVelocity.x),
    )
    .toBeLessThan(-0.15);
  await expect
    .poll(() =>
      page.evaluate(() => window.__roadster.physics.body.angularVelocity.z),
    )
    .toBeLessThan(-0.15);
  expect(
    await page.evaluate(() =>
      ["w", "o", "p"].map((key) => window.__roadster.input.state[key]),
    ),
  ).toEqual([0, 0, 0]);
  await page.keyboard.up("q");
  await expect
    .poll(() => page.evaluate(() => window.__roadster.input.state.q))
    .toBe(0);
  await page.locator('#hud [data-action="reset"]').click();
  expect(
    await page.evaluate(() => window.__roadster.physics.state.damage),
  ).toBe(0);
  expect(
    await page.evaluate(() => window.__roadster.physics.body.position.y),
  ).toBeCloseTo(0.74, 2);
});

test("R restarts while paused and Escape closes settings from a focused select", async ({
  page,
}) => {
  await openGame(page);
  await startLevel(page, 0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("r");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await page.evaluate(() => window.__roadster.paused)).toBe(false);
  expect(await page.evaluate(() => window.__roadster.physics.time)).toBe(0);
  await returnToHangar(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("#setting-quality").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("all four level selections start, inversion autodrives, and factory counts rings", async ({
  page,
}) => {
  await openGame(page);
  for (const [index, id, name] of [
    [0, "garage", "The garage"],
    [1, "drag", "The quarter mile"],
    [2, "ramp", "The inversion"],
    [3, "factory", "The Gigafactory"],
  ]) {
    await startLevel(page, index);
    await expect(page.locator("#hud-level-name")).toHaveText(name);
    expect(await page.evaluate(() => window.__roadster.physics.level)).toBe(id);
    if (id === "ramp") {
      await expect(page.locator("#drive-label")).toHaveText("AUTODRIVE ON");
      await expect
        .poll(() =>
          page.evaluate(() => window.__roadster.physics.body.position.z),
        )
        .toBeGreaterThan(1);
      expect(
        await page.evaluate(() => window.__roadster.input.state.throttle),
      ).toBe(0);
    }
    if (id === "factory") {
      await expect(page.locator("#ring-objective")).toBeVisible();
      await expect(page.locator("#ring-count")).toHaveText("0 / 5");
      expect(await page.evaluate(() => ({
        goal: window.__roadster.physics.state.ringGoal,
        total: window.__roadster.physics.state.ringTotal,
      }))).toEqual({ goal: 5, total: 10 });
    } else await expect(page.locator("#ring-objective")).toBeHidden();
    await returnToHangar(page);
  }
});

test("physical impacts crumple the car, explode once, and reset all wreckage", async ({
  page,
}) => {
  await openGame(page);
  await startLevel(page, 1);
  await page.evaluate(() => {
    const game = window.__roadster;
    // Controlled collision initial conditions exercise the real solver and the
    // entire impact -> model -> debris -> explosion chain without a damage cheat.
    game.physics.addBox({ position: [0, 1.5, 5], size: [8, 3, 0.8] });
    window.damageBaseline = {
      bodies: game.physics.world.bodies.length,
      vertices: [],
    };
    game.car.group.traverse((object) => {
      if (object.geometry?.attributes.position) {
        window.damageBaseline.vertices.push({
          object,
          positions: Array.from(object.geometry.attributes.position.array),
          visible: object.visible,
        });
      }
    });
    game.physics.body.velocity.set(0, 0, 8);
  });
  await expect
    .poll(() => page.evaluate(() => window.__roadster.physics.state.damage))
    .toBeGreaterThan(1);
  expect(
    await page.evaluate(() => window.__roadster.physics.state.damage),
  ).toBeLessThan(100);
  expect(await page.evaluate(() => window.__roadster.wreck.exploded)).toBe(
    false,
  );
  expect(
    await page.evaluate(() =>
      window.damageBaseline.vertices.some(({ object, positions }) =>
        object.geometry.attributes.position.array.some(
          (value, index) => value !== positions[index],
        ),
      ),
    ),
  ).toBe(true);

  for (let attempt = 0; attempt < 2; attempt++) {
    await page.keyboard.press("r");
    await page.waitForFunction(() => window.__roadster.input.enabled);
    expect(
      await page.evaluate(() =>
        window.damageBaseline.vertices.every(
          ({ object, positions, visible }) =>
            object.visible === visible &&
            object.geometry.attributes.position.array.every(
              (value, index) => value === positions[index],
            ),
        ),
      ),
    ).toBe(true);
    await page.evaluate(() =>
      window.__roadster.physics.body.velocity.set(0, 0, 32),
    );
    await page.waitForFunction(() => window.__roadster.physics.state.exploded);
    const exploded = await page.evaluate(() => {
      const { physics, wreck } = window.__roadster;
      return {
        damage: physics.damage,
        outcome: physics.outcome,
        exploded: wreck.exploded,
        parts: wreck.debris.filter((part) => !part.shard).length,
        physicalParts: wreck.debris.every((part) =>
          physics.world.bodies.includes(part.body),
        ),
        smoke: wreck.smoke.mesh.visible,
        fire: wreck.fire.mesh.visible,
        repeatBlast: physics.explode(),
        repeatEffects: wreck.explode(physics.state),
      };
    });
    expect(exploded).toMatchObject({
      damage: 100,
      outcome: "wrecked",
      exploded: true,
      physicalParts: true,
      smoke: true,
      fire: true,
      repeatBlast: false,
      repeatEffects: false,
    });
    expect(exploded.parts).toBeGreaterThan(4);
    await expect(page.locator("#flight-status")).toHaveText("VEHICLE LOST");
    await page.keyboard.press("Escape");
    const pausedAge = await page.evaluate(
      () => window.__roadster.wreck.blastAge,
    );
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__roadster.wreck.blastAge)).toBe(
      pausedAge,
    );
    await page.keyboard.press("r");
    expect(
      await page.evaluate(() => {
        const { physics, wreck } = window.__roadster;
        return {
          damage: physics.damage,
          exploded: physics.exploded,
          debris: wreck.debris.length,
          bodies: physics.world.bodies.length - window.damageBaseline.bodies,
          smoke: wreck.smoke.mesh.visible,
          fire: wreck.fire.mesh.visible,
        };
      }),
    ).toEqual({
      damage: 0,
      exploded: false,
      debris: 0,
      bodies: 0,
      smoke: false,
      fire: false,
    });
  }
});

test.describe("mobile multi-touch", () => {
  test.use({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });

  test("four simultaneous touches fire every corner and cancellation releases them", async ({
    page,
    context,
  }) => {
    await openGame(page);
    await startLevel(page, 1);
    const touchPoints = [];
    for (const [index, key] of ["q", "w", "o", "p"].entries()) {
      const button = page.locator(`[data-jets="${key}"]`);
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      touchPoints.push({
        id: index + 1,
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        radiusX: 4,
        radiusY: 4,
        force: 1,
      });
    }
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints,
    });
    await expect
      .poll(() => page.evaluate(() => window.__roadster.input.pointers.size))
      .toBe(4);
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__roadster.physics.boosterLevels.every((value) => value > 0.5),
        ),
      )
      .toBe(true);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect
      .poll(() => page.evaluate(() => window.__roadster.input.pointers.size))
      .toBe(0);
    expect(
      await page.evaluate(() =>
        ["q", "w", "o", "p"].map((key) => window.__roadster.input.state[key]),
      ),
    ).toEqual([0, 0, 0, 0]);
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__roadster.physics.boosterLevels.every(
            (value) => value < 0.05,
          ),
        ),
      )
      .toBe(true);
    await cdp.detach();
  });
});
