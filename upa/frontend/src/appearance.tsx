import { createContext, useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { getProfilePreferences, saveProfilePreferences, transferBrowserData } from './api';
import { CustomCursor } from './components/CustomCursor';
import type { UpdateProfilePreferences } from '../../shared/appearance';
import { DEFAULT_APPEARANCE, parseAppearance, type AppearanceSettings } from '../../shared/appearance';
export { DEFAULT_APPEARANCE, parseAppearance, APPEARANCE_OFFSET_LIMIT, CONTROL_SPACING_LIMITS, CONTROL_DARKNESS_LIMITS, MODIFICATION_LIGHTNESS_LIMITS, AUTO_FADE_SECONDS_LIMITS, type AppearanceSettings } from '../../shared/appearance';

export function appearanceSurface(appearance: Pick<AppearanceSettings, 'surface' | 'foreground'>): string {
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

// The default gradient end color matches the shared audio icon color, so
// letter highlights read as an extension of the playback/bookmark controls.
export function appearanceModificationColor(appearance: Pick<AppearanceSettings, 'gradient' | 'modificationColor'>): string {
  return appearance.modificationColor ?? appearanceAudioColor(appearance);
}

export function appearanceFocusedLetterColor(appearance: Pick<AppearanceSettings, 'gradient' | 'foreground' | 'modificationColor'>): string {
  return contrastingPaletteColor(appearance, appearanceModificationColor(appearance));
}

// A quick-select preset: the reading color shifted lighter/darker against its
// background, independent of the audio icon color used as the default above.
export function appearanceModificationTextShiftColor(appearance: Pick<AppearanceSettings, 'gradient' | 'foreground' | 'modificationLightness'>): string {
  const foregroundChannels = colorChannels(appearance.foreground);
  const [hue, saturation, lightness] = rgbToHsl(foregroundChannels);
  const backgroundLevel = appearance.gradient.reduce((total, color) => total + luminance(colorChannels(color)), 0)
    / appearance.gradient.length;
  const foregroundLevel = luminance(foregroundChannels);
  const lightnessShift = appearance.modificationLightness / 100;
  const shiftedLightness = foregroundLevel < backgroundLevel
    ? Math.min(0.92, lightness + lightnessShift)
    : Math.max(0.08, lightness - lightnessShift);
  return `#${hslToRgb(hue, saturation, shiftedLightness).map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function randomAppearanceColors(random = Math.random): Pick<AppearanceSettings, 'gradient' | 'foreground'> {
  const palettes: Array<Pick<AppearanceSettings, 'gradient' | 'foreground'>> = [
    { gradient: ['#e4f0eb', '#a8c5b8', '#e1b9c4'], foreground: '#30483e' },
    { gradient: ['#f4ddd2', '#e0b6bf', '#afc9d0'], foreground: '#362b36' },
    { gradient: ['#dfe5f2', '#c1c9e0', '#c2dcd0'], foreground: '#34463e' },
    { gradient: ['#344a44', '#56515e', '#354452'], foreground: '#d4cedf' },
    { gradient: ['#eef0ce', '#bfd9cc', '#d4c4dc'], foreground: '#3d4934' },
  ];
  return palettes[Math.min(palettes.length - 1, Math.max(0, Math.floor(random() * palettes.length)))]!;
}

export function appearanceAudioColor(appearance: Pick<AppearanceSettings, 'gradient'>): string {
  const backgrounds = appearance.gradient.map(colorChannels);
  const levels = backgrounds.map(luminance);
  const colored = backgrounds.filter(color => Math.max(...color) > Math.min(...color));
  const endpoints = [...(colored.length ? colored : backgrounds)].sort((a, b) => luminance(a) - luminance(b));
  // Shading RGB directly desaturates pale colors. Change HSL lightness instead,
  // retaining an actual gradient endpoint's hue and saturation beyond its range.
  const candidates = [endpoints[0]!, endpoints.at(-1)!].map((base, index) => {
    const [hue, saturation, lightness] = rgbToHsl(base);
    let best = base;
    let bestContrast = 0;
    for (let step = 0.12; step <= 1; step += 0.01) {
      const shade = hslToRgb(hue, saturation, Math.max(0.02, Math.min(0.98, lightness + (index ? step : -step))));
      const level = luminance(shade);
      if (index ? level <= Math.max(...levels) : level >= Math.min(...levels)) continue;
      const contrast = Math.min(...levels.map(background => contrastRatio(level, background)));
      if (contrast > bestContrast) { best = shade; bestContrast = contrast; }
      if (contrast >= 2.4) break;
    }
    return { color: best, contrast: bestContrast };
  });
  const best = candidates.sort((a, b) => b.contrast - a.contrast)[0]!;
  return `#${best.color.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

// Representative center tone of the emphasized icon. The full icon still
// carries a translucent gradient, whose appearance depends on the background.
export function appearanceAudioHoverColor(appearance: Pick<AppearanceSettings, 'gradient'> & Partial<Pick<AppearanceSettings, 'controlDarkness'>>): string {
  const stop = appearanceAudioGlass(appearance, 1.4).stops[1]!;
  const paint = colorChannels(stop.color);
  const page = colorChannels(appearance.gradient[1]);
  const brightness = 1 - (appearance.controlDarkness ?? 15) / 100;
  const rgb = paint.map(value => value * brightness);
  const gray = rgb[0]! * .213 + rgb[1]! * .715 + rgb[2]! * .072;
  const result = rgb.map((value, index) => {
    const vivid = gray + (value - gray) * 1.16;
    const contrasted = Math.max(0, Math.min(255, (vivid - 127.5) * 1.08 + 127.5));
    return Math.round(page[index]! * (1 - stop.opacity) + contrasted * stop.opacity);
  });
  return `#${result.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

// The magnifier bars and scrubber paint the translucent glass gradient over
// the page gradient behind them, then a brightness() filter dims the result.
// The keyboard reproduces that exact composite numerically -- alpha-blend each
// glass stop over the page color at that stop, then apply the same brightness
// -- so its opaque panel renders the same color those elements actually show.
export function appearanceKeyboardGradient(appearance: Pick<AppearanceSettings, 'gradient' | 'controlDarkness'>) {
  const glass = appearanceAudioGlass(appearance);
  const brightness = 1 - appearance.controlDarkness / 100;
  const hex = (channels: number[]) => `#${channels.map(channel => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, '0')).join('')}`;
  const rendered = glass.stops.map((stop, index) => {
    const page = colorChannels(appearance.gradient[index]!);
    const paint = colorChannels(stop.color);
    return page.map((channel, part) => (channel + (paint[part]! - channel) * stop.opacity) * brightness);
  });
  // Zoom into the middle of the spectrum: pull the endpoints most of the way
  // toward the center stop so the panel shows the central band, not the full range.
  const middle = rendered[1]!;
  const shades = rendered.map(color => hex(color.map((channel, part) => middle[part]! + (channel - middle[part]!) * 0.35)));
  const average = [0, 1, 2].map(part => rendered.reduce((total, color) => total + color[part]!, 0) / rendered.length);
  const [hue, saturation, lightness] = rgbToHsl(average.map(Math.round));
  const gloss = hex(hslToRgb(hue, saturation, Math.min(0.97, lightness + 0.16)));
  return {
    gradient: `linear-gradient(135deg, ${shades[0]} 0%, ${shades[1]} 50%, ${shades[2]} 100%)`,
    glow: gloss,
    ink: lightness > 0.5 ? '#14171a' : '#f4f6f8',
    accent: hex(average),
  };
}

export function appearanceAudioGlass(appearance: Pick<AppearanceSettings, 'gradient'>, opacityScale = 1) {
  const targetLightness = rgbToHsl(colorChannels(appearanceAudioColor(appearance)))[2];
  const palette = appearance.gradient.map(color => rgbToHsl(colorChannels(color)));
  const hex = (channels: number[]) => `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
  const positions = [0, 0.5, 1];
  // Halve the edge-to-center contrast without washing out the whole control.
  const centerWeight = (position: number) => 1 - Math.abs(position - 0.5) * 2;
  const blendAt = (position: number) => 0.275 + 0.23 * centerWeight(position);
  const opacityAt = (position: number) => 0.30 + 0.195 * centerWeight(position);
  const shades = palette.map(([hue, saturation, lightness], index) =>
    hex(hslToRgb(hue, saturation, lightness + (targetLightness - lightness) * blendAt(positions[index]!))));
  const [hue, saturation, lightness] = palette[1]!;
  const highlight = hex(hslToRgb(hue, saturation, Math.min(0.96, Math.max(lightness, targetLightness) + 0.14)));
  const stops = positions.map((offset, index) => ({
    offset,
    color: shades[index]!,
    opacity: Math.min(1, opacityAt(offset) * opacityScale),
  }));
  return {
    stops,
    gradient: `linear-gradient(135deg, ${stops.map(stop =>
      `${stop.color}${Math.round(stop.opacity * 255).toString(16).padStart(2, '0')} ${stop.offset * 100}%`).join(', ')})`,
    edge: `${highlight}20`,
  };
}

function rgbToHsl(channels: number[]): [number, number, number] {
  const red = channels[0]! / 255;
  const green = channels[1]! / 255;
  const blue = channels[2]! / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (!delta) return [0, 0, lightness];
  const hue = max === red ? (green - blue) / delta + (green < blue ? 6 : 0)
    : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  return [hue / 6, delta / (1 - Math.abs(2 * lightness - 1)), lightness];
}

function hslToRgb(hue: number, saturation: number, lightness: number): number[] {
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  return [0, 8, 4].map(offset => {
    const phase = (offset + hue * 12) % 12;
    return Math.round(255 * (lightness - amplitude * Math.max(-1, Math.min(phase - 3, 9 - phase, 1))));
  });
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
  const appearanceRoot = useRef<HTMLDivElement>(null);
  const materialPaintId = `control-material-${useId().replace(/:/g, '')}`;
  useEffect(() => {
    // The browser's own :focus-visible heuristic re-arms after the document
    // regains visibility, so a plain click right after alt-tabbing back in
    // gets treated as keyboard-driven focus. Tracking modality ourselves from
    // real key/pointer events avoids that false positive without ever
    // disabling the ring for actual Tab navigation.
    const root = document.documentElement;
    const NAVIGATION_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Home', 'End', 'PageUp', 'PageDown']);
    const onKeyDown = (event: KeyboardEvent) => {
      if (NAVIGATION_KEYS.has(event.key)) root.setAttribute('data-input-modality', 'keyboard');
    };
    const onPointerDown = () => root.setAttribute('data-input-modality', 'pointer');
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);
  useEffect(() => {
    let pressed: { button: HTMLButtonElement; pointerId: number } | null = null;
    const clear = () => {
      pressed?.button.removeAttribute('data-touch-pressed');
      pressed = null;
    };
    const start = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      clear();
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button || button.disabled || !appearanceRoot.current?.contains(button)) return;
      pressed = { button, pointerId: event.pointerId };
      button.setAttribute('data-touch-pressed', '');
    };
    const move = (event: PointerEvent) => {
      if (!pressed || event.pointerId !== pressed.pointerId) return;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (!target || !pressed.button.contains(target)) clear();
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId === pressed?.pointerId) clear();
    };
    document.addEventListener('pointerdown', start, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);
    document.addEventListener('visibilitychange', clear);
    window.addEventListener('blur', clear);
    return () => {
      clear();
      document.removeEventListener('pointerdown', start, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', end, true);
      document.removeEventListener('pointercancel', end, true);
      document.removeEventListener('visibilitychange', clear);
      window.removeEventListener('blur', clear);
    };
  }, []);
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
  const keyboard = appearanceKeyboardGradient(appearance);
  // Higher paint opacity paired with the resting opacity in control-material.css
  // provides room for emphasis without inverting or changing the palette.
  const material = appearanceAudioGlass(appearance, 1.4);
  const style = {
    '--surface': appearanceSurface(appearance),
    '--control-icon-paint': `url(#${materialPaintId})`,
    '--control-material-gradient': material.gradient,
    '--control-material-edge': material.edge,
    '--control-brightness': 1 - appearance.controlDarkness / 100,
    '--audio-control-color': appearanceAudioColor(appearance),
    // The keyboard's accent already reproduces the exact rendered color of the
    // glass audio/magnifier/bookmark controls, so the cursor reuses it as-is.
    '--cursor-color': keyboard.accent,
    '--gradient-start': appearance.gradient[0],
    '--gradient-middle': appearance.gradient[1],
    '--gradient-end': appearance.gradient[2],
    '--keyboard-gradient': keyboard.gradient,
    '--keyboard-glow': keyboard.glow,
    '--keyboard-ink': keyboard.ink,
    '--keyboard-accent': keyboard.accent,
    '--foreground': appearance.foreground,
    '--modification-color': appearanceModificationColor(appearance),
    '--corner-control-color': appearanceAudioColor(appearance),
    '--audio-offset': `${appearance.audioOffset}px`,
    '--audio-timestamp-gap': `${appearance.audioTimestampGap}px`,
    '--timestamp-magnifier-gap': `${appearance.timestampMagnifierGap}px`,
    '--audio-placement-bottom': 'max(16px, calc(env(safe-area-inset-bottom) + 16px))',
  } as CSSProperties;
  return (
    <AppearanceContext.Provider value={{ profileCode, appearance, updateAppearance, language, updateLanguage }}>
      <div ref={appearanceRoot} className="appearance-root" style={style}>
        <svg className="control-material-definitions" width="0" height="0" aria-hidden="true" focusable="false">
          <defs><linearGradient id={materialPaintId} x1="0%" y1="0%" x2="100%" y2="100%">
            {material.stops.map(stop => <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />)}
          </linearGradient></defs>
        </svg>
        <div className="gradient-field" aria-hidden="true"><div /><div /><div /></div>
        <CustomCursor />
        {loaded ? children : <main className="app-shell entry-screen profile-preferences-loading"
          aria-busy={!error} aria-label="Loading profile settings" />}
        {error ? <div className="profile-preferences-error" role="alert">
          {loaded ? 'Settings not saved.' : 'Could not load profile settings.'}
        </div> : null}
      </div>
    </AppearanceContext.Provider>
  );
}
