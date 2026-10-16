import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createCar } from "../src/car.js";

function snapshot(car) {
  const geometry = [],
    transforms = [],
    materials = new Map();
  car.group.traverse((object) => {
    transforms.push({
      object,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
      visible: object.visible,
    });
    if (object.geometry) {
      const attributes = Object.entries(object.geometry.attributes).map(
        ([name, attribute]) => ({
          name,
          attribute,
          data: attribute.array.slice(),
          version: attribute.version,
        }),
      );
      geometry.push({ object, geometry: object.geometry, attributes });
    }
    if (object.material)
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        materials.set(material, {
          color: material.color?.clone(),
          roughness: material.roughness,
          metalness: material.metalness,
          clearcoat: material.clearcoat,
          emissiveIntensity: material.emissiveIntensity,
        });
      }
  });
  return { geometry, transforms, materials };
}

function checkRestored(car, initial) {
  for (const item of initial.geometry) {
    assert.equal(
      item.object.geometry,
      item.geometry,
      "reset retains existing GPU geometry",
    );
    for (const { name, attribute, data } of item.attributes) {
      assert.equal(
        item.geometry.attributes[name],
        attribute,
        `${name} attribute is retained`,
      );
      assert.deepEqual(
        attribute.array,
        data,
        `${item.object.name} ${name} restored exactly`,
      );
    }
  }
  for (const item of initial.transforms) {
    assert.ok(
      item.object.position.equals(item.position),
      `${item.object.name} position`,
    );
    assert.ok(
      item.object.quaternion.equals(item.quaternion),
      `${item.object.name} orientation`,
    );
    assert.ok(
      item.object.scale.equals(item.scale),
      `${item.object.name} scale`,
    );
    assert.equal(
      item.object.visible,
      item.visible,
      `${item.object.name} visibility`,
    );
  }
  for (const [material, state] of initial.materials) {
    if (state.color) assert.ok(material.color.equals(state.color));
    for (const name of [
      "roughness",
      "metalness",
      "clearcoat",
      "emissiveIntensity",
    ])
      assert.equal(material[name], state[name]);
  }
  assert.equal(car.group.userData.damageStage, "intact");
}

const frontalImpact = {
  localPoint: { x: 0.2, y: -0.1, z: 2.23 },
  localNormal: { x: 0, y: 0, z: 1 },
  intensity: 0.65,
  speed: 18,
  damage: 42,
};

test("a front impact produces inward localized deformation and retains dents between frames", () => {
  const car = createCar(),
    initial = snapshot(car);
  car.group.updateMatrixWorld(true);
  car.applyImpact(frontalImpact);
  let frontChanges = 0,
    rearChanges = 0,
    inward = 0;
  const vertex = new THREE.Vector3();
  for (const record of initial.geometry) {
    const before = record.attributes.find((a) => a.name === "position");
    const after = record.geometry.attributes.position.array;
    for (let i = 0; i < after.length; i += 3) {
      assert.ok(
        Number.isFinite(after[i]) &&
          Number.isFinite(after[i + 1]) &&
          Number.isFinite(after[i + 2]),
      );
      vertex.fromArray(before.data, i).applyMatrix4(record.object.matrixWorld);
      const changed =
        Math.abs(after[i] - before.data[i]) +
          Math.abs(after[i + 1] - before.data[i + 1]) +
          Math.abs(after[i + 2] - before.data[i + 2]) >
        1e-6;
      if (changed && vertex.z > 1) {
        frontChanges++;
        if (after[i + 2] < before.data[i + 2]) inward++;
      }
      if (changed && vertex.z < -1.5) rearChanges++;
    }
  }
  assert.ok(frontChanges > 20, `${frontChanges} front vertices deform`);
  assert.ok(
    inward > frontChanges * 0.9,
    "front bodywork compresses toward the cabin",
  );
  assert.equal(
    rearChanges,
    0,
    "a frontal impact leaves distant rear geometry intact",
  );
  const dented = snapshot(car);
  for (let i = 0; i < 120; i++) car.setDamage(42);
  for (const record of dented.geometry)
    for (const attribute of record.attributes) {
      assert.deepEqual(attribute.attribute.array, attribute.data);
      assert.equal(
        attribute.attribute.version,
        attribute.version,
        "unchanged damage avoids GPU upload churn",
      );
    }
});

