import { OBSERVATION_FONTS, type ObservationFontFamily } from '../../shared/appearance';
export { OBSERVATION_FONTS, type ObservationFontFamily } from '../../shared/appearance';
export const IOS_OBSERVATION_FONTS = [
  'Noto Sans Telugu',
  'Noto Serif Telugu',
] as const satisfies readonly ObservationFontFamily[];

interface DeviceNavigator {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}

export function isIOSDevice(device: DeviceNavigator | null = typeof navigator === 'undefined' ? null : navigator): boolean {
  return device !== null && (/iPhone|iPad|iPod/u.test(device.userAgent)
    || (device.platform === 'MacIntel' && device.maxTouchPoints > 1));
}

export function compatibleObservationFonts(
  enabledFonts: readonly ObservationFontFamily[],
  device?: DeviceNavigator | null,
): readonly ObservationFontFamily[] {
  const requested = enabledFonts.length ? enabledFonts : OBSERVATION_FONTS;
  const currentDevice = device === undefined ? (typeof navigator === 'undefined' ? null : navigator) : device;
  if (!isIOSDevice(currentDevice)) return requested;
  return IOS_OBSERVATION_FONTS;
}
export const OBSERVATION_PRESENTATION = {
  fonts: OBSERVATION_FONTS,
  fontWeight: 400,
  emptyFontSizePx: 64,
  preferredMinimumFontSizePx: 24,
  preferredMaximumFontSizePx: 160,
  fitMinimumFontSizePx: 12,
  fitIterations: 10,
  fitVerticalReservePx: 64,
  heightBaseMinimumPx: 112,
  heightBaseMaximumPx: 160,
  heightFraction: 0.28,
  widthScaleMinimum: 0.86,
  widthScaleMaximum: 1.08,
  widthReferencePx: 650,
  contentCharacterDivisor: 12,
  contentExponent: 0.33,
  lineHeight: 1.2,
  // A fixed, font-agnostic sample covering vowels, consonants, matras, and a
  // conjunct, used to measure each font's own ascent/descent asymmetry.
  verticalMetricsSampleText:
    'అఆఇఈఉఊఋఎఏఐఒఓఔ కగతపమయరవశసహ క్ష్ ఱ్ఱ గ్రా ొౌ',
  verticalMetricsReferenceFontSizePx: 200,
} as const;
function clamp(minimum: number, maximum: number, value: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
export interface FontVerticalMetricsSample {
  actualAscent: number;
  actualDescent: number;
  fontAscent: number;
  fontDescent: number;
}
// Flexbox centers a text line's box, which is derived from a font's own
// ascent/descent metrics. Fonts differ in how their ink sits within that box,
// so this computes a size-scaled pixel correction (from measured metrics)
// that recenters the visible glyphs rather than the font's declared box.
export function fontVerticalCorrectionPx(
  sample: FontVerticalMetricsSample,
  referenceFontSizePx: number,
  targetFontSizePx: number,
): number {
  if (!(referenceFontSizePx > 0)) return 0;
  const inkCenter = (sample.actualAscent - sample.actualDescent) / 2;
  const boxCenter = (sample.fontAscent - sample.fontDescent) / 2;
  return ((inkCenter - boxCenter) / referenceFontSizePx) * targetFontSizePx;
}
export function chooseRandomObservationFont(
  random: () => number = Math.random,
  enabledFonts: readonly ObservationFontFamily[] = OBSERVATION_FONTS,
): ObservationFontFamily {
  const raw = random();
  const normalized = Number.isFinite(raw)
    ? clamp(0, 0.9999999999999999, raw)
    : 0;
  const fonts = enabledFonts.length ? enabledFonts : OBSERVATION_FONTS;
  const index = Math.floor(normalized * fonts.length);
  return fonts[index]!;
}
export function preferredObservationFontSizePx(
  text: string,
  containerWidth: number,
  containerHeight: number,
  fontScale = 50,
): number {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return OBSERVATION_PRESENTATION.emptyFontSizePx;
  const words = normalized.split(' ').length;
  const nonWhitespaceCharacters = Array.from(
    normalized.replace(/\s/g, ''),
  ).length;
  const contentLoad = Math.max(
    1,
    words + nonWhitespaceCharacters / OBSERVATION_PRESENTATION.contentCharacterDivisor,
  );
  const heightBase = clamp(
    OBSERVATION_PRESENTATION.heightBaseMinimumPx,
    OBSERVATION_PRESENTATION.heightBaseMaximumPx,
    containerHeight * OBSERVATION_PRESENTATION.heightFraction,
  );
  const widthScale = clamp(
    OBSERVATION_PRESENTATION.widthScaleMinimum,
    OBSERVATION_PRESENTATION.widthScaleMaximum,
    containerWidth / OBSERVATION_PRESENTATION.widthReferencePx,
  );
  const size =
    (heightBase * widthScale) /
    Math.pow(contentLoad, OBSERVATION_PRESENTATION.contentExponent);
  const scale = 0.5 + clamp(0, 100, Number.isFinite(fontScale) ? fontScale : 50) / 100;
  return scale * clamp(
    OBSERVATION_PRESENTATION.preferredMinimumFontSizePx,
    OBSERVATION_PRESENTATION.preferredMaximumFontSizePx,
    size,
  );
}
