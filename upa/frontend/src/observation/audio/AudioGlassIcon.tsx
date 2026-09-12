import { useMemo, type CSSProperties } from 'react';
import { AUDIO_ICON_SHAPES, AudioIcon, type AudioIconName } from '../../components/icons';

export function AudioGlassIcon({ name }: { name: AudioIconName }) {
  const mask = useMemo(() => {
    const shape = AUDIO_ICON_SHAPES[name];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${shape.filled ? 'black' : 'none'}" stroke="${shape.filled ? 'none' : 'black'}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${shape.paths.map(d => `<path d="${d}"/>`).join('')}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }, [name]);
  return (
    <span className="audio-glass-icon" aria-hidden="true" style={{ '--audio-icon-mask': mask } as CSSProperties}>
      <AudioIcon name={name} />
    </span>
  );
}
