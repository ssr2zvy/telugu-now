import { useId, useMemo } from 'react';
import { appearanceAudioGlass, useAppearance } from '../appearance';

export function SettingsIcon() {
  const { appearance } = useAppearance();
  const paintId = `settings-glass-${useId().replace(/:/g, '')}`;
  const glass = useMemo(() => appearanceAudioGlass(appearance), [appearance.gradient]);
  return (
    <svg
      className="control-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ stroke: `url(#${paintId})` }}
    >
      <defs>
        <linearGradient id={paintId} x1="0%" y1="0%" x2="100%" y2="100%">
          {glass.stops.map(stop => <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />)}
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .62 1.7 1.7 0 0 0-.4 1.08V21h-4v-.1a1.7 1.7 0 0 0-.4-1.08 1.7 1.7 0 0 0-1-.62 1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.62-1A1.7 1.7 0 0 0 2.9 13.6H3v-4h-.1a1.7 1.7 0 0 0 1.08-.4 1.7 1.7 0 0 0 .62-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.06 3.4l.06.06A1.7 1.7 0 0 0 9 3.8a1.7 1.7 0 0 0 1-.62A1.7 1.7 0 0 0 10.4 2.1V2h4v.1a1.7 1.7 0 0 0 .4 1.08 1.7 1.7 0 0 0 1 .62 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8a1.7 1.7 0 0 0 .62 1 1.7 1.7 0 0 0 1.08.4h.1v4h-.1a1.7 1.7 0 0 0-1.08.4 1.7 1.7 0 0 0-.62 1Z" />
    </svg>
  );
}
export function LanguageIcon() {
  return (
    <svg
      className="control-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21M12 3C9.5 5.6 8.2 8.6 8.2 12s1.3 6.4 3.8 9" />
    </svg>
  );
}
export const AUDIO_ICON_SHAPES = {
  play: { filled: true, paths: ['M7 4.5v15l14-7.5z'] },
  pause: { filled: true, paths: ['M6 4.5h4v15H6zM14 4.5h4v15h-4z'] },
  speed: { filled: false, paths: ['M4 16a8 8 0 0 1 16 0', 'M12 16 14.5 11.6'] },
  bookmark: { filled: true, paths: ['M6 3h12v18l-6-4.2L6 21z'] },
  loop: { filled: false, paths: ['M4 9.5h13a3.5 3.5 0 0 1 0 7H7', 'M14.5 6 17 9.5 14.5 13', 'M9.5 13 7 16.5 9.5 20'] },
} as const;
export type AudioIconName = keyof typeof AUDIO_ICON_SHAPES;

export function AudioIcon({ name }: { name: AudioIconName }) {
  const shape = AUDIO_ICON_SHAPES[name];
  return (
    <svg
      className={`control-icon${shape.filled ? ' control-icon-fill' : ''}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {shape.paths.map(d => <path key={d} d={d} />)}
    </svg>
  );
}
export function PlayIcon() {
  return <AudioIcon name="play" />;
}
export function PauseIcon() {
  return <AudioIcon name="pause" />;
}
export function SpeedIcon() {
  return <AudioIcon name="speed" />;
}
export function BookmarkIcon() {
  return <AudioIcon name="bookmark" />;
}
