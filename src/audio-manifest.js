// Generated audio ships as static files. No API calls or credentials reach players.
export const AUDIO_GROUPS = Object.freeze({
  effects: [
    "booster-loop",
    "booster-ignite",
    "booster-cut",
    "impact-light-1",
    "impact-light-2",
    "impact-heavy-1",
    "impact-heavy-2",
    "crunch",
    "glass",
    "explosion",
    "debris",
    "fire-loop",
  ],
  voices: [
    "pilot-oh-no",
    "pilot-scream",
    "pilot-controls",
    "pilot-insurance",
    "pilot-landing",
    "pilot-regret",
    "pilot-flip",
    "mission-start",
    "mission-fail",
    "mission-win",
  ],
  music: ["music-menu", "music-drive", "music-ramp"],
});

export const AUDIO_FILES = Object.freeze(
  Object.fromEntries(
    Object.values(AUDIO_GROUPS)
      .flat()
      .map((id) => [id, `/audio/${id}.mp3`]),
  ),
);
