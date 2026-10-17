import test from "node:test";
import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { PhysicsGame } from "../src/physics.js";
import { RIVAL } from "../src/rival-physics.js";

function simulate(game, seconds, input = {}) {
  for (let tick = 0; tick < Math.round(seconds * 120); tick++) game.step(1 / 120, input);
}

function race(input) {
  const game = new PhysicsGame();
  game.setLevel("drag");
  for (let tick = 0; tick < 15 * 120 && !game.outcome; tick++) game.step(1 / 120, input);
  return game;
}

function rearEnd(speed) {
  const impacts = [];
  const game = new PhysicsGame({ onRivalImpact: (event) => impacts.push(event) });
  game.setLevel("drag");
  game.body.position.set(RIVAL.laneX, 0.74, -4.7);
  game.body.velocity.z = speed;
  simulate(game, 0.5);
  return { game, impacts };
}

test("Porsche launches in the other lane using a dynamic chassis and intact suspension", () => {
  const game = new PhysicsGame();
  game.setLevel("drag");
  const rival = game.rival;
  assert.equal(rival.body.type, CANNON.Body.DYNAMIC);
  assert.equal(rival.body.mass, RIVAL.mass);
  assert.equal(rival.body.position.x, 6.4);
  assert.equal(rival.body.velocity.length(), 0);
  simulate(game, 5);
  assert.ok(rival.body.position.z > 125, "rival actually accelerates down the track");
  assert.ok(rival.body.velocity.z > 45);
  assert.ok(Math.abs(rival.body.position.x - 6.4) < 0.02);
  assert.ok(rival.body.position.y > 0.68 && rival.body.position.y < 0.79);
  assert.equal(rival.state.grounded, true);
  assert.equal(rival.damage, 0, "launching and resting on its wheels cause no self-damage");
  assert.equal(rival.crashed, false);
});

test("the Porsche beats ordinary throttle, while rear rockets win a clean race", () => {
  const ordinary = race({ throttle: 1 });
  assert.equal(ordinary.outcome, "beaten");
  assert.ok(ordinary.rival.finishTime > 9 && ordinary.rival.finishTime < 10);
  assert.ok(ordinary.body.position.z < 402);
  assert.equal(ordinary.damage, 0);
  const boosted = race({ throttle: 1, boost: 1 });
  assert.equal(boosted.outcome, "success");
  assert.ok(boosted.dragFinishTime < 7);
  assert.equal(boosted.rival.finishTime, null);
  assert.equal(boosted.rival.damage, 0);
  assert.equal(boosted.damage, 0);
});

test("gentle contact trades momentum and dents the Porsche without exploding it", () => {
  const { game, impacts } = rearEnd(5);
  assert.ok(impacts.length > 0, "the bodies must actually collide");
  assert.ok(game.rival.damage > 0 && game.rival.damage < 3);
  assert.equal(game.rival.crashed, false);
  assert.equal(game.rival.exploded, false);
  assert.ok(impacts[0].reducedMass > 750 && impacts[0].reducedMass < 850);
  assert.ok(impacts[0].impulse > 500);
  assert.ok(impacts[0].localPoint.z < -2, "rear dent is expressed in rival coordinates");
});

test("a hard player collision totals the Porsche and its one-shot blast moves physical bodies", () => {
  const { game, impacts } = rearEnd(25);
  assert.equal(game.rival.damage, 100);
  assert.equal(game.rival.crashed, true);
  assert.ok(impacts[0].speed > 20);
  const before = game.body.velocity.clone();
  assert.equal(game.rival.explode(), true);
  assert.equal(game.rival.exploded, true);
  assert.ok(game.body.velocity.distanceTo(before) > 0.1, "nearby player receives the blast impulse");
  const once = game.body.velocity.clone();
  assert.equal(game.rival.explode(), false);
  assert.ok(game.body.velocity.distanceTo(once) < 1e-10, "repeated render frames cannot repeat the blast");
  simulate(game, 0.5);
  assert.equal(game.rival.throttle, 0);
  assert.equal(game.rival.contactCount, 0, "a totaled car loses suspension support");
});

test("fast tangential rubbing is not treated as a full-speed head-on crash", () => {
  const game = new PhysicsGame();
  game.setLevel("drag");
  game.body.position.set(4.25, 0.74, 20);
  game.rival.body.position.set(6.4, 0.74, 20);
  game.body.velocity.set(4, 0, 50);
  game.rival.body.velocity.set(0, 0, 50);
  simulate(game, 0.25);
  assert.ok(game.rival.damage > 0, "the side swipe must register");
  assert.ok(game.rival.damage < 5, `glancing damage was ${game.rival.damage}`);
  assert.equal(game.rival.crashed, false);
});

