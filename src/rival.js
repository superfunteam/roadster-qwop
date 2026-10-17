import { createPorsche } from "./porsche.js";
import { WreckEffects } from "./wreck.js";

/** Visuals follow the opponent's physical body; neither racing nor crashes
 * move a mesh independently of its collider. */
export class RivalPresentation {
  constructor(scene, physics, { onExplosion } = {}) {
    this.rival = physics.rival;
    this.car = createPorsche();
    scene.add(this.car.group);
    this.pendingImpacts = [];
    this.onExplosion = onExplosion;
    const rival = this.rival;
    this.wreck = new WreckEffects(scene, {
      world: physics.world,
      propMaterial: physics.propMaterial,
      body: rival.body,
      get time() { return physics.time; },
    }, this.car);
    this.wreck.group.name = "Porsche / debris and combustion";
    this.update(0);
  }

  impact(event) { this.pendingImpacts.push(event); }

  update(dt) {
    let state = this.rival.state;
    this.car.group.position.copy(state.position);
    this.car.group.quaternion.copy(state.quaternion);
    const speed = state.signedSpeed ?? state.speed;
    this.car.update(dt, { speed, steer: (state.steer || 0) * (0.5 / (1 + Math.abs(speed) / 28)) });
    this.car.wheels.forEach((wheel, i) => {
      if (state.suspension) wheel.position.y = state.suspension[i];
    });
    this.car.setDamage(state.damage);
    this.car.group.updateMatrixWorld(true);
    for (const impact of this.pendingImpacts) {
      this.car.applyImpact(impact);
      this.wreck.onImpact(impact);
    }
    this.pendingImpacts.length = 0;
    if (state.crashed && !this.wreck.exploded) {
      // Detach panels before the physical blast, so they receive its impulse.
      this.wreck.explode(state);
      this.rival.explode();
      state = this.rival.state;
      this.onExplosion?.(state);
    }
    this.rival.setMissingWheels(this.car.wheels.map((wheel) => !wheel.visible));
    this.wreck.update(dt, state);
  }

  reset() {
    this.pendingImpacts.length = 0;
    this.wreck.clear();
    this.car.setDamage(0);
    this.update(0);
  }

  dispose() {
    this.pendingImpacts.length = 0;
    this.wreck.dispose();
    this.car.dispose();
  }
}
