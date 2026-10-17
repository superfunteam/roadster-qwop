import { AUDIO_FILES } from "./audio-manifest.js";
import { VoiceScheduler, RunAudioEvents } from "./audio-events.js";

export { AUDIO_FILES };

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
// Assets are normalized before shipping: voice -17 LUFS, SFX -19,
// loops -24, music -22. These gains put the un-ducked music near -29 LUFS,
// full booster near -26, and speech near -18 before bus compression.
const MIX = Object.freeze({
  master: 0.75,
  music: 0.6,
  sfx: 0.9,
  voice: 1.15,
  booster: 1.2,
});
const MUSIC = {
  menu: "music-menu",
  garage: "music-menu",
  drag: "music-drive",
  ramp: "music-ramp",
  result: "music-menu",
};

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.paused = false;
    this.preferences = { music: true, voices: true };
    this.scene = "menu";
    this.buffers = new Map();
    this.raw = new Map();
    this.failed = new Set();
    this.loading = new Set();
    this.decoding = new Set();
    this.transients = new Set();
    this.loops = new Map();
    this.musicSources = new Set();
    this.voices = new VoiceScheduler();
    this.runEvents = new RunAudioEvents();
    this.runGeneration = 0;
    this.runActive = false;
    this.lastImpact = -Infinity;
    this.lastExplosion = -Infinity;
    this.lastBoostEdge = -Infinity;
    this.lastMissionStart = -Infinity;
    this.lastThrust = 0;
    this.explosionDuckUntil = 0;
    this.musicId = null;
    this.musicNextAt = 0;
    this.lastVariant = new Map();
  }

  // Fetch before the first gesture; decoding and playback use the context
  // created by start(). A late fetch never queues an old game event.
  preload() {
    if (this.preloadPromise) return this.preloadPromise;
    const early = ["music-menu", "booster-loop", "mission-start", "explosion"];
    const files = [
      ...early
        .filter((id) => AUDIO_FILES[id])
        .map((id) => [id, AUDIO_FILES[id]]),
      ...Object.entries(AUDIO_FILES).filter(([id]) => !early.includes(id)),
    ];
    let cursor = 0;
    const worker = async () => {
      while (cursor < files.length) {
        const [id, url] = files[cursor++];
        this.loading.add(id);
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error("Audio unavailable");
          this.raw.set(id, await response.arrayBuffer());
          if (this.ctx) await this._decode(id);
        } catch {
          this.failed.add(id);
        } finally {
          this.loading.delete(id);
        }
      }
    };
    this.preloadPromise = Promise.all(Array.from({ length: 4 }, worker));
    return this.preloadPromise;
  }

  async _decode(id) {
    if (
      !this.ctx ||
      this.buffers.has(id) ||
      this.decoding.has(id) ||
      !this.raw.has(id)
    )
      return;
    this.decoding.add(id);
    try {
      const buffer = await this.ctx.decodeAudioData(this.raw.get(id).slice(0));
      this.buffers.set(id, buffer);
      this.raw.delete(id);
      this.failed.delete(id);
    } catch {
      this.failed.add(id);
      this.raw.delete(id);
    } finally {
      this.decoding.delete(id);
    }
  }

  start() {
    if (this.ctx) {
      if (!this.paused) this.ctx.resume().catch(() => {});
      this._tick();
      return;
    }
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) return;
    try {
      const c = (this.ctx = new Context());
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : MIX.master;
      this.sfxBus = c.createGain();
      this.musicBus = c.createGain();
      this.voiceBus = c.createGain();
      this.sfxBus.gain.value = MIX.sfx;
      this.musicBus.gain.value = this.preferences.music ? MIX.music : 0;
      this.voiceBus.gain.value = this.preferences.voices ? MIX.voice : 0;
      for (const bus of [this.sfxBus, this.musicBus, this.voiceBus])
        bus.connect(this.master);
      this.limiter = c.createDynamicsCompressor();
      this.limiter.threshold.value = -8;
      this.limiter.knee.value = 12;
      this.limiter.ratio.value = 6;
      this.limiter.attack.value = 0.002;
      this.limiter.release.value = 0.2;
      this.master.connect(this.limiter);
      this.limiter.connect(c.destination);
      this._createFallback();
      for (const id of this.raw.keys()) void this._decode(id);
      void this.preload();
      // Menus need music scheduling even when physics is not updating.
      this.timer = setInterval(() => this._tick(), 120);
      this.timer.unref?.();
      if (this.paused) c.suspend().catch(() => {});
      else c.resume().catch(() => {});
    } catch {
      // Browsers without Web Audio keep the game playable and silent.
      this.ctx = null;
    }
  }

  _createFallback() {
    const c = this.ctx;
    this.noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    let last = 0;
    const noise = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < noise.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      noise[i] = last * 3.5;
    }
    this.crackleBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const crackle = this.crackleBuffer.getChannelData(0);
    for (let i = 0; i < crackle.length; i++)
      crackle[i] = (Math.random() * 2 - 1) * (Math.random() > 0.997 ? 1 : 0.16);
    const makeNoise = (buffer, cutoff) => {
      const source = c.createBufferSource(),
        filter = c.createBiquadFilter(),
        gain = c.createGain();
      source.buffer = buffer;
      source.loop = true;
      filter.type = "lowpass";
      filter.frequency.value = cutoff;
      gain.gain.value = 0;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxBus);
      source.start();
      return { source, filter, gain };
    };
    this.rocket = makeNoise(this.noiseBuffer, 800);
    this.fire = makeNoise(this.crackleBuffer, 1700);
    const source = c.createOscillator(),
      filter = c.createBiquadFilter(),
      gain = c.createGain();
    source.type = "sawtooth";
    source.frequency.value = 40;
    filter.type = "lowpass";
    filter.frequency.value = 340;
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    source.start();
    this.motor = { source, filter, gain };
  }

  setMuted(value) {
    this.muted = Boolean(value);
    if (this.ctx)
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : MIX.master,
        this.ctx.currentTime,
        0.04,
      );
    if (this.muted) this._clearVoices();
  }

  setPreferences({
    music = this.preferences.music,
    voices = this.preferences.voices,
  } = {}) {
    this.preferences = { music: Boolean(music), voices: Boolean(voices) };
    if (!voices) this._clearVoices();
    if (!music) this._stopMusic();
    if (this.ctx) {
      this.voiceBus.gain.setTargetAtTime(
        voices ? MIX.voice : 0,
        this.ctx.currentTime,
        0.04,
      );
      this._tick();
    }
  }

  setPaused(value) {
    value = Boolean(value);
    if (value === this.paused) return;
    this.paused = value;
    if (this.ctx)
      (value ? this.ctx.suspend() : this.ctx.resume()).catch(() => {});
  }

  setScene(scene) {
    this.scene = Object.hasOwn(MUSIC, scene) ? scene : "menu";
    this._tick();
  }

  beginRun(level) {
    this.reset();
    this.runActive = true;
    const id = typeof level === "string" ? level : level?.id;
    this.setScene(id === "ramp" || id === "factory" ? "ramp" : id === "drag" ? "drag" : "garage");
    // Repeated retries should not repeat the same introduction every time.
    const now = this.ctx?.currentTime ?? 0;
    if (now - this.lastMissionStart > 20) {
      this.lastMissionStart = now;
      this._requestVoice("mission-start", {
        priority: 30,
        delay: 0.35,
        ttl: 3,
      });
    }
  }

  finish(outcome) {
    if (!this.runActive) return;
    this.runActive = false;
    this._clearVoices();
    const value = typeof outcome === "string" ? outcome : outcome?.outcome;
    const success =
      value === "success" ||
      value === "win" ||
      outcome?.success === true ||
      outcome?.won === true;
    this.setScene("result");
    this._requestVoice(success ? "mission-win" : "mission-fail", {
      priority: 100,
      delay: 0.55,
      ttl: 4,
    });
  }

  _requestVoice(id, options = {}) {
    if (!this.ctx || this.muted || !this.preferences.voices) return false;
    return this.voices.request(id, this.ctx.currentTime, options);
  }

  _clearVoices() {
    this.voices.reset();
    if (this.voice) this._stop(this.voice);
    this.voice = null;
  }

  _track(source, nodes, collection = this.transients, onended) {
    const record = { source, nodes, ended: false };
    collection.add(record);
    record.cleanup = () => {
      if (record.ended) return;
      record.ended = true;
      collection.delete(record);
      source.disconnect();
      for (const node of nodes) node.disconnect();
      onended?.();
    };
    source.onended = record.cleanup;
    return record;
  }

  _stop(record, when) {
    if (!record || record.ended) return;
    try {
      record.source.stop(when);
    } catch {
      /* Already stopped. */
    }
    if (when === undefined || when <= this.ctx.currentTime) record.cleanup();
  }

  _sample(
    id,
    { volume = 1, rate = 1, delay = 0, bus = this.sfxBus, onended } = {},
  ) {
    const buffer = this.buffers.get(id);
    if (!this.ctx || !buffer || this.paused) return null;
    const source = this.ctx.createBufferSource(),
      gain = this.ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(bus);
    const record = this._track(source, [gain], this.transients, onended);
    record.id = id;
    record.gain = gain;
    record.generation = this.runGeneration;
    source.start(this.ctx.currentTime + delay);
    return record;
  }

  _loop(id, level, rate = 1) {
    let loop = this.loops.get(id);
    if (!loop && level > 0 && this.buffers.has(id)) {
      const source = this.ctx.createBufferSource(),
        gain = this.ctx.createGain();
      source.buffer = this.buffers.get(id);
      source.loop = true;
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(this.sfxBus);
      loop = this._track(source, [gain], new Set(), () =>
        this.loops.delete(id),
      );
      loop.id = id;
      loop.gain = gain;
      this.loops.set(id, loop);
      source.start();
    }
    if (loop) {
      loop.gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.09);
      loop.source.playbackRate.setTargetAtTime(
        rate,
        this.ctx.currentTime,
        0.12,
      );
      loop.silentAt =
        level > 0 ? null : (loop.silentAt ?? this.ctx.currentTime);
    }
    return Boolean(loop);
  }

  update(state, active) {
    if (!this.ctx || this.paused) return;
    const t = this.ctx.currentTime;
    const thrust =
      active && !state.exploded
        ? clamp(
            Math.max(...(state.boosterLevels || [0]), state.rearBoost || 0),
            0,
            1,
          )
        : 0;
    const sampledBoost = this._loop(
      "booster-loop",
      thrust * MIX.booster,
      0.82 + thrust * 0.45 + Math.min(0.18, (state.speed || 0) * 0.004),
    );
    this.rocket.gain.gain.setTargetAtTime(
      sampledBoost ? 0 : thrust * 1.05,
      t,
      0.08,
    );
    this.rocket.filter.frequency.setTargetAtTime(450 + thrust * 2400, t, 0.1);
    if (t - this.lastBoostEdge > 0.22) {
      if (thrust > 0.15 && this.lastThrust <= 0.15) {
        this._sample("booster-ignite", {
          volume: 0.55,
          rate: 0.96 + Math.random() * 0.08,
        });
        this.lastBoostEdge = t;
      } else if (thrust < 0.08 && this.lastThrust >= 0.08) {
        this._sample("booster-cut", { volume: 0.42 });
        this.lastBoostEdge = t;
      }
    }
    this.lastThrust = thrust;
    this.motor.source.frequency.setTargetAtTime(
      35 + Math.abs(state.speed || 0) * 5,
      t,
      0.1,
    );
    this.motor.gain.gain.setTargetAtTime(
      active && !state.crashed
        ? Math.min(0.065, Math.abs(state.speed || 0) * 0.004)
        : 0,
      t,
      0.1,
    );
    const fire =
      active && state.damage > 70 ? Math.min(0.5, (state.damage - 70) / 60) : 0;
    const sampledFire = this._loop("fire-loop", fire * 0.7);
    this.fire.gain.gain.setTargetAtTime(
      sampledFire ? 0 : fire * (0.8 + Math.sin(t * 19) * 0.12),
      t,
      0.12,
    );
    if (active && this.runActive) {
      if (state.grounded || state.crashed) {
        this.voices.clearPending((event) =>
          ["panic", "falling-panic", "controlled-descent"].includes(event.key),
        );
      }
      const event = this.runEvents.observe(state);
      if (
        event &&
        this._requestVoice(event.id, { cooldown: 11, ttl: 2.8, ...event })
      )
        this.runEvents.accept(event);
    }
    this._tick();
  }

  _variant(group, ids) {
    const candidates = ids.filter((id) => this.buffers.has(id));
    if (!candidates.length) return null;
    const fresh = candidates.filter((id) => id !== this.lastVariant.get(group));
    const choices = fresh.length ? fresh : candidates;
    const id = choices[Math.floor(Math.random() * choices.length)];
    this.lastVariant.set(group, id);
    return id;
  }

  impact(event = 1) {
    if (!this.ctx || this.paused) return;
    const strength = typeof event === "number" ? event : event.speed || 0;
    const t = this.ctx.currentTime;
    if (strength < 2.5 || t - this.lastImpact < 0.14) return;
    this.lastImpact = t;
    const heavy = strength > 10;
    const id = this._variant(
      heavy ? "heavy" : "light",
      heavy
        ? ["impact-heavy-1", "impact-heavy-2"]
        : ["impact-light-1", "impact-light-2"],
    );
    if (id)
      this._sample(id, {
        volume: clamp(strength / 17, 0.25, 1),
        rate: 0.9 + Math.random() * 0.18,
      });
    else this._synthImpact(strength);
    if (heavy) {
      this.explosionDuckUntil = Math.max(this.explosionDuckUntil, t + 0.65);
      this._sample("crunch", {
        volume: 0.22 + Math.min(0.3, strength / 100),
        delay: 0.025,
      });
      if (strength > 17) this._sample("glass", { volume: 0.28, delay: 0.06 });
    }
    if (this.runActive && strength > 15) {
      const voice = this._variant("crash-voice", [
        "pilot-insurance",
        "pilot-regret",
        "pilot-controls",
      ]);
      if (voice)
        this._requestVoice(voice, {
          key: "crash-joke",
          priority: 25,
          cooldown: 18,
          delay: 1,
          ttl: 3,
        });
    }
  }

  _synthImpact(strength) {
    const c = this.ctx,
      t = c.currentTime;
    const source = c.createBufferSource(),
      gain = c.createGain(),
      filter = c.createBiquadFilter();
    source.buffer = this.noiseBuffer;
    filter.type = "lowpass";
    filter.frequency.value = 300 + Math.min(strength, 20) * 80;
    gain.gain.setValueAtTime(Math.min(1.6, strength * 0.1), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    this._track(source, [filter, gain]);
    source.start(t);
    source.stop(t + 0.5);
  }

  explosion() {
    if (!this.ctx || this.paused) return;
    const t = this.ctx.currentTime;
    if (t - this.lastExplosion < 1) return;
    this.lastExplosion = t;
    this.explosionDuckUntil = t + 2.8;
    this.voices.clearPending();
    if (!this._sample("explosion", { volume: 1.15 })) this._synthExplosion();
    this._sample("debris", { volume: 0.52, delay: 0.25 });
    if (this.runActive && !this.voice?.id.startsWith("pilot-")) {
      const reaction = this._variant("crash-voice", [
        "pilot-insurance",
        "pilot-regret",
      ]);
      if (reaction)
        this._requestVoice(reaction, {
          key: "blast-survivor",
          priority: 70,
          cooldown: 30,
          delay: 1.15,
          ttl: 2,
          interrupt: true,
        });
    }
    this._tick();
  }

  _synthExplosion() {
    const c = this.ctx,
      t = c.currentTime;
    for (const [buffer, cutoff, peak, tail] of [
      [this.crackleBuffer, 3800, 2.1, 0.7],
      [this.noiseBuffer, 340, 2.5, 2.4],
    ]) {
      const source = c.createBufferSource(),
        filter = c.createBiquadFilter(),
        gain = c.createGain();
      source.buffer = buffer;
      source.loop = true;
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(cutoff, t);
      filter.frequency.exponentialRampToValueAtTime(80, t + tail);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + tail);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxBus);
      this._track(source, [filter, gain]);
      source.start(t);
      source.stop(t + tail + 0.05);
    }
    const sub = c.createOscillator(),
      gain = c.createGain();
    sub.frequency.setValueAtTime(85, t);
    sub.frequency.exponentialRampToValueAtTime(24, t + 1.3);
    gain.gain.setValueAtTime(1.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    sub.connect(gain);
    gain.connect(this.sfxBus);
    this._track(sub, [gain]);
    sub.start(t);
    sub.stop(t + 1.6);
  }

  _stopMusic() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const record of this.musicSources) {
      record.gain.gain.cancelScheduledValues(t);
      record.gain.gain.setTargetAtTime(0, t, 0.14);
      this._stop(record, t + 0.7);
    }
    this.musicId = null;
    this.musicNextAt = 0;
  }

  _music() {
    const id = MUSIC[this.scene];
    const buffer = this.buffers.get(id);
    if (!this.preferences.music || !buffer) return;
    const c = this.ctx,
      now = c.currentTime;
    if (this.musicId !== id) {
      this._stopMusic();
      this.musicId = id;
      this.musicNextAt = now + 0.03;
    }
    if (this.musicNextAt > now + 0.45) return;
    const start = Math.max(now + 0.015, this.musicNextAt);
    const overlap = Math.min(1.4, buffer.duration * 0.18);
    if (buffer.duration < 0.2) return;
    const end = start + buffer.duration;
    const source = c.createBufferSource(),
      gain = c.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(1, start + overlap);
    gain.gain.setValueAtTime(1, end - overlap);
    gain.gain.linearRampToValueAtTime(0, end);
    source.connect(gain);
    gain.connect(this.musicBus);
    const record = this._track(source, [gain], this.musicSources);
    record.id = id;
    record.gain = gain;
    source.start(start);
    source.stop(end + 0.01);
    this.musicNextAt = end - overlap;
  }

  _tick() {
    if (!this.ctx || this.paused || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    for (const loop of this.loops.values()) {
      if (
        loop.silentAt !== null &&
        loop.silentAt !== undefined &&
        t - loop.silentAt > 0.6
      )
        this._stop(loop);
    }
    // Fade the old source fully out before releasing the speech channel.
    // The urgent line is only eligible after onended has cleared the old one.
    if (
      this.voice &&
      !this.voice.interrupted &&
      this.voices.interruption(t, (id) => this.buffers.has(id))
    ) {
      this.voice.interrupted = true;
      this.voice.gain.gain.cancelScheduledValues(t);
      this.voice.gain.gain.setValueAtTime(this.voice.gain.gain.value, t);
      this.voice.gain.gain.linearRampToValueAtTime(0, t + 0.055);
      this._stop(this.voice, t + 0.06);
    }
    const event =
      !this.muted && this.preferences.voices
        ? this.voices.take(t, (id) => this.buffers.has(id))
        : null;
    if (event) {
      const record = this._sample(event.id, {
        bus: this.voiceBus,
        onended: () => {
          this.voices.complete(event.token, this.ctx.currentTime);
          if (this.voice === record) this.voice = null;
        },
      });
      this.voice = record;
      if (!record) this.voices.complete(event.token, t);
    }
    const duck = this.voice ? 0.23 : t < this.explosionDuckUntil ? 0.32 : 1;
    this.musicBus.gain.setTargetAtTime(
      this.preferences.music ? MIX.music * duck : 0,
      t,
      duck < 1 ? 0.07 : 0.5,
    );
    this._music();
  }

  reset() {
    this.runGeneration++;
    this.runActive = false;
    this.runEvents.reset();
    this._clearVoices();
    for (const record of this.transients) this._stop(record);
    for (const loop of this.loops.values()) this._stop(loop);
    this.lastImpact = this.lastExplosion = this.lastBoostEdge = -Infinity;
    this.lastThrust = 0;
    this.explosionDuckUntil = 0;
    if (this.ctx) {
      const t = this.ctx.currentTime;
      for (const loop of [this.rocket, this.fire, this.motor])
        loop?.gain.gain.setTargetAtTime(0, t, 0.02);
    }
    this.setPaused(false);
  }

  ringPass(count) {
    if (!this.ctx || this.paused) return;
    const c = this.ctx;
    const base = 523.25 * 2 ** ((Math.min(5, count) - 1) / 12);
    [base, base * 1.5].forEach((frequency, i) => {
      const source = c.createOscillator(), gain = c.createGain();
      const start = c.currentTime + i * 0.075;
      source.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.075, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);
      source.connect(gain);
      gain.connect(this.sfxBus);
      this._track(source, [gain]);
      source.start(start);
      source.stop(start + 0.3);
    });
  }

  chime() {
    if (!this.ctx || this.paused) return;
    const c = this.ctx;
    [440, 554.37, 659.25].forEach((frequency, i) => {
      const source = c.createOscillator(),
        gain = c.createGain();
      const start = c.currentTime + i * 0.11;
      source.frequency.value = frequency;
      gain.gain.setValueAtTime(0.1, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.65);
      source.connect(gain);
      gain.connect(this.sfxBus);
      this._track(source, [gain]);
      source.start(start);
      source.stop(start + 0.7);
    });
  }

  debugSnapshot() {
    return {
      ready: Boolean(this.ctx),
      contextState: this.ctx?.state || "uninitialized",
      contextTime: this.ctx?.currentTime ?? 0,
      loaded: [...this.buffers.keys()],
      failed: [...this.failed],
      loading: this.loading.size + this.decoding.size,
      scene: this.scene,
      paused: this.paused,
      muted: this.muted,
      preferences: { ...this.preferences },
      masterGain: this.master?.gain.value ?? 0,
      musicGain: this.musicBus?.gain.value ?? 0,
      voiceGain: this.voiceBus?.gain.value ?? 0,
      music: { id: this.musicId, activeSources: this.musicSources.size },
      voice: {
        id: this.voice?.id || null,
        generation: this.voice?.generation ?? null,
        pending: this.voices.pending.length,
      },
      loops: [...this.loops.keys()],
      oneShots: this.transients.size - (this.voice ? 1 : 0),
      runGeneration: this.runGeneration,
    };
  }
}
