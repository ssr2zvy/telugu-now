import { createContext, useContext, useState, type CSSProperties, type ReactNode } from 'react';
import { OBSERVATION_FONTS, type ObservationFontFamily } from './presentation';

export interface AppearanceSettings {
  gradient: [string, string, string];
  foreground: string;
  surface: string | null;
  fontScale: number;
  textOffset: number;
  audioOffset: number;
  magnifierPosition: 'above' | 'below';
  autoFadeSeconds: number;
  fonts: ObservationFontFamily[];
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  gradient: ['#b6b6b6', '#969696', '#787878'],
  foreground: '#171717',
  surface: null,
  fontScale: 50,
  textOffset: 0,
  audioOffset: 0,
  magnifierPosition: 'above',
  autoFadeSeconds: 15,
  fonts: [...OBSERVATION_FONTS],
};
export const APPEARANCE_OFFSET_LIMIT = 200;
export const AUTO_FADE_SECONDS_LIMITS = { min: 1, max: 60 } as const;
const storageKey = 'telugu-now-appearance-v1';
const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const parseOffset = (value: unknown): number => typeof value === 'number' && Number.isFinite(value)
  ? Math.round(Math.max(-APPEARANCE_OFFSET_LIMIT, Math.min(APPEARANCE_OFFSET_LIMIT, value))) : 0;

export function parseAppearance(value: unknown): AppearanceSettings {
  const candidate = (value && typeof value === 'object' ? value : {}) as Partial<AppearanceSettings>;
  const fonts = OBSERVATION_FONTS.filter((font) => Array.isArray(candidate.fonts) && candidate.fonts.includes(font));
  return {
    gradient: Array.isArray(candidate.gradient) && candidate.gradient.length === 3 && candidate.gradient.every(isColor)
      ? [...candidate.gradient] : [...DEFAULT_APPEARANCE.gradient],
    foreground: isColor(candidate.foreground) ? candidate.foreground : DEFAULT_APPEARANCE.foreground,
    surface: isColor(candidate.surface) ? candidate.surface : null,
    fontScale: typeof candidate.fontScale === 'number' && Number.isFinite(candidate.fontScale)
      ? Math.max(0, Math.min(100, candidate.fontScale)) : 50,
    textOffset: parseOffset(candidate.textOffset),
    audioOffset: parseOffset(candidate.audioOffset),
    magnifierPosition: candidate.magnifierPosition === 'below' ? 'below' : 'above',
    autoFadeSeconds: typeof candidate.autoFadeSeconds === 'number' && Number.isFinite(candidate.autoFadeSeconds)
      ? Math.round(Math.max(AUTO_FADE_SECONDS_LIMITS.min, Math.min(AUTO_FADE_SECONDS_LIMITS.max, candidate.autoFadeSeconds)))
      : DEFAULT_APPEARANCE.autoFadeSeconds,
    fonts: fonts.length ? fonts : [...OBSERVATION_FONTS],
  };
}

export function appearanceSurface(appearance: AppearanceSettings): string {
  if (appearance.surface) return appearance.surface;
  const brightness = parseInt(appearance.foreground.slice(1, 3), 16) * 0.2126
    + parseInt(appearance.foreground.slice(3, 5), 16) * 0.7152
    + parseInt(appearance.foreground.slice(5, 7), 16) * 0.0722;
  return brightness > 140 ? '#191b1d' : '#f8f9fa';
}

