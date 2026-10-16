// Uses the AudioContext clock, which freezes while the game is paused.
export class VoiceScheduler {
  constructor({ gap = 1.8 } = {}) {
    this.gap = gap;
    this.generation = 0;
    this.sequence = 0;
    this.reset();
  }

  reset() {
    this.generation++;
    this.pending = [];
    this.active = null;
    this.cooldowns = new Map();
    this.nextAt = -Infinity;
  }

  clearPending(matches = () => true) {
    this.pending = this.pending.filter((event) => !matches(event));
  }

  request(
    id,
    now,
    {
      priority = 10,
      cooldown = 15,
      key = id,
      delay = 0,
      ttl = 4,
      interrupt = false,
    } = {},
  ) {
    if (now < (this.cooldowns.get(key) ?? -Infinity)) return false;
    if (
      this.pending.some((event) => event.key === key) ||
      this.active?.key === key
    )
      return false;
    this.cooldowns.set(key, now + cooldown);
    // An imminent fall replaces queued observations about the earlier climb.
    if (interrupt)
      this.pending = this.pending.filter((event) => event.priority >= priority);
    this.pending.push({
      id,
      key,
      priority,
      interrupt,
      at: now + delay,
      expires: now + delay + ttl,
      generation: this.generation,
      token: ++this.sequence,
    });
    // A collision pileup must never turn into a backlog of spoken jokes.
    this.pending.sort((a, b) => b.priority - a.priority || a.at - b.at);
    this.pending.length = Math.min(this.pending.length, 3);
    return true;
  }

  take(now, available = () => true) {
    this.pending = this.pending.filter((event) => event.expires > now);
    if (this.active) return null;
    const index = this.pending.findIndex(
      (event) =>
        event.at <= now &&
        (now >= this.nextAt || event.interrupt) &&
        available(event.id),
    );
    if (index < 0) return null;
    this.active = this.pending.splice(index, 1)[0];
    return this.active;
  }

  interruption(now, available = () => true) {
    if (!this.active) return null;
    const urgent = this.pending.find(
      (event) =>
        event.interrupt &&
        event.at <= now &&
        event.expires > now &&
        event.priority > this.active.priority &&
        available(event.id),
    );
    return urgent ? this.active.token : null;
  }

  complete(token, now) {
    if (this.active?.token !== token) return;
    this.active = null;
    this.nextAt = now + this.gap;
  }
}

// Qualifying flight needs both sustained airtime and height: suspension hops
// and curb bumps should not produce a terrified pilot on every frame.
export class RunAudioEvents {
  constructor() {
    this.reset();
  }

  reset() {
    this.said = new Set();
  }

  accept(event) {
    this.said.add(event.tag);
  }

  observe(state) {
    const altitude = state.altitude || 0;
    const air = !state.grounded && (state.airtime || 0) > 0.7 && altitude > 3;
    const spin = Math.hypot(
      state.angularVelocity?.x || 0,
      state.angularVelocity?.y || 0,
      state.angularVelocity?.z || 0,
    );
    const descent = state.velocity?.y || 0;
    let event = null;
    if (
      !state.crashed &&
      air &&
      descent < -9 &&
      altitude > 5 &&
      !this.said.has("scream")
    ) {
      event = {
        id: "pilot-scream",
        key: "falling-panic",
        tag: "scream",
        priority: 90,
        interrupt: true,
        ttl: 1.5,
      };
    } else if (!state.crashed && air && spin > 2.8 && !this.said.has("flip")) {
      event = { id: "pilot-flip", key: "panic", tag: "flip", priority: 55 };
    } else if (
      !state.crashed &&
      air &&
      altitude > 9 &&
      !this.said.has("height")
    ) {
      event = { id: "pilot-oh-no", key: "panic", tag: "height", priority: 45 };
    } else if (
      !state.crashed &&
      air &&
      altitude <= 7 &&
      descent < -3 &&
      descent > -7 &&
      spin < 1.6 &&
      state.damage < 70 &&
      !this.said.has("landing")
    ) {
      event = {
        id: "pilot-landing",
        key: "controlled-descent",
        tag: "landing",
        priority: 50,
        interrupt: true,
        ttl: 1.2,
      };
    }
    return event;
  }
}
