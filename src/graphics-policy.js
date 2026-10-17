const PROFILES = {
  mobile: {
    high: { pixelBudget: 800_000, dpr: 1.5, shadowSize: 1024 },
    balanced: { pixelBudget: 600_000, dpr: 1.25, shadowSize: 1024 },
    low: { pixelBudget: 450_000, dpr: 1, shadowSize: 0 },
  },
  desktop: {
    high: { pixelBudget: 2_300_000, dpr: 1.75, shadowSize: 2048 },
    balanced: { pixelBudget: 1_600_000, dpr: 1.25, shadowSize: 1024 },
    low: { pixelBudget: 900_000, dpr: 1, shadowSize: 0 },
  },
};
const ADAPTIVE_SCALES = [1, 0.85, 0.7, 0.6];
const positive = (value, fallback) =>
  Number.isFinite(value) && value > 0 ? value : fallback;

// Render size is independent of CSS size. In particular, a high-DPI phone does
// not acquire a desktop-sized HDR pipeline just because its screen is sharp.
export function graphicsPlan({
  quality = "balanced",
  width = 1,
  height = 1,
  devicePixelRatio = 1,
  mobile = false,
  safeMode = false,
  floatSupported = true,
  adaptiveStep = 0,
  maxWidth = 4096,
  maxHeight = 4096,
} = {}) {
  quality = Object.hasOwn(PROFILES.desktop, quality) ? quality : "balanced";
  width = Math.max(1, Math.round(positive(width, 1)));
  height = Math.max(1, Math.round(positive(height, 1)));
  adaptiveStep = Math.min(3, Math.max(0, Math.floor(adaptiveStep) || 0));
  const profile = PROFILES[mobile ? "mobile" : "desktop"][quality];
  const pixelBudget = safeMode ? Math.min(profile.pixelBudget, 450_000) : profile.pixelBudget;
  const scale = ADAPTIVE_SCALES[adaptiveStep];
  const pixelRatio = Math.min(
    positive(devicePixelRatio, 1),
    safeMode ? 1 : profile.dpr,
    Math.sqrt(pixelBudget / (width * height)),
    positive(maxWidth, 4096) / width,
    positive(maxHeight, 4096) / height,
  ) * scale;
  const renderWidth = Math.max(1, Math.floor(width * pixelRatio));
  const renderHeight = Math.max(1, Math.floor(height * pixelRatio));
  const postprocessing = !mobile && !safeMode && floatSupported && quality !== "low" && adaptiveStep < 3;
  const shadowSize = !profile.shadowSize ? 0 : safeMode ? 512 :
    adaptiveStep >= 2 ? Math.min(profile.shadowSize, 1024) : profile.shadowSize;
  return {
    quality, mobile: Boolean(mobile), safeMode: Boolean(safeMode),
    width, height, pixelRatio, renderWidth, renderHeight,
    pixelCount: renderWidth * renderHeight, pixelBudget, adaptiveStep,
    postprocessing, ambientOcclusion: postprocessing && quality === "high" && adaptiveStep < 2,
    bloom: postprocessing, shadows: shadowSize > 0, shadowSize,
  };
}

// Two slow three-second windows must agree before reducing resolution. Ignore
// startup compilation and tab-switch stalls; never bounce resolution up/down.
export class AdaptiveResolution {
  constructor() { this.reset(); }

  reset() {
    this.step = 0;
    this.elapsed = 0;
    this.nextSampleAt = 4000;
    this.windowTime = 0;
    this.frames = 0;
    this.slowWindows = 0;
    this.longFrameStreak = 0;
  }

  observe(frameMs) {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || this.step >= 3) return false;
    if (frameMs > 250) {
      // One loading/tab-switch stall is not evidence of a slow GPU. Three
      // consecutive long frames are: count them conservatively so a severely
      // overloaded device can still recover instead of being ignored forever.
      if (++this.longFrameStreak < 3) return false;
      frameMs = 250;
    } else this.longFrameStreak = 0;
    this.elapsed += frameMs;
    if (this.elapsed < this.nextSampleAt) return false;
    this.windowTime += frameMs;
    this.frames++;
    if (this.windowTime < 3000) return false;
    const slow = this.windowTime / this.frames > 1000 / 42;
    this.slowWindows = slow ? this.slowWindows + 1 : 0;
    this.windowTime = 0;
    this.frames = 0;
    if (this.slowWindows < 2) return false;
    this.step++;
    this.slowWindows = 0;
    this.nextSampleAt = this.elapsed + 8000;
    return true;
  }
}
