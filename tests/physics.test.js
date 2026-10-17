import test from "node:test";
import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { PhysicsGame, PHYSICS } from "../src/physics.js";
import { RAMP } from "../src/environments.js";

function simulate(game, seconds, input = {}, dt = 1 / 60) {
  for (let t = 0; t < seconds - 1e-8; t += dt) game.step(dt, input);
  return game.state;
}

test("suspension supports a 1540 kg chassis at the designed wheel height", () => {
  const game = new PhysicsGame();
  const state = simulate(game, 4);
  assert.ok(state.grounded);
  assert.ok(
    Math.abs(state.position.y - 0.73) < 0.045,
    `rest height ${state.position.y}`,
  );
  assert.ok(state.speed < 0.05);
  assert.equal(state.damage, 0);
});

test("all four throttled jets lift the car, retain momentum, and spool down", () => {
  const game = new PhysicsGame();
  simulate(game, 0.5);
  const lifted = simulate(game, 1.5, { q: 1, w: 1, o: 1, p: 1 });
  assert.ok(lifted.position.y > 3, `height ${lifted.position.y}`);
  assert.ok(lifted.velocity.y > 4);
  assert.equal(lifted.grounded, false);
  const before = lifted.position.y;
  game.step(1 / 60, {});
  assert.ok(
    game.state.boosterLevels[0] > 0.8,
    "valves should not switch off instantaneously",
  );
  assert.ok(
    game.state.position.y > before,
    "vertical inertia remains after release",
  );
});

test("a single front-left jet generates pitch and roll; opposite front/rear pairs reverse pitch", () => {
  const single = new PhysicsGame();
  single.body.position.y = 8;
  simulate(single, 0.45, { q: 1 });
  assert.ok(single.body.angularVelocity.x < -0.35);
  assert.ok(single.body.angularVelocity.z < -0.35);
  const front = new PhysicsGame();
  front.body.position.y = 8;
  simulate(front, 0.45, { q: 1, w: 1 });
  const rear = new PhysicsGame();
  rear.body.position.y = 8;
  simulate(rear, 0.45, { o: 1, p: 1 });
  assert.ok(front.body.angularVelocity.x < -0.7);
  assert.ok(rear.body.angularVelocity.x > 0.7);
  assert.ok(Math.abs(front.body.angularVelocity.z) < 0.05);
});

test("fixed integration gives the same trajectory at 30 and 120 rendering frames per second", () => {
  const slow = new PhysicsGame();
  const fast = new PhysicsGame();
  simulate(slow, 2, { throttle: 1, q: 0.8, w: 0.8, o: 0.8, p: 0.8 }, 1 / 30);
  simulate(fast, 2, { throttle: 1, q: 0.8, w: 0.8, o: 0.8, p: 0.8 }, 1 / 120);
  assert.ok(slow.body.position.distanceTo(fast.body.position) < 1e-7);
  assert.ok(slow.body.velocity.distanceTo(fast.body.velocity) < 1e-7);
});

test("reset restores the car, pressure, momentum, and destroyed prop transforms", () => {
  const game = new PhysicsGame();
  const prop = game.addBox({ position: [1, 2, 3], size: [1, 1, 1], mass: 12 });
  simulate(game, 2, { q: 1, boost: 1 });
  prop.position.set(20, 30, 40);
  game.reset();
  assert.equal(game.body.position.y, 0.74);
  assert.equal(game.body.velocity.length(), 0);
  assert.equal(game.body.angularVelocity.length(), 0);
  assert.equal(game.state.pressure, 1);
  assert.deepEqual(game.state.boosterLevels, [0, 0, 0, 0]);
  assert.deepEqual(prop.position.toArray(), [1, 2, 3]);
  assert.equal(game.state.outcome, null);
});

