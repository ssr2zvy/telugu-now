export const OBSERVATION_FONTS = [
  'Noto Sans Telugu',
  'Noto Serif Telugu',
  'Mandali',
  'Ramabhadra',
  'NTR',
  'Peddana',
  'Ramaraja',
  'Sree Krushnadevaraya',
  'Suranna',
  'Tenali Ramakrishna',
] as const;
export type ObservationFontFamily = (typeof OBSERVATION_FONTS)[number];

export interface AppearanceSettings {
  gradient: [string, string, string];
  foreground: string;
  surface: string | null;
  fontScale: number;
  textOffset: number;
  audioOffset: number;
  // Vertical offsets remembered for the magnifier position not currently
  // active, restored automatically when switching back to it.
  textOffsetOther: number;
  audioOffsetOther: number;
  audioTimestampGap: number;
  timestampMagnifierGap: number;
  magnifierPosition: 'above' | 'below';
  scrollMode: boolean;
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
  textOffsetOther: 0,
  audioOffsetOther: 0,
  audioTimestampGap: 1,
  timestampMagnifierGap: 1,
  magnifierPosition: 'below',
  scrollMode: true,
  autoFadeSeconds: 15,
  fonts: [...OBSERVATION_FONTS],
};
export const APPEARANCE_OFFSET_LIMIT = 200;
export const CONTROL_SPACING_LIMITS = { min: 0, max: 48 } as const;
export const AUTO_FADE_SECONDS_LIMITS = { min: 1, max: 60 } as const;
const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const parseOffset = (value: unknown): number => typeof value === 'number' && Number.isFinite(value)
  ? Math.round(Math.max(-APPEARANCE_OFFSET_LIMIT, Math.min(APPEARANCE_OFFSET_LIMIT, value))) : 0;
const parseControlGap = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value)
  ? Math.round(Math.max(CONTROL_SPACING_LIMITS.min, Math.min(CONTROL_SPACING_LIMITS.max, value))) : fallback;

export function parseAppearance(value: unknown): AppearanceSettings {
  const candidate = (value && typeof value === 'object' ? value : {}) as Partial<AppearanceSettings> & { controlSpacing?: unknown };
  const fonts = OBSERVATION_FONTS.filter((font) => Array.isArray(candidate.fonts) && candidate.fonts.includes(font));
  const legacyGap = Math.min(1, parseControlGap(candidate.controlSpacing, DEFAULT_APPEARANCE.audioTimestampGap));
  return {
    gradient: Array.isArray(candidate.gradient) && candidate.gradient.length === 3 && candidate.gradient.every(isColor)
      ? [...candidate.gradient] : [...DEFAULT_APPEARANCE.gradient],
    foreground: isColor(candidate.foreground) ? candidate.foreground : DEFAULT_APPEARANCE.foreground,
    surface: isColor(candidate.surface) ? candidate.surface : null,
    fontScale: typeof candidate.fontScale === 'number' && Number.isFinite(candidate.fontScale)
      ? Math.max(0, Math.min(100, candidate.fontScale)) : 50,
    textOffset: parseOffset(candidate.textOffset),
    audioOffset: parseOffset(candidate.audioOffset),
    textOffsetOther: parseOffset(candidate.textOffsetOther),
    audioOffsetOther: parseOffset(candidate.audioOffsetOther),
    audioTimestampGap: parseControlGap(candidate.audioTimestampGap, legacyGap),
    timestampMagnifierGap: parseControlGap(candidate.timestampMagnifierGap, legacyGap),
    magnifierPosition: candidate.magnifierPosition === 'above' || candidate.magnifierPosition === 'below'
      ? candidate.magnifierPosition : DEFAULT_APPEARANCE.magnifierPosition,
    scrollMode: typeof candidate.scrollMode === 'boolean' ? candidate.scrollMode : DEFAULT_APPEARANCE.scrollMode,
    autoFadeSeconds: typeof candidate.autoFadeSeconds === 'number' && Number.isFinite(candidate.autoFadeSeconds)
      ? Math.round(Math.max(AUTO_FADE_SECONDS_LIMITS.min, Math.min(AUTO_FADE_SECONDS_LIMITS.max, candidate.autoFadeSeconds)))
      : DEFAULT_APPEARANCE.autoFadeSeconds,
    fonts: fonts.length ? fonts : [...OBSERVATION_FONTS],
  };
}

export interface ProfilePreferences {
  appearance: AppearanceSettings | null;
  language: 'en' | 'te' | null;
  imagePrompt: string;
  allowImageRegeneration: boolean;
}

export interface UpdateProfilePreferences {
  appearance?: Partial<AppearanceSettings>;
  language?: 'en' | 'te';
  imagePrompt?: string;
  allowImageRegeneration?: boolean;
}

export interface ProfileMigrationState {
  settings: boolean;
  bookmarks: boolean;
}