function colorChannels(color: string): number[] {
  return [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
}

function luminance(channels: number[]): number {
  return channels.reduce((total, channel, index) => {
    const normalized = channel / 255;
    const linear = normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    return total + linear * [0.2126, 0.7152, 0.0722][index]!;
  }, 0);
}

function contrastRatio(first: number, second: number): number {
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function appearanceCornerColor(appearance: Pick<AppearanceSettings, 'gradient' | 'foreground'>): string {
  const backgrounds = appearance.gradient.map(colorChannels);
  const palette = [0, 1, 2].map(channel => backgrounds.reduce((total, color) => total + color[channel]!, 0) / backgrounds.length);
  const backgroundLuminances = backgrounds.flatMap((start, index) => backgrounds.slice(index).flatMap(end =>
    Array.from({ length: 11 }, (_, step) => luminance(start.map((channel, channelIndex) => channel + (end[channelIndex]! - channel) * step / 10))),
  ));
  const foreground = colorChannels(appearance.foreground);
  const foregroundLuminance = luminance(foreground);
  let bestColor = appearance.foreground;
  let bestContrast = 0;
  for (const target of [foreground, [0, 0, 0], [255, 255, 255]]) {
    for (let step = 0; step <= 100; step += 1) {
      const channels = palette.map((channel, index) => Math.round(channel + (target[index]! - channel) * step / 100));
      const candidateLuminance = luminance(channels);
      const contrast = Math.min(...backgroundLuminances.map(background => contrastRatio(candidateLuminance, background)));
      const color = `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
      if (contrast > bestContrast) {
        bestColor = color;
        bestContrast = contrast;
      }
      if (contrast >= 3 && contrastRatio(candidateLuminance, foregroundLuminance) >= 1.2) return color;
    }
  }
  return bestColor;
}

export function randomAppearanceColors(random = Math.random): Pick<AppearanceSettings, 'gradient' | 'foreground'> {
  const palettes: Array<Pick<AppearanceSettings, 'gradient' | 'foreground'>> = [
    { gradient: ['#e4f0eb', '#a8c5b8', '#e1b9c4'], foreground: '#20332c' },
    { gradient: ['#f4ddd2', '#e0b6bf', '#afc9d0'], foreground: '#362b36' },
    { gradient: ['#dfe5f2', '#c1c9e0', '#c2dcd0'], foreground: '#24332d' },
    { gradient: ['#344a44', '#56515e', '#354452'], foreground: '#f3f5ee' },
    { gradient: ['#eef0ce', '#bfd9cc', '#d4c4dc'], foreground: '#30352b' },
  ];
  return palettes[Math.min(palettes.length - 1, Math.max(0, Math.floor(random() * palettes.length)))]!;
}

const AppearanceContext = createContext<{
  appearance: AppearanceSettings;
  updateAppearance: (patch: Partial<AppearanceSettings>) => void;
}>({ appearance: DEFAULT_APPEARANCE, updateAppearance: () => {} });

export const useAppearance = () => useContext(AppearanceContext);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState(() => {
    try { return parseAppearance(JSON.parse(localStorage.getItem(storageKey) ?? 'null')); }
    catch { return parseAppearance(null); }
  });
  const updateAppearance = (patch: Partial<AppearanceSettings>) => {
    setAppearance((current) => {
      const next = parseAppearance({ ...current, ...patch });
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const style = {
    '--surface': appearanceSurface(appearance),
    '--audio-surface': appearance.surface ?? 'color-mix(in srgb, var(--surface) 35%, var(--gradient-middle))',
    '--gradient-start': appearance.gradient[0],
    '--gradient-middle': appearance.gradient[1],
    '--gradient-end': appearance.gradient[2],
    '--foreground': appearance.foreground,
    '--corner-control-color': appearanceCornerColor(appearance),
    '--audio-offset': `${appearance.audioOffset}px`,
    '--audio-placement-bottom': appearance.magnifierPosition === 'below'
      ? 'max(164px, calc(env(safe-area-inset-bottom) + 164px))'
      : 'max(16px, calc(env(safe-area-inset-bottom) + 16px))',
  } as CSSProperties;
  return (
    <AppearanceContext.Provider value={{ appearance, updateAppearance }}>
      <div className="appearance-root" style={style}>
        <div className="gradient-field" aria-hidden="true"><div /><div /><div /></div>
        {children}
      </div>
    </AppearanceContext.Provider>
  );
}