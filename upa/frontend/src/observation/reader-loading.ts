// Entry readiness still gates playback/navigation. Dots only describe a blank
// reader; visible content must never be covered by background preparation.
export function readerNeedsLoadingDots(content: {
  entryReady: boolean;
  textVisible: boolean;
  audioVisible: boolean;
  comparisonVisible: boolean;
  errorVisible: boolean;
  startVisible: boolean;
}): boolean {
  return !Object.values(content).some(Boolean);
}
