import { WebGLRenderer } from "three";

function showStartupFailure(attempts, onSafeMode) {
  let loading = document.querySelector("#loading");
  if (!loading) {
    loading = document.createElement("div");
    loading.id = "loading";
    document.body.append(loading);
  }
  loading.classList.remove("done");
  loading.classList.add("graphics-startup-failure");
  loading.innerHTML = `<section class="graphics-startup-panel" role="alert" aria-labelledby="graphics-startup-title" tabindex="-1">
    <p class="eyebrow">FLIGHT SYSTEMS</p>
    <h2 id="graphics-startup-title">Graphics could not start.</h2>
    <p>The browser could not open the game's graphics system. It may be temporarily unavailable after a graphics crash; this does not necessarily mean your device lacks WebGL 2.</p>
    <p>Try reloading with lighter settings. If it still cannot start, close other graphics-heavy tabs and reopen the browser. Some browsers or devices may not support the graphics this game needs.</p>
    <div class="graphics-startup-actions"><button type="button" class="primary-button" data-startup-action="reload">Reload safely</button><button type="button" class="secondary-button" data-startup-action="report">Copy graphics report</button></div>
    <p class="graphics-startup-status" role="status" aria-live="polite"></p>
    <label class="graphics-startup-report" hidden>Graphics report<textarea readonly spellcheck="false" aria-label="Graphics report"></textarea></label>
  </section>`;
  const makeReport = () => JSON.stringify({
    date: new Date().toISOString(),
    browser: navigator.userAgent,
    webgl: "context creation failed",
    contextStatus: attempts.map((attempt) => attempt.statusMessages),
    attempts,
  }, null, 2);
  loading.querySelector('[data-startup-action="reload"]').addEventListener("click", () => {
    onSafeMode();
    location.reload();
  });
  loading.querySelector('[data-startup-action="report"]').addEventListener("click", async () => {
    const report = makeReport();
    const status = loading.querySelector(".graphics-startup-status");
    try {
      await navigator.clipboard.writeText(report);
      status.textContent = "Graphics report copied. Share it with the developer.";
    } catch {
      const label = loading.querySelector(".graphics-startup-report");
      const field = label.querySelector("textarea");
      label.hidden = false;
      field.value = report;
      field.focus();
      field.select();
      status.textContent = "Select and copy the report below. Nothing is sent automatically.";
    }
  });
  loading.querySelector(".graphics-startup-panel").focus();
}

/** Retry context creation once with a fresh canvas and conservative attributes. */
export function createGameRenderer(settings = {}, { mobile = false, onSafeMode = () => {} } = {}) {
  const attempts = [];
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) onSafeMode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const attributes = {
      antialias: attempt === 0 && mobile && !settings.safeGraphics,
      powerPreference: attempt === 1 || mobile ? "default" : "high-performance",
      alpha: false,
    };
    const statusMessages = [];
    const captureStatus = (event) => {
      if (event.statusMessage) statusMessages.push(event.statusMessage);
    };
    canvas.addEventListener("webglcontextcreationerror", captureStatus, { once: true });
    try {
      const renderer = new WebGLRenderer({ canvas, ...attributes });
      canvas.removeEventListener("webglcontextcreationerror", captureStatus);
      return renderer;
    } catch (error) {
      lastError = error;
      attempts.push({ attributes, error: String(error?.message || error), statusMessages });
      // Some drivers queue their creation-error event. The one-shot listener
      // can still fill this attempt's report after getContext has returned.
    }
  }
  showStartupFailure(attempts, onSafeMode);
  const error = new Error("The graphics system could not create a WebGL 2 context.", { cause: lastError });
  error.graphicsUnavailable = true;
  throw error;
}
