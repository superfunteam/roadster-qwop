import test from "node:test";
import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { PhysicsGame, PHYSICS } from "../src/physics.js";

const UP = new CANNON.Vec3(0, 1, 0);

function simulate(game, seconds, input = {}, dt = 1 / 120) {
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) game.step(dt, input);
  return game.state;
}

function placeOnRoof(game, height = 0.69) {
  game.body.position.set(0, height, 0);
  game.body.quaternion.setFromEuler(0, 0, Math.PI);
  game.body.velocity.setZero();
  game.body.angularVelocity.setZero();
  game.body.aabbNeedsUpdate = true;
  game.world.broadphase.dirty = true;
}

function roofGame() {
  const game = new PhysicsGame();
  game.setLevel("drag");
  placeOnRoof(game);
  return game;
}

function assertNotRecovering(game, message) {
  assert.equal(game.state.recoveryRemaining, null, message);
  assert.equal(game.state.recoveryReady, false, message);
}

function warningGame() {
  const game = roofGame();
  simulate(game, 2.25);
  assert.ok(game.state.recoveryRemaining > 0, "real roof contact should arm a warning");
  assert.equal(game.state.recoveryReady, false);
  return game;
}

test("a survivable roof landing gets a recovery countdown before becoming ready to reset", () => {
  const game = roofGame();
  simulate(game, 1);
  assertNotRecovering(game, "give a new roof landing time to recover without a warning");
  assert.equal(game.state.grounded, false, "roof support is not wheel support");
  assert.ok(game.world.contacts.some(contact => contact.bi === game.body || contact.bj === game.body));
  simulate(game, 1.25);
  const firstRemaining = game.state.recoveryRemaining;
  assert.ok(firstRemaining > 0 && firstRemaining < PHYSICS.recoveryNotice);
  assert.equal(game.state.recoveryReady, false);
  simulate(game, 0.5);
  assert.ok(game.state.recoveryRemaining < firstRemaining, "the warning counts down in simulation time");
  simulate(game, 2);
  assert.equal(game.state.recoveryReady, true);
  assert.equal(game.state.recoveryRemaining, 0);
  assert.equal(game.state.damage, 0);
  assert.equal(game.state.outcome, null, "being stranded should not manufacture a crash or end the level");
});

test("roof support on elevated loose clutter also qualifies without a ground-height heuristic", () => {
  const game = new PhysicsGame();
  game.setLevel("drag");
  game.addBox({ position: [0, 2, 0], size: [10, 4, 10] });
  const platform = game.addBox({ position: [0, 4.2, 0], size: [8, 0.4, 8], mass: 800 });
  placeOnRoof(game, 5.09);
  simulate(game, 5);
  assert.ok(game.body.position.y > 4.9, "the car should remain on the elevated clutter");
  assert.ok(game.world.contacts.some(contact =>
    (contact.bi === game.body && contact.bj === platform) ||
    (contact.bj === game.body && contact.bi === platform)), "the loose object must really support the roof");
  assert.equal(game.state.recoveryReady, true);
  assert.equal(game.state.outcome, null);
});

test("a stationary inverted car in midair or pressed against a wall is not mistaken for a roof landing", () => {
  const airborne = roofGame();
  airborne.world.gravity.setZero();
  airborne.body.position.y = 8;
  simulate(airborne, 6);
  assert.ok(airborne.body.quaternion.vmult(UP).y < -0.99);
  assert.ok(airborne.body.velocity.length() < 0.01);
  assertNotRecovering(airborne, "being upside down in the air is part of the stunt");

  const wall = roofGame();
  wall.body.position.y = 5;
  wall.world.gravity.set(9.81, 0, 0);
  const obstacle = wall.addBox({ position: [1.7, 5, 0], size: [1, 10, 10] });
  simulate(wall, 6);
  assert.ok(wall.world.contacts.some(contact =>
    (contact.bi === wall.body && contact.bj === obstacle) ||
    (contact.bj === wall.body && contact.bi === obstacle)), "test must include real sustained wall contact");
  assertNotRecovering(wall, "a side-wall contact does not support the roof from below");
});

