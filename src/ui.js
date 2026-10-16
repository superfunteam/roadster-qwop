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
      "Four hundred metres. A very questionable power-to-weight ratio.",
    goal: "Cross the finish line. Wheels down is a nice touch.",
    hint: "Hold ↑ to drive. SPACE adds rear thrust. Use short jet bursts to stay level.",
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
    distance: "24 m high",
    time: "~ 15 sec",
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
export class UI {
  constructor(actions, settings) {
    this.actions = actions;
    this.settings = settings;
    this.selected = 0;
    this.lastOutcome = null;
    const isPlayer = document.documentElement.dataset.player === "true";
    const playerLink = isPlayer
      ? '<a class="player-full-link" href="https://roadster.superfun.games/" target="_blank" rel="noopener noreferrer">Open full game <span aria-hidden="true">↗</span></a>'
      : "";
    const playerGuide = isPlayer
      ? '<p class="player-controls-guide"><span>Hold <b>Q W O P</b> to lift each corner.</span><span><b>↑ ↓ ← →</b> drive · <b>SPACE</b> thrust · or hold the buttons.</span></p>'
      : "";
    document.querySelector("#app").innerHTML = `
      <header class="topbar"><a class="brand" href="#" aria-label="Back to hangar">${wordmark}</a>${playerLink}<div class="program">EXPERIMENTAL FLIGHT PROGRAM <i></i></div><nav class="top-actions" aria-label="Game settings"><button class="icon-button" id="install-button" hidden aria-label="Install game">${svg("install")}</button><button class="icon-button" data-action="help" aria-label="Flight manual">${svg("help")}</button><button class="icon-button" id="audio-button" data-action="mute" aria-label="Toggle sound">${svg(settings.muted ? "mute" : "sound")}</button><button class="icon-button" data-action="settings" aria-label="Settings">${svg("settings")}</button></nav></header>
      <section id="hangar" aria-label="Main menu">
        <div class="hero-copy"><p class="eyebrow">THE NEXT GENERATION</p><h1><img class="roadster-wordmark" src="/art/roadster-wordmark.svg" alt="Roadster" width="760" height="46" draggable="false" /></h1><p class="hero-tagline">But can it fly?</p></div>
        <div class="spec-rail"><div><b>04</b><p>INDEPENDENT<br>THRUSTERS</p></div><div><b>00</b><p>FLIGHT<br>ASSISTANCE</p></div><div><b>∞</b><p>POSSIBLE<br>REGRETS</p></div></div>
        <div class="hero-index"><i></i><p>FLIGHT PACKAGE<br><span>PROTOTYPE 001</span></p></div>
        <div class="orbit-hint">DRAG TO INSPECT <span>↔</span></div>
        <div class="mission-panel"><div class="mission-topline"><p class="eyebrow">SELECT YOUR TEST</p><p class="tiny">THREE TESTS. NO GUARANTEES.</p></div><div class="mission-layout"><div class="mission-grid" role="group" aria-label="Select a level">${LEVELS.map((level, i) => `<button class="mission ${i === 0 ? "selected" : ""}" data-level="${i}" aria-pressed="${i === 0}"><div class="mission-image image-${level.id}"><span>${level.number}</span><i>${i === 0 ? "SELECTED" : "AVAILABLE"}</i></div><div class="mission-info"><h2>${level.name}</h2><p>${level.tag}</p></div><div class="mission-line"></div></button>`).join("")}</div><div class="launch-panel"><div class="launch-description"><p id="selected-type" class="eyebrow">${LEVELS[0].difficulty}</p><p id="selected-description">${LEVELS[0].description}</p></div><button class="primary-button" data-action="start">Begin test ${svg("arrow")}</button><p class="launch-note">KEYBOARD + TOUCH SUPPORTED</p></div></div>${playerGuide}<footer class="hangar-footer"><p>ENGINEERED TO FLY. <span>OPERATED BY YOU.</span></p><p>SUPERFUN GAMES <span>© 2026</span></p></footer></div>
      </section>
      <section id="hud" hidden aria-label="Game controls and telemetry">
        <div class="hud-top"><div class="mission-title"><p class="eyebrow" id="hud-level-number">TEST 01 / ORIENTATION</p><h2 id="hud-level-name">The garage</h2><p id="hud-goal"></p></div><div class="hud-top-right"><div class="time-display"><p class="eyebrow">ELAPSED</p><div id="timer">00:00.00</div></div><button class="icon-button" data-action="pause" aria-label="Pause game">${svg("pause")}</button></div></div>
        <div class="progress-track"><i id="level-progress"></i></div>
        <div id="game-message" aria-live="polite"></div>
        <div class="telemetry"><div class="speed-readout"><b id="speed">0</b><p>KM/H</p></div><div class="telemetry-detail"><div><p>ALTITUDE</p><b id="altitude">0.0 <small>m</small></b></div><div><p>HULL</p><b id="hull">100<small>%</small></b></div></div></div>
        <div class="flight-status"><div class="status-dot"></div><p id="flight-status">GROUND CONTACT</p></div>
        <div class="booster-console"><div class="console-heading"><p>THRUSTER CONTROL</p><div><i id="pressure-fill"></i></div><p id="pressure-value">100%</p></div><div class="booster-row"><div class="jet-pair">${boosterControl("Q", "FRONT L", "front-l")}${boosterControl("W", "FRONT R", "front-r")}</div><div class="car-diagram" aria-hidden="true"><svg viewBox="0 0 60 115"><path d="m16 8 28 0 7 15v72l-6 13H15L9 95V23Z"/><path d="m16 28 28 0-4 25H20Zm4 52h20l5 15H15Z"/><path d="M6 27v17m48-17v17M6 76v17m48-17v17"/><path d="M30 1v11m-4-6 4-5 4 5"/></svg></div><div class="jet-pair">${boosterControl("O", "REAR L", "rear-l")}${boosterControl("P", "REAR R", "rear-r")}</div></div><button class="rear-boost" data-control="boost" aria-label="Hold rear thrust"><span class="space-key">SPACE</span><span>REAR THRUST</span><i></i></button></div>
        <div class="drive-controls"><p id="drive-label">GROUND DRIVE</p><div class="drive-up"><button data-control="throttle" aria-label="Accelerate">↑</button></div><div class="drive-row"><button data-control="left" aria-label="Steer left">←</button><button data-control="brake" aria-label="Brake or reverse">↓</button><button data-control="right" aria-label="Steer right">→</button></div></div>
        <div class="game-toolbar"><button data-action="reset" aria-label="Reset test">${svg("reset")}<span><kbd>R</kbd> Reset</span></button><button data-action="camera" aria-label="Change camera">${svg("camera")}<span><kbd>C</kbd> Camera</span></button><button data-action="fullscreen" aria-label="Toggle fullscreen">${svg("expand")}<span>Fullscreen</span></button></div>
        <p class="flight-tip" id="flight-tip"></p>
      </section>
      <div class="impact-vignette"></div>
      <div class="explosion-flash"></div>
      <div class="modal-backdrop" id="dialog" hidden><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button close-dialog" data-action="close" aria-label="Close dialog">${svg("close")}</button><div id="dialog-content"></div></section></div>
      <div id="toast" role="status"></div>
    `;
    document.addEventListener("click", (e) => {
      const action = e.target.closest("[data-action]");
      if (action) {
        this.actions(action.dataset.action);
        return;
      }
      const mission = e.target.closest("[data-level]");
      if (mission) this.select(+mission.dataset.level);
      if (e.target.closest(".brand")) {
        e.preventDefault();
        this.actions("home");
      }
    });
    this.dialog = document.querySelector("#dialog");
    this.dialog.addEventListener("click", (e) => {
      if (e.target === this.dialog) this.actions("close");
    });
    document.addEventListener("keydown", (e) => {
      if (!this.dialog.hidden && e.key === "Tab") {
        const els = [
          ...this.dialog.querySelectorAll("button,a,input,select"),
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
      ].map((id) => [id, document.getElementById(id)]),
    );
    this.jetButtons = [...document.querySelectorAll(".jet-button")];
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
    document.querySelector("#hud-level-number").textContent =
      `TEST ${level.number} / ${level.difficulty}`;
    document.querySelector("#hud-level-name").textContent = level.name;
    document.querySelector("#hud-goal").textContent = level.goal;
    this.refs["flight-tip"].textContent = level.hint;
    document.querySelector("#drive-label").textContent =
      level.id === "ramp" ? "AUTODRIVE ON" : "GROUND DRIVE";
    document
      .querySelector(".drive-controls")
      .classList.toggle("autodrive", level.id === "ramp");
    this.lastOutcome = null;
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
    const progress =
      level.id === "ramp"
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
    document
      .querySelector(".rear-boost")
      .style.setProperty("--throttle", s.rearBoost);
    document
      .querySelector(".flight-status")
      .classList.toggle("airborne", !s.grounded);
    document
      .querySelector(".flight-status")
      .classList.toggle("critical", s.damage > 65);
    this.recovery(s.recoveryRemaining);
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
      clearTimeout(this.messageTimeout);
      this.refs["game-message"].textContent = this.recoveryMessage;
    } else if (this.refs["game-message"].textContent === previousMessage) {
      this.refs["game-message"].textContent = "";
    }
  }
  modal(html, kind = "") {
    this.previousFocus = document.activeElement;
    this.dialog.dataset.kind = kind;
    document.querySelector("#dialog-content").innerHTML = html;
    this.dialog.hidden = false;
    this.dialog.querySelector(".dialog").scrollTop = 0;
    document.querySelector("#hangar").inert = true;
    document.querySelector("#hud").inert = true;
    document.querySelector(".topbar").inert = true;
    requestAnimationFrame(() => this.dialog.querySelector("button")?.focus());
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
      `<p class="eyebrow">OWNER’S MANUAL / FLIGHT PACKAGE</p><h2 id="dialog-title">A little thrust.<br>A lot of consequences.</h2><p class="dialog-intro">Each key fires one corner of the car. Hold to build thrust. Release before you think you should.</p><div class="manual-layout"><div class="manual-car"><div class="manual-pair"><kbd>Q</kbd><p>FRONT</p><kbd>W</kbd></div><svg viewBox="0 0 100 180" aria-hidden="true"><path d="M25 8h50l10 25v115l-9 22H24l-9-22V33Z"/><path d="m25 42 50 0-8 42H33Zm8 80h34l11 27H22Z"/></svg><div class="manual-pair"><kbd>O</kbd><p>REAR</p><kbd>P</kbd></div></div><div class="manual-list"><p><b>Q + W</b> Lift the nose. Pitch backward.</p><p><b>O + P</b> Lift the tail. Pitch forward.</p><p><b>Q + W + O + P</b> Lift off. Try to stay level.</p><p><b>SPACE</b> Fire the rear rockets.</p><p><b>↑ ↓ ← →</b> Drive, brake / reverse, steer.</p></div></div><div class="manual-footnote"><p>Tap opposing jets to catch a rotation. Pressure refills when you let go. On touchscreens, hold several controls at once.</p><p><kbd>R</kbd> Start over · <kbd>C</kbd> Camera · <kbd>ESC</kbd> Pause</p></div><button class="primary-button wide" data-action="close">Understood. Probably. ${svg("arrow")}</button>`,
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
      `<p class="eyebrow">VEHICLE PREFERENCES</p><h2 id="dialog-title">Make yourself<br>comfortable.</h2><div class="settings-list"><label>Sound <input id="setting-sound" type="checkbox" ${settings.muted ? "" : "checked"} /><span>All game audio</span></label><label>Music <input id="setting-music" type="checkbox" ${settings.music !== false ? "checked" : ""} /><span>The soundtrack to poor decisions</span></label><label>Pilot reactions <input id="setting-voices" type="checkbox" ${settings.voices !== false ? "checked" : ""} /><span>Panicked pilot & frantic mission control</span></label><label>Haptics <input id="setting-haptics" type="checkbox" ${settings.haptics ? "checked" : ""} /><span>Vibration on supported devices</span></label><label>Camera shake <input id="setting-shake" type="checkbox" ${settings.shake ? "checked" : ""} /><span>Feel the thrust and hard landings</span></label><label>Graphics <select id="setting-quality"><option value="high" ${settings.quality === "high" ? "selected" : ""}>High</option><option value="balanced" ${settings.quality === "balanced" ? "selected" : ""}>Balanced</option><option value="low" ${settings.quality === "low" ? "selected" : ""}>Performance</option></select><span>Reflections, shadows & resolution</span></label></div><button class="primary-button wide" data-action="save-settings">Ready for liftoff ${svg("arrow")}</button>`,
    );
  }
  result(s, level, best) {
    const win = s.outcome === "success",
      fly = s.outcome === "flyaway";
    this.modal(
      `<p class="eyebrow">TEST ${level.number} / ${win ? "COMPLETE" : "UNSCHEDULED CONCLUSION"}</p><h2 id="dialog-title">${win ? ["Garage departed.\nMostly intact.", "That was\nunnecessary.", "Against all\nexpectations."][LEVELS.indexOf(level)].replace("\n", "<br>") : fly ? "We have lost<br>the vehicle." : s.damage >= 95 ? "Rapid unscheduled<br>disassembly." : "A bold interpretation<br>of landing."}</h2><p class="dialog-intro">${win ? (level.id === "ramp" ? "You made gravity look optional." : "The test engineers are cautiously impressed.") : fly ? "The warranty does not cover low Earth orbit." : "The data is invaluable. The car, less so."}</p><div class="result-stats"><div><b>${s.time.toFixed(2)}<small>s</small></b><p>TEST TIME</p></div><div><b>${Math.round(s.maxSpeed * 3.6)}<small>km/h</small></b><p>TOP SPEED</p></div><div><b>${s.maxAltitude.toFixed(1)}<small>m</small></b><p>MAX ALTITUDE</p></div></div>${best ? `<p class="record">PERSONAL BEST · ${best.toFixed(2)}s</p>` : ""}<div class="dialog-buttons"><button class="primary-button wide" data-action="${win ? "next" : "reset"}">${win ? (level.id === "ramp" ? "Back to hangar" : "Next test") : "Try that again"} ${svg("arrow")}</button><button class="secondary-button" data-action="${win ? "reset" : "home"}">${win ? "Replay test" : "Return to hangar"}</button></div>`,
      "result",
    );
  }
  message(text, duration = 3200) {
    this.refs["game-message"].textContent = text;
    clearTimeout(this.messageTimeout);
    this.messageTimeout = setTimeout(
      () => (this.refs["game-message"].textContent = ""),
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
