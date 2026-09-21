import { AUDIO_PLAYBACK_RATE_MIN, AUDIO_PLAYBACK_RATE_MAX } from '../../../../shared/audio';

export const AUDIO_PLAYER_PRESENTATION = {
  playbackRateMin: AUDIO_PLAYBACK_RATE_MIN,
  playbackRateMax: AUDIO_PLAYBACK_RATE_MAX,
  playbackRateStep: 0.05,
  controlsSlideMs: 320,
  // Milliseconds a press must be held before the precision magnifier engages.
  magnifierHoldMs: 300,
  magnifierPressureThreshold: 0.75,
  // Fixed one-second window is owned by magnifier-waveform.ts.
  magnifierWidthPx: 260,
  // A run of clicks on the bookmark button is only resolved once no further
  // click arrives within this window.
  bookmarkClickWindowMs: 220,
  loopClickWindowMs: 220,
} as const;
