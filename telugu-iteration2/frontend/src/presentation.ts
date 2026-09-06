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
  const index = Math.floor(normalized * OBSERVATION_FONTS.length);
  return OBSERVATION_FONTS[index]!;
}
export function preferredObservationFontSizePx(
  text: string,
  containerWidth: number,
  containerHeight: number,
): number {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return 64;
  const words = normalized.split(' ').length;
  const nonWhitespaceCharacters = Array.from(
    normalized.replace(/\s/g, ''),
  ).length;
  const contentLoad = Math.max(
    1,
    words + nonWhitespaceCharacters / 12,
  );
  const heightBase = clamp(112, 160, containerHeight * 0.28);
  const widthScale = clamp(0.86, 1.08, containerWidth / 650);
  const size = (heightBase * widthScale) / Math.pow(contentLoad, 0.33);
  return clamp(24, 160, size);
}
