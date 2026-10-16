import * as CANNON from "cannon-es";

// Metres, seconds, kilograms. +Z is the nose of the car; +Y is up.
export const PHYSICS = Object.freeze({
  mass: 1540,
  fixedStep: 1 / 120,
  wheelRadius: 0.36,
  jetForce: 9000,
  rearForce: 25000,
  pitchInertiaScale: 3.5,
  angularDrag: 2500,
  suspensionDamping: 10000,
  maxSuspensionForce: 55000,
  recoveryDelay: 4,
  recoveryNotice: 2.5,
  rampRadius: 12,
  rampStart: 42,
});

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const UP = new CANNON.Vec3(0, 1, 0);
const FORWARD = new CANNON.Vec3(0, 0, 1);
const ZERO = new CANNON.Vec3();
const WHEELS = [
  new CANNON.Vec3(-0.94, 0, 1.43),
  new CANNON.Vec3(0.94, 0, 1.43),
  new CANNON.Vec3(-0.94, 0, -1.43),
  new CANNON.Vec3(0.94, 0, -1.43),
];
const JETS = [
  new CANNON.Vec3(-0.88, -0.19, 1.5),
  new CANNON.Vec3(0.88, -0.19, 1.5),
  new CANNON.Vec3(-0.88, -0.19, -1.5),
  new CANNON.Vec3(0.88, -0.19, -1.5),
];
const KEYS = ["q", "w", "o", "p"];