test("changing levels removes previous colliders and props", () => {
  const game = new PhysicsGame();
  game.addBox({ position: [0, 1, 10], size: [1, 1, 1], mass: 12 });
  assert.equal(game.world.bodies.length, 3);
  game.setLevel("ramp");
  assert.equal(game.world.bodies.length, 2);
  assert.equal(game.props.length, 0);
  simulate(game, 1);
  assert.ok(game.body.position.z > 2, "ramp approach drives automatically");
});

test("the complete curved ramp can be flipped and landed near-level without a last-second hover", () => {
  const game = new PhysicsGame();
  game.setLevel("ramp");
  const { radius, entryZ, width, thickness, segments } = RAMP;
  game.addBox({ position: [0, -0.5, 25], size: [230, 1, 300] });
  game.addBox({ position: [0, -0.11, 6], size: [width, 0.22, 72] });
  for (let i = 0; i < segments; i++) {
    const angle = ((i + 0.5) * Math.PI) / segments;
    game.addBox({
      position: [
        0,
        radius - (radius + thickness / 2) * Math.cos(angle),
        entryZ + (radius + thickness / 2) * Math.sin(angle),
      ],
      size: [
        width,
        thickness,
        2 * radius * Math.sin(Math.PI / segments / 2) + 0.025,
      ],
      rotation: [-angle, 0, 0],
    });
  }
  let launchTime = null;
  for (let i = 0; i < 120 * 9; i++) {
    let input = {};
    if (game.state.rampStage === "airborne" && launchTime === null)
      launchTime = game.time;
    if (launchTime !== null) {
      const t = game.time - launchTime;
      // Continue the flip and counter its momentum. A player who rights the
      // chassis should be able to let go and stick the normal ramp descent.
      if (t < 0.85) input = { q: 1, w: 1 };
      else if (t < 1.35) input = { o: 1, p: 1 };
    }
    game.step(1 / 120, input);
    if (game.state.outcome) break;
  }
  assert.ok(launchTime !== null, "car should leave the upside-down lip");
  assert.ok(game.state.maxAltitude > 22);
  assert.equal(game.state.outcome, "success");
  assert.ok(game.state.damage < 10, `landing damage ${game.state.damage}`);
  assert.equal(game._landingCaught, true, "landing struts should catch the normal ramp return");
});

test("car transfers collision momentum to loose garage clutter", () => {
  const game = new PhysicsGame();
  const prop = game.addBox({
    position: [0, 0.5, 5],
    size: [1, 1, 1],
    mass: 30,
  });
  game.body.velocity.z = 12;
  simulate(game, 1);
  assert.ok(prop.position.z > 8, `prop travelled to ${prop.position.z}`);
  assert.ok(
    prop.velocity.length() > 2,
    "clutter should be physically displaced",
  );
});

test("launching straight up away from the ramp cannot count as completing the inversion", () => {
  const game = new PhysicsGame();
  game.setLevel("ramp");
  simulate(game, 4, { q: 1, w: 1, o: 1, p: 1 });
  assert.ok(
    game.body.position.y > 18,
    "test should exceed the old altitude-only milestone",
  );
  assert.equal(game._hasClimbed, false);
  assert.equal(game._rampLaunched, false);
  assert.notEqual(game.state.rampStage, "airborne");
  assert.equal(game.state.outcome, null);
});

test("a lethal upright landing is not declared successful before its chassis impact", () => {
  const game = new PhysicsGame();
  game.setLevel("ramp");
  game._hasClimbed = true;
  game._rampLaunched = true;
  game.rampStage = "airborne";
  game.body.position.set(0, 0.98, 10);
  game.body.velocity.set(0, -50, 0);
  game.step(1 / 120, {});
  assert.notEqual(
    game.state.outcome,
    "success",
    "wheel rays must not award a landing at 50 m/s",
  );
  simulate(game, 1);
  assert.equal(game.state.outcome, "wrecked");
  assert.equal(game.state.damage, 100);
});

