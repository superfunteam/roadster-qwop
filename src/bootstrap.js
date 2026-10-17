import "./style.css";
import "./viewport.css";
import "./responsive-menus.css";
import "./responsive-controls.css";
import "./embed.css";
import "./touch-controls.css";
import "./graphics-startup.css";

// A context-creation failure already has an actionable recovery screen. Keep
// that expected failure out of the browser's uncaught-error page overlay.
import("./main.js").catch((error) => {
  if (error?.graphicsUnavailable) return;
  console.error("Roadster startup failed", error);
  let loading = document.querySelector("#loading");
  if (!loading) {
    loading = document.createElement("div");
    loading.id = "loading";
    document.body.append(loading);
  }
  loading.classList.remove("done");
  loading.classList.add("graphics-startup-failure");
  loading.innerHTML = `<section class="graphics-startup-panel" role="alert" aria-labelledby="graphics-startup-title" tabindex="-1"><p class="eyebrow">FLIGHT SYSTEMS</p><h2 id="graphics-startup-title">The game could not start.</h2><p>Something interrupted loading. Reload the game to try again.</p><button type="button" class="primary-button">Reload game</button></section>`;
  loading.querySelector("button").addEventListener("click", () => location.reload());
  loading.querySelector("section").focus();
});
