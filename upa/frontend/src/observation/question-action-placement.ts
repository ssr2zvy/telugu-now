export interface VerticalBounds { top: number; bottom: number }

// Keep the footer slot unless actual audio controls would overlap it. Move the
// action above the obstruction, never move the audio bar or the reading text.
export function questionActionBottom(
  screenBottom: number, preferredBottom: number, height: number,
  occupied: VerticalBounds[], gap = 8,
): number {
  let bottom = preferredBottom;
  for (let pass = 0; pass <= occupied.length; pass += 1) {
    const action = { top: screenBottom - bottom - height, bottom: screenBottom - bottom };
    const collisions = occupied.filter(rect => action.top < rect.bottom + gap && action.bottom > rect.top - gap);
    if (!collisions.length) return bottom;
    bottom = Math.max(bottom, ...collisions.map(rect => screenBottom - rect.top + gap));
  }
  return bottom;
}
