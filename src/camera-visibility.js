import * as THREE from "three";

// The camera keeps its smooth chase motion. Architecture makes a local cutaway
// wherever it would cover the car, including when the camera is inside a wall.
// No transparent materials, extra render passes, or physics changes are needed.
export class CameraVisibility {
  constructor(objects = [], { restoreDelay = 0.22, margin = 0.045 } = {}) {
    this.restoreDelay = restoreDelay;
    this.margin = margin;
    this.entries = objects.filter((object) => object.isMesh).map((object) => {
      object.geometry.computeBoundingBox();
      return {
        object,
        localBounds: object.geometry.boundingBox.clone(),
        worldBounds: new THREE.Box3(),
        visible: object.visible,
        hidden: false,
        clearTime: 0,
      };
    });
    this.frustum = new THREE.Frustum();
    this.crop = new THREE.Matrix4();
    this.projection = new THREE.Matrix4();
    this.point = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.cameraPosition = new THREE.Vector3();
    this.targetBounds = new THREE.Box3(
      new THREE.Vector3(-1.2, -0.8, -2.5),
      new THREE.Vector3(1.2, 0.85, 2.5),
    );
    this.corners = [];
    for (const x of [this.targetBounds.min.x, this.targetBounds.max.x])
      for (const y of [this.targetBounds.min.y, this.targetBounds.max.y])
        for (const z of [this.targetBounds.min.z, this.targetBounds.max.z])
          this.corners.push(new THREE.Vector3(x, y, z));
    this.active = false;
  }

  update(camera, target, dt = 0) {
    if (!target || !this.entries.length) return;
    camera.updateWorldMatrix(true, false);
    target.updateWorldMatrix(true, false);
    camera.getWorldPosition(this.cameraPosition);
    camera.getWorldDirection(this.forward);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let farDepth = camera.near;
    let behindNear = false;
    // Protect the whole car silhouette, not just one ray to its center. Local
    // corners follow every roll and flip without querying hundreds of car meshes.
    for (const corner of this.corners) {
      this.point.copy(corner).applyMatrix4(target.matrixWorld);
      const depth = this.forward.dot(this.point) - this.forward.dot(this.cameraPosition);
      farDepth = Math.max(farDepth, depth + 0.2);
      if (depth <= camera.near) behindNear = true;
      this.point.project(camera);
      minX = Math.min(minX, this.point.x);
      maxX = Math.max(maxX, this.point.x);
      minY = Math.min(minY, this.point.y);
      maxY = Math.max(maxY, this.point.y);
    }
    // A close camera can briefly cross the car during a reset or violent tumble.
    // Its whole view is protected until the normal chase distance is restored.
    if (behindNear) {
      minX = minY = -1;
      maxX = maxY = 1;
    }
    minX -= this.margin;
    maxX += this.margin;
    minY -= this.margin;
    maxY += this.margin;
    const sx = 2 / (maxX - minX), sy = 2 / (maxY - minY);
    this.crop.set(
      sx, 0, 0, -(maxX + minX) * sx / 2,
      0, sy, 0, -(maxY + minY) * sy / 2,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
    this.projection.copy(this.crop).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    // Replace the distant camera plane with the car's farthest surface. Scenery
    // behind the vehicle remains visible; bounding-volume checks also see walls
    // from their backfaces and catch the camera embedded inside thick geometry.
    this.frustum.planes[4].normal.copy(this.forward).negate();
    this.frustum.planes[4].constant = farDepth + this.forward.dot(this.cameraPosition);
    this.active = true;
    const delta = Math.max(0, Math.min(dt, 0.1));
    for (const entry of this.entries) {
      if (!entry.visible) continue;
      entry.object.updateWorldMatrix(true, false);
      entry.worldBounds.copy(entry.localBounds).applyMatrix4(entry.object.matrixWorld);
      const blocked = this.frustum.intersectsBox(entry.worldBounds);
      if (blocked) {
        entry.object.visible = false;
        entry.hidden = true;
        entry.clearTime = 0;
      } else if (entry.hidden) {
        entry.clearTime += delta;
        if (entry.clearTime >= this.restoreDelay) {
          entry.object.visible = entry.visible;
          entry.hidden = false;
          entry.clearTime = 0;
        }
      }
    }
  }

  get hiddenCount() {
    return this.entries.reduce((count, entry) => count + Number(entry.hidden), 0);
  }

  reset() {
    for (const entry of this.entries) {
      if (entry.hidden) entry.object.visible = entry.visible;
      entry.hidden = false;
      entry.clearTime = 0;
    }
    this.active = false;
  }

  dispose() {
    this.reset();
    this.entries.length = 0;
  }
}