test("flyaway result preserves motion and reset restores a fresh playable run", () => {
  const game = new PhysicsGame();
  game.body.position.set(181, 12, 0);
  game.body.velocity.set(9, 4, 12);
  game.step(1 / 60, {});
  assert.equal(game.state.outcome, "flyaway");
  const x = game.body.position.x;
  simulate(game, 0.5);
  assert.ok(
    game.body.position.x > x,
    "an outcome must not freeze the humorous aftermath",
  );
  game.reset();
  assert.equal(game.state.outcome, null);
  simulate(game, 3, { throttle: 1 });
  assert.equal(game.state.outcome, "success");
});

test("forward drive and rear thrust can finish the quarter mile with the car intact", () => {
  const game = new PhysicsGame();
  game.setLevel("drag");
  for (let i = 0; i < 120 * 12 && !game.state.outcome; i++) {
    game.step(1 / 120, { throttle: 1, boost: 1 });
  }
  assert.equal(game.state.outcome, "success");
  assert.ok(game.state.distance >= 402);
  assert.ok(game.state.time < 10);
  assert.equal(game.state.damage, 0);
});

test("mixed boost, steering, reversals, and uneven frame times remain finite", () => {
  const game = new PhysicsGame();
  game.setLevel("drag");
  let seed = 92731;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  let input = {};
  for (let i = 0; i < 2100; i++) {
    if (i % 17 === 0)
      input = {
        q: +(random() > 0.5),
        w: +(random() > 0.5),
        o: +(random() > 0.5),
        p: +(random() > 0.5),
        boost: +(random() > 0.4),
        throttle: random(),
        brake: random() * 0.4,
        steer: random() * 2 - 1,
      };
    game.step([1 / 30, 1 / 60, 1 / 120, 1 / 48][i % 4], input);
    assert.ok(
      [
        ...game.body.position.toArray(),
        ...game.body.velocity.toArray(),
        ...game.body.quaternion.toArray(),
        game.state.pressure,
        game.state.damage,
      ].every(Number.isFinite),
    );
  }
  assert.ok(game.state.pressure >= 0 && game.state.pressure <= 1);
});

test("impact damage accounts for mass: a light crate flies away while a fixed obstacle totals the car", () => {
  const hit = (mass) => {
    const events = [];
    const game = new PhysicsGame({ onImpact: event => events.push(event) });
    const obstacle = game.addBox({ position: [0, 0.5, 5], size: [1, 1, 1], mass });
    game.body.velocity.z = 24;
    simulate(game, 0.8);
    return { game, obstacle, event: events[0] };
  };
  const crate = hit(8);
  const fixed = hit(0);
  assert.ok(crate.event, "the light crate must actually be hit");
  assert.ok(crate.obstacle.position.z > 12, "collision should throw the crate");
  assert.ok(crate.game.damage < 3, `light crate caused ${crate.game.damage}% damage`);
  assert.equal(crate.game.crashed, false);
  assert.equal(fixed.game.damage, 100);
  assert.equal(fixed.game.crashed, true);
  assert.equal(fixed.game.outcome, "wrecked");
  assert.ok(crate.event.reducedMass < 8.1);
  assert.ok(fixed.event.energy > crate.event.energy * 100);
});

test("glancing impacts use normal closing speed instead of full vehicle speed", () => {
  const hitWall = (normalSpeed) => {
    const game = new PhysicsGame();
    game.body.position.y = 3;
    game.addBox({ position: [3, 4, 10], size: [0.6, 8, 100] });
    game.body.velocity.set(normalSpeed, 0, Math.sqrt(24 * 24 - normalSpeed * normalSpeed));
    simulate(game, 0.6);
    return game;
  };
  const glancing = hitWall(4);
  const perpendicular = hitWall(24);
  assert.ok(glancing.damage > 0, "the grazing contact should register");
  assert.ok(glancing.damage < 3, `glancing damage ${glancing.damage}`);
  assert.equal(perpendicular.damage, 100);
});