test("lane keeping cannot teleport away a collision impulse or correct a car in midair", () => {
  const game = new PhysicsGame();
  game.setLevel("drag");
  game.rival.body.position.y = 10;
  game.rival.body.applyImpulse(new CANNON.Vec3(RIVAL.mass * 6, 0, 0));
  simulate(game, 0.5);
  assert.ok(game.rival.body.position.x > RIVAL.laneX + 2.8);
  assert.ok(game.rival.body.velocity.x > 5.5);
  assert.ok(Math.abs(game.rival.body.angularVelocity.y) < 1e-8);
  assert.equal(game.rival.contactCount, 0);
});

test("reset restores both cars, damage, wheel support and race timing", () => {
  const { game } = rearEnd(25);
  game.rival.explode();
  game.rival.setMissingWheels([true, false, true, false]);
  game.rival.finishTime = 9;
  game.reset();
  assert.deepEqual(game.rival.body.position.toArray(), [6.4, 0.74, 0]);
  assert.deepEqual(game.rival.body.velocity.toArray(), [0, 0, 0]);
  assert.deepEqual(game.rival.missingWheels, [false, false, false, false]);
  assert.equal(game.rival.damage, 0);
  assert.equal(game.rival.crashed, false);
  assert.equal(game.rival.exploded, false);
  assert.equal(game.rival.finishTime, null);
  assert.equal(game.dragFinishTime, null);
  assert.equal(game.outcome, null);
  simulate(game, 1, { throttle: 1, boost: 1 });
  assert.equal(game.rival.damage, 0);
  assert.ok(game.rival.body.position.z > 5);
});

test("changing levels removes the rival body and repeated drag starts do not accumulate cars", () => {
  const game = new PhysicsGame();
  for (const level of ["drag", "garage", "drag", "ramp", "drag", "factory", "drag"]) {
    const previousBody = game.rival?.body;
    game.setLevel(level);
    assert.equal(game.world.bodies.length, level === "drag" ? 3 : 2);
    assert.equal(game.world.bodies.includes(previousBody), false);
    assert.equal(game.state.rival !== null, level === "drag");
  }
});

test("same-tick finish order uses the crossing fraction, not body update order", () => {
  for (const [playerZ, rivalZ, expected] of [[401.9, 401.7, "success"], [401.7, 401.9, "beaten"]]) {
    const game = new PhysicsGame();
    game.setLevel("drag");
    game.body.position.z = playerZ;
    game.rival.body.position.z = rivalZ;
    game.body.velocity.z = 60;
    game.rival.body.velocity.z = 60;
    game.step(1 / 120, {});
    assert.ok(game.dragFinishTime !== null && game.rival.finishTime !== null);
    assert.equal(game.outcome, expected);
  }
});

test("a destroyed Porsche cannot win by sliding over the line, and AI brakes after the race", () => {
  const game = new PhysicsGame();
  game.setLevel("drag");
  game.rival.body.position.z = 401.9;
  game.rival.body.velocity.z = 60;
  game.rival.explode();
  game.step(1 / 120, {});
  assert.ok(game.rival.body.position.z > 402);
  assert.equal(game.rival.finishTime, null);
  assert.equal(game.outcome, null);

  const completed = race({ throttle: 1, boost: 1 });
  const before = completed.rival.body.velocity.z;
  simulate(completed, 1);
  assert.equal(completed.rival.throttle, 0);
  assert.ok(completed.rival.body.velocity.z < before - 5);
});

test("a Porsche finish followed by a fatal crash in the same frame cannot defeat an intact player", () => {
  for (const [playerZ, expected] of [[0, null], [399.8, "success"]]) {
    const game = new PhysicsGame();
    game.setLevel("drag");
    game.body.position.z = playerZ;
    game.body.velocity.z = 60;
    game.rival.body.position.z = 401.1;
    game.rival.body.velocity.z = 60;
    game.addBox({ position: [6.4, 1.5, 405.1], size: [3, 3, 0.4] });
    game.step(0.05, {});
    assert.equal(game.rival.damage, 100);
    assert.equal(game.rival.finishTime, null);
    assert.equal(game.damage, 0);
    assert.equal(game.outcome, expected);
  }
});

test("a rival result delivered in an earlier frame stays banked during a later crash", () => {
  const game = new PhysicsGame();
  game.setLevel("drag");
  game.rival.body.position.z = 401.1;
  game.rival.body.velocity.z = 60;
  game.addBox({ position: [6.4, 1.5, 405.1], size: [3, 3, 0.4] });
  game.step(1 / 60, {});
  assert.equal(game.outcome, "beaten");
  assert.equal(game.rival.damage, 0);
  const finish = game.rival.finishTime;
  game.step(0.05, {});
  assert.equal(game.rival.damage, 100);
  assert.equal(game.rival.finishTime, finish);
  assert.equal(game.outcome, "beaten");
});
