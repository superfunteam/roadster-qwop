const ACTIVE_KEY = "roadster-graphics-active";

/**
 * Best-effort detection of an interrupted visible tab. A GPU/process crash can
 * leave sessionStorage intact without delivering pagehide; normal navigation
 * and reload clear the marker. Hidden-tab crashes cannot be detected this way.
 */
export function startGraphicsSession(onInterrupted = () => {}) {
  let interrupted = false;
  try {
    interrupted = sessionStorage.getItem(ACTIVE_KEY) === "1";
  } catch {}
  if (interrupted) onInterrupted();

  let leaving = false;
  const mark = (active) => {
    try {
      if (active) sessionStorage.setItem(ACTIVE_KEY, "1");
      else sessionStorage.removeItem(ACTIVE_KEY);
    } catch {}
  };
  const visibility = () => mark(!leaving && document.visibilityState === "visible");
  const pagehide = () => {
    leaving = true;
    mark(false);
  };
  const pageshow = () => {
    leaving = false;
    visibility();
  };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", pagehide);
  window.addEventListener("pageshow", pageshow);
  visibility();

  return () => {
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", pagehide);
    window.removeEventListener("pageshow", pageshow);
    mark(false);
  };
}
