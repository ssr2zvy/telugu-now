export type PrecisionMode = 'closed' | 'magnifier' | 'speed';
export type PrecisionAction = 'open' | 'close' | 'toggle-speed' | 'close-speed';

export function precisionControls(mode: PrecisionMode, action: PrecisionAction): PrecisionMode {
  switch (action) {
    case 'open': return 'magnifier';
    case 'close': return 'closed';
    case 'toggle-speed': return mode === 'closed' ? 'closed' : mode === 'speed' ? 'magnifier' : 'speed';
    case 'close-speed': return mode === 'speed' ? 'magnifier' : mode;
  }
}
