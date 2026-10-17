import { WebGLRenderer } from "three";

const isBlockedStatus = (message) => /web\s+page\s+caused\s+context\s+loss\s+and\s+was\s+blocked/i.test(message || "");
const hasBlockedStatus = (attempts) => attempts.some((attempt) =>
  isBlockedStatus(attempt.error) || attempt.statusMessages.some(isBlockedStatus),
);

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
    <p data-startup-description>The browser could not open the game's graphics system. It may be temporarily unavailable after a graphics crash; this does not necessarily mean your device lacks WebGL 2.</p>
    <p data-startup-instructions>Try reloading with lighter settings. If it still cannot start, close other graphics-heavy tabs and reopen the browser. Some browsers or devices may not support the graphics this game needs.</p>
    <p data-startup-followup hidden></p>
    <div class="graphics-startup-actions"><button type="button" class="primary-button" data-startup-action="reload">Reload safely</button><button type="button" class="secondary-button" data-startup-action="report">Copy graphics report</button><a class="secondary-button" href="/graphics-check.html" target="_blank" rel="noopener">Open graphics check</a></div>
    <p class="graphics-startup-status" role="status" aria-live="polite"></p>
    <label class="graphics-startup-report" hidden>Graphics report<textarea readonly spellcheck="false" aria-label="Graphics report"></textarea></label>
  </section>`;
  const makeReport = () => JSON.stringify({
    date: new Date().toISOString(),
    build: __ROADSTER_BUILD__,
    browser: navigator.userAgent,
    webgl: "context creation failed",
    browserBlocked: hasBlockedStatus(attempts),
    contextStatus: attempts.map((attempt) => attempt.statusMessages),
    attempts,
  }, null, 2);
  const reloadButton = loading.querySelector('[data-startup-action="reload"]');
  const reportButton = loading.querySelector('[data-startup-action="report"]');
  reloadButton.addEventListener("click", () => {
    onSafeMode();
    location.reload();
  });
  reportButton.addEventListener("click", async () => {
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
  const update = () => {
    if (!hasBlockedStatus(attempts)) return;
    const chrome = /\b(?:Chrome|HeadlessChrome|CriOS)\//.test(navigator.userAgent) &&
      !/\b(?:Edg|EdgA|OPR|SamsungBrowser)\//.test(navigator.userAgent);
    loading.querySelector("#graphics-startup-title").textContent = chrome ? "Chrome blocked the graphics." : "The browser blocked graphics.";
    loading.querySelector("[data-startup-description]").textContent = `${chrome ? "Chrome" : "The browser"} refused a graphics context before the game could render. Compatibility mode is saved. This page cannot clear the browser’s block.`;
    loading.querySelector("[data-startup-instructions]").textContent = "Open the lightweight graphics check below. It tests one pixel without loading the car, levels or effects. It can help isolate the failure, but cannot guarantee the full game will run.";
    const followup = loading.querySelector("[data-startup-followup]");
    followup.hidden = false;
    followup.textContent = "If reloading or reopening the browser has not helped, share the graphics check report with the developer. Repeated reloads may not resolve the underlying graphics failure.";
    const moveFocus = document.activeElement === reloadButton;
    reloadButton.remove();
    reportButton.className = "primary-button";
    if (moveFocus) reportButton.focus();
    // A driver can report the block after the generic screen is already open.
    // Update the existing field without replacing the dialog or stealing focus.
    const label = loading.querySelector(".graphics-startup-report");
    if (!label.hidden) {
      const field = label.querySelector("textarea");
      const start = field.selectionStart, end = field.selectionEnd;
      const selectedAll = start === 0 && end === field.value.length;
      field.value = makeReport();
      field.setSelectionRange(selectedAll ? 0 : start, selectedAll ? field.value.length : end);
    }
  };
  update();
  loading.querySelector(".graphics-startup-panel").focus();
  return { update };
}

/** Retry context creation once with a fresh canvas and conservative attributes. */
export function createGameRenderer(settings = {}, { mobile = false, onSafeMode = () => {} } = {}) {
  const attempts = [];
  let lastError, failureUI;
  let blocked = false, safeRequested = false;
  const requestSafeMode = () => {
    if (safeRequested) return;
    safeRequested = true;
    onSafeMode();
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) requestSafeMode();
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
      if (isBlockedStatus(event.statusMessage)) {
        blocked = true;
        requestSafeMode();
      }
      failureUI?.update();
    };
    canvas.addEventListener("webglcontextcreationerror", captureStatus);
    try {
      const renderer = new WebGLRenderer({ canvas, ...attributes });
      canvas.removeEventListener("webglcontextcreationerror", captureStatus);
      return renderer;
    } catch (error) {
      lastError = error;
      attempts.push({ attributes, error: String(error?.message || error), statusMessages });
      if (blocked || isBlockedStatus(error?.message)) {
        requestSafeMode();
        break;
      }
      // Some drivers queue their creation-error events. Failed detached
      // canvases can still fill the report after getContext has returned.
    }
  }
  failureUI = showStartupFailure(attempts, requestSafeMode);
  const error = new Error("The graphics system could not create a WebGL 2 context.", { cause: lastError });
  error.graphicsUnavailable = true;
  throw error;
}
