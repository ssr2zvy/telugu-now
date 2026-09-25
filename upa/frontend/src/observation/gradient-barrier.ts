export function normalizeGradientBarrier(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 50;
}

// 50 exactly preserves the previous distance-to-color curve. Higher values
// compress it around its midpoint; lower values spread the transition out.
export function gradientBarrierAmount(distance: number, barrier = 50): number {
  const original = Math.pow(Math.min(1, Math.max(0, distance) * .925), .42);
  const amount = normalizeGradientBarrier(barrier);
  if (amount === 50 || original === 0 || original === 1) return original;
  const sharpness = Math.pow(2, (amount - 50) / 25);
  const left = Math.pow(original, sharpness);
  const right = Math.pow(1 - original, sharpness);
  return left / (left + right);
}

export function gradientTextureKey(text: string, font: string, foreground: string, endColor: string, barrier = 50): string {
  return [font, text, foreground, endColor, normalizeGradientBarrier(barrier)].join('\0');
}