test("collision events provide accurate local dent coordinates for a rotated car", () => {
  const events = [];
  const game = new PhysicsGame({ onImpact: event => events.push(event) });
  game.body.quaternion.setFromEuler(0, Math.PI / 2, 0);
  game.body.velocity.x = 24;
  game.addBox({ position: [5, 1.5, 0], size: [0.6, 3, 3] });
  simulate(game, 0.3);
  const event = events[0];
  assert.ok(event);
  assert.ok(event.localPoint.z > 2.1, "the car's local nose hit the wall");
  assert.ok(event.localNormal.z > 0.99, "local normal points out through the nose");
  assert.ok(event.normal.x > 0.99, "world normal points toward the +X wall");
  assert.ok(event.impulse > 10000);
  assert.ok(event.effectiveMass > 0 && event.effectiveMass <= PHYSICS.mass);
  assert.equal(event.severity, 1);
});

test("a severe roof-first landing totals the chassis", () => {
  const game = new PhysicsGame();
  game.body.position.y = 18;
  game.body.quaternion.setFromEuler(Math.PI, 0, 0);
  simulate(game, 3);
  assert.equal(game.damage, 100);
  assert.equal(game.crashed, true);
});

test("a totaled car cannot thrust or drive and its broken suspension lets the shell settle", () => {
  const game = new PhysicsGame();
  game.body.position.y = 8;
  game.boosterLevels.fill(1);
  game.rearBoost = 1;
  game.damage = 100;
  const controls = { q: 1, w: 1, o: 1, p: 1, throttle: 1, steer: 1, boost: 1 };
  simulate(game, 0.5, controls);
  assert.ok(game.body.velocity.y < -4.7, "wreck must fall under gravity even with all jets held");
  assert.ok(Math.abs(game.body.velocity.z) < 0.001, "rear thrust must be disabled");
  assert.ok(game.boosterLevels.every(level => level < 0.001));
  assert.ok(game.rearBoost < 0.001);
  assert.equal(game.contactCount, 0);
  simulate(game, 3, controls);
  assert.ok(game.body.position.y < 0.35, `wreck suspension still supports y=${game.body.position.y}`);
  assert.ok(Math.abs(game.body.position.z) < 0.1, "the totaled motor must not drive away");
});

test("explosion is one-shot, kicks nearby dynamic props and debris, and reset clears its lifecycle", () => {
  const game = new PhysicsGame();
  const nearby = game.addBox({ position: [2, 0.5, 0], size: [1, 1, 1], mass: 10 });
  const distant = game.addBox({ position: [30, 0.5, 0], size: [1, 1, 1], mass: 10 });
  const fixed = game.addBox({ position: [-3, 0.5, 0], size: [1, 1, 1] });
  const debris = new CANNON.Body({ mass: 3, position: new CANNON.Vec3(-2, 1, 0), shape: new CANNON.Box(new CANNON.Vec3(0.2, 0.2, 0.2)) });
  game.world.addBody(debris);
  nearby.sleep();
  assert.equal(game.explode(), true);
  assert.equal(game.state.exploded, true);
  assert.equal(game.state.crashed, true);
  assert.ok(nearby.velocity.x > 5 && nearby.velocity.y > 0);
  assert.ok(debris.velocity.x < -5, "direct world debris must also receive the shock wave");
  assert.equal(distant.velocity.length(), 0);
  assert.equal(fixed.velocity.length(), 0);
  assert.ok(game.body.velocity.length() > 1 && game.body.velocity.length() < 4, "car receives a modest kick");
  const firstVelocity = nearby.velocity.clone();
  assert.equal(game.explode(), false);
  assert.equal(nearby.velocity.distanceTo(firstVelocity), 0);
  game.world.removeBody(debris); // WreckEffects owns detached debris cleanup.
  game.reset();
  assert.equal(game.state.exploded, false);
  assert.equal(game.state.crashed, false);
  assert.equal(game.state.damage, 0);
  assert.equal(game.lastBlastTime, null);
  assert.equal(nearby.velocity.length(), 0);
  assert.deepEqual(nearby.position.toArray(), [2, 0.5, 0]);
});

