import test from "node:test";
import assert from "node:assert/strict";
import { VoiceScheduler, RunAudioEvents } from "../src/audio-events.js";
import { GameAudio } from "../src/audio.js";

test("urgent commentary wins when the channel becomes free and voices never overlap", () => {
  const voices = new VoiceScheduler({ gap: 1 });
  voices.request("mission-start", 0, { priority: 100 });
  const start = voices.take(0);
  voices.request("pilot-insurance", 0.1, { priority: 20, ttl: 8 });
  voices.request("pilot-scream", 0.2, { priority: 60, ttl: 8 });
  assert.equal(voices.take(2), null, "a long intro must not overlap a scream");
  voices.complete(start.token, 2);
  assert.equal(voices.take(2.9), null, "leave a breath between lines");
  assert.equal(voices.take(3).id, "pilot-scream");
});

test("late voice downloads cannot replay expired or reset events", () => {
  const voices = new VoiceScheduler();
  voices.request("pilot-scream", 0, { ttl: 2 });
  assert.equal(
    voices.take(1, () => false),
    null,
  );
  assert.equal(
    voices.take(3, () => true),
    null,
    "old panic should not play after download",
  );
  voices.request("mission-fail", 3, { delay: 1 });
  voices.reset();
  assert.equal(voices.take(5), null, "reset must cancel future commentary");
});

test("ending an old run's source cannot free the new run's active voice", () => {
  const voices = new VoiceScheduler();
  voices.request("pilot-scream", 0);
  const old = voices.take(0);
  voices.reset();
  voices.request("mission-start", 1);
  const current = voices.take(1);
  voices.complete(old.token, 2);
  assert.equal(voices.active.token, current.token);
});

test("collision commentary shares a cooldown across different jokes", () => {
  const voices = new VoiceScheduler();
  assert.equal(
    voices.request("pilot-regret", 0, { key: "crash", cooldown: 15 }),
    true,
  );
  const first = voices.take(0);
  voices.complete(first.token, 1);
  assert.equal(
    voices.request("pilot-insurance", 2, { key: "crash", cooldown: 15 }),
    false,
  );
  assert.equal(
    voices.request("pilot-controls", 16, { key: "crash", cooldown: 15 }),
    true,
  );
});

test("suspension hops and low-altitude rolling never trigger airborne panic", () => {
  const events = new RunAudioEvents();
  for (let i = 0; i < 120; i++) {
    assert.equal(
      events.observe({
        grounded: false,
        altitude: 0.5,
        airtime: 2,
        angularVelocity: { x: 8 },
        velocity: { y: -12 },
      }),
      null,
    );
    assert.equal(
      events.observe({
        grounded: false,
        altitude: 5,
        airtime: 0.1,
        angularVelocity: { x: 8 },
      }),
      null,
    );
  }
});

test("controlled descent gets a landing claim before touchdown and reset forgets flight", () => {
  const events = new RunAudioEvents();
  const spinning = {
    grounded: false,
    altitude: 8,
    airtime: 1.5,
    angularVelocity: { x: 4 },
    damage: 0,
  };
  const flip = events.observe(spinning);
  assert.equal(flip.id, "pilot-flip");
  events.accept(flip);
  assert.equal(events.observe(spinning), null);
  assert.equal(events.observe({ grounded: true, damage: 12 }), null);
  const descending = {
    grounded: false,
    altitude: 6,
    airtime: 2,
    velocity: { y: -4 },
    damage: 12,
  };
  const landing = events.observe(descending);
  assert.equal(landing.id, "pilot-landing");
  events.accept(landing);
  assert.equal(events.observe(descending), null);
  assert.equal(events.observe({ grounded: true, damage: 12 }), null);
  events.reset();
  assert.equal(
    events.observe({ grounded: true, damage: 0 }),
    null,
    "new run cannot inherit a landing",
  );
  assert.equal(events.observe(spinning).id, "pilot-flip");
});

