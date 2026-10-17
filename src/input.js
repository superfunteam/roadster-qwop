import { getControlMode } from "./control-mode.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const axisWithDeadzone = (value) =>
  Math.abs(value) <= 0.15 ? 0 : Math.sign(value) * (Math.abs(value) - 0.15) / 0.85;
const controlKeys = {
  throttle: "ArrowUp", brake: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", boost: "Space",
};

export class Input {
  constructor({ onAction = () => {} } = {}) {
    getControlMode();
    this.keys = new Set();
    this.blockedKeys = new Set();
    this.pointers = new Map();
    this.padPointers = new Map();
    this.captureTargets = new Map();
    this.boundElements = new WeakSet();
    this.controlElements = new Set();
    this.onAction = onAction;
    this.enabled = false;
    this.down = (e) => {
      const key = e.code;
      if (key === "Escape" && !e.repeat) {
        onAction("pause");
        return;
      }
      if (
        /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) ||
        e.target.isContentEditable
      )
        return;
      // A reset or pause releases a held control. OS key-repeat must not
      // silently arm it again; a fresh press (or keyup) clears the latch.
      if (!e.repeat) this.blockedKeys.delete(key);
      if (this.blockedKeys.has(key)) return;
      if (
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          key,
        ) &&
        this.enabled
      )
        e.preventDefault();
      if (!e.repeat) {
        if (key === "KeyR") onAction("reset");
        if (key === "KeyC" && this.enabled) onAction("camera");
        if (key === "KeyM") onAction("mute");
      }
      this.keys.add(key);
      this.syncControls();
    };
    this.up = (e) => {
      this.keys.delete(e.code);
      this.blockedKeys.delete(e.code);
      this.syncControls();
    };
    window.addEventListener("keydown", this.down);
    window.addEventListener("keyup", this.up);
    window.addEventListener("blur", () => {
      this.clear();
      onAction("blur");
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.clear();
        onAction("blur");
      }
    });
    // Capture can be unavailable in restricted webviews. A release anywhere
    // in this document must still stop the corresponding booster.
    window.addEventListener("pointerup", (e) =>
      this.releasePointer(e.pointerId),
    );
    window.addEventListener("pointercancel", (e) =>
      this.releasePointer(e.pointerId),
    );
    window.addEventListener("pointermove", (e) => {
      const pad = this.padPointers.get(e.pointerId);
      if (!pad) return;
      if (!this.enabled) {
        this.releasePointer(e.pointerId);
        return;
      }
      e.preventDefault();
      this.updatePad(pad, e);
    }, { passive: false });
  }
  get enabled() { return this._enabled; }
  set enabled(value) {
    this._enabled = Boolean(value);
    this.syncControls();
  }
  syncControl(element) {
    const key = controlKeys[element.dataset.control];
    const keyboardHeld = key && this.keys.has(key) && !this.blockedKeys.has(key);
    // A pointer belongs to its particular button; keyboard input lights every
    // presentation of that control, including the duplicate mobile boost pad.
    const pointerHeld = [...this.captureTargets.values()].includes(element);
    element.classList.toggle("held", this.enabled && Boolean(keyboardHeld || pointerHeld));
  }
  syncControls() {
    for (const element of this.controlElements) this.syncControl(element);
  }
  releasePointer(pointerId) {
    const target = this.captureTargets.get(pointerId);
    const pad = this.padPointers.get(pointerId);
    this.pointers.delete(pointerId);
    this.padPointers.delete(pointerId);
    this.captureTargets.delete(pointerId);
    if (target?.dataset.control) this.syncControl(target);
    else if (target && ![...this.captureTargets.values()].includes(target))
      target.classList.remove("held");
    if (pad) this.syncPad(pad.element);
    try {
      if (target?.hasPointerCapture?.(pointerId))
        target.releasePointerCapture(pointerId);
    } catch {}
  }
  bind(container = document) {
    container.querySelectorAll("[data-control]").forEach((el) => {
      if (this.boundElements.has(el)) return;
      this.boundElements.add(el);
      this.controlElements.add(el);
      this.syncControl(el);
      el.addEventListener("pointerdown", (e) => {
        if (!this.enabled || (e.pointerType === "mouse" && e.button !== 0))
          return;
        e.preventDefault();
        document
          .querySelector("#game-canvas canvas")
          ?.focus({ preventScroll: true });
        try {
          el.setPointerCapture?.(e.pointerId);
        } catch {}
        this.pointers.set(e.pointerId, el.dataset.control);
        this.captureTargets.set(e.pointerId, el);
        this.syncControl(el);
      });
      const release = (e) => this.releasePointer(e.pointerId);
      el.addEventListener("pointerup", release);
      el.addEventListener("pointercancel", release);
      el.addEventListener("lostpointercapture", release);
      el.addEventListener("contextmenu", (e) => e.preventDefault());
    });
    container.querySelectorAll("[data-touch-pad]").forEach((el) => {
      if (this.boundElements.has(el)) return;
      this.boundElements.add(el);
      el.addEventListener("pointerdown", (e) => {
        if (!this.enabled || (e.pointerType === "mouse" && e.button !== 0)) return;
        const kind = el.dataset.touchPad;
        if (kind !== "drive" && kind !== "flight") return;
        e.preventDefault();
        // A drive stick belongs to one thumb. Another finger can still operate
        // the flight grid or rear rocket without stealing that stick.
        if (kind === "drive" && [...this.padPointers.values()].some((pad) => pad.element === el)) return;
        document.querySelector("#game-canvas canvas")?.focus({ preventScroll: true });
        try {
          el.setPointerCapture?.(e.pointerId);
        } catch {}
        const pad = { kind, element: el, x: 0, y: 0, jets: "" };
        this.pointers.set(e.pointerId, kind);
        this.padPointers.set(e.pointerId, pad);
        this.captureTargets.set(e.pointerId, el);
        this.updatePad(pad, e);
      });
      const release = (e) => this.releasePointer(e.pointerId);
      el.addEventListener("pointerup", release);
      el.addEventListener("pointercancel", release);
      el.addEventListener("lostpointercapture", release);
      el.addEventListener("contextmenu", (e) => e.preventDefault());
    });
  }
  updatePad(pad, event) {
    const bounds = pad.element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (pad.kind === "drive") {
      pad.x = clamp((x - bounds.width / 2) / (bounds.width * 0.42), -1, 1);
      pad.y = clamp((y - bounds.height / 2) / (bounds.height * 0.42), -1, 1);
    } else {
      const outside = x < -12 || y < -12 || x > bounds.width + 12 || y > bounds.height + 12;
      const column = clamp(Math.floor(x / bounds.width * 3), 0, 2);
      const row = clamp(Math.floor(y / bounds.height * 3), 0, 2);
      const cell = pad.element.querySelectorAll("[data-jets]")[row * 3 + column];
      pad.jets = outside ? "" : (cell?.dataset.jets || "");
    }
    this.syncPad(pad.element);
  }
  syncPad(element) {
    const held = [...this.padPointers.values()].filter((pad) => pad.element === element);
    element.classList.toggle("held", held.length > 0);
    if (element.dataset.touchPad === "drive") {
      const bounds = element.getBoundingClientRect();
      const pad = held[0];
      // Leave room for the thumb cap inside the pad, even at full steering.
      element.style.setProperty("--stick-x", `${(pad?.x || 0) * bounds.width * 0.28}px`);
      element.style.setProperty("--stick-y", `${(pad?.y || 0) * bounds.height * 0.28}px`);
    } else {
      const selected = new Set(held.map((pad) => pad.jets));
      element.querySelectorAll("[data-jets]").forEach((cell) => {
        const active = selected.has(cell.dataset.jets);
        cell.classList.toggle("active", active);
        cell.setAttribute("aria-pressed", String(active));
      });
    }
  }
  held(key, control) {
    return this.keys.has(key) || [...this.pointers.values()].includes(control) ||
      [...this.padPointers.values()].some((pad) => pad.kind === "flight" && pad.jets.includes(control));
  }
  get state() {
    if (!this.enabled) return {};
    const drive = [...this.padPointers.values()].find((pad) => pad.kind === "drive");
    const x = axisWithDeadzone(drive?.x || 0);
    const y = axisWithDeadzone(drive?.y || 0);
    return {
      q: +this.held("KeyQ", "q"),
      w: +this.held("KeyW", "w"),
      o: +this.held("KeyO", "o"),
      p: +this.held("KeyP", "p"),
      throttle: Math.max(+this.held("ArrowUp", "throttle"), -y),
      brake: Math.max(+this.held("ArrowDown", "brake"), y),
      steer: clamp(+this.held("ArrowRight", "right") - this.held("ArrowLeft", "left") + x, -1, 1),
      boost: +this.held("Space", "boost"),
    };
  }
  clear() {
    for (const key of this.keys) this.blockedKeys.add(key);
    this.keys.clear();
    for (const pointerId of this.pointers.keys())
      this.releasePointer(pointerId);
    this.pointers.clear();
    this.padPointers.clear();
    this.captureTargets.clear();
    document
      .querySelectorAll(".held")
      .forEach((e) => e.classList.remove("held"));
  }
}