test("a fatal crash in the same rendered frame takes precedence over crossing the finish", () => {
  const game = new PhysicsGame();
  game.setLevel("drag");
  game.body.position.z = 401.8;
  game.body.velocity.z = 24;
  game.addBox({ position: [0, 1.5, 405.1], size: [8, 3, 0.4] });
  game.step(0.05, {});
  assert.ok(game.distance >= 402, "car must cross the finish before the collision in this frame");
  assert.equal(game.damage, 100);
  assert.equal(game.outcome, "wrecked");
});

test("a success already delivered before the aftermath remains an achieved result", () => {
  const game = new PhysicsGame();
  game.setLevel("drag");
  game.body.position.z = 402;
  game.step(1 / 120, {});
  assert.equal(game.outcome, "success");
  game.damage = 100;
  game.step(1 / 60, {});
  assert.equal(game.crashed, true);
  assert.equal(game.outcome, "success");
});

test("fresh own debris cannot recursively damage the car, while old and foreign debris can", () => {
  const strike = (age, own) => {
    const game = new PhysicsGame();
    game.time = age;
    const part = game.addBox({ position: [0, 0.55, 2.8], size: [0.3, 0.3, 0.3], mass: 4 });
    part.userData.wreckDebris = true;
    part.userData.sourceBodyId = own ? game.body.id : -1;
    part.userData.spawnedAt = 0;
    part.velocity.z = -30;
    simulate(game, 0.18);
    return game.damage;
  };
  assert.equal(strike(0, true), 0);
  assert.ok(strike(1, true) > 0.1, "old detached pieces can still make genuine impacts");
  assert.ok(strike(0, false) > 0.1, "other vehicles' pieces must not receive own-body grace");
});

test("a detached wheel removes its support and grip, while reset restores all four contacts", () => {
  const game = new PhysicsGame();
  simulate(game, 1);
  const intactHeight = game.body.position.y;
  game.setMissingWheels([true, false, false, false]);
  assert.equal(game.contactCount, 3, "detachment must immediately clear that wheel's old contact");
  simulate(game, 3);
  assert.deepEqual(game.state.wheelContacts, [false, true, true, true]);
  assert.equal(game.contactCount, 3);
  assert.ok(game.body.position.y < intactHeight - 0.04, "the missing corner must lose support");
  assert.ok(Math.abs(game.body.quaternion.x) + Math.abs(game.body.quaternion.z) > 0.08, "uneven support should naturally lean the chassis");
  assert.ok([...game.body.position.toArray(), ...game.body.quaternion.toArray(), ...game.body.velocity.toArray()].every(Number.isFinite));
  assert.equal(game.damage, 0, "losing one wheel need not automatically total the car");
  game.reset();
  assert.deepEqual(game.state.missingWheels, [false, false, false, false]);
  simulate(game, 2);
  assert.deepEqual(game.state.wheelContacts, [true, true, true, true]);
  assert.ok(Math.abs(game.body.position.y - intactHeight) < 0.01);
  assert.ok(Math.abs(game.body.quaternion.x) + Math.abs(game.body.quaternion.z) < 0.001);
});

test("an otherwise powered car without wheels cannot drive on invisible tire forces", () => {
  const game = new PhysicsGame();
  game.setMissingWheels([true, true, true, true]);
  simulate(game, 3, { throttle: 1, steer: 1 });
  assert.equal(game.contactCount, 0);
  assert.ok(game.body.position.y < 0.35, "the shell must rest directly on the floor");
  assert.ok(Math.abs(game.body.position.z) < 0.1, "ground drive requires an attached tire");
  assert.ok(Math.abs(game.body.position.x) < 0.1);
});
