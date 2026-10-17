import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createPorsche } from "../src/porsche.js";

function resources(root) {
  const geometry = new Set(),
    materials = new Set();
  root.traverse((o) => {
    if (o.geometry) geometry.add(o.geometry);
    if (o.material) materials.add(o.material);
  });
  return { geometry, materials };
}
function disposePiece(piece) {
  const owned = resources(piece.object);
  for (const geo of owned.geometry) geo.dispose();
  for (const mat of owned.materials) mat.dispose();
}

test("Porsche dimensions, wheels and draw budget fit the live drag rival", () => {
  const car = createPorsche();
  const bounds = new THREE.Box3().setFromObject(car.group),
    size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.z > 4.4 && size.z < 4.8, `length ${size.z}`);
  assert.ok(size.x > 1.9 && size.x < 2.4, `width ${size.x}`);
  assert.ok(
    Math.abs(bounds.min.y + 0.71) < 0.015,
    "tire contact matches the physical COM",
  );
  assert.equal(car.wheels.length, 4);
  let drawCalls = 0;
  car.group.traverse((o) => {
    if (o.isMesh) {
      drawCalls++;
      assert.ok(o.geometry.attributes.position.count > 0);
    }
  });
  assert.ok(
    drawCalls <= 45,
    `${drawCalls} draw calls including all four rotating wheels`,
  );
  car.update(0.5, { speed: 12, steer: 0.2 });
  assert.equal(car.wheels[0].rotation.y, 0.2);
  assert.equal(car.wheels[2].rotation.y, 0);
  assert.ok(car.wheels[0].children[0].rotation.x > 1);
  car.dispose();
});

test("exploding detaches actual Porsche panels and wheels with independent centered world geometry", () => {
  const car = createPorsche(),
    sources = new Map();
  car.group.position.set(10, 3, 42);
  car.group.rotation.set(0.1, 0.7, -0.13);
  car.group.scale.setScalar(1.2);
  car.update(0.3, { speed: 8, steer: 0.13 });
  car.group.updateMatrixWorld(true);
  car.group.traverse((o) => {
    if (o.userData.carPart) sources.set(o.userData.carPart, o);
  });
  const originals = resources(car.group),
    positions = new Map();
  for (const [kind, source] of sources) {
    const points = [];
    source.traverse((o) => {
      if (o.geometry) {
        const a = o.geometry.attributes.position;
        for (let i = 0; i < a.count; i++)
          points.push(
            new THREE.Vector3()
              .fromBufferAttribute(a, i)
              .applyMatrix4(o.matrixWorld),
          );
      }
    });
    positions.set(kind, points);
  }
  const pieces = car.takeDebris({ explode: true });
  assert.equal(pieces.length, 9);
  assert.equal(pieces.filter((p) => p.kind.startsWith("wheel-")).length, 4);
  for (const kind of [
    "hood",
    "rear-deck",
    "rear-wing",
    "front-bumper",
    "rear-bumper",
  ])
    assert.ok(pieces.some((p) => p.kind === kind));
  for (const piece of pieces) {
    assert.equal(sources.get(piece.kind).visible, false);
    assert.ok(piece.size.every((n) => Number.isFinite(n) && n > 0.04));
    const owned = resources(piece.object);
    for (const geo of owned.geometry) assert.ok(!originals.geometry.has(geo));
    for (const mat of owned.materials) assert.ok(!originals.materials.has(mat));
    const expected = positions.get(piece.kind);
    let index = 0;
    piece.object.traverse((o) => {
      if (o.geometry) {
        const a = o.geometry.attributes.position;
        for (let i = 0; i < a.count; i++) {
          const actual = new THREE.Vector3()
            .fromBufferAttribute(a, i)
            .applyMatrix4(o.matrixWorld);
          assert.ok(
            actual.distanceTo(expected[index++]) < 1e-5,
            "detached vertices retain their world position",
          );
        }
      }
    });
    const localBounds = new THREE.Box3(),
      inverse = piece.object.matrixWorld.clone().invert();
    piece.object.traverse((o) => {
      if (o.geometry) {
        const matrix = new THREE.Matrix4().multiplyMatrices(
            inverse,
            o.matrixWorld,
          ),
          a = o.geometry.attributes.position;
        for (let i = 0; i < a.count; i++)
          localBounds.expandByPoint(
            new THREE.Vector3().fromBufferAttribute(a, i).applyMatrix4(matrix),
          );
      }
    });
    assert.ok(
      localBounds.getCenter(new THREE.Vector3()).length() < 1e-5,
      "debris origin is centered for rigid-body rotation",
    );
    disposePiece(piece);
  }
  assert.deepEqual(
    car.takeDebris({ explode: true }),
    [],
    "one explosion cannot duplicate debris",
  );
  car.dispose();
});

test("impact deforms shell locally, damage persists, and reset reuses every GPU resource", () => {
  const car = createPorsche(),
    originals = resources(car.group),
    state = [];
  car.group.traverse((o) => {
    if (o.geometry)
      state.push({
        o,
        array: o.geometry.attributes.position.array.slice(),
        geometry: o.geometry,
      });
  });
  const colors = new Map(
    [...originals.materials].map((m) => [m, m.color.clone()]),
  );
  car.applyImpact({
    localPoint: { x: 0.6, y: 0.12, z: 1.9 },
    localNormal: { x: 0, y: 0, z: 1 },
    intensity: 0.8,
    speed: 20,
    damage: 80,
  });
  assert.ok(
    state.some(({ o, array }) =>
      o.geometry.attributes.position.array.some((n, i) => n !== array[i]),
    ),
    "impact dents the real coachwork",
  );
  const pieces = car.takeDebris({ explode: true });
  assert.equal(car.group.userData.damageStage, "wreck");
  car.setDamage(0);
  assert.equal(car.group.userData.damageStage, "intact");
  for (const { o, array, geometry } of state) {
    assert.equal(o.geometry, geometry);
    assert.deepEqual(o.geometry.attributes.position.array, array);
    assert.equal(o.visible, true);
  }
  for (const [m, color] of colors)
    assert.ok(m.color.equals(color), "paint, glass and lamp colors restored");
  const secondExplosion = car.takeDebris({ explode: true });
  assert.equal(secondExplosion.length, 9, "reset rearms detachable parts");
  for (const piece of secondExplosion) disposePiece(piece);
  for (const piece of pieces) disposePiece(piece);
  car.dispose();
});

test("disposing Porsche GPU resources is idempotent and never disposes handed-off debris", () => {
  const car = createPorsche(),
    originals = resources(car.group),
    pieces = car.takeDebris({ explode: true });
  let geometries = 0,
    materials = 0,
    debrisDisposals = 0;
  for (const g of originals.geometry)
    g.addEventListener("dispose", () => geometries++);
  for (const m of originals.materials)
    m.addEventListener("dispose", () => materials++);
  for (const p of pieces) {
    const owned = resources(p.object);
    for (const g of owned.geometry)
      g.addEventListener("dispose", () => debrisDisposals++);
  }
  car.dispose();
  car.dispose();
  assert.equal(geometries, originals.geometry.size);
  assert.equal(materials, originals.materials.size);
  assert.equal(debrisDisposals, 0);
  for (const p of pieces) disposePiece(p);
});
