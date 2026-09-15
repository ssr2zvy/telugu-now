export type PrecisionMode = 'closed' | 'magnifier' | 'controls' | 'speed';
export type PrecisionAction = 'open' | 'close' | 'toggle-controls' | 'toggle-speed' | 'close-speed';

export function precisionControls(mode: PrecisionMode, action: PrecisionAction): PrecisionMode {
  switch (action) {
    case 'open': return 'magnifier';
    case 'close': return 'closed';
    case 'toggle-controls': return mode === 'closed' ? 'closed' : mode === 'magnifier' ? 'controls' : 'magnifier';
    case 'toggle-speed': return mode === 'controls' ? 'speed' : mode === 'speed' ? 'controls' : mode;
    case 'close-speed': return mode === 'speed' ? 'controls' : mode;
  }
}
