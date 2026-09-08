// A bookmark within roughly this many seconds of an existing one is treated
// as the same mark rather than creating a near-duplicate.
const MIN_BOOKMARK_SPACING_SECONDS = 0.25;
// Guards against "seek/delete nearest prior" immediately re-targeting a
// bookmark sitting essentially at the current playback position.
const NEAREST_PRIOR_EPSILON_SECONDS = 0.05;

function sortedUnique(times: readonly number[]): number[] {
  return [...new Set(times.map((time) => Math.max(0, time)))].sort((left, right) => left - right);
}

export function insertBookmark(bookmarks: readonly number[], time: number): number[] {
  const safeTime = Math.max(0, time);
  const withoutNearby = bookmarks.filter(
    (existing) => Math.abs(existing - safeTime) > MIN_BOOKMARK_SPACING_SECONDS,
  );
  return sortedUnique([...withoutNearby, safeTime]);
}

export function nearestPriorBookmark(bookmarks: readonly number[], currentTime: number): number | null {
  let nearest: number | null = null;
  for (const bookmark of bookmarks) {
    if (bookmark < currentTime - NEAREST_PRIOR_EPSILON_SECONDS && (nearest === null || bookmark > nearest)) {
      nearest = bookmark;
    }
  }
  return nearest;
}

export function deleteNearestPriorBookmark(bookmarks: readonly number[], currentTime: number): number[] {
  const target = nearestPriorBookmark(bookmarks, currentTime);
  if (target === null) return sortedUnique(bookmarks);
  return sortedUnique(bookmarks.filter((bookmark) => bookmark !== target));
}
