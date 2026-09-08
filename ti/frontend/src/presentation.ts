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
  lineHeight: 1.3,
} as const;
function clamp(minimum: number, maximum: number, value: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
export function chooseRandomObservationFont(
  random: () => number = Math.random,
): ObservationFontFamily {
  const raw = random();
  const normalized = Number.isFinite(raw)
    ? clamp(0, 0.9999999999999999, raw)
    : 0;
  const index = Math.floor(normalized * OBSERVATION_PRESENTATION.fonts.length);
  return OBSERVATION_PRESENTATION.fonts[index]!;
}
export function preferredObservationFontSizePx(
  text: string,
  containerWidth: number,
  containerHeight: number,
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
  return clamp(
    OBSERVATION_PRESENTATION.preferredMinimumFontSizePx,
    OBSERVATION_PRESENTATION.preferredMaximumFontSizePx,
    size,
  );
}