test("inverted wheels riding an overhead surface remain playable", () => {
  const game = roofGame();
  game.world.gravity.set(0, 9.81, 0);
  game.addBox({ position: [0, 5.8, 0], size: [12, 0.2, 12] });
  game.body.position.y = 4.9;
  simulate(game, 6);
  assert.ok(game.body.quaternion.vmult(UP).y < -0.99);
  assert.equal(game.contactCount, 4, "the inverted suspension must actually contact the ceiling");
  assertNotRecovering(game, "the inverted section of the ramp must not trigger recovery");
});

test("sliding, renewed rotation, righting, and leaving support immediately cancel a roof countdown", () => {
  const interventions = {
    sliding: game => game.body.velocity.set(5, 0, 0),
    rotating: game => game.body.angularVelocity.set(0, 4, 0),
    righting: game => {
      game.body.quaternion.set(0, 0, 0, 1);
      game.body.position.y = 0.74;
    },
    airborne: game => {
      game.body.position.y = 8;
      game.world.gravity.setZero();
    },
  };
  for (const [name, intervene] of Object.entries(interventions)) {
    const game = warningGame();
    intervene(game);
    game.body.aabbNeedsUpdate = true;
    game.world.broadphase.dirty = true;
    game.step(PHYSICS.fixedStep);
    assertNotRecovering(game, `${name} must cancel the pending reset`);
    if (name === "righting" || name === "airborne") {
      simulate(game, 5);
      assertNotRecovering(game, `${name} must stay canceled`);
    } else {
      placeOnRoof(game);
      simulate(game, 1);
      assertNotRecovering(game, "a new stationary contact must earn a fresh grace period");
      simulate(game, 4);
      assert.equal(game.state.recoveryReady, true);
    }
  }
});

test("achieved results and explosions take priority over pending roof recovery", () => {
  for (const outcome of ["success", "flyaway", "wrecked"]) {
    const game = warningGame();
    game.outcome = outcome;
    simulate(game, 5);
    assert.equal(game.state.outcome, outcome);
    assertNotRecovering(game, `${outcome} must not be replaced by an automatic roof reset`);
  }
  const wreck = warningGame();
  wreck.explode();
  simulate(wreck, 5);
  assert.equal(wreck.state.exploded, true);
  assert.equal(wreck.state.outcome, "wrecked");
  assertNotRecovering(wreck, "explosion aftermath retains control of the result");
});

test("manual reset and level changes clear all recovery state", () => {
  for (const action of [game => game.reset(), game => game.setLevel("garage")]) {
    const game = roofGame();
    simulate(game, 5);
    assert.equal(game.state.recoveryReady, true);
    action(game);
    assertNotRecovering(game, "a new run starts with no recovery timer");
    assert.equal(game.state.time, 0);
    simulate(game, 5);
    assertNotRecovering(game, "an upright new run should stay playable");
  }
});

test("reading state and non-advancing physics calls cannot consume recovery time", () => {
  const game = warningGame();
  const remaining = game.state.recoveryRemaining;
  const time = game.state.time;
  for (let i = 0; i < 100; i++) {
    game.step(0);
    game.step(-1);
    game.step(Number.NaN);
    assert.equal(game.state.recoveryRemaining, remaining);
    assert.equal(game.state.time, time);
  }
  simulate(game, 0.5);
  assert.ok(game.state.recoveryRemaining < remaining);
});

test("roof recovery timing is independent of the rendering frame rate", () => {
  const slow = roofGame();
  const fast = roofGame();
  simulate(slow, 3, {}, 1 / 30);
  simulate(fast, 3, {}, 1 / 120);
  assert.ok(Math.abs(slow.state.recoveryRemaining - fast.state.recoveryRemaining) < 1e-8);
  assert.equal(slow.state.recoveryReady, false);
  assert.equal(fast.state.recoveryReady, false);
  simulate(slow, 1.5, {}, 1 / 30);
  simulate(fast, 1.5, {}, 1 / 120);
  assert.equal(slow.state.recoveryReady, true);
  assert.equal(fast.state.recoveryReady, true);
});