test("landing claims stay quiet during a fast fall and pending flight lines can be cancelled at touchdown", () => {
  const events = new RunAudioEvents();
  const state = {
    grounded: false,
    altitude: 6,
    airtime: 2,
    velocity: { y: -12 },
    damage: 0,
  };
  assert.equal(events.observe(state).id, "pilot-scream");
  const voices = new VoiceScheduler();
  voices.request("pilot-landing", 0, { key: "controlled-descent", delay: 1 });
  voices.request("mission-win", 0, { priority: 100, delay: 1 });
  voices.clearPending((event) => event.key === "controlled-descent");
  assert.equal(voices.take(1).id, "mission-win");
  assert.equal(voices.pending.length, 0);
});

test("a falling scream can supersede the climb's oh-no without overlapping it", () => {
  const events = new RunAudioEvents();
  const voices = new VoiceScheduler();
  const state = {
    grounded: false,
    altitude: 14,
    airtime: 2,
    velocity: { y: 3 },
  };
  const climbing = events.observe(state);
  assert.equal(climbing.id, "pilot-oh-no");
  assert.equal(
    voices.request(climbing.id, 0, { ...climbing, cooldown: 11 }),
    true,
  );
  events.accept(climbing);
  const current = voices.take(0);
  const falling = events.observe({ ...state, velocity: { y: -12 } });
  assert.equal(falling.id, "pilot-scream");
  assert.equal(
    voices.request(falling.id, 1, falling),
    true,
    "falling panic has a separate cooldown",
  );
  events.accept(falling);
  assert.equal(voices.interruption(1), current.token);
  assert.equal(
    voices.take(1),
    null,
    "old source must finish fading before scream starts",
  );
  voices.complete(current.token, 1.06);
  assert.equal(
    voices.take(1.06).id,
    "pilot-scream",
    "urgent panic bypasses the normal conversation gap",
  );
  assert.equal(events.observe({ ...state, velocity: { y: -12 } }), null);
});

test("unavailable urgent clips do not interrupt audible commentary", () => {
  const voices = new VoiceScheduler();
  voices.request("mission-start", 0, { priority: 30 });
  const current = voices.take(0);
  voices.request("pilot-oh-no", 0.1, { priority: 45 });
  voices.request("pilot-scream", 0.2, { priority: 90, interrupt: true });
  assert.equal(voices.pending.length, 1, "old climb commentary is superseded");
  assert.equal(
    voices.interruption(0.3, () => false),
    null,
  );
  assert.equal(voices.active.token, current.token);
  assert.equal(
    voices.interruption(0.3, () => true),
    current.token,
  );
});

test("a rejected flight reaction remains eligible instead of being marked spoken", () => {
  const events = new RunAudioEvents();
  const voices = new VoiceScheduler();
  voices.request("pilot-oh-no", 0, { key: "panic", cooldown: 11 });
  const spinning = {
    grounded: false,
    altitude: 8,
    airtime: 1.5,
    angularVelocity: { x: 4 },
  };
  const flip = events.observe(spinning);
  assert.equal(voices.request(flip.id, 1, flip), false);
  assert.equal(events.observe(spinning).id, "pilot-flip");
  voices.take(12, () => false); // Expire the old pending line.
  assert.equal(voices.request(flip.id, 12, flip), true);
  events.accept(flip);
  assert.equal(events.observe(spinning), null);
});

test("fatal explosions schedule one delayed survivor reaction unless a pilot is already speaking", () => {
  const createAudio = () => {
    const audio = new GameAudio();
    audio.ctx = { currentTime: 10, state: "suspended" };
    audio.runActive = true;
    audio.buffers.set("pilot-insurance", {});
    audio._sample = () => ({});
    return audio;
  };
  const audio = createAudio();
  audio.voices.request("pilot-regret", 10, { key: "crash-joke", delay: 1 });
  audio.explosion();
  assert.equal(audio.voices.pending.length, 1);
  assert.equal(audio.voices.take(11.1), null);
  assert.equal(audio.voices.take(11.2).id, "pilot-insurance");
  audio.explosion();
  assert.equal(
    audio.voices.pending.length,
    0,
    "the same blast does not add more lines",
  );
  const panicking = createAudio();
  panicking.voice = { id: "pilot-scream" };
  panicking.explosion();
  assert.equal(
    panicking.voices.pending.length,
    0,
    "do not follow a scream with more immediate chatter",
  );
});
