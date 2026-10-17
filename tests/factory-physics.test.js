import test from "node:test";
import assert from "node:assert/strict";
import { PhysicsGame } from "../src/physics.js";
import { FACTORY_RINGS, FACTORY_RING_GOAL, FACTORY_BOUNDS } from "../src/flight-course.js";

function factory() {
  const game = new PhysicsGame();
  game.setLevel("factory");
  return game;
}

function simulate(game, seconds, input = {}) {
  for (let tick = 0; tick < seconds * 120 && !game.outcome; tick++) game.step(1 / 120, input);
}

// The starting placement cannot score: only motion integrated after it is swept.
function cross(game, ring, { reverse = false, x = 0, y = 0, dt = 1 / 120 } = {}) {
  const [cx, cy, cz] = ring.position;
  game.body.position.set(cx + x, cy + y, cz + (reverse ? 0.5 : -0.5));
  game.body.quaternion.set(0, 0, 0, 1);
  game.body.velocity.set(0, 0, reverse ? -120 : 120);
  game.body.angularVelocity.setZero();
  game.body.force.setZero();
  game.body.torque.setZero();
  game.body.aabbNeedsUpdate = true;
  game.step(dt, {});
}

test("five unique airborne gate crossings complete the ten-ring factory course in any order", () => {
  const game = factory();
  assert.equal(game.state.ringTotal, 10);
  assert.equal(game.state.ringGoal, 5);
  const order = [7, 2, 9, 0, 5];
  for (let i = 0; i < FACTORY_RING_GOAL; i++) {
    cross(game, FACTORY_RINGS[order[i]], { reverse: i % 2 === 1 });
    assert.equal(game.state.ringCount, i + 1);
    assert.equal(game.state.outcome, i === 4 ? "success" : null);
  }
  assert.deepEqual(game.state.collectedRings, order.map(index => FACTORY_RINGS[index].id));
  assert.equal(game.state.damage, 0);
});

test("the factory course is winnable from spawn with a short lift pulse and rear boost", () => {
  // This is the real flight path, with no position/orientation edits or hidden
  // stabilization. The two mobile pads can produce these same binary inputs:
  // hold BOOST, hold LIFT for 0.8 s shortly after launch, then release LIFT.
  // Timing variation and differing render rates leave a useful control window.
  for (const dt of [1 / 120, 1 / 60, 1 / 30]) {
    for (const liftStart of [0.65, 0.75, 0.85]) {
      const game = factory();
      game.addBox({ position: [0, -0.5, 150], size: [200, 1, 360] });
      for (let frame = 0; frame < 8 / dt && !game.outcome; frame++) {
        const lift = +(game.time >= liftStart && game.time < liftStart + 0.8);
        game.step(dt, { boost: 1, q: lift, w: lift, o: lift, p: lift });
      }
      assert.equal(game.state.outcome, "success", `${1 / dt} fps / lift at ${liftStart} s`);
      assert.deepEqual(game.state.collectedRings, FACTORY_RINGS.slice(0, 5).map(ring => ring.id));
      assert.equal(game.state.damage, 0);
      assert.equal(game.state.crashed, false);
      assert.equal(game.state.grounded, false);
      assert.ok(game.state.maxAltitude > 16 && game.state.maxAltitude < 30);
      assert.ok(game.state.time < 5);
    }
  }
});

test("hovering in a ring, approaching its face, and crossing outside the opening do not score", () => {
  const game = factory();
  const ring = FACTORY_RINGS[0];
  game.body.position.set(...ring.position);
  game.step(1 / 60, {});
  assert.equal(game.state.ringCount, 0, "spawning or hovering in the plane is not a crossing");
  game.body.position.z = ring.position[2] - 2;
  game.body.velocity.z = 5;
  game.step(1 / 60, {});
  assert.equal(game.state.ringCount, 0, "close proximity is not passage");
  cross(game, ring, { x: ring.radius + 1 });
  assert.equal(game.state.ringCount, 0);
  cross(game, ring, { y: ring.radius + 1 });
  assert.equal(game.state.ringCount, 0);
  cross(game, ring, { x: ring.radius - 0.4 });
  assert.equal(game.state.ringCount, 0, "the complete car needs room inside the gate");
  cross(game, ring);
  assert.equal(game.state.ringCount, 1);
});

test("a fast pass cannot tunnel through a ring and a repeated reverse pass cannot farm it", () => {
  const game = factory();
  const ring = FACTORY_RINGS[1];
  cross(game, ring, { dt: 1 / 30 });
  assert.ok(game.body.position.z > ring.position[2] + 3);
  assert.equal(game.state.ringCount, 1);
  cross(game, ring, { reverse: true });
  assert.equal(game.state.ringCount, 1);
  assert.deepEqual(game.state.collectedRings, [ring.id]);
});

