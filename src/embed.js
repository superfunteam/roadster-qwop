// The player is a standalone document: it never needs to inspect or message
// its host, including when the host gives it an opaque sandboxed origin.
export const isPlayer = /^\/player(?:\/|$)/.test(location.pathname);
export const isFramed = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const viewport = { width: 1, height: 1, bottomInset: 0 };

export function refreshGameViewport() {
  // Browser toolbars change the visible height on phones without always
  // changing the layout viewport. Keep the HUD and renderer on the same box.
  const visual = window.visualViewport;
  const width = Math.max(1, Math.round(visual?.width || window.innerWidth));
  const fullHeight = Math.max(
    1,
    Math.round(visual?.height || window.innerHeight),
  );
  const touch =
    matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  // X's mobile media sheet can cover the lower part of a top-level player.
  // An actual iframe already has an allocated viewport, so do not shrink it.
  const bottomInset =
    isPlayer && !isFramed && touch && fullHeight > width
      ? Math.round(fullHeight * 0.3)
      : 0;
  Object.assign(viewport, {
    width,
    height: fullHeight - bottomInset,
    bottomInset,
  });
  document.documentElement.style.setProperty(
    "--game-height",
    `${viewport.height}px`,
  );
  document.documentElement.style.setProperty(
    "--player-bottom-inset",
    `${bottomInset}px`,
  );
  return viewport;
}

export function getGameViewport() {
  return viewport;
}

if (isPlayer) document.documentElement.dataset.player = "true";
document.documentElement.dataset.framed = String(isFramed);
refreshGameViewport();