/** Four independent cold-gas jets on an ordinary, very heavy rigid body. */
export class PhysicsGame {
  constructor({ onImpact } = {}) {
    this.onImpact = onImpact;
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.solver.iterations = 16;
    this.world.solver.tolerance = 0.001;
    this.world.allowSleep = true;
    this.world.defaultContactMaterial.friction = 0.42;
    this.world.defaultContactMaterial.restitution = 0.08;
    this.world.defaultContactMaterial.contactEquationStiffness = 1e8;
    this.world.defaultContactMaterial.contactEquationRelaxation = 4;
    this.roadMaterial = new CANNON.Material("concrete");
    this.carMaterial = new CANNON.Material("carbon-aluminium");
    this.propMaterial = new CANNON.Material("garage-clutter");
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.carMaterial, this.roadMaterial, {
        friction: 0.36,
        restitution: 0.12,
        contactEquationStiffness: 1e8,
      }),
    );
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.carMaterial, this.propMaterial, {
        friction: 0.32,
        restitution: 0.2,
      }),
    );
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.propMaterial, this.roadMaterial, {
        friction: 0.56,
        restitution: 0.07,
      }),
    );

    this.body = new CANNON.Body({
      mass: PHYSICS.mass,
      material: this.carMaterial,
      linearDamping: 0.012,
      angularDamping: 0.065,
      allowSleep: false,
      collisionFilterGroup: 2,
    });
    // The low battery pack dominates the inertia; the cabin catches roof landings.
    this.body.addShape(
      new CANNON.Box(new CANNON.Vec3(0.97, 0.2, 2.23)),
      new CANNON.Vec3(0, -0.04, 0),
    );
    this.body.addShape(
      new CANNON.Box(new CANNON.Vec3(0.75, 0.28, 0.91)),
      new CANNON.Vec3(0, 0.34, -0.25),
    );
    // Give the long chassis time to rise before its tail swings into the road.
    // Booster forces and collision impulses share this game-tuned inertia.
    this.body.inertia.x *= PHYSICS.pitchInertiaScale;
    this.body.invInertia.x = 1 / this.body.inertia.x;
    this.body.updateInertiaWorld(true);
    this.world.addBody(this.body);
    this.body.addEventListener("collide", (event) => this._collision(event));
    this.props = [];
    this.levelBodies = [];
    this.boosterLevels = [0, 0, 0, 0];
    this.suspension = [-0.35, -0.35, -0.35, -0.35];
    this.wheelContacts = [false, false, false, false];
    this.missingWheels = [false, false, false, false];
    this._rayResults = WHEELS.map(() => new CANNON.RaycastResult());
    this._impactTimes = new Map();
    this._debrisContactTimes = new WeakMap();
    this._up = new CANNON.Vec3();
    this._forward = new CANNON.Vec3();
    this._mount = new CANNON.Vec3();
    this._end = new CANNON.Vec3();
    this._offset = new CANNON.Vec3();
    this._force = new CANNON.Vec3();
    this._velocity = new CANNON.Vec3();
    this._tireForward = new CANNON.Vec3();
    this._tireRight = new CANNON.Vec3();
    this._normal = new CANNON.Vec3();
    this._localForce = new CANNON.Vec3();
    this._contactLocal = new CANNON.Vec3();
    this.setLevel("garage");
  }

  setLevel(id) {
    if (!["garage", "drag", "ramp"].includes(id))
      throw new Error(`Unknown driving level: ${id}`);
    for (const body of this.levelBodies) this.world.removeBody(body);
    this.levelBodies = [];
    this.props = [];
    this.level = id;
    const ground = new CANNON.Body({
      mass: 0,
      material: this.roadMaterial,
      collisionFilterGroup: 1,
    });
    ground.addShape(new CANNON.Plane());
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(ground);
    this.levelBodies.push(ground);
    this.reset();
  }

  /** Environment colliders. Rotation is XYZ Euler radians; size is full extent. */
  addBox({
    position = [0, 0, 0],
    size = [1, 1, 1],
    mass = 0,
    rotation = [0, 0, 0],
    ...metadata
  }) {
    const body = new CANNON.Body({
      mass,
      material: mass > 0 ? this.propMaterial : this.roadMaterial,
      position: new CANNON.Vec3(...position),
      shape: new CANNON.Box(
        new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2),
      ),
      linearDamping: 0.07,
      angularDamping: 0.16,
      sleepSpeedLimit: 0.14,
      sleepTimeLimit: 1.8,
      collisionFilterGroup: 1,
    });
    body.quaternion.setFromEuler(...rotation, "XYZ");
    body.userData = {
      ...metadata,
      initialPosition: body.position.clone(),
      initialQuaternion: body.quaternion.clone(),
    };
    this.world.addBody(body);
    this.levelBodies.push(body);
    if (mass > 0) this.props.push(body);
    return body;
  }

  reset() {
    this.body.position.set(0, 0.74, 0);
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
    for (const prop of this.props) {
      prop.position.copy(prop.userData.initialPosition);
      prop.quaternion.copy(prop.userData.initialQuaternion);
      prop.previousPosition.copy(prop.position);
      prop.interpolatedPosition.copy(prop.position);
      prop.previousQuaternion.copy(prop.quaternion);
      prop.interpolatedQuaternion.copy(prop.quaternion);
      prop.velocity.setZero();
      prop.angularVelocity.setZero();
      prop.force.setZero();
      prop.torque.setZero();
      prop.aabbNeedsUpdate = true;
      prop.wakeUp();
    }
    this.world.broadphase.dirty = true;
    this.boosterLevels.fill(0);
    this.suspension.fill(-0.35);
    this.wheelContacts.fill(false);
    this.missingWheels.fill(false);
    this.rearBoost = 0;
    this.pressure = 1;
    this.damage = 0;
    this.time = 0;
    this.distance = 0;
    this.maxAltitude = 0;
    this.airtime = 0;
    this.totalAirtime = 0;
    this.contactCount = 0;
    this._accumulator = 0;
    this._steering = 0;
    this._impactTimes.clear();
    this._debrisContactTimes = new WeakMap();
    this._hasClimbed = false;
    this._rampLaunched = false;
    this._landingTime = 0;
    this.rampStage = "approach";
    this.outcome = null;
    this.crashed = false;
    this.exploded = false;
    this.lastBlastTime = null;
    this.lastImpact = 0;
    this.maxSpeed = 0;
    this.flipAngle = 0;
    this._strandedTime = 0;
  }

  step(dt, input = {}) {
    if (!Number.isFinite(dt) || dt <= 0) return this.state;
    const previousOutcome = this.outcome;
    this._accumulator += Math.min(dt, 0.1);
    while (this._accumulator + 1e-10 >= PHYSICS.fixedStep) {
      this._integrate(PHYSICS.fixedStep, input);
      this.world.step(PHYSICS.fixedStep);
      this._afterStep(PHYSICS.fixedStep);
      this._accumulator -= PHYSICS.fixedStep;
    }
    // A rendered frame can contain several fixed ticks. A fatal collision later
    // in this same frame takes precedence over crossing the line a tick earlier.
    // A result already delivered by a previous frame remains an achieved result.
    if (!previousOutcome && this.crashed && this.outcome === "success") {
      this.outcome = "wrecked";
    }
    return this.state;
  }

  /** Detached wheels lose their suspension and tire forces; other wheels stay physical. */
  setMissingWheels(mask = []) {
    this.contactCount = 0;
    for (let i = 0; i < 4; i++) {
      this.missingWheels[i] = Boolean(mask?.[i]);
      if (this.missingWheels[i]) {
        this.wheelContacts[i] = false;
        this.suspension[i] = -0.18;
      }
      if (this.wheelContacts[i]) this.contactCount++;
    }
  }

  _integrate(dt, input) {
    this.time += dt;
    this.body.quaternion.vmult(UP, this._up);
    this.body.quaternion.vmult(FORWARD, this._forward);
    if (this.crashed || this.damage >= 100 || this.exploded) {
      this.crashed = true;
      this.outcome ||= "wrecked";
      // Severed lines vent briefly for the visual effects, but supply no force.
      const valveDecay = Math.exp(-dt / 0.055);
      for (let i = 0; i < 4; i++) {
        this.boosterLevels[i] *= valveDecay;
        if (this.boosterLevels[i] < 0.0003) this.boosterLevels[i] = 0;
      }
      this.rearBoost *= valveDecay;
      if (this.rearBoost < 0.0003) this.rearBoost = 0;
      this.pressure = Math.max(0, this.pressure - dt * 1.4);
      this.contactCount = 0;
      this.wheelContacts.fill(false);
      this.suspension.fill(-0.18);
      this._applyAirResistance();
      return;
    }
    const signedSpeed = this.body.velocity.dot(this._forward);
    let throttle = clamp(Number(input.throttle) || 0, -1, 1);
    const brake = clamp(Number(input.brake) || 0, 0, 1);
    const steer = clamp(Number(input.steer) || 0, -1, 1);
    // The demonstration's ramp approach is automatic, but launch and landing are physics.
    if (this.level === "ramp" && !this._rampLaunched && !this.crashed) {
      throttle = Math.max(throttle, clamp((28 - signedSpeed) * 0.34, 0, 1));
    }
    this._steering += (steer - this._steering) * (1 - Math.exp(-dt * 8));
    this._suspensionAndTires(dt, throttle, brake, signedSpeed);

    let requested = 0;
    for (let i = 0; i < 4; i++) {
      const target = clamp(Number(input[KEYS[i]]) || 0, 0, 1);
      const response = target > this.boosterLevels[i] ? 0.12 : 0.19;
      this.boosterLevels[i] +=
        (target - this.boosterLevels[i]) * (1 - Math.exp(-dt / response));
      if (this.boosterLevels[i] < 0.0003) this.boosterLevels[i] = 0;
      requested += this.boosterLevels[i];
    }
    const rearTarget = clamp(Number(input.boost) || 0, 0, 1);
    this.rearBoost +=
      (rearTarget - this.rearBoost) *
      (1 - Math.exp(-dt / (rearTarget ? 0.18 : 0.25)));
    if (this.rearBoost < 0.0003) this.rearBoost = 0;
    const consumption = requested * 0.016 + this.rearBoost * 0.024;
    const recharge = requested + this.rearBoost < 0.12 ? 0.12 : 0;
    this.pressure = clamp(this.pressure + (recharge - consumption) * dt, 0, 1);
    // At low pressure the compressor supplies a weak residual stream, never a hard cutoff.
    const availableThrust = 0.32 + 0.68 * Math.sqrt(this.pressure);
    for (let i = 0; i < 4; i++) {
      const level = this.boosterLevels[i];
      if (level < 0.0001) continue;
      const side = i % 2 === 0 ? -1 : 1;
      const end = i < 2 ? 1 : -1;
      const pulse = 1 + Math.sin(this.time * 24 + (i * Math.PI) / 2) * 0.017;
      const force = PHYSICS.jetForce * level * availableThrust * pulse;
      this._localForce.set(side * force * 0.014, force, end * force * 0.018);
      this.body.applyLocalForce(this._localForce, JETS[i]);
    }
    if (this.rearBoost > 0) {
      this._localForce.set(
        0,
        0,
        PHYSICS.rearForce * this.rearBoost * availableThrust,
      );
      // Just below the centre of mass: a small, physically caused nose-up moment.
      this.body.applyLocalForce(
        this._localForce,
        new CANNON.Vec3(0, -0.1, -2.18),
      );
    }
    this._applyAirResistance();
  }

  _applyAirResistance() {
    const airspeed = this.body.velocity.length();
    this.body.velocity.scale(-0.68 * airspeed, this._force);
    this.body.applyForce(this._force, ZERO);
    const angularSpeed = this.body.angularVelocity.length();
    this.body.angularVelocity.scale(-PHYSICS.angularDrag * angularSpeed, this._force);
    this.body.torque.vadd(this._force, this.body.torque);
  }

  _suspensionAndTires(dt, throttle, brake, signedSpeed) {
    this.contactCount = 0;
    const restLength = 0.455;
    const maxLength = 0.66;
    const steeringAngle =
      this._steering * (0.54 / (1 + Math.abs(signedSpeed) / 26));
    for (let i = 0; i < 4; i++) {
      if (this.missingWheels[i]) {
        this.wheelContacts[i] = false;
        this.suspension[i] = -0.18;
        continue;
      }
      this.body.pointToWorldFrame(WHEELS[i], this._mount);
      this._up.scale(-(maxLength + PHYSICS.wheelRadius), this._end);
      this._mount.vadd(this._end, this._end);
      const hit = this._rayResults[i];
      hit.reset();
      this.world.raycastClosest(
        this._mount,
        this._end,
        {
          collisionFilterMask: 1,
          collisionFilterGroup: 2,
          skipBackfaces: true,
        },
        hit,
      );
      this.wheelContacts[i] = false;
      this.suspension[i] = -0.45;
      if (!hit.hasHit) continue;
      const normalAlignment = hit.hitNormalWorld.dot(this._up);
      if (normalAlignment < 0.22) continue;
      const length = Math.max(0.07, hit.distance - PHYSICS.wheelRadius);
      if (length > maxLength) continue;
      this.suspension[i] = -length;
      this.wheelContacts[i] = true;
      this.contactCount++;
      this._normal.copy(hit.hitNormalWorld);
      hit.hitPointWorld.vsub(this.body.position, this._offset);
      this.body.getVelocityAtWorldPoint(hit.hitPointWorld, this._velocity);
      if (hit.body.mass > 0) {
        const groundVelocity = hit.body.getVelocityAtWorldPoint(
          hit.hitPointWorld,
          new CANNON.Vec3(),
        );
        this._velocity.vsub(groundVelocity, this._velocity);
      }
      const normalVelocity = this._velocity.dot(this._normal);
      const compression = restLength - length;
      const bumpStop = Math.max(0, 0.18 - length) * 100000;
      const normalForce = clamp(
        (compression * 44000 + bumpStop - normalVelocity * PHYSICS.suspensionDamping) /
          normalAlignment,
        0,
        PHYSICS.maxSuspensionForce,
      );
      this._normal.scale(normalForce, this._force);
      // The contact point produces the correct roll and pitch weight transfer.
      this.body.applyForce(this._force, this._offset);
      if (hit.body.mass > 0 && normalForce > 0) {
        this._force.negate(this._force);
        const relative = hit.hitPointWorld.vsub(hit.body.position);
        hit.body.applyForce(this._force, relative);
      }

      const angle = i < 2 ? steeringAngle : 0;
      this._localForce.set(Math.sin(angle), 0, Math.cos(angle));
      this.body.quaternion.vmult(this._localForce, this._tireForward);
      this._normal.scale(this._tireForward.dot(this._normal), this._force);
      this._tireForward.vsub(this._force, this._tireForward);
      this._tireForward.normalize();
      this._normal.cross(this._tireForward, this._tireRight);
      this._tireRight.normalize();
      const lateralSpeed = this._velocity.dot(this._tireRight);
      const rollingSpeed = this._velocity.dot(this._tireForward);
      const traction = normalForce * 1.45;
      let drive = (throttle * 4600) / (1 + Math.abs(rollingSpeed) / 65);
      if (brake > 0) {
        drive +=
          Math.abs(signedSpeed) > 1.2
            ? -Math.sign(rollingSpeed) *
              Math.min(7000, Math.abs(rollingSpeed) * 1900) *
              brake
            : -brake * 2400;
      }
      drive -= clamp(rollingSpeed * 130, -160, 160);
      drive = clamp(drive, -traction, traction);
      const gripBudget = Math.sqrt(
        Math.max(0, traction * traction - drive * drive * 0.6),
      );
      // Finite grip allows slides; there is no airborne steering correction.
      const lateral = clamp(-lateralSpeed * 3200, -gripBudget, gripBudget);
      this._tireForward.scale(drive, this._force);
      this._tireRight.scale(lateral, this._localForce);
      this._force.vadd(this._localForce, this._force);
      this.body.applyForce(this._force, this._offset);
    }
  }

  _collision(event) {
    const debris = event.body.userData;
    if (debris?.wreckDebris && (debris.sourceBodyId == null || debris.sourceBodyId === this.body.id)) {
      let detachedAt = debris.spawnedAt;
      if (!Number.isFinite(detachedAt)) {
        detachedAt = this._debrisContactTimes.get(event.body) ?? this.time;
        this._debrisContactTimes.set(event.body, detachedAt);
      }
      // A fresh panel originates inside the compound collision hull. Its initial
      // separation must not count as a new crash and recursively shed more parts.
      if (this.time - detachedAt < 0.45) return;
    }
    const contact = event.contact;
    // Cannon reports positive closing speed. Tangential scraping and separating
    // contacts must not be treated as head-on collisions at the car's full speed.
    const speed = Math.max(0, contact.getImpactVelocityAlongNormal());
    if (speed < 2.6) return;
    const previous = this._impactTimes.get(event.body.id) ?? -10;
    if (this.time - previous < 0.16) return;
    this._impactTimes.set(event.body.id, this.time);
    const carIsA = contact.bi === this.body;
    const relativePoint =
      carIsA ? contact.ri : contact.rj;
    const otherPoint = carIsA ? contact.rj : contact.ri;
    const position = this.body.position.vadd(relativePoint);
    // Outward from the car toward the obstacle; deformation goes along -normal.
    const normal = contact.ni.scale(carIsA ? 1 : -1);
    const localPoint = this.body.vectorToLocalFrame(relativePoint);
    const localNormal = this.body.vectorToLocalFrame(normal);
    const other = event.body;
    const otherInverseMass = other.type === CANNON.Body.DYNAMIC ? other.invMass : 0;
    const reducedMass = 1 / (this.body.invMass + otherInverseMass);
    const carLever = relativePoint.cross(normal);
    const otherLever = otherPoint.cross(normal);
    const rotationalInverseMass =
      carLever.dot(this.body.invInertiaWorld.vmult(carLever)) +
      (otherInverseMass > 0 ? otherLever.dot(other.invInertiaWorld.vmult(otherLever)) : 0);
    const effectiveMass = 1 / (this.body.invMass + otherInverseMass + rotationalInverseMass);
    const impulse = effectiveMass * speed * (1 + contact.restitution);
    const energy = 0.5 * reducedMass * speed * speed;
    // Reduced mass describes energy available across the contact manifold, while
    // point effective mass above accounts for rotation in the estimated impulse.
    // A light box can fly away with little crumpling; a fixed wall cannot.
    const crushSpeed = Math.max(0, speed - 2.8);
    const roofHit = localPoint.y > 0.15 && localNormal.y > 0.35;
    const structureFactor = roofHit ? 1.35 : Math.abs(localNormal.x) > 0.65 ? 1.12 : 1;
    const damageEnergy = 0.5 * reducedMass * crushSpeed * crushSpeed * structureFactor;
    const severity = clamp(damageEnergy / 190000, 0, 1);
    const beforeDamage = this.damage;
    this.damage = clamp(this.damage + damageEnergy / 1900, 0, 100);
    const addedDamage = this.damage - beforeDamage;
    this.lastImpact = speed;
    if (this.damage >= 100) {
      this.crashed = true;
      this.outcome ||= "wrecked";
    }
    if (this.onImpact)
      this.onImpact({
        intensity: clamp(Math.sqrt(energy / 220000) * 0.85, 0, 1),
        speed,
        position,
        normal: { x: normal.x, y: normal.y, z: normal.z },
        localPoint: { x: localPoint.x, y: localPoint.y, z: localPoint.z },
        localNormal: { x: localNormal.x, y: localNormal.y, z: localNormal.z },
        impulse,
        effectiveMass,
        reducedMass,
        energy,
        severity,
        addedDamage,
        body: other,
        damage: this.damage,
      });
  }

  /** One blast per run. Debris added directly to world participates automatically. */
  explode({ position = this.body.position, strength = 1, radius = 11 } = {}) {
    if (this.exploded) return false;
    this.exploded = true;
    this.lastBlastTime = this.time;
    this.damage = 100;
    this.crashed = true;
    this.outcome ||= "wrecked";
    const power = clamp(Number.isFinite(strength) ? strength : 1, 0, 3);
    const reach = clamp(Number.isFinite(radius) ? radius : 11, 2, 25);
    const origin = new CANNON.Vec3(
      position.x ?? position[0] ?? this.body.position.x,
      position.y ?? position[1] ?? this.body.position.y,
      position.z ?? position[2] ?? this.body.position.z,
    );
    const direction = new CANNON.Vec3();
    const impulse = new CANNON.Vec3();
    const offset = new CANNON.Vec3();
    for (const body of this.world.bodies) {
      if (body.mass <= 0 || body.type !== CANNON.Body.DYNAMIC) continue;
      body.position.vsub(origin, direction);
      const distance = direction.length();
      if (distance >= reach) continue;
      if (distance > 0.05) direction.scale(1 / distance, direction);
      else direction.set(Math.sin(body.id * 2.39996) * 0.2, 1, Math.cos(body.id * 2.39996) * 0.2);
      const falloff = Math.pow(1 - distance / reach, 2);
      if (body === this.body) {
        direction.x *= 0.35;
        direction.z *= 0.35;
        direction.y = Math.max(0.8, direction.y + 0.5);
        direction.normalize();
        direction.scale(body.mass * 2.9 * power * falloff, impulse);
        this.body.vectorToWorldFrame(new CANNON.Vec3(0.32, -0.12, -0.38), offset);
      } else {
        direction.y = Math.max(0.22, direction.y + 0.35);
        direction.normalize();
        const deltaSpeed = Math.min(32, 22 * Math.pow(10 / Math.max(body.mass, 1), 0.18) * falloff * power);
        direction.scale(body.mass * deltaSpeed, impulse);
        const lever = Math.min(body.boundingRadius || 0.5, 1.2) * 0.12;
        offset.set(Math.sin(body.id * 1.71) * lever, lever * 0.25, Math.cos(body.id * 1.71) * lever);
      }
      body.wakeUp();
      body.applyImpulse(impulse, offset);
    }
    return true;
  }

  _afterStep(dt) {
    const position = this.body.position;
    this.body.quaternion.vmult(UP, this._up);
    this.distance = Math.max(this.distance, position.z);
    this.maxSpeed = Math.max(this.maxSpeed, this.body.velocity.length());
    this.maxAltitude = Math.max(this.maxAltitude, position.y - 0.73);
    if (!this.contactCount) {
      this.airtime += dt;
      this.totalAirtime += dt;
    } else {
      this.airtime = 0;
    }
    this.flipAngle += this.body.angularVelocity.x * dt;
    if (this.level === "ramp") {
      if (position.y > 3 && position.z > 39) this.rampStage = "climb";
      // Count the stunt only after the wheels genuinely rode the upper, inverted
      // part of the ramp. A vertical launch elsewhere cannot skip the approach.
      if (
        this.contactCount >= 2 &&
        this._up.y < -0.3 &&
        position.y > 18 &&
        position.y < 25.5 &&
        position.z > 40 &&
        position.z < 55 &&
        Math.abs(position.x) < 5.4
      ) {
        this._hasClimbed = true;
      }
      if (
        this._hasClimbed &&
        this.contactCount === 0 &&
        position.y > 17 &&
        this.airtime > 0.14
      ) {
        this._rampLaunched = true;
        this.rampStage = "airborne";
      }
      // Raycasts see the floor before a high-speed chassis impact. Require the
      // suspension to catch and hold a survivable landing before awarding it.
      const settledLanding =
        this._rampLaunched &&
        position.y < 1.25 &&
        this.contactCount >= 2 &&
        this._up.y > 0.75 &&
        Math.abs(this.body.velocity.y) < 4.5 &&
        this.body.angularVelocity.length() < 2.5 &&
        this.damage < 90 &&
        position.z < 40 &&
        position.z > -25 &&
        Math.abs(position.x) < 14;
      this._landingTime = settledLanding ? this._landingTime + dt : 0;
      if (this._landingTime >= 0.18 && !this.outcome) {
        this.outcome = "success";
        this.rampStage = "landed";
      }
    } else if (
      this.level === "garage" &&
      position.z > 24 &&
      Math.abs(position.x) < 12 &&
      this._up.y > 0.3
    ) {
      this.outcome ||= "success";
    } else if (
      this.level === "drag" &&
      position.z >= 402 &&
      Math.abs(position.x) < 22
    ) {
      this.outcome ||= "success";
    }
    if (this.damage >= 100) {
      this.crashed = true;
      this.outcome ||= "wrecked";
    }
    if (
      position.y > 110 ||
      Math.abs(position.x) > 180 ||
      position.y < -12 ||
      position.z < -160
    ) {
      this.outcome ||= "flyaway";
    }
    this._updateRecovery(dt);
  }

  _updateRecovery(dt) {
    // Suspension rays point away from the floor when the car is on its roof.
    // Use actual supporting chassis contacts, so midair inversions, wall
    // scrapes and the upside-down ramp are never mistaken for being stranded.
    let roofSupported = false;
    if (
      !this.outcome && !this.crashed && !this.exploded &&
      this._up.y < -0.55 && this.contactCount === 0 &&
      this.body.velocity.length() < 0.9 &&
      this.body.angularVelocity.length() < 0.55
    ) {
      for (const contact of this.world.contacts) {
        if (!contact.enabled) continue;
        const isFirst = contact.bi === this.body;
        if (!isFirst && contact.bj !== this.body) continue;
        const outwardY = isFirst ? contact.ni.y : -contact.ni.y;
        if (outwardY > -0.45) continue;
        this.body.vectorToLocalFrame(
          isFirst ? contact.ri : contact.rj,
          this._contactLocal,
        );
        if (this._contactLocal.y > 0.12) {
          roofSupported = true;
          break;
        }
      }
    }
    this._strandedTime = roofSupported ? this._strandedTime + dt : 0;
  }

  get state() {
    this.body.quaternion.vmult(FORWARD, this._forward);
    const speed = this.body.velocity.length();
    return {
      position: this.body.position,
      quaternion: this.body.quaternion,
      velocity: this.body.velocity,
      angularVelocity: this.body.angularVelocity,
      speed,
      speedKmh: speed * 3.6,
      signedSpeed: this.body.velocity.dot(this._forward),
      altitude: Math.max(0, this.body.position.y - 0.73),
      damage: this.damage,
      pressure: this.pressure,
      boosterLevels: this.boosterLevels,
      rearBoost: this.rearBoost,
      grounded: this.contactCount > 0,
      wheelContacts: this.wheelContacts,
      missingWheels: this.missingWheels,
      suspension: this.suspension,
      steer: this._steering,
      distance: this.distance,
      time: this.time,
      airtime: this.airtime,
      totalAirtime: this.totalAirtime,
      maxAltitude: this.maxAltitude,
      maxSpeed: this.maxSpeed,
      crashed: this.crashed,
      critical: this.damage >= 70 && this.damage < 100 && !this.crashed,
      exploded: this.exploded,
      outcome: this.outcome,
      rampStage: this.rampStage,
      flipAngle: this.flipAngle,
      recoveryRemaining:
        this._strandedTime >= PHYSICS.recoveryDelay - PHYSICS.recoveryNotice
          ? Math.max(0, PHYSICS.recoveryDelay - this._strandedTime)
          : null,
      recoveryReady: this._strandedTime >= PHYSICS.recoveryDelay,
    };
  }
}

export default PhysicsGame;
