const GAME_KEYS = new Set([
  "KeyQ", "KeyW", "KeyO", "KeyP", "Space",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Escape", "KeyR", "KeyC", "KeyM",
]);

let mode;
let pendingKeyboard = false;
const activeTouches = new Set();
const listeners = new Set();

function setMode(next) {
  if (mode === next) return;
  mode = next;
  document.documentElement.dataset.input = next;
  for (const callback of listeners) callback(next);
}

function initialize() {
  if (mode) return;
  setMode(window.matchMedia?.("(pointer: coarse)").matches ? "touch" : "keyboard");

  // Screen width and a touchscreen's presence do not tell us how someone is
  // playing. Start with their primary pointer, then follow actual input.
  window.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    activeTouches.add(event.pointerId);
    pendingKeyboard = false;
    setMode("touch");
  }, true);

  const releaseTouch = (event) => {
    activeTouches.delete(event.pointerId);
    if (!activeTouches.size && pendingKeyboard) {
      pendingKeyboard = false;
      setMode("keyboard");
    }
  };
  window.addEventListener("pointerup", releaseTouch, true);
  window.addEventListener("pointercancel", releaseTouch, true);
  window.addEventListener("keydown", (event) => {
    if (event.repeat || !GAME_KEYS.has(event.code)) return;
    if (/INPUT|SELECT|TEXTAREA/.test(event.target?.tagName) || event.target?.isContentEditable) return;
    // Keyboard input still works while touching. Keep the controls under the
    // player's fingers until their final touch ends before changing layout.
    if (activeTouches.size) pendingKeyboard = true;
    else setMode("keyboard");
  }, true);

  const clearTouches = () => {
    activeTouches.clear();
    if (pendingKeyboard) {
      pendingKeyboard = false;
      setMode("keyboard");
    }
  };
  window.addEventListener("blur", clearTouches);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTouches();
  });
}

export function getControlMode() {
  initialize();
  return mode;
}

export function subscribeControlMode(callback) {
  initialize();
  listeners.add(callback);
  return () => listeners.delete(callback);
}