test("glass progresses from cracks to open jagged edges and a scorched crushed shell", () => {
  const car = createCar();
  const parts = [];
  car.group.traverse((object) => parts.push(object));
  const cracks = parts.filter(
    (o) => o.name === "Laminated glass spiderweb fracture",
  );
  const remnants = parts.filter((o) => o.name === "Jagged remaining glass");
  const shell = parts.find(
    (o) => o.name === "Crash-deformable aluminium shell",
  );
  const originalBrightness =
    shell.material.color.r + shell.material.color.g + shell.material.color.b;
  assert.ok(cracks.length >= 5 && remnants.length === cracks.length);
  car.setDamage(25);
  assert.ok(cracks.every((o) => o.visible));
  assert.ok(remnants.every((o) => !o.visible));
  car.setDamage(75);
  assert.ok(cracks.every((o) => !o.visible));
  assert.ok(remnants.every((o) => o.visible));
  assert.ok(
    parts.find((o) => o.name === "Exposed cabin after glass failure").visible,
  );
  car.setDamage(100);
  assert.equal(car.group.userData.damageStage, "wreck");
  assert.ok(
    shell.material.color.r + shell.material.color.g + shell.material.color.b <
      originalBrightness * 0.15,
  );
  const wreck = shell.geometry.attributes.position.array.slice();
  car.setDamage(100);
  assert.deepEqual(
    shell.geometry.attributes.position.array,
    wreck,
    "wreck crush happens once",
  );
});

test("explosion detaches actual centered world-space parts with independent disposable resources", () => {
  const car = createCar();
  car.group.position.set(12, 4, -8);
  car.group.rotation.set(0.3, 0.7, -0.15);
  car.group.scale.setScalar(1.3);
  car.group.updateMatrixWorld(true);
  const initial = snapshot(car);
  const sources = new Map();
  car.group.traverse((object) => {
    if (object.userData.carPart) sources.set(object.userData.carPart, object);
  });
  const pieces = car.takeDebris({ explode: true });
  assert.ok(pieces.length >= 8);
  assert.ok(pieces.some((p) => p.kind.startsWith("wheel-")));
  assert.ok(pieces.some((p) => p.kind === "rear-wing"));
  assert.ok(pieces.some((p) => p.kind === "hood"));
  const originalGeometry = new Set(
    initial.geometry.map((record) => record.geometry),
  );
  const originalMaterials = new Set(initial.materials.keys());
  for (const piece of pieces) {
    const source = sources.get(piece.kind);
    assert.equal(source.visible, false);
    assert.ok(
      piece.mass > 0 &&
        piece.size.length === 3 &&
        piece.size.every((n) => Number.isFinite(n) && n > 0),
    );
    assert.equal(piece.object.parent, null);
    assert.equal(piece.object.userData.carDebris, true);
    piece.object.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(source, true);
    const debrisBounds = new THREE.Box3().setFromObject(piece.object, true);
    assert.ok(
      sourceBounds.min.distanceTo(debrisBounds.min) < 1e-5,
      `${piece.kind} preserves world geometry minimum`,
    );
    assert.ok(
      sourceBounds.max.distanceTo(debrisBounds.max) < 1e-5,
      `${piece.kind} preserves world geometry maximum`,
    );
    piece.object.traverse((object) => {
      if (object.geometry) {
        assert.equal(originalGeometry.has(object.geometry), false);
        object.geometry.dispose();
      }
      if (object.material)
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          assert.equal(originalMaterials.has(material), false);
          material.dispose();
        }
    });
  }
  assert.deepEqual(
    car.takeDebris({ explode: true }),
    [],
    "pieces cannot detach twice",
  );
  car.setDamage(0);
  checkRestored(car, initial);
});

test("repeated crash and reset cycles restore exact model arrays, materials, transforms and visibility", () => {
  const car = createCar(),
    initial = snapshot(car);
  for (let cycle = 0; cycle < 3; cycle++) {
    car.update(0.2, { speed: 15, steer: 0.3, boosters: [1, 0.5, 1, 0] });
    car.applyImpact(frontalImpact);
    car.applyImpact({
      localPoint: { x: -1, y: 0.16, z: 0.45 },
      localNormal: { x: -1, y: 0, z: 0 },
      intensity: 0.9,
      speed: 25,
      damage: 85,
    });
    const collisionPieces = car.takeDebris();
    assert.ok(
      collisionPieces.length > 0,
      "severe localized impact sheds real nearby parts",
    );
    const explosionPieces = car.takeDebris({ explode: true });
    assert.ok(explosionPieces.length > 0);
    car.setDamage(0);
    checkRestored(car, initial);
  }
  const pristine = snapshot(car);
  for (let i = 0; i < 120; i++) car.setDamage(0);
  for (const record of pristine.geometry)
    for (const attribute of record.attributes) {
      assert.equal(
        attribute.attribute.version,
        attribute.version,
        "pristine frames do not rewrite geometry",
      );
    }
});
