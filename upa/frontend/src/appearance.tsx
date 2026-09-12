import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LoaderCircle, RotateCw } from 'lucide-react';
import { getProfilePreferences, saveProfilePreferences, transferBrowserData } from './api';
import type { UpdateProfilePreferences } from '../../shared/appearance';
import { DEFAULT_APPEARANCE, parseAppearance, type AppearanceSettings } from '../../shared/appearance';
export { DEFAULT_APPEARANCE, parseAppearance, APPEARANCE_OFFSET_LIMIT, AUTO_FADE_SECONDS_LIMITS, type AppearanceSettings } from '../../shared/appearance';

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

function contrastingPaletteColor(appearance: Pick<AppearanceSettings, 'gradient' | 'foreground'>, distinctFrom?: string): string {
  const backgrounds = appearance.gradient.map(colorChannels);
  const palette = [0, 1, 2].map(channel => backgrounds.reduce((total, color) => total + color[channel]!, 0) / backgrounds.length);
  const backgroundLuminances = backgrounds.flatMap((start, index) => backgrounds.slice(index).flatMap(end =>
    Array.from({ length: 11 }, (_, step) => luminance(start.map((channel, channelIndex) => channel + (end[channelIndex]! - channel) * step / 10))),
  ));
  const foreground = colorChannels(appearance.foreground);
  const foregroundLuminance = luminance(foreground);
  const distinctLuminance = distinctFrom ? luminance(colorChannels(distinctFrom)) : null;
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
      if (contrast >= 3 && contrastRatio(candidateLuminance, foregroundLuminance) >= 1.2
        && (distinctLuminance === null || contrastRatio(candidateLuminance, distinctLuminance) >= 1.2)) return color;
    }
  }
  return bestColor;
}

export function appearanceCornerColor(appearance: Pick<AppearanceSettings, 'gradient' | 'foreground'>): string {
  return contrastingPaletteColor(appearance, appearanceAudioColor(appearance));
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

export function appearanceAudioColor(appearance: Pick<AppearanceSettings, 'gradient'>): string {
  return contrastingPaletteColor({ gradient: appearance.gradient, foreground: appearance.gradient[1] });
}

const AppearanceContext = createContext<{
  profileCode: string | null;
  appearance: AppearanceSettings;
  updateAppearance: (patch: Partial<AppearanceSettings>) => void;
  language: 'en' | 'te';
  updateLanguage: (language: 'en' | 'te') => void;
}>({ profileCode: null, appearance: DEFAULT_APPEARANCE, updateAppearance: () => {}, language: 'te', updateLanguage: () => {} });

export const useAppearance = () => useContext(AppearanceContext);

export function AppearanceProvider({ children, profileCode = null }: { children: ReactNode; profileCode?: string | null }) {
  const [appearance, setAppearance] = useState(() => parseAppearance(null));
  const [language, setLanguage] = useState<'en' | 'te'>('te');
  const [loaded, setLoaded] = useState(!profileCode);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState(false);
  const pending = useRef<UpdateProfilePreferences>({});
  const saving = useRef(false);
  useEffect(() => {
    if (!profileCode) return;
    let cancelled = false;
    setError(false);
    void transferBrowserData(profileCode).then(() => getProfilePreferences(profileCode)).then(preferences => {
      if (cancelled) return;
      setAppearance(parseAppearance(preferences.appearance));
      setLanguage(preferences.language ?? 'te');
      setLoaded(true);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [profileCode, loadAttempt]);
  useEffect(() => {
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (!saving.current && Object.keys(pending.current).length === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnUnsaved);
    return () => window.removeEventListener('beforeunload', warnUnsaved);
  }, []);
  const flush = async () => {
    if (!profileCode || saving.current || !loaded) return;
    saving.current = true;
    setError(false);
    try {
      while (Object.keys(pending.current).length) {
        const patch = pending.current;
        pending.current = {};
        try { await saveProfilePreferences(profileCode, patch); }
        catch {
          pending.current = {
            ...patch, ...pending.current,
            ...(patch.appearance || pending.current.appearance
              ? { appearance: { ...patch.appearance, ...pending.current.appearance } } : {}),
          };
          setError(true);
          break;
        }
      }
    } finally { saving.current = false; }
  };
  const updateAppearance = (patch: Partial<AppearanceSettings>) => {
    if (!profileCode || !loaded) return;
    setAppearance(current => parseAppearance({ ...current, ...patch }));
    pending.current = { ...pending.current, appearance: { ...pending.current.appearance, ...patch } };
    void flush();
  };
  const updateLanguage = (next: 'en' | 'te') => {
    if (!profileCode || !loaded) return;
    setLanguage(next);
    pending.current = { ...pending.current, language: next };
    void flush();
  };
  const style = {
    '--surface': appearanceSurface(appearance),
    '--audio-surface': 'color-mix(in srgb, var(--gradient-start) 35%, var(--gradient-middle))',
    '--audio-control-color': appearanceAudioColor(appearance),
    '--gradient-start': appearance.gradient[0],
    '--gradient-middle': appearance.gradient[1],
    '--gradient-end': appearance.gradient[2],
    '--foreground': appearance.foreground,
    '--corner-control-color': appearanceCornerColor(appearance),
    '--audio-offset': `${appearance.audioOffset}px`,
    '--audio-placement-bottom': 'max(16px, calc(env(safe-area-inset-bottom) + 16px))',
  } as CSSProperties;
  return (
    <AppearanceContext.Provider value={{ profileCode, appearance, updateAppearance, language, updateLanguage }}>
      <div className="appearance-root" style={style}>
        <div className="gradient-field" aria-hidden="true"><div /><div /><div /></div>
        {loaded ? children : <main className="app-shell entry-screen profile-preferences-loading">
          <div className="entry-wrap">
            <div className="entry-status" data-state="loading" role="status" aria-label={error ? 'Could not load profile settings' : 'Loading profile settings'}>
              {!error ? <LoaderCircle aria-hidden="true" /> : null}
            </div>
          </div>
        </main>}
        {error ? <div className="profile-preferences-error" role="alert">
          <span>{loaded ? 'Settings not saved.' : 'Could not load profile settings.'}</span>
          <button type="button" onClick={() => loaded ? void flush() : setLoadAttempt(current => current + 1)}><RotateCw size={16} aria-hidden="true" />Retry</button>
        </div> : null}
      </div>
    </AppearanceContext.Provider>
  );
}