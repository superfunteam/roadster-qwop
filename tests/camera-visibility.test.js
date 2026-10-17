import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CameraVisibility } from "../src/camera-visibility.js";

function camera(position = [0, 3, -10], target = [0, 0, 0]) {
  const value = new THREE.PerspectiveCamera(50, 1.5, 0.08, 500);
  value.position.set(...position);
  value.lookAt(...target);
  value.updateProjectionMatrix();
  return value;
}

function box(position, size = [1, 1, 1]) {
  const value = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial());
  value.position.set(...position);
  return value;
}

test("camera cutaway hides a blocking wall but preserves neighboring scenery and the background", () => {
  const wall = box([0, 1.5, -5], [8, 4, 0.25]);
  const neighbor = box([9, 1, -5], [1, 2, 1]);
  const background = box([0, 2, 12], [8, 4, 0.25]);
  const visibility = new CameraVisibility([wall, neighbor, background]);
  visibility.update(camera(), new THREE.Group(), 1 / 60);
  assert.equal(wall.visible, false);
  assert.equal(neighbor.visible, true);
  assert.equal(background.visible, true);
  assert.equal(visibility.hiddenCount, 1);
});

test("cutaways protect car corners that are missed by a ray through the center", () => {
  const view = camera([0, 0, -10]);
  // The center ray misses this narrow post, but it covers the left rear wheel.
  const post = box([0.73, 0, -5], [0.17, 1.7, 0.2]);
  const visibility = new CameraVisibility([post]);
  visibility.update(view, new THREE.Group(), 1 / 60);
  assert.equal(post.visible, false);
});

test("single-sided backfaces and a camera embedded in a thick wall cannot block the view", () => {
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
  wall.position.set(0, 1, -5);
  const embeddedWall = box([0, 3, -10], [8, 4, 2]);
  const visibility = new CameraVisibility([wall, embeddedWall]);
  visibility.update(camera(), new THREE.Group(), 1 / 60);
  assert.equal(wall.visible, false);
  assert.equal(embeddedWall.visible, false);
});

test("roof geometry is cut away from an overhead view of an inverted airborne car", () => {
  const car = new THREE.Group();
  car.position.set(0, 2, 0);
  car.rotation.set(0.8, 0.7, Math.PI);
  const roof = box([0, 4, 0], [9, 0.3, 12]);
  const visibility = new CameraVisibility([roof]);
  visibility.update(camera([2, 9, -6], [0, 2, 0]), car, 1 / 60);
  assert.equal(roof.visible, false);
});

test("moving shelves and props update their bounds and restore only after a clear interval", () => {
  const prop = box([0, 1.5, -5], [1, 2, 1]);
  const visibility = new CameraVisibility([prop]);
  const view = camera();
  const car = new THREE.Group();
  visibility.update(view, car, 1 / 60);
  assert.equal(prop.visible, false);
  prop.position.x = 9;
  visibility.update(view, car, 0.1);
  assert.equal(prop.visible, false, "briefly clear frames must not flicker the prop");
  prop.position.x = 0;
  visibility.update(view, car, 1 / 60);
  prop.position.x = 9;
  visibility.update(view, car, 0.1);
  visibility.update(view, car, 0.1);
  assert.equal(prop.visible, false, "a renewed obstruction resets the clear interval");
  visibility.update(view, car, 0.1);
  assert.equal(prop.visible, true);
});

test("reset and disposal restore cutaways without exposing objects that were already hidden", () => {
  const wall = box([0, 1, -5], [8, 3, 1]);
  const secret = box([0, 1, -5]);
  secret.visible = false;
  const visibility = new CameraVisibility([wall, secret]);
  visibility.update(camera(), new THREE.Group(), 1 / 60);
  visibility.reset();
  assert.equal(wall.visible, true);
  assert.equal(secret.visible, false);
  assert.equal(visibility.hiddenCount, 0);
  visibility.update(camera(), new THREE.Group(), 1 / 60);
  visibility.dispose();
  assert.equal(wall.visible, true);
  assert.equal(secret.visible, false);
  assert.equal(visibility.entries.length, 0);
});

test("cutaway follows camera view offsets and portrait framing without changing the camera transform", () => {
  const view = camera([8, 4, -5]);
  view.aspect = 390 / 844;
  view.setViewOffset(390, 844, 0, 100, 390, 844);
  view.updateProjectionMatrix();
  const wall = box([4, 2, -2.5], [0.3, 6, 8]);
  const visibility = new CameraVisibility([wall]);
  const position = view.position.clone();
  const rotation = view.quaternion.clone();
  visibility.update(view, new THREE.Group(), 1 / 60);
  assert.equal(wall.visible, false);
  assert.ok(view.position.equals(position));
  assert.ok(view.quaternion.equals(rotation));
});
