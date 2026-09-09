import { createContext, useContext, useState, type CSSProperties, type ReactNode } from 'react';
import { OBSERVATION_FONTS, type ObservationFontFamily } from './presentation';

export interface AppearanceSettings {
  gradient: [string, string, string];
  foreground: string;
  surface: string | null;
  fontScale: number;
  fonts: ObservationFontFamily[];
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  gradient: ['#9a9a9a', '#707070', '#515151'],
  foreground: '#171717',
  surface: null,
  fontScale: 50,
  fonts: [...OBSERVATION_FONTS],
};
const storageKey = 'telugu-now-appearance-v1';
const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

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
    '--gradient-start': appearance.gradient[0],
    '--gradient-middle': appearance.gradient[1],
    '--gradient-end': appearance.gradient[2],
    '--foreground': appearance.foreground,
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