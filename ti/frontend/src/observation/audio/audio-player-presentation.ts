export const AUDIO_PLAYER_PRESENTATION = {
  // Keep in sync with server/src/services/audio-settings-service.ts bounds.
  playbackRateMin: 0.3,
  playbackRateMax: 2.5,
  playbackRateStep: 0.05,
  // Milliseconds a press must be held before the precision magnifier engages.
  magnifierHoldMs: 300,
  // The magnifier zooms into a window this fraction of the total duration,
  // clamped to a sensible absolute range regardless of clip length.
  magnifierWindowFraction: 0.02,
  magnifierWindowMinSeconds: 0.5,
  magnifierWindowMaxSeconds: 4,
  magnifierWidthPx: 260,
  // A run of clicks on the bookmark button is only resolved once no further
  // click arrives within this window.
  bookmarkClickWindowMs: 220,
} as const;