test("rolling through a gate on an elevated platform does not count as flying", () => {
  const game = factory();
  const ring = FACTORY_RINGS[0];
  game.addBox({ position: [ring.position[0], ring.position[1] - 1.0, ring.position[2]], size: [25, 0.5, 25] });
  cross(game, ring);
  assert.equal(game.state.grounded, true);
  assert.equal(game.state.ringCount, 0);
});

test("a destroyed or exploded car cannot pass the fifth gate for a win", () => {
  for (const failure of ["destroyed", "exploded"]) {
    const game = factory();
    for (const ring of FACTORY_RINGS.slice(0, 4)) cross(game, ring);
    if (failure === "exploded") game.explode();
    else game.damage = 100;
    cross(game, FACTORY_RINGS[4]);
    assert.equal(game.state.ringCount, 4);
    assert.equal(game.state.outcome, "wrecked");
  }
});

test("a fatal wall collision in the fifth-gate frame takes precedence over completion", () => {
  const game = factory();
  for (const ring of FACTORY_RINGS.slice(0, 4)) cross(game, ring);
  const ring = FACTORY_RINGS[4];
  const [x, y, z] = ring.position;
  game.addBox({ position: [x, y, z + 4.0], size: [20, 20, 0.4] });
  cross(game, ring, { dt: 0.05 });
  assert.equal(game.state.ringCount, 5, "fifth ring must be crossed before hitting the wall");
  assert.equal(game.state.damage, 100);
  assert.equal(game.state.outcome, "wrecked");
});

test("reset and level switching start fresh courses and clear all collected gates", () => {
  const game = factory();
  cross(game, FACTORY_RINGS[0]);
  game.reset();
  assert.equal(game.state.ringCount, 0);
  assert.deepEqual(game.state.collectedRings, []);
  cross(game, FACTORY_RINGS[0]);
  assert.equal(game.state.ringCount, 1, "a fresh attempt can collect the same gate again");
  game.setLevel("drag");
  assert.equal(game.state.ringCount, 0);
  cross(game, FACTORY_RINGS[1]);
  assert.equal(game.state.ringCount, 0, "other levels never collect factory gates");
  game.setLevel("factory");
  assert.equal(game.state.ringCount, 0);
  assert.equal(game.state.outcome, null);
});

test("factory flight stays inside its larger course bounds and escaping them ends the run", () => {
  const game = factory();
  game.body.position.set(0, 45, 310);
  game.step(1 / 120, {});
  assert.equal(game.state.outcome, null);
  game.body.position.set(0, 45, FACTORY_BOUNDS.maxZ + 1);
  game.step(1 / 120, {});
  assert.equal(game.state.outcome, "flyaway");
});

function rampReturn({ pitch = 0, roll = 0, completedRamp = true } = {}) {
  const game = new PhysicsGame();
  game.setLevel("ramp");
  game._hasClimbed = completedRamp;
  game._rampLaunched = true;
  game.rampStage = "airborne";
  game.body.position.set(0, 24, 10);
  game.body.quaternion.setFromEuler(pitch, 0, roll);
  // Match the real environment, whose flush runway/apron boxes overlap the
  // universal plane and can become the nearest suspension ray hit.
  game.addBox({ position: [0, -0.5, 25], size: [230, 1, 300] });
  game.addBox({ position: [0, -0.11, 6], size: [10, 0.22, 72] });
  return game;
}

test("a near-level 24 m inversion return is caught on its wheels and wins", () => {
  for (const attitude of [{}, { pitch: 0.45 }, { roll: -0.4 }]) {
    const game = rampReturn(attitude);
    simulate(game, 6);
    assert.equal(game.state.outcome, "success", JSON.stringify(attitude));
    assert.equal(game.state.crashed, false);
    assert.equal(game.state.exploded, false);
    assert.ok(game.state.damage < 5);
    assert.equal(game._landingCaught, true);
  }
});

test("ramp landing assistance never protects roof, nose, side-wall, or skipped-ramp impacts", () => {
  for (const attitude of [{ pitch: Math.PI }, { pitch: 0.8 }, { roll: 1.25 }, { completedRamp: false, pitch: 0.45 }]) {
    const game = rampReturn(attitude);
    simulate(game, 6);
    assert.equal(game.state.outcome, "wrecked", JSON.stringify(attitude));
    assert.equal(game._landingCaught, false);
  }
  const wallHit = rampReturn();
  wallHit.addBox({ position: [5, 24, 10], size: [0.5, 10, 20] });
  wallHit.body.velocity.x = 30;
  simulate(wallHit, 0.5);
  assert.equal(wallHit.state.outcome, "wrecked");
  assert.equal(wallHit._landingCaught, false);
});

test("an extreme near-upright impact and a severely damaged chassis remain fatal", () => {
  for (const damaged of [false, true]) {
    const game = rampReturn();
    game.body.position.y = 1.1;
    game.body.velocity.y = damaged ? -22 : -40;
    if (damaged) game.damage = 95;
    simulate(game, 1);
    assert.equal(game.state.outcome, "wrecked");
    assert.equal(game.state.damage, 100);
    assert.equal(game._landingCaught, false);
  }
});
