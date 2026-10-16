import { isPlayer, isFramed } from "./embed.js";

let installPrompt = null;
let initialized = false;

export function getInstallInfo() {
  const ua = navigator.userAgent;
  const ios =
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const safari =
    /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|Android/.test(ua);
  const standalone =
    matchMedia("(display-mode: standalone)").matches ||
    matchMedia("(display-mode: fullscreen)").matches ||
    navigator.standalone === true;
  return {
    platform: ios ? "ios" : safari ? "safari" : "browser",
    standalone,
    canPrompt: Boolean(installPrompt),
    title: "Take flight from your home screen.",
    instructions: ios
      ? "Open this game in Safari, tap Share, then Add to Home Screen. Turn on Open as Web App and tap Add."
      : safari
        ? "In Safari, choose File → Add to Dock, then click Add. Roadster opens in its own window."
        : "Open your browser menu and choose Install Roadster or Install this page as an app. Installation is available in supported browsers.",
  };
}

/**
 * Registers production-only offline support and wires #install-button.
 * When native install UI is unavailable, window receives an `install-help`
 * CustomEvent with {platform, title, instructions}. The main UI owns its dialog.
 * `pwa-ready` announces that every built game asset is cached for offline play.
 */
export function setupPWA({
  button = document.getElementById("install-button"),
} = {}) {
  if (initialized) return;
  initialized = true;

  // Install prompts and service workers belong to the full game. Even reading
  // these APIs can throw in an opaque sandbox or with browser storage blocked.
  let storageAvailable = false;
  if (!isPlayer && !isFramed) {
    try {
      window.localStorage.getItem("roadster-settings");
      storageAvailable = true;
    } catch {}
  }
  if (isPlayer || isFramed || !storageAvailable) {
    if (button) button.hidden = true;
    return;
  }

  function refreshButton() {
    const info = getInstallInfo();
    document.documentElement.dataset.installed = info.standalone
      ? "true"
      : "false";
    if (!button) return;
    button.hidden = info.standalone;
    button.disabled = false;
    button.setAttribute("aria-label", "Install Roadster on this device");
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    refreshButton();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    if (button) button.hidden = true;
    document.documentElement.dataset.installed = "true";
    window.dispatchEvent(new CustomEvent("pwa-installed"));
  });
  matchMedia("(display-mode: standalone)").addEventListener?.(
    "change",
    refreshButton,
  );
  button?.addEventListener("click", async () => {
    if (installPrompt) {
      const prompt = installPrompt;
      installPrompt = null;
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice.outcome === "accepted" && button) button.hidden = true;
      } catch {
        window.dispatchEvent(
          new CustomEvent("install-help", { detail: getInstallInfo() }),
        );
      }
    } else {
      window.dispatchEvent(
        new CustomEvent("install-help", { detail: getInstallInfo() }),
      );
    }
  });
  refreshButton();

  let serviceWorker;
  try {
    serviceWorker = navigator.serviceWorker;
  } catch {
    return;
  }
  if (!serviceWorker || !window.isSecureContext) return;

  if (import.meta.env.DEV) {
    // Development must never be served stale bundled JavaScript by a previous
    // production preview on the same origin.
    serviceWorker
      .getRegistrations()
      .then(async (registrations) => {
        for (const registration of registrations) {
          const script =
            registration.active?.scriptURL || registration.waiting?.scriptURL;
          if (script === new URL("/sw.js", location.origin).href)
            await registration.unregister();
        }
        for (const key of await caches.keys())
          if (key.startsWith("roadster-flight-test-")) await caches.delete(key);
      })
      .catch(() => {});
    return;
  }

  async function register() {
    try {
      await serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      await serviceWorker.ready;
      window.dispatchEvent(new CustomEvent("pwa-ready"));
    } catch (error) {
      // Installation and game play remain available when storage is restricted.
      console.info(
        "Offline game caching is unavailable in this browser.",
        error,
      );
    }
  }
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
