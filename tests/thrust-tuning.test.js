import test from "node:test";
import assert from "node:assert/strict";
import { Vec3 } from "cannon-es";
import { PhysicsGame } from "../src/physics.js";

const UP = new Vec3(0, 1, 0);

function simulate(game, seconds, input = {}, observe) {
  for (let tick = 0; tick < Math.round(seconds * 120); tick++) {
    game.step(1 / 120, input);
    observe?.(game.state);
  }
  return game.state;
}

function settledDrag(options) {
  const game = new PhysicsGame(options);
  game.setLevel("drag");
  simulate(game, 0.5);
  return game;
}

test("rear thrust gives a strong straight launch without lifting or damaging the car", () => {
  const game = settledDrag();
  const state = simulate(game, 2, { boost: 1 });

  assert.ok(state.speedKmh > 95 && state.speedKmh < 115, `rear launch: ${state.speedKmh} km/h`);
  assert.equal(state.grounded, true);
  assert.ok(state.altitude < 0.05);
  assert.ok(game.body.quaternion.vmult(UP).y > 0.99);
  assert.equal(state.damage, 0);
});

test("rear boost followed by front jets climbs smoothly before a prolonged hold can flip it", () => {
  const impacts = [];
  const game = settledDrag({ onImpact: impact => impacts.push(impact) });
  simulate(game, 3, { boost: 1 });
  let peakPitchRate = 0;
  let largestReverseRate = 0;
  const observe = state => {
    peakPitchRate = Math.max(peakPitchRate, Math.abs(state.angularVelocity.x));
    largestReverseRate = Math.max(largestReverseRate, state.angularVelocity.x);
  };

  const rising = simulate(game, 1, { boost: 1, q: 1, w: 1 }, observe);
  assert.ok(rising.altitude > 1.7, `front jets should raise the chassis: ${rising.altitude} m`);
  assert.ok(rising.velocity.y > 4.5);
  assert.ok(game.body.quaternion.vmult(UP).y > 0.45, "one second leaves time to counter the pitch");
  assert.ok(peakPitchRate < 2.4, `pitch should build progressively: ${peakPitchRate} rad/s`);

  const sustained = simulate(game, 0.5, { boost: 1, q: 1, w: 1 }, observe);
  assert.ok(sustained.altitude > 4.5 && sustained.velocity.y > 6);
  assert.ok(peakPitchRate < 3.2, "the tail must not strike the ground and kick the car into a snap flip");
  assert.ok(largestReverseRate < 0.1, "nose-up thrust should not cause a sudden reverse spin");
  assert.ok(game.body.quaternion.vmult(UP).y < 0, "holding an unbalanced pair can still over-rotate the car");
  assert.equal(impacts.length, 0, "launch should clear the ground without a tail impact");
  assert.equal(sustained.damage, 0);
});

test("adding the front pair after a short rear-corner pulse gains height without instantly overturning", () => {
  const game = settledDrag();
  simulate(game, 0.45, { o: 1, p: 1 });
  const state = simulate(game, 1, { q: 1, w: 1, o: 1, p: 1 });

  assert.ok(state.altitude > 4.5, `balanced jets should climb: ${state.altitude} m`);
  assert.ok(state.velocity.y > 7);
  assert.ok(game.body.quaternion.vmult(UP).y > 0.4, "the car should remain short of a sideways pitch attitude");
  assert.ok(state.angularVelocity.x > 0.3 && state.angularVelocity.x < 1.1, "prior angular momentum remains, with a usable correction window");
  assert.equal(state.damage, 0);
});

test("paired jets retain independent pitch control and momentum after releasing the valves", () => {
  const front = new PhysicsGame();
  const rear = new PhysicsGame();
  front.body.position.y = rear.body.position.y = 15;
  simulate(front, 0.45, { q: 1, w: 1 });
  simulate(rear, 0.45, { o: 1, p: 1 });

  assert.ok(front.body.angularVelocity.x < -0.7 && front.body.angularVelocity.x > -1.4);
  assert.ok(rear.body.angularVelocity.x > 0.7 && rear.body.angularVelocity.x < 1.4);
  assert.ok(Math.abs(front.body.angularVelocity.x + rear.body.angularVelocity.x) < 0.05);

  const pitchBeforeRelease = front.flipAngle;
  simulate(front, 0.15);
  assert.ok(front.flipAngle < pitchBeforeRelease - 0.1, "release should preserve physical angular momentum");
  assert.ok(front.body.angularVelocity.x < -0.6, "there must be no automatic attitude correction");
});
