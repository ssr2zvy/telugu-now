/** Browser autoplay policy is an expected idle state, not a broken audio file. */
export function playbackFailureMessage(error: unknown, automatic: boolean): string | null {
  const blocked = error instanceof DOMException && error.name === 'NotAllowedError';
  if (automatic && blocked) return null;
  return blocked ? 'Audio could not start. Tap to retry.'
    : 'This audio file could not be played. Tap to retry.';
}
