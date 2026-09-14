// 'controls' shows the bookmark/loop/speed transport buttons on their own; the
// magnifier always implies those buttons as well.
export type PrecisionMode = 'closed' | 'controls' | 'magnifier' | 'speed';
export type PrecisionAction = 'open' | 'close' | 'toggle-controls' | 'toggle-speed' | 'close-speed';

export function precisionControls(mode: PrecisionMode, action: PrecisionAction): PrecisionMode {
  switch (action) {
    case 'open': return 'magnifier';
    case 'close': return 'closed';
    // A middle double tap opens the three controls, and closes the magnifier
    // together with them when anything is already open.
    case 'toggle-controls': return mode === 'closed' ? 'controls' : 'closed';
    case 'toggle-speed': return mode === 'closed' ? 'closed' : mode === 'speed' ? 'magnifier' : 'speed';
    case 'close-speed': return mode === 'speed' ? 'magnifier' : mode;
  }
}

export function precisionControlsVisible(mode: PrecisionMode): boolean {
  return mode !== 'closed';
}

export function precisionMagnifierVisible(mode: PrecisionMode): boolean {
  return mode === 'magnifier' || mode === 'speed';
}
