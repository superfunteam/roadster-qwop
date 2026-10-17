import { test, expect } from "@playwright/test";

test.skip(Boolean(process.env.PWA_TEST_URL), "Race diagnostics require development modules.");

async function boot(page) {
  await page.addInitScript(() => {
    localStorage.setItem("roadster-manual-seen", "true");
    localStorage.setItem("roadster-settings", JSON.stringify({ quality: "low", muted: true, shake: false, haptics: false }));
    let next = 1, now = 0;
    const callbacks = new Map();
    window.requestAnimationFrame = (fn) => { const id = next++; callbacks.set(id, fn); return id; };
    window.cancelAnimationFrame = (id) => callbacks.delete(id);
    Object.defineProperty(performance, "now", { value: () => now });
    window.raceTick = (frames = 1) => {
      for (let i = 0; i < frames; i++) {
        now += 1000 / 60;
        const pending = [...callbacks.values()]; callbacks.clear();
        for (const fn of pending) fn(now);
      }
    };
  });
  await page.goto("/?test=drag", { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__roadster && !document.querySelector("#loading"), null, { polling: 100 });
  await page.evaluate(() => {
    const game = window.__roadster;
    game.graphics.observeFrame = () => false;
    document.querySelector('[data-action="start"]').click();
    for (let i = 0; i < 120 && !game.input.enabled; i++) window.raceTick();
  });
}
async function tick(page, frames) { await page.evaluate((frames) => window.raceTick(frames), frames); }
async function snapshot(page) {
  return page.evaluate(() => {
    const g = window.__roadster, r = g.physics.rival, p = g.rivalPresentation;
    return {
      damage: r.damage, crashed: r.crashed, exploded: r.exploded,
      position: r.body.position.toArray(), velocity: r.body.velocity.toArray(),
      visualPosition: p.car.group.position.toArray(), visibleWheels: p.car.wheels.filter(w => w.visible).length,
      debris: p.wreck.debris.length, visualExplosion: p.wreck.exploded,
      playerDamage: g.physics.damage, outcome: g.physics.outcome,
      finishTime: r.finishTime, time: g.physics.time,
      bodies: g.physics.world.bodies.length,
    };
  });
}
async function reset(page) {
  await page.evaluate(() => {
    window.__roadster.reset();
    for (let i = 0; i < 90 && !window.__roadster.input.enabled; i++) window.raceTick();
  });
}

const errors = new WeakMap();
test.beforeEach(({ page }) => {
  const list = []; errors.set(page, list);
  page.on("pageerror", error => list.push(error.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

test("the physical Porsche races, rockets beat it, and a slower finish has a race result", async ({ page }) => {
  await boot(page);
  const initial = await snapshot(page);
  expect(initial.position).toEqual([6.4, 0.74, 0]);
  expect(initial.visibleWheels).toBe(4);
  await page.screenshot({ path: "reference/qa/rival-race-start.png" });
  await page.keyboard.down("ArrowUp");
  await page.keyboard.down("Space");
  await tick(page, 120);
  const racing = await snapshot(page);
  expect(racing.position[2]).toBeGreaterThan(20);
  expect(racing.visualPosition).toEqual(racing.position);
  expect(racing.damage).toBe(0);
  await page.screenshot({ path: "reference/qa/rival-race-underway.png" });
  await tick(page, 340);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.up("Space");
  const won = await snapshot(page);
  expect(won.outcome).toBe("success");
  expect(won.playerDamage).toBe(0);
  await expect(page.locator("#hud-goal")).toContainText("You crossed first");
  await expect(page.getByRole("dialog")).toContainText("PORSCHE · BEHIND YOU AT THE LINE");
  await expect(page.getByRole("button", { name: "Next test" })).toBeVisible();
  await reset(page);
  await page.keyboard.down("ArrowUp");
  await tick(page, 700);
  await page.keyboard.up("ArrowUp");
  const lost = await snapshot(page);
  expect(lost.outcome).toBe("beaten");
  expect(lost.playerDamage).toBe(0);
  expect(lost.finishTime).toBeGreaterThan(9);
  expect(lost.finishTime).toBeLessThan(10);
  await expect(page.locator("#dialog-title")).toContainText("Porsche takes it.");
  await expect(page.getByRole("button", { name: "Try that again" })).toBeVisible();
});

test("gentle contact dents; a real hard collision explodes the rival once and reset restores both cars", async ({ page }) => {
  await boot(page);
  const initial = await snapshot(page);
  const rearEnd = async (speed) => page.evaluate((speed) => {
    const body = window.__roadster.physics.body;
    body.position.set(6.4, 0.74, -4.7);
    body.velocity.set(0, 0, speed);
    body.previousPosition.copy(body.position);
    body.interpolatedPosition.copy(body.position);
    body.aabbNeedsUpdate = true;
    body.wakeUp();
    window.raceTick(12);
  }, speed);
  await rearEnd(5);
  const bump = await snapshot(page);
  expect(bump.damage).toBeGreaterThan(0);
  expect(bump.damage).toBeLessThan(5);
  expect(bump.exploded).toBe(false);
  expect(bump.visualExplosion).toBe(false);
  await reset(page);
  await rearEnd(25);
  const crash = await snapshot(page);
  expect(crash.damage).toBe(100);
  expect(crash.exploded).toBe(true);
  expect(crash.visualExplosion).toBe(true);
  expect(crash.debris).toBeGreaterThan(8);
  expect(crash.visibleWheels).toBe(0);
  await expect(page.locator("#hud-goal")).toHaveText("Both cars · DNF.");
  const blastTime = await page.evaluate(() => window.__roadster.physics.rival.lastBlastTime);
  await page.screenshot({ path: "reference/qa/rival-explosion.png" });
  await tick(page, 120);
  expect(await page.evaluate(() => window.__roadster.physics.rival.lastBlastTime)).toBe(blastTime);
  await reset(page);
  const fresh = await snapshot(page);
  expect(fresh.damage).toBe(0);
  expect(fresh.exploded).toBe(false);
  expect(fresh.visualExplosion).toBe(false);
  expect(fresh.visibleWheels).toBe(4);
  expect(fresh.debris).toBe(0);
  expect(fresh.bodies).toBe(initial.bodies);
  expect(fresh.position).toEqual(initial.position);
  await tick(page, 120);
  expect((await snapshot(page)).position[2]).toBeGreaterThan(20);
  const disposed = await page.evaluate(() => {
    const g = window.__roadster, body = g.physics.rival.body, group = g.rivalPresentation.car.group;
    g.startLevel(0);
    window.raceTick(1);
    return { body: g.physics.world.bodies.includes(body), group: group.parent !== null, rival: g.rivalPresentation !== null };
  });
  expect(disposed).toEqual({ body: false, group: false, rival: false });
});

test.describe("phone race framing", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("both cars fit at the start and touch Boost can win", async ({ page, context }) => {
    await boot(page);
    const framing = await page.evaluate(async () => {
      const THREE = await import("/node_modules/three/build/three.module.js");
      const g = window.__roadster;
      return [g.car.group, g.rivalPresentation.car.group].map(car => {
        const p = car.getWorldPosition(new THREE.Vector3()).project(g.camera);
        return { x: p.x, y: p.y };
      });
    });
    for (const point of framing) {
      expect(Math.abs(point.x)).toBeLessThan(0.8);
      expect(Math.abs(point.y)).toBeLessThan(0.6);
    }
    await page.screenshot({ path: "reference/qa/rival-race-mobile.png" });
    const cdp = await context.newCDPSession(page);
    const b = await page.locator(".touch-boost").boundingBox();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: b.x + b.width / 2, y: b.y + b.height / 2, radiusX: 4, radiusY: 4, force: 1 }] });
    await tick(page, 550);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect((await snapshot(page)).outcome).toBe("success");
    await expect(page.getByRole("button", { name: "Next test" })).toBeVisible();
  });
});
