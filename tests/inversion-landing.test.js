import test from "node:test";
import assert from "node:assert/strict";
import { PhysicsGame } from "../src/physics.js";
import { RAMP } from "../src/environments.js";

// Recreate the actual ramp and its flat apron. Every stunt below starts at the
// normal spawn and uses only player inputs; no airborne state is injected.
function inversionCourse() {
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
      size: [width, thickness, 2 * radius * Math.sin(Math.PI / segments / 2) + 0.025],
      rotation: [-angle, 0, 0],
    });
  }
  return game;
}

function sideFlipAndStabilize(pair, liftDuration) {
  const game = inversionCourse();
  let launchTime = null;
  let touchdown = null;
  let caughtAt = null;
  for (let frame = 0; frame < 120 * 13; frame++) {
    if (game.rampStage === "airborne" && launchTime === null) launchTime = game.time;
    let input = {};
    if (launchTime !== null) {
      const airborneTime = game.time - launchTime;
      if (airborneTime < 0.8) input = pair;
      else if (airborneTime < 0.8 + liftDuration) input = { q: 1, w: 1, o: 1, p: 1 };
    }
    game.step(1 / 120, input);
    if (game._landingCaught && !caughtAt) caughtAt = game.body.position.clone();
    if (launchTime !== null && game.contactCount >= 2 && game.body.position.y < 1.25 && !touchdown) {
      touchdown = {
        x: game.body.position.x,
        z: game.body.position.z,
        speed: Math.hypot(game.body.velocity.x, game.body.velocity.z),
        up: game._up.y,
      };
    }
    if (game.outcome) break;
  }
  return { game, launchTime, touchdown, caughtAt };
}

for (const [name, pair] of [["left", { q: 1, o: 1 }], ["right", { w: 1, p: 1 }]]) {
  test(`inversion accepts a ${name} side flip stabilized by all four jets on the wide apron`, () => {
    const { game, launchTime, touchdown } = sideFlipAndStabilize(pair, 0.8);
    assert.ok(launchTime !== null, "must actually drive the inverted ramp and leave its lip");
    assert.ok(touchdown, "the side flip must return to its wheels");
    assert.ok(Math.abs(touchdown.x) > 14, "reproduce lateral drift past the old invisible landing boundary");
    assert.ok(touchdown.speed > 15, "preserve the player's normal horizontal landing speed");
    assert.ok(touchdown.up > 0.86, "the player has righted the car before touchdown");
    assert.equal(game.outcome, "success", "a controlled landing on the apron must complete the test");
    assert.ok(game.damage < 5, `a near-level return should not explode (damage ${game.damage})`);
    assert.equal(game.crashed, false);
  });
}

test("a caught inversion landing still wins after sliding beyond the old line during settling", () => {
  const { game, touchdown, caughtAt } = sideFlipAndStabilize({ q: 1, o: 1 }, 0.4);
  assert.ok(caughtAt && caughtAt.x < 14, "landing begins inside the old boundary");
  assert.ok(touchdown && touchdown.speed > 15, "car continues sliding while its suspension settles");
  assert.ok(game.body.position.x > 14, "settling carries the car across the old invisible line");
  assert.equal(game.outcome, "success", "settling must not revoke an otherwise successful landing");
  assert.ok(game.damage < 5);
});

function completedRampReturn({ x = 0, z = 10, pitch = 0, roll = 0, height = 24 } = {}) {
  const game = inversionCourse();
  game._hasClimbed = true;
  game._rampLaunched = true;
  game.rampStage = "airborne";
  game.body.position.set(x, height, z);
  game.body.quaternion.setFromEuler(pitch, 0, roll);
  return game;
}

for (const attitude of [{ pitch: 40 * Math.PI / 180 }, { roll: -40 * Math.PI / 180 }]) {
  test(`the near-level landing tolerance also protects a 40-degree ${attitude.pitch ? "pitch" : "roll"} return`, () => {
    const game = completedRampReturn(attitude);
    for (let frame = 0; frame < 120 * 6 && !game.outcome; frame++) game.step(1 / 120, {});
    assert.equal(game.outcome, "success", "catch and completion must agree on the acceptable landing attitude");
    assert.equal(game._landingCaught, true);
    assert.ok(game.damage < 5, `landing within the allowed angle must not explode (damage ${game.damage})`);
  });
}

for (const position of [{ x: 181 }, { x: -181 }, { z: -161 }]) {
  test(`a return outside the playable area cannot become a landing success: ${JSON.stringify(position)}`, () => {
    const game = completedRampReturn({ ...position, height: 0.98 });
    game.body.velocity.y = -22;
    game.step(1 / 120, {});
    assert.equal(game._landingCaught, false, "the infinite physics plane must not rescue an out-of-bounds car");
    assert.equal(game.outcome, "flyaway");
    for (let frame = 0; frame < 120; frame++) game.step(1 / 120, {});
    assert.equal(game.outcome, "flyaway", "settling after an out-of-bounds failure cannot award success");
  });
}

for (const z of [-60, 80]) {
  test(`a soft inversion landing at z=${z} uses the full visible apron`, () => {
    const game = completedRampReturn({ z, height: 0.98 });
    game.body.velocity.y = -0.5;
    for (let frame = 0; frame < 120 * 2 && !game.outcome; frame++) game.step(1 / 120, {});
    assert.equal(game.outcome, "success", "a gentle touchdown beyond the old longitudinal gate must count");
    assert.equal(game._landingCaught, false, "a soft landing succeeds without emergency impact assistance");
    assert.equal(game.damage, 0);
  });
}

for (const position of [{ x: 120 }, { z: 180 }]) {
  test(`flat ground beyond the visible apron is not a landing zone: ${JSON.stringify(position)}`, () => {
    for (const descent of [-0.5, -22]) {
      const game = completedRampReturn({ ...position, height: 0.98 });
      game.body.velocity.y = descent;
      for (let frame = 0; frame < 120 * 2; frame++) game.step(1 / 120, {});
      assert.equal(game._landingCaught, false, "the world plane outside the apron must not provide landing assistance");
      assert.notEqual(game.outcome, "success", "a completed ramp does not make every patch of ground a valid finish");
      if (descent === -0.5) {
        assert.ok(game.contactCount >= 2, "the gentle control case really settled on the floor");
        assert.equal(game.damage, 0);
        assert.equal(game.outcome, null, "this is beyond the apron, but still inside the playable world");
      }
    }
  });
}
