import * as CANNON from "cannon-es";

export const RIVAL = Object.freeze({
  laneX: 6.4,
  mass: 1640,
  finishZ: 402,
  wheelRadius: 0.36,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const UP = new CANNON.Vec3(0, 1, 0);
const FORWARD = new CANNON.Vec3(0, 0, 1);
const ZERO = new CANNON.Vec3();
const WHEELS = [
  new CANNON.Vec3(-0.945, 0, 1.28),
  new CANNON.Vec3(0.945, 0, 1.28),
  new CANNON.Vec3(-0.971, 0, -1.37),
  new CANNON.Vec3(0.971, 0, -1.37),
];

/** A second dynamic car: its driver can steer the tires, never the chassis pose. */
export class RivalPhysics {
  constructor({ world, material, playerBody, onImpact }) {
    this.world = world;
    this.playerBody = playerBody;
    this.onImpact = onImpact;
    this.body = new CANNON.Body({
      mass: RIVAL.mass,
      material,
      linearDamping: 0.012,
      angularDamping: 0.08,
      allowSleep: false,
      collisionFilterGroup: 2,
    });
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(0.95, 0.21, 2.26)), new CANNON.Vec3(0, -0.04, 0));
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(0.73, 0.25, 0.95)), new CANNON.Vec3(0, 0.35, -0.15));
    this.body.userData = { rivalCar: true, name: "Porsche" };
    this.body.inertia.x *= 2.2;
    this.body.invInertia.x = 1 / this.body.inertia.x;
    this.body.updateInertiaWorld(true);
    this._collisionListener = (event) => this._collision(event);
    this.body.addEventListener("collide", this._collisionListener);
    this.world.addBody(this.body);
    this._up = new CANNON.Vec3();
    this._forward = new CANNON.Vec3();
    this._mount = new CANNON.Vec3();
    this._end = new CANNON.Vec3();
    this._offset = new CANNON.Vec3();
    this._force = new CANNON.Vec3();
    this._velocity = new CANNON.Vec3();
    this._tireForward = new CANNON.Vec3();
    this._tireRight = new CANNON.Vec3();
    this._localForce = new CANNON.Vec3();
    this._rayResults = WHEELS.map(() => new CANNON.RaycastResult());
    this.suspension = WHEELS.map(() => -0.35);
    this.wheelContacts = WHEELS.map(() => false);
    this.missingWheels = WHEELS.map(() => false);
    this._impactTimes = new Map();
    this.reset();
  }

  reset() {
    this.body.position.set(RIVAL.laneX, 0.74, 0);
    this.body.quaternion.set(0, 0, 0, 1);
    this.body.updateInertiaWorld(true);
    this.body.velocity.setZero();
    this.body.angularVelocity.setZero();
    this.body.force.setZero();
    this.body.torque.setZero();
    this.body.previousPosition.copy(this.body.position);
    this.body.interpolatedPosition.copy(this.body.position);
    this.body.previousQuaternion.copy(this.body.quaternion);
    this.body.interpolatedQuaternion.copy(this.body.quaternion);
    this.body.aabbNeedsUpdate = true;
    this.body.wakeUp();
    this.world.broadphase.dirty = true;
    this.suspension.fill(-0.35);
    this.wheelContacts.fill(false);
    this.missingWheels.fill(false);
    this.contactCount = 0;
    this.damage = 0;
    this.crashed = false;
    this.exploded = false;
    this.lastBlastTime = null;
    this.time = 0;
    this.finishTime = null;
    this.steer = 0;
    this.throttle = 0;
    this._previousZ = this.body.position.z;
    this._impactTimes.clear();
  }

  setMissingWheels(missing) {
    for (let index = 0; index < 4; index++) this.missingWheels[index] = !!missing?.[index];
  }

  /** Called before the shared Cannon world advances one fixed tick. */
  step(dt, { raceFinished = false } = {}) {
    this.time += dt;
    this._previousZ = this.body.position.z;
    this.body.quaternion.vmult(UP, this._up);
    this.body.quaternion.vmult(FORWARD, this._forward);
    const speed = this.body.velocity.dot(this._forward);
    this.contactCount = 0;
    if (this.crashed || this.exploded) {
      this.throttle = 0;
      this.wheelContacts.fill(false);
      this.suspension.fill(-0.18);
    } else {
      // The launch is simultaneous with the player's first physics tick. Lane
      // keeping uses tire grip only, so a side impact can still spin or roll it.
      const heading = Math.atan2(this._forward.x, this._forward.z);
      const targetHeading = clamp((RIVAL.laneX - this.body.position.x) * 0.075, -0.3, 0.3);
      let headingError = targetHeading - heading;
      headingError = Math.atan2(Math.sin(headingError), Math.cos(headingError));
      const steerTarget = raceFinished ? 0 : clamp(headingError * 2.8 - this.body.angularVelocity.y * 0.32, -1, 1);
      this.steer += (steerTarget - this.steer) * (1 - Math.exp(-dt * 5));
      const braking = raceFinished || (this.finishTime !== null && this.body.position.z > 430);
      this.throttle = braking || this._up.y < 0.35 ? 0 : 1;
      this._suspensionAndTires(speed, braking);
    }
    const airspeed = this.body.velocity.length();
    this.body.velocity.scale(-0.66 * airspeed, this._force);
    this.body.applyForce(this._force, ZERO);
    this.body.angularVelocity.scale(-900 * this.body.angularVelocity.length(), this._force);
    this.body.torque.vadd(this._force, this.body.torque);
  }

  afterStep(dt) {
    if (this.finishTime !== null || this.crashed) return;
    if (this.body.position.z >= RIVAL.finishZ && Math.abs(this.body.position.x) < 22) {
      const dz = this.body.position.z - this._previousZ;
      const fraction = dz > 0 ? clamp((RIVAL.finishZ - this._previousZ) / dz, 0, 1) : 1;
      this.finishTime = this.time - dt * (1 - fraction);
    }
  }

  _suspensionAndTires(speed, braking) {
    const steeringAngle = this.steer * (0.5 / (1 + Math.abs(speed) / 28));
    for (let index = 0; index < WHEELS.length; index++) {
      this.wheelContacts[index] = false;
      this.suspension[index] = -0.45;
      if (this.missingWheels[index]) continue;
      this.body.pointToWorldFrame(WHEELS[index], this._mount);
      this._up.scale(-0.99, this._end);
      this._mount.vadd(this._end, this._end);
      const hit = this._rayResults[index];
      hit.reset();
      this.world.raycastClosest(this._mount, this._end, {
        collisionFilterMask: 1,
        collisionFilterGroup: 2,
        skipBackfaces: true,
      }, hit);
      if (!hit.hasHit) continue;
      const alignment = hit.hitNormalWorld.dot(this._up);
      const length = Math.max(0.07, hit.distance - RIVAL.wheelRadius);
      if (alignment < 0.22 || length > 0.64) continue;
      this.suspension[index] = -length;
      this.wheelContacts[index] = true;
      this.contactCount++;
      hit.hitPointWorld.vsub(this.body.position, this._offset);
      this.body.getVelocityAtWorldPoint(hit.hitPointWorld, this._velocity);
      if (hit.body.mass > 0) {
        hit.body.getVelocityAtWorldPoint(hit.hitPointWorld, this._force);
        this._velocity.vsub(this._force, this._velocity);
      }
      const normalForce = clamp(((0.455 - length) * 50000 + Math.max(0, 0.18 - length) * 100000 -
        this._velocity.dot(hit.hitNormalWorld) * 10500) / alignment, 0, 55000);
      hit.hitNormalWorld.scale(normalForce, this._force);
      this.body.applyForce(this._force, this._offset);
      if (hit.body.mass > 0 && normalForce > 0) {
        this._force.negate(this._force);
        hit.hitPointWorld.vsub(hit.body.position, this._localForce);
        hit.body.applyForce(this._force, this._localForce);
      }
      const angle = index < 2 ? steeringAngle : 0;
      this._localForce.set(Math.sin(angle), 0, Math.cos(angle));
      this.body.quaternion.vmult(this._localForce, this._tireForward);
      hit.hitNormalWorld.scale(this._tireForward.dot(hit.hitNormalWorld), this._force);
      this._tireForward.vsub(this._force, this._tireForward);
      this._tireForward.normalize();
      hit.hitNormalWorld.cross(this._tireForward, this._tireRight);
      this._tireRight.normalize();
      const rollingSpeed = this._velocity.dot(this._tireForward);
      const lateralSpeed = this._velocity.dot(this._tireRight);
      const traction = normalForce * 1.7;
      let drive = this.throttle * 8000 / (1 + Math.abs(rollingSpeed) / 55);
      if (braking) drive -= Math.sign(rollingSpeed) * Math.min(7000, Math.abs(rollingSpeed) * 1900);
      drive -= clamp(rollingSpeed * 130, -160, 160);
      drive = clamp(drive, -traction, traction);
      const gripBudget = Math.sqrt(Math.max(0, traction * traction - drive * drive * 0.6));
      const lateral = clamp(-lateralSpeed * 3400, -gripBudget, gripBudget);
      this._tireForward.scale(drive, this._force);
      this._tireRight.scale(lateral, this._localForce);
      this._force.vadd(this._localForce, this._force);
      this.body.applyForce(this._force, this._offset);
    }
  }

  _collision(event) {
    if (this.exploded) return;
    const metadata = event.body.userData;
    if (metadata?.wreckDebris && metadata.sourceBodyId === this.body.id &&
      this.time - (metadata.spawnedAt ?? this.time) < 0.45) return;
    const contact = event.contact;
    const speed = Math.max(0, contact.getImpactVelocityAlongNormal());
    if (speed < 2.6 || this.time - (this._impactTimes.get(event.body.id) ?? -10) < 0.16) return;
    this._impactTimes.set(event.body.id, this.time);
    const rivalIsA = contact.bi === this.body;
    const point = rivalIsA ? contact.ri : contact.rj;
    const otherPoint = rivalIsA ? contact.rj : contact.ri;
    const normal = contact.ni.scale(rivalIsA ? 1 : -1);
    const localPoint = this.body.vectorToLocalFrame(point);
    const localNormal = this.body.vectorToLocalFrame(normal);
    const otherInverseMass = event.body.type === CANNON.Body.DYNAMIC ? event.body.invMass : 0;
    const reducedMass = 1 / (this.body.invMass + otherInverseMass);
    const lever = point.cross(normal);
    const otherLever = otherPoint.cross(normal);
    const inverseRotation = lever.dot(this.body.invInertiaWorld.vmult(lever)) +
      (otherInverseMass > 0 ? otherLever.dot(event.body.invInertiaWorld.vmult(otherLever)) : 0);
    const effectiveMass = 1 / (this.body.invMass + otherInverseMass + inverseRotation);
    const energy = 0.5 * reducedMass * speed * speed;
    const structure = localPoint.y > 0.15 && localNormal.y > 0.35 ? 1.35 : Math.abs(localNormal.x) > 0.65 ? 1.12 : 1;
    const crushEnergy = 0.5 * reducedMass * Math.max(0, speed - 2.8) ** 2 * structure;
    const before = this.damage;
    this.damage = clamp(this.damage + crushEnergy / 1500, 0, 100);
    this.crashed ||= this.damage >= 100;
    this.onImpact?.({
      intensity: clamp(Math.sqrt(energy / 220000) * 0.85, 0, 1),
      speed,
      position: this.body.position.vadd(point),
      normal: { x: normal.x, y: normal.y, z: normal.z },
      localPoint: { x: localPoint.x, y: localPoint.y, z: localPoint.z },
      localNormal: { x: localNormal.x, y: localNormal.y, z: localNormal.z },
      impulse: effectiveMass * speed * (1 + contact.restitution),
      effectiveMass,
      reducedMass,
      energy,
      severity: clamp(crushEnergy / 150000, 0, 1),
      addedDamage: this.damage - before,
      body: event.body,
      damage: this.damage,
    });
  }

  /** One blast per race, including physical force on nearby cars and debris. */
  explode({ strength = 1, radius = 9 } = {}) {
    if (this.exploded) return false;
    this.exploded = true;
    this.crashed = true;
    this.damage = 100;
    this.lastBlastTime = this.time;
    const power = clamp(Number.isFinite(strength) ? strength : 1, 0, 3);
    const reach = clamp(Number.isFinite(radius) ? radius : 9, 2, 25);
    const direction = new CANNON.Vec3();
    const impulse = new CANNON.Vec3();
    const offset = new CANNON.Vec3();
    for (const body of this.world.bodies) {
      if (body.mass <= 0 || body.type !== CANNON.Body.DYNAMIC) continue;
      body.position.vsub(this.body.position, direction);
      const distance = direction.length();
      if (distance >= reach) continue;
      if (body === this.body) direction.set(0.12, 1, -0.08);
      else {
        if (distance > 0.05) direction.scale(1 / distance, direction);
        direction.y = Math.max(0.25, direction.y + 0.35);
      }
      direction.normalize();
      const falloff = (1 - distance / reach) ** 2;
      const deltaSpeed = body === this.body ? 2.8 : Math.min(24, 17 * Math.pow(10 / Math.max(body.mass, 1), 0.18));
      direction.scale(body.mass * deltaSpeed * power * falloff, impulse);
      offset.set(body === this.body ? 0.23 : 0.04, -0.12, -0.28);
      body.wakeUp();
      body.applyImpulse(impulse, offset);
    }
    return true;
  }

  dispose() {
    this.body.removeEventListener("collide", this._collisionListener);
    this.world.removeBody(this.body);
    this._impactTimes.clear();
  }

  get state() {
    this.body.quaternion.vmult(FORWARD, this._forward);
    return {
      name: "Porsche",
      position: this.body.position,
      quaternion: this.body.quaternion,
      velocity: this.body.velocity,
      angularVelocity: this.body.angularVelocity,
      speed: this.body.velocity.length(),
      speedKmh: this.body.velocity.length() * 3.6,
      signedSpeed: this.body.velocity.dot(this._forward),
      grounded: this.contactCount > 0,
      suspension: this.suspension,
      wheelContacts: this.wheelContacts,
      missingWheels: this.missingWheels,
      steer: this.steer,
      throttle: this.throttle,
      damage: this.damage,
      crashed: this.crashed,
      exploded: this.exploded,
      time: this.time,
      finishTime: this.finishTime,
      progress: clamp(this.body.position.z / RIVAL.finishZ, 0, 1),
    };
  }
}
