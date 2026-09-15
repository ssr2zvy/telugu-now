export interface PrecisionMode {
  surface: 'closed' | 'controls' | 'magnifier';
  playback: 'closed' | 'controls' | 'speed';
}
export type PrecisionAction = 'open' | 'close' | 'toggle-visibility' | 'toggle-controls' | 'toggle-speed' | 'close-speed';
export const CLOSED_PRECISION_MODE: PrecisionMode = { surface: 'closed', playback: 'closed' };

export function precisionControls(mode: PrecisionMode, action: PrecisionAction): PrecisionMode {
  switch (action) {
    case 'open': return { ...mode, surface: 'magnifier' };
    case 'close': return CLOSED_PRECISION_MODE;
    case 'toggle-visibility': return mode.surface === 'closed'
      ? { surface: 'controls', playback: 'closed' }
      : CLOSED_PRECISION_MODE;
    case 'toggle-controls': return mode.surface === 'closed' ? mode : {
      ...mode,
      playback: mode.playback === 'closed' ? 'controls' : 'closed',
    };
    case 'toggle-speed': return mode.playback === 'controls'
      ? { ...mode, playback: 'speed' }
      : mode.playback === 'speed' ? { ...mode, playback: 'controls' } : mode;
    case 'close-speed': return mode.playback === 'speed' ? { ...mode, playback: 'controls' } : mode;
  }
}
