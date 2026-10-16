export class Input {
  constructor({ onAction = () => {} } = {}) {
    this.keys = new Set();
    this.blockedKeys = new Set();
    this.pointers = new Map();
    this.captureTargets = new Map();
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
    };
    this.up = (e) => {
      this.keys.delete(e.code);
      this.blockedKeys.delete(e.code);
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
  }
  releasePointer(pointerId) {
    const control = this.pointers.get(pointerId);
    const target = this.captureTargets.get(pointerId);
    this.pointers.delete(pointerId);
    this.captureTargets.delete(pointerId);
    if (target && ![...this.pointers.values()].includes(control))
      target.classList.remove("held");
    try {
      if (target?.hasPointerCapture?.(pointerId))
        target.releasePointerCapture(pointerId);
    } catch {}
  }
  bind(container = document) {
    container.querySelectorAll("[data-control]").forEach((el) => {
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
        el.classList.add("held");
      });
      const release = (e) => this.releasePointer(e.pointerId);
      el.addEventListener("pointerup", release);
      el.addEventListener("pointercancel", release);
      el.addEventListener("lostpointercapture", release);
      el.addEventListener("contextmenu", (e) => e.preventDefault());
    });
  }
  held(key, control) {
    return this.keys.has(key) || [...this.pointers.values()].includes(control);
  }
  get state() {
    if (!this.enabled) return {};
    return {
      q: +this.held("KeyQ", "q"),
      w: +this.held("KeyW", "w"),
      o: +this.held("KeyO", "o"),
      p: +this.held("KeyP", "p"),
      throttle: +this.held("ArrowUp", "throttle"),
      brake: +this.held("ArrowDown", "brake"),
      steer: +this.held("ArrowRight", "right") - this.held("ArrowLeft", "left"),
      boost: +this.held("Space", "boost"),
    };
  }
  clear() {
    for (const key of this.keys) this.blockedKeys.add(key);
    this.keys.clear();
    for (const pointerId of this.pointers.keys())
      this.releasePointer(pointerId);
    this.pointers.clear();
    this.captureTargets.clear();
    document
      .querySelectorAll(".held")
      .forEach((e) => e.classList.remove("held"));
  }
}
