import { getControlMode, subscribeControlMode } from "./control-mode.js";
import "./factory-ui.css";

export const LEVELS = [
  {
    id: "garage",
    number: "01",
    name: "The garage",
    tag: "A simple departure.",
    difficulty: "ORIENTATION",
    description: "Get out of the garage. Preferably with the garage.",
    goal: "Clear the garage and reach the driveway.",
    hint: "Use ↑ to roll out. Tap Q W O P for lift. The shelves are not structural.",
    touchHint: "Slide up to drive. Lift clears a little clutter.",
    distance: "24 m",
    time: "~ 30 sec",
  },
  {
    id: "drag",
    number: "02",
    name: "The quarter mile",
    tag: "Unreasonably quick.",
    difficulty: "ACCELERATION",
    description:
      "A Porsche in the other lane. Four hundred metres to settle things.",
    goal: "Beat the Porsche to the 402-metre finish.",
    hint: "Hold ↑ to drive. SPACE adds rear thrust. Use short jet bursts to stay level.",
    touchHint: "Hold Boost for speed. Tap Lift for air.",
    distance: "402 m",
    time: "~ 20 sec",
  },
  {
    id: "ramp",
    number: "03",
    name: "The inversion",
    tag: "Up is a suggestion.",
    difficulty: "FLIGHT CONTROL",
    description:
      "The car drives. You handle the part where the ground disappears.",
    goal: "Ride the curve, rotate in the air, and land on your wheels.",
    hint: "Autodrive is on. At the lip, pulse Q + W to complete the flip. Release early.",
    touchHint: "The car drives itself. Pulse Nose up at the lip.",
    distance: "24 m high",
    time: "~ 15 sec",
  },
  {
    id: "factory",
    number: "04",
    name: "The Gigafactory",
    tag: "Some assembly required.",
    difficulty: "FLIGHT COURSE",
    description: "Ten glowing rings. Fly through any five. Keep the car in one piece.",
    goal: "Fly through 5 of 10 rings without crashing.",
    hint: "Hold Q W O P to lift. SPACE adds forward thrust. Pulse opposing jets to stay level.",
    touchHint: "Hold Lift to rise. Boost carries you forward. Slide to tilt; let go early.",
    distance: "10 rings",
    time: "5 to win",
  },
];
export const icons = {
  sound:
    '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m16 9 6 6m0-6-6 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 3m0 3v.01"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 9M3 4v6h6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  install: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/>',
  camera: '<path d="M3 7h5l2-3h4l2 3h5v13H3Z"/><circle cx="12" cy="13" r="4"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
};
export const svg = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.arrow}</svg>`;
const wordmark = `<svg class="tesla-wordmark" viewBox="0 0 180 24" role="img" aria-label="Tesla"><path fill="currentColor" d="M0 0h30l-3 4H3zm12 7h6v17h-6zM39 0h27v4H39zm0 10h24v4H39zm0 10h27v4H39zM77 0h28l-3 4H77zm0 0h5v14h-5zm0 10h28v4H77zm23 0h5v14h-5zM77 20h28v4H77zM116 0h6v20h21l-3 4h-24zM157 0h8l15 24h-7L161 5l-12 19h-7zm-2 16h12l3 4h-18z"/></svg>`;
const boosterControl = (key, label, place) =>
  `<button class="jet-button ${place}" data-control="${key.toLowerCase()}" aria-label="Hold ${label} booster"><div class="jet-key">${key}</div><div class="jet-label">${label}</div><div class="jet-meter"><i></i></div></button>`;
const inputCopy = (keyboard, touch) =>
  `<span class="keyboard-only">${keyboard}</span><span class="touch-only">${touch}</span>`;
const touchJets = [
  ["q", "↖", "FRONT L", "front-left booster"],
  ["qw", "↑", "NOSE UP", "both front boosters to raise the nose"],
  ["w", "↗", "FRONT R", "front-right booster"],
  ["qo", "←", "LEFT", "both left boosters"],
  ["qwop", "↑", "LIFT", "all four boosters to lift"],
  ["wp", "→", "RIGHT", "both right boosters"],
  ["o", "↙", "REAR L", "rear-left booster"],
  ["op", "↓", "TAIL UP", "both rear boosters to raise the tail"],
  ["p", "↘", "REAR R", "rear-right booster"],
];
const touchControls = `
  <div class="touch-controls" aria-label="Touch driving and flight controls">
    <div class="touch-drive-group">
      <div class="touch-control-heading"><p>DRIVE</p><span class="touch-drive-status">SLIDE TO STEER</span></div>
      <div class="touch-drive-pad" data-touch-pad="drive" role="group" aria-label="Drive pad: slide up to accelerate, down to brake or reverse, and sideways to steer">
        <span class="drive-label-forward">DRIVE</span><span class="drive-label-back">BRAKE</span><span class="drive-label-left" aria-hidden="true">←</span><span class="drive-label-right" aria-hidden="true">→</span><span class="drive-stick" aria-hidden="true"></span>
      </div>
      <button class="touch-boost" data-control="boost" aria-label="Hold rear rockets"><span>BOOST</span><small>REAR ROCKETS</small>${svg("arrow")}</button>
    </div>
    <div class="touch-flight-group">
      <div class="touch-control-heading"><p>FLIGHT</p><span class="touch-pressure" aria-label="Booster pressure">100%</span></div>
      <div class="touch-flight-pad" data-touch-pad="flight" role="group" aria-label="Flight pad: hold the center for lift, an edge for paired boosters, or a corner for one booster">
        ${touchJets.map(([jets, icon, label, description]) => `<button class="touch-jet ${jets === "qwop" ? "touch-jet-center" : jets.length === 2 ? "touch-jet-pair" : ""}" data-jets="${jets}" aria-label="Hold ${description}" aria-pressed="false"><span class="touch-jet-icon" aria-hidden="true">${icon}</span><span class="touch-jet-label">${label}</span></button>`).join("")}
      </div>
      <p class="touch-flight-hint">Hold to fire · slide to tilt</p>
    </div>
  </div>`;
export class UI {
  constructor(actions, settings) {
    getControlMode();
    this.actions = actions;
    this.settings = settings;
    this.selected = 0;
    this.lastOutcome = null;
    const isPlayer = document.documentElement.dataset.player === "true";
    const playerLink = isPlayer
      ? '<a class="player-full-link" href="https://roadster.superfun.games/" target="_blank" rel="noopener noreferrer">Open full game <span aria-hidden="true">↗</span></a>'
      : "";
    const playerGuide = isPlayer
      ? `<p class="player-controls-guide">${inputCopy('Hold <b>Q W O P</b> to lift each corner. <b>↑ ↓ ← →</b> drive · <b>SPACE</b> thrust.', 'Left thumb drives. Right thumb flies. Hold Boost for rear thrust.')}</p>`
      : "";
    document.querySelector("#app").innerHTML = `
      <header class="topbar"><a class="brand" href="#" aria-label="Back to hangar">${wordmark}</a>${playerLink}<div class="program">EXPERIMENTAL FLIGHT PROGRAM <i></i></div><nav class="top-actions" aria-label="Game settings"><button class="icon-button" id="install-button" hidden aria-label="Install game">${svg("install")}</button><button class="icon-button" data-action="help" aria-label="Flight manual">${svg("help")}</button><button class="icon-button" id="audio-button" data-action="mute" aria-label="Toggle sound">${svg(settings.muted ? "mute" : "sound")}</button><button class="icon-button" data-action="settings" aria-label="Settings">${svg("settings")}</button></nav></header>
      <section id="hangar" aria-label="Main menu">
        <div class="hero-copy"><p class="eyebrow">THE NEXT GENERATION</p><h1><img class="roadster-wordmark" src="/art/roadster-wordmark.svg" alt="Roadster" width="760" height="46" draggable="false" /></h1><p class="hero-tagline">But can it fly?</p></div>
        <div class="spec-rail"><div><b>04</b><p>INDEPENDENT<br>THRUSTERS</p></div><div><b>00</b><p>FLIGHT<br>ASSISTANCE</p></div><div><b>∞</b><p>POSSIBLE<br>REGRETS</p></div></div>
        <div class="hero-index"><i></i><p>FLIGHT PACKAGE<br><span>PROTOTYPE 001</span></p></div>
        <div class="orbit-hint">${inputCopy("DRAG TO INSPECT", "SWIPE TO INSPECT")} <span>↔</span></div>
        <div class="mission-panel"><div class="mission-topline"><p class="eyebrow">SELECT YOUR TEST</p><p class="tiny">${LEVELS.length} TESTS. NO GUARANTEES.</p></div><div class="mission-layout"><div class="mission-grid" role="group" aria-label="Select a level">${LEVELS.map((level, i) => `<button class="mission ${i === 0 ? "selected" : ""}" data-level="${i}" aria-pressed="${i === 0}"><div class="mission-image image-${level.id}"><span>${level.number}</span><i>${i === 0 ? "SELECTED" : "AVAILABLE"}</i></div><div class="mission-info"><h2>${level.name}</h2><p>${level.tag}</p></div><div class="mission-line"></div></button>`).join("")}</div><div class="launch-panel"><div class="launch-description"><p id="selected-type" class="eyebrow">${LEVELS[0].difficulty}</p><p id="selected-description">${LEVELS[0].description}</p></div><button class="primary-button" data-action="start">Begin test ${svg("arrow")}</button><p class="launch-note">${inputCopy("Q W O P TO FLY · ARROW KEYS TO DRIVE", "LEFT THUMB DRIVES · RIGHT THUMB FLIES")}</p></div></div>${playerGuide}<footer class="hangar-footer"><p>ENGINEERED TO FLY. <span>OPERATED BY YOU.</span></p><p>SUPERFUN GAMES <span>© 2026</span></p></footer></div>
      </section>
      <section id="hud" hidden aria-label="Game controls and telemetry">
        <div class="hud-top"><div class="mission-title"><p class="eyebrow" id="hud-level-number">TEST 01 / ORIENTATION</p><h2 id="hud-level-name">The garage</h2><div class="ring-objective" id="ring-objective" hidden><div class="ring-objective-heading"><span>RINGS</span><b id="ring-count" aria-live="polite" aria-atomic="true">0 / 5</b><small id="ring-total">10 AVAILABLE</small></div><div class="ring-objective-track" id="ring-objective-track" role="progressbar" aria-label="Rings cleared" aria-valuemin="0" aria-valuemax="5" aria-valuenow="0"><i id="ring-progress"></i></div></div><p id="hud-goal"></p></div><div class="hud-top-right"><div class="time-display"><p class="eyebrow">ELAPSED</p><div id="timer">00:00.00</div></div><button class="icon-button" data-action="pause" aria-label="Pause game">${svg("pause")}</button></div></div>
        <div class="progress-track"><i id="level-progress"></i></div>
        <div id="game-message" aria-live="polite"></div>
        <div class="telemetry"><div class="speed-readout"><b id="speed">0</b><p>KM/H</p></div><div class="telemetry-detail"><div><p>ALTITUDE</p><b id="altitude">0.0 <small>m</small></b></div><div><p>HULL</p><b id="hull">100<small>%</small></b></div></div></div>
        <div class="flight-status"><div class="status-dot"></div><p id="flight-status">GROUND CONTACT</p></div>
        <div class="booster-console"><div class="console-heading"><p>THRUSTER CONTROL</p><div><i id="pressure-fill"></i></div><p id="pressure-value">100%</p></div><div class="booster-row"><div class="jet-pair">${boosterControl("Q", "FRONT L", "front-l")}${boosterControl("W", "FRONT R", "front-r")}</div><div class="car-diagram" aria-hidden="true"><svg viewBox="0 0 60 115"><path d="m16 8 28 0 7 15v72l-6 13H15L9 95V23Z"/><path d="m16 28 28 0-4 25H20Zm4 52h20l5 15H15Z"/><path d="M6 27v17m48-17v17M6 76v17m48-17v17"/><path d="M30 1v11m-4-6 4-5 4 5"/></svg></div><div class="jet-pair">${boosterControl("O", "REAR L", "rear-l")}${boosterControl("P", "REAR R", "rear-r")}</div></div><button class="rear-boost" data-control="boost" aria-label="Hold rear thrust"><span class="space-key">SPACE</span><span>REAR THRUST</span><i></i></button></div>
        <div class="drive-controls"><p id="drive-label">GROUND DRIVE</p><div class="drive-up"><button data-control="throttle" aria-label="Accelerate">↑</button></div><div class="drive-row"><button data-control="left" aria-label="Steer left">←</button><button data-control="brake" aria-label="Brake or reverse">↓</button><button data-control="right" aria-label="Steer right">→</button></div></div>
        ${touchControls}
        <div class="game-toolbar"><button data-action="reset" aria-label="Reset test">${svg("reset")}<span><kbd>R</kbd> Reset</span></button><button data-action="camera" aria-label="Change camera">${svg("camera")}<span><kbd>C</kbd> Camera</span></button><button data-action="fullscreen" aria-label="Toggle fullscreen">${svg("expand")}<span>Fullscreen</span></button></div>
        <p class="flight-tip" id="flight-tip"></p>
      </section>
      <div class="impact-vignette"></div>
      <div class="explosion-flash"></div>
      <div class="modal-backdrop" id="dialog" hidden><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button close-dialog" data-action="close" aria-label="Close dialog">${svg("close")}</button><div id="dialog-content"></div></section></div>
      <div id="toast" role="status"></div>
    `;
    // Browsers often omit click for a second or third finger. The player
    // must still be able to pause or reset while holding both thumb pads.
    const touchActions = new Map();
    let handledTouchClickAt = -Infinity;
    document.addEventListener("pointerdown", () => {
      handledTouchClickAt = -Infinity;
    }, true);
    // Opening a dialog can retarget the compatibility click to its backdrop.
    // Catch that click before any target listener can close the dialog again.
    document.addEventListener("click", (event) => {
      if (event.detail > 0 && performance.now() - handledTouchClickAt < 800) {
        handledTouchClickAt = -Infinity;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    document.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch") return;
      const button = event.target.closest("#hud [data-action]");
      if (!button || button.disabled) return;
      touchActions.set(event.pointerId, {
        button, x: event.clientX, y: event.clientY, moved: false,
      });
    });
    document.addEventListener("pointermove", (event) => {
      const gesture = touchActions.get(event.pointerId);
      if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 12)
        gesture.moved = true;
    });
    document.addEventListener("pointercancel", (event) => touchActions.delete(event.pointerId));
    document.addEventListener("pointerup", (event) => {
      const gesture = touchActions.get(event.pointerId);
      if (!gesture) return;
      touchActions.delete(event.pointerId);
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const hud = document.querySelector("#hud");
      handledTouchClickAt = performance.now();
      if (gesture.moved || hud.hidden || hud.inert ||
          !hit || !gesture.button.contains(hit)) return;
      event.preventDefault();
      this.actions(gesture.button.dataset.action);
    });
    window.addEventListener("blur", () => touchActions.clear());
    document.addEventListener("click", (e) => {
      const action = e.target.closest("[data-action]");
      if (action) {
        this.actions(action.dataset.action);
        return;
      }
      const mission = e.target.closest(".mission[data-level]");
      if (mission) this.select(+mission.dataset.level);
      if (e.target.closest(".brand")) {
        e.preventDefault();
        this.actions("home");
      }
    });
    this.dialog = document.querySelector("#dialog");
    let backdropPressed = false;
    this.dialog.addEventListener("pointerdown", (event) => {
      backdropPressed = event.target === this.dialog;
    });
    this.dialog.addEventListener("pointercancel", () => { backdropPressed = false; });
    this.dialog.addEventListener("click", (e) => {
      // Releasing a thumb that started on a game control is not a backdrop tap.
      const close = backdropPressed && e.target === this.dialog;
      backdropPressed = false;
      if (close) this.actions("close");
    });
    document.addEventListener("keydown", (e) => {
      if (!this.dialog.hidden && e.key === "Tab") {
        const els = [
          ...this.dialog.querySelectorAll("button,a,input,select,textarea"),
        ].filter((el) => !el.disabled && !el.hidden);
        if (!els.length) return;
        const first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    this.refs = Object.fromEntries(
      [
        "speed",
        "altitude",
        "hull",
        "timer",
        "level-progress",
        "flight-status",
        "pressure-value",
        "pressure-fill",
        "game-message",
        "flight-tip",
        "hud-goal",
        "ring-objective",
        "ring-count",
        "ring-total",
        "ring-progress",
        "ring-objective-track",
      ].map((id) => [id, document.getElementById(id)]),
    );
    this.jetButtons = [...document.querySelectorAll(".jet-button")];
    this.touchJetButtons = [...document.querySelectorAll(".touch-jet")];
    this.touchPressure = document.querySelector(".touch-pressure");
    this.touchBoost = document.querySelector(".touch-boost");
    subscribeControlMode(() => {
      if (this.inputMessage) this.refs["game-message"].textContent =
        this.inputMessage[getControlMode()];
    });
  }
  select(i) {
    this.selected = i;
    document.querySelectorAll(".mission").forEach((el, index) => {
      el.classList.toggle("selected", index === i);
      el.setAttribute("aria-pressed", index === i);
      el.querySelector(".mission-image i").textContent =
        index === i ? "SELECTED" : "AVAILABLE";
    });
    document.querySelector("#selected-type").textContent = LEVELS[i].difficulty;
    document.querySelector("#selected-description").textContent =
      LEVELS[i].description;
    this.actions("select", i);
  }
  game(level) {
    this.close();
    this.recovery(null);
    document.querySelector("#hangar").hidden = true;
    document.querySelector("#hud").hidden = false;
    document.body.classList.add("playing");
    document.querySelector("#hud").dataset.level = level.id;
    this.refs["ring-objective"].hidden = level.id !== "factory";
    this.updateRings(0, 5, 10);
    document.querySelector("#hud-level-number").textContent =
      `TEST ${level.number} / ${level.difficulty}`;
    document.querySelector("#hud-level-name").textContent = level.name;
    document.querySelector("#hud-goal").textContent = level.goal;
    this.refs["flight-tip"].innerHTML = inputCopy(level.hint, level.touchHint);
    document.querySelector(".touch-drive-status").textContent =
      level.id === "ramp" ? "AUTO DRIVE" : "SLIDE TO STEER";
    document.querySelector(".touch-drive-group").classList.toggle("autodrive", level.id === "ramp");
    document.querySelector("#drive-label").textContent =
      level.id === "ramp" ? "AUTODRIVE ON" : "GROUND DRIVE";
    document
      .querySelector(".drive-controls")
      .classList.toggle("autodrive", level.id === "ramp");
    this.lastOutcome = null;
    this.raceStatus = null;
  }
  home() {
    this.close();
    this.recovery(null);
    document.querySelector("#hangar").hidden = false;
    document.querySelector("#hud").hidden = true;
    document.body.classList.remove("playing");
  }
  update(s, level) {
    const time = s.time || 0;
    this.refs.speed.textContent = Math.round(
      Math.abs(s.speedKmh || s.speed * 3.6 || 0),
    );
    this.refs.altitude.innerHTML = `${Math.max(0, s.altitude || 0).toFixed(1)} <small>m</small>`;
    this.refs.hull.innerHTML = `${Math.round(100 - s.damage)}<small>%</small>`;
    this.refs.hull.classList.toggle("danger", s.damage > 65);
    this.refs.timer.textContent = `${String(Math.floor(time / 60)).padStart(2, "0")}:${(time % 60).toFixed(2).padStart(5, "0")}`;
    this.refs["pressure-value"].textContent =
      `${Math.round(s.pressure * 100)}%`;
    this.refs["pressure-fill"].style.transform = `scaleX(${s.pressure})`;
    if (level.id === "factory") this.updateRings(s.ringCount || 0, s.ringGoal || 5, s.ringTotal || 10);
    if (level.id === "drag" && s.rival) {
      const gap = s.rival.position.z - s.position.z;
      const status = s.outcome === "beaten" ? "Porsche takes the race."
        : s.outcome === "success" ? "You crossed first. Porsche would like a rematch."
        : s.crashed ? (s.rival.crashed ? "Both cars · DNF." : "Your Roadster · DNF.")
        : s.rival.crashed ? "Porsche · DNF. Finish your run."
        : Math.abs(gap) < 0.75 ? "Porsche · Side by side."
        : `Porsche · ${Math.round(Math.abs(gap))} m ${gap > 0 ? "ahead" : "behind"}.`;
      if (status !== this.raceStatus) {
        this.refs["hud-goal"].textContent = status;
        this.raceStatus = status;
      }
    }
    const progress =
      level.id === "factory"
        ? Math.min(1, (s.ringCount || 0) / (s.ringGoal || 5))
        : level.id === "ramp"
        ? s.rampStage === "landed"
          ? 1
          : s.rampStage === "airborne"
            ? 0.78
            : s.rampStage === "climb"
              ? 0.5
              : Math.min(0.4, s.position.z / 100)
        : Math.max(
            0,
            Math.min(1, s.distance / (level.id === "garage" ? 24 : 402)),
          );
    this.refs["level-progress"].style.transform = `scaleX(${progress})`;
    const status = s.crashed
      ? "VEHICLE LOST"
      : Number.isFinite(s.recoveryRemaining)
        ? `AUTO RESET IN ${Math.ceil(s.recoveryRemaining)}s`
        : s.damage > 85
          ? "HULL FAILURE IMMINENT"
          : s.damage > 65
            ? "HULL CRITICAL"
            : s.pressure < 0.1
              ? "RECHARGING · RELEASE JETS"
              : !s.grounded
                ? "AIRBORNE"
                : level.id === "ramp" && s.rampStage === "approach"
                  ? "AUTODRIVE ACTIVE"
                  : "GROUND CONTACT";
    this.refs["flight-status"].textContent = status;
    this.jetButtons.forEach((b, i) => {
      const amount = s.boosterLevels[i];
      b.style.setProperty("--throttle", amount);
      b.classList.toggle("firing", amount > 0.1);
      b.setAttribute("aria-pressed", amount > 0.1);
    });
    this.touchPressure.textContent = `${Math.round(s.pressure * 100)}%`;
    this.touchPressure.classList.toggle("danger", s.pressure < 0.15);
    const jetIndices = { q: 0, w: 1, o: 2, p: 3 };
    this.touchJetButtons.forEach((button) => {
      const amount = Math.min(...[...button.dataset.jets].map((key) => s.boosterLevels[jetIndices[key]]));
      button.style.setProperty("--throttle", amount);
      button.classList.toggle("firing", amount > 0.1);
      button.setAttribute("aria-pressed", amount > 0.1);
    });
    this.touchBoost.style.setProperty("--throttle", s.rearBoost);
    this.touchBoost.classList.toggle("firing", s.rearBoost > 0.1);
    this.touchBoost.setAttribute("aria-pressed", s.rearBoost > 0.1);
    document.querySelector(".rear-boost").style.setProperty("--throttle", s.rearBoost);
    document
      .querySelector(".flight-status")
      .classList.toggle("airborne", !s.grounded);
    document
      .querySelector(".flight-status")
      .classList.toggle("critical", s.damage > 65);
    this.recovery(s.recoveryRemaining);
  }
  updateRings(count, goal, total) {
    const key = `${count}/${goal}/${total}`;
    if (this.ringProgressKey === key) return;
    this.ringProgressKey = key;
    const label = `${count} / ${goal}`;
    if (this.refs["ring-count"].textContent !== label)
      this.refs["ring-count"].textContent = label;
    this.refs["ring-total"].textContent = `${Math.max(0, total - count)} AVAILABLE`;
    this.refs["ring-progress"].style.transform = `scaleX(${Math.min(1, count / goal)})`;
    this.refs["ring-objective-track"].setAttribute("aria-valuenow", count);
    this.refs["ring-objective-track"].setAttribute("aria-valuemax", goal);
  }
  recovery(remaining) {
    const seconds = Number.isFinite(remaining) ? Math.ceil(remaining) : null;
    if (seconds === this.recoverySecond) return;
    const previousMessage = this.recoveryMessage;
    this.recoverySecond = seconds;
    this.recoveryMessage = seconds === null
      ? null
      : `Upside down. Resetting in ${seconds}…`;
    if (this.recoveryMessage) {
      this.inputMessage = null;
      clearTimeout(this.messageTimeout);
      this.refs["game-message"].textContent = this.recoveryMessage;
    } else if (this.refs["game-message"].textContent === previousMessage) {
      this.refs["game-message"].textContent = "";
    }
  }
  modal(html, kind = "") {
    this.previousFocus = document.activeElement;
    this.dialog.dataset.kind = kind;
    this.dialog.querySelector(".close-dialog").hidden = kind === "graphics";
    document.querySelector("#dialog-content").innerHTML = html;
    this.dialog.hidden = false;
    this.dialog.querySelector(".dialog").scrollTop = 0;
    document.querySelector("#hangar").inert = true;
    document.querySelector("#hud").inert = true;
    document.querySelector(".topbar").inert = true;
    requestAnimationFrame(() => this.dialog.querySelector("button:not([hidden]):not(:disabled)")?.focus());
  }
  close() {
    this.dialog.hidden = true;
    document.querySelector("#hangar").inert = false;
    document.querySelector("#hud").inert = false;
    document.querySelector(".topbar").inert = false;
    this.previousFocus?.focus?.({ preventScroll: true });
  }
  help() {
    this.modal(
      `<p class="eyebrow">OWNER’S MANUAL / FLIGHT PACKAGE</p><h2 id="dialog-title">A little thrust.<br>A lot of consequences.</h2><p class="dialog-intro">${inputCopy("Each key fires one corner of the car. Hold to build thrust. Release before you think you should.", "Two thumbs. Four rockets. Let go early.")}</p><div class="keyboard-only"><div class="manual-layout"><div class="manual-car"><div class="manual-pair"><kbd>Q</kbd><p>FRONT</p><kbd>W</kbd></div><svg viewBox="0 0 100 180" aria-hidden="true"><path d="M25 8h50l10 25v115l-9 22H24l-9-22V33Z"/><path d="m25 42 50 0-8 42H33Zm8 80h34l11 27H22Z"/></svg><div class="manual-pair"><kbd>O</kbd><p>REAR</p><kbd>P</kbd></div></div><div class="manual-list"><p><b>Q + W</b> Lift the nose. Pitch backward.</p><p><b>O + P</b> Lift the tail. Pitch forward.</p><p><b>Q + W + O + P</b> Lift off. Try to stay level.</p><p><b>SPACE</b> Fire the rear rockets.</p><p><b>↑ ↓ ← →</b> Drive, brake / reverse, steer.</p></div></div><div class="manual-footnote"><p>Tap opposing jets to catch a rotation. Pressure refills when you let go. On touchscreens, hold several controls at once.</p><p><kbd>R</kbd> Start over · <kbd>C</kbd> Camera · <kbd>ESC</kbd> Pause</p></div></div><div class="touch-only touch-manual"><div class="touch-manual-card"><span class="touch-manual-number">01</span><h3>Left thumb. Drive.</h3><p>Slide up to drive, down to brake or reverse, and sideways to steer. Release to coast.</p><p>Hold <b>Boost</b> for rear thrust.</p></div><div class="touch-manual-card"><span class="touch-manual-number">02</span><h3>Right thumb. Fly.</h3><p>Hold <b>Lift</b> for all four jets. Slide to <b>Nose up</b> or <b>Tail up</b> to pitch.</p><p>Edges fire pairs. Corners fire one jet. Slide between them without lifting your thumb.</p></div><p class="touch-manual-note">Use both pads at once. Release to refill pressure; tap the opposite jets to catch a spin.</p><p class="touch-manual-note">On the ramp, the car drives itself. Reset, Camera and Pause are on screen.</p></div><button class="primary-button wide" data-action="close">Understood. Probably. ${svg("arrow")}</button>`,
    );
  }
  pause() {
    this.modal(
      `<p class="eyebrow">FLIGHT TEST PAUSED</p><h2 id="dialog-title">Take a breath.</h2><p class="dialog-intro">Gravity can wait.</p><div class="dialog-buttons"><button class="primary-button wide" data-action="close">Resume test ${svg("arrow")}</button><button class="secondary-button" data-action="reset">Restart test</button><button class="text-button" data-action="home">Return to hangar</button></div>`,
      "pause",
    );
  }
  showSettings(settings) {
    this.modal(
      `<p class="eyebrow">VEHICLE PREFERENCES</p><h2 id="dialog-title">Make yourself<br>comfortable.</h2><div class="settings-list"><label>Sound <input id="setting-sound" type="checkbox" ${settings.muted ? "" : "checked"} /><span>All game audio</span></label><label>Music <input id="setting-music" type="checkbox" ${settings.music !== false ? "checked" : ""} /><span>The soundtrack to poor decisions</span></label><label>Pilot reactions <input id="setting-voices" type="checkbox" ${settings.voices !== false ? "checked" : ""} /><span>Panicked pilot & frantic mission control</span></label><label>Haptics <input id="setting-haptics" type="checkbox" ${settings.haptics ? "checked" : ""} /><span>Vibration on supported devices</span></label><label>Camera shake <input id="setting-shake" type="checkbox" ${settings.shake ? "checked" : ""} /><span>Feel the thrust and hard landings</span></label><label>Graphics <select id="setting-quality"><option value="high" ${settings.quality === "high" ? "selected" : ""}>High</option><option value="balanced" ${settings.quality === "balanced" ? "selected" : ""}>Balanced</option><option value="low" ${settings.quality === "low" ? "selected" : ""}>Performance</option></select><span>Adapts resolution to keep play smooth</span></label><label>Compatibility mode <input id="setting-safe" type="checkbox" ${settings.safeGraphics ? "checked" : ""} /><span>Lighter graphics for devices having trouble</span></label></div><button class="text-button wide" data-action="graphics-report">Copy graphics report</button><button class="primary-button wide" data-action="save-settings">Ready for liftoff ${svg("arrow")}</button>`,
    );
  }
  graphicsRecovery(state, inGame = false) {
    const restored = state === "restored", failed = state === "failed";
    this.modal(
      `<p class="eyebrow">FLIGHT SYSTEMS</p><h2 id="dialog-title">${restored ? "Graphics restored." : failed ? "Graphics need a restart." : "Restoring graphics…"}</h2><p class="dialog-intro">${restored ? "Your test is paused. Compatibility mode is on to reduce the graphics load." : failed ? "The graphics system could not recover reliably. Restart with lighter settings to try again." : "Your test is paused. Restoring graphics with a lighter rendering budget."}</p><div class="dialog-buttons">${restored ? `<button class="primary-button wide" data-action="${inGame ? "close" : "home"}">${inGame ? "Resume test" : "Return to hangar"}</button>` : `<button class="${failed ? "primary-button" : "secondary-button"} wide" data-action="reload-graphics">Reload safely</button>`}</div>`,
      "graphics",
    );
  }
  graphicsReport(report) {
    this.modal(
      `<p class="eyebrow">FLIGHT SYSTEMS</p><h2 id="dialog-title">Graphics report</h2><p class="dialog-intro">Copy this report to help diagnose the problem. Nothing is sent automatically.</p><textarea class="graphics-report" aria-label="Graphics report" readonly></textarea><button class="primary-button wide" data-action="settings">Back to settings</button>`,
      "graphics-report",
    );
    const field = this.dialog.querySelector("textarea");
    field.value = report;
    field.focus();
    field.select();
  }
  result(s, level, best) {
    const win = s.outcome === "success",
      fly = s.outcome === "flyaway",
      beaten = s.outcome === "beaten";
    const winTitle = {
      garage: "Garage departed.<br>Mostly intact.",
      drag: "That was<br>unnecessary.",
      ramp: "Against all<br>expectations.",
      factory: "Five rings.<br>One whole car.",
    }[level.id] || "Test complete.";
    const finalTest = LEVELS.indexOf(level) === LEVELS.length - 1;
    const rivalResult = level.id === "drag" && s.rival
      ? `<p class="record">PORSCHE · ${s.rival.crashed ? "DID NOT FINISH" : s.rival.finishTime !== null ? `${s.rival.finishTime.toFixed(2)}s` : win ? "BEHIND YOU AT THE LINE" : "RACE UNFINISHED"}</p>`
      : "";
    this.modal(
      `<p class="eyebrow">TEST ${level.number} / ${win ? "COMPLETE" : "UNSCHEDULED CONCLUSION"}</p><h2 id="dialog-title">${win ? winTitle : beaten ? "Porsche takes it.<br>Try the rockets." : fly ? "We have lost<br>the vehicle." : s.damage >= 95 ? "Rapid unscheduled<br>disassembly." : "A bold interpretation<br>of landing."}</h2><p class="dialog-intro">${win ? (level.id === "factory" ? "Flight certification: surprisingly plausible." : level.id === "ramp" ? "You made gravity look optional." : "The test engineers are cautiously impressed.") : beaten ? "No extra points for conserving rocket fuel. Give it another run." : fly ? "The warranty does not cover low Earth orbit." : "The data is invaluable. The car, less so."}</p><div class="result-stats"><div><b>${s.time.toFixed(2)}<small>s</small></b><p>TEST TIME</p></div><div><b>${Math.round(s.maxSpeed * 3.6)}<small>km/h</small></b><p>TOP SPEED</p></div><div><b>${level.id === "factory" ? `${s.ringCount || 0}<small>/ ${s.ringGoal || 5}</small>` : `${s.maxAltitude.toFixed(1)}<small>m</small>`}</b><p>${level.id === "factory" ? "RINGS CLEARED" : "MAX ALTITUDE"}</p></div></div>${rivalResult}${best ? `<p class="record">PERSONAL BEST · ${best.toFixed(2)}s</p>` : ""}<div class="dialog-buttons"><button class="primary-button wide" data-action="${win ? "next" : "reset"}">${win ? (finalTest ? "Back to hangar" : "Next test") : "Try that again"} ${svg("arrow")}</button><button class="secondary-button" data-action="${win ? "reset" : "home"}">${win ? "Replay test" : "Return to hangar"}</button></div>`,
      "result",
    );
  }
  messageForInput(keyboard, touch, duration = 3200) {
    this.message(getControlMode() === "touch" ? touch : keyboard, duration);
    this.inputMessage = { keyboard, touch };
  }
  message(text, duration = 3200) {
    this.inputMessage = null;
    this.refs["game-message"].textContent = text;
    clearTimeout(this.messageTimeout);
    this.messageTimeout = setTimeout(
      () => {
        this.refs["game-message"].textContent = "";
        this.inputMessage = null;
      },
      duration,
    );
  }
  toast(text) {
    const el = document.querySelector("#toast");
    el.textContent = text;
    el.classList.add("visible");
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => el.classList.remove("visible"), 3000);
  }
  setMuted(muted) {
    document.querySelector("#audio-button").innerHTML = svg(
      muted ? "mute" : "sound",
    );
    document
      .querySelector("#audio-button")
      .setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
  }
}
