import { useId, useMemo } from 'react';
import { appearanceAudioGlass, useAppearance } from '../appearance';

const SETTINGS_PATH = 'M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .62 1.7 1.7 0 0 0-.4 1.08V21h-4v-.1a1.7 1.7 0 0 0-.4-1.08 1.7 1.7 0 0 0-1-.62 1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.62-1A1.7 1.7 0 0 0 2.9 13.6H3v-4h-.1a1.7 1.7 0 0 0 1.08-.4 1.7 1.7 0 0 0 .62-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.06 3.4l.06.06A1.7 1.7 0 0 0 9 3.8a1.7 1.7 0 0 0 1-.62A1.7 1.7 0 0 0 10.4 2.1V2h4v.1a1.7 1.7 0 0 0 .4 1.08 1.7 1.7 0 0 0 1 .62 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8a1.7 1.7 0 0 0 .62 1 1.7 1.7 0 0 0 1.08.4h.1v4h-.1a1.7 1.7 0 0 0-1.08.4 1.7 1.7 0 0 0-.62 1Z';

export function SettingsIcon({ filled = false }: { filled?: boolean }) {
  const { appearance } = useAppearance();
  const paintId = `settings-glass-${useId().replace(/:/g, '')}`;
  const glass = useMemo(() => appearanceAudioGlass(appearance), [appearance.gradient]);
  return (
    <svg
      className={`control-icon settings-icon${filled ? ' is-filled' : ''}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ stroke: `url(#${paintId})` }}
    >
      <defs>
        <linearGradient id={paintId} x1="0%" y1="0%" x2="100%" y2="100%">
          {glass.stops.map(stop => <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />)}
        </linearGradient>
      </defs>
      <path className="settings-icon-fill-shape" fillRule="evenodd" clipRule="evenodd" d={`${SETTINGS_PATH} M15 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0Z`} />
      <g className="settings-icon-outline-shape"><circle cx="12" cy="12" r="3" /><path d={SETTINGS_PATH} /></g>
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
  bookmark: { filled: false, paths: ['M5 3h14v18l-7-4.2L5 21z'] },
  loop: { filled: false, paths: ['M17 2l4 4-4 4', 'M3 11V9a3 3 0 0 1 3-3h15', 'M7 22l-4-4 4-4', 'M21 13v2a3 3 0 0 1-3 3H3'] },
  bookmarkLoop: { filled: false, paths: ['M7 3h7v8l-3.5-2L7 11z', 'M16 6h2a3 3 0 0 1 3 3v2', 'M18 8l3 3 3-3', 'M8 18H6a3 3 0 0 1-3-3v-2', 'M6 16l-3-3-3 3'] },
} as const;
export type AudioIconName = keyof typeof AUDIO_ICON_SHAPES;

export function AudioIcon({ name, filled }: { name: AudioIconName; filled?: boolean }) {
  const shape = AUDIO_ICON_SHAPES[name];
  const isFilled = filled ?? shape.filled;
  return (
    <svg
      className={`control-icon${isFilled ? ' control-icon-fill' : ''}`}
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
