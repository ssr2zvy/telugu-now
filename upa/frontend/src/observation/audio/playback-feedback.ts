export const MEDIA_ERROR_CONFIRM_MS = 350;

interface PlaybackMedia extends EventTarget {
  src: string;
  currentSrc: string;
  currentTime: number;
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  readyState: number;
  error: { code: number } | null;
}

export function observePlaybackFeedback(
  element: PlaybackMedia,
  onFailure: (message: string) => void,
  onRecovery: (playing: boolean) => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let source = element.src;
  let lastTime = element.currentTime;
  const failure = () => {
    if (!element.error || element.error.code === 1) return null;
    if (element.currentSrc && element.currentSrc !== element.src) return null;
    return element.error.code === 2
      ? 'Audio could not be loaded. Check your connection and retry.'
      : 'This audio file could not be played.';
  };
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const reset = () => {
    cancel();
    source = element.src;
    lastTime = element.currentTime;
    onRecovery(false);
  };
  const advancing = () => !element.paused && !element.ended && !element.seeking
    && element.currentTime > lastTime;
  const confirm = () => {
    timer = null;
    const message = failure();
    if (element.src !== source || !message || element.ended) {
      reset();
      return;
    }
    const progressed = advancing();
    lastTime = element.currentTime;
    if (progressed) {
      onRecovery(true);
      timer = setTimeout(confirm, MEDIA_ERROR_CONFIRM_MS);
    } else {
      onFailure(message);
    }
  };
  const schedule = () => {
    cancel();
    timer = setTimeout(confirm, MEDIA_ERROR_CONFIRM_MS);
  };
  const onError = () => {
    if (!failure()) {
      reset();
      return;
    }
    source = element.src;
    lastTime = element.currentTime;
    // Source swaps can deliver late errors, and buffered audio can keep playing
    // after a network error. Report only a current failure with no clock progress.
    schedule();
  };
  const onPlayable = (event: Event) => {
    if (failure()) onError();
    else if (element.readyState >= 2) {
      cancel();
      source = element.src;
      lastTime = element.currentTime;
      onRecovery(event.type === 'playing' && !element.paused && !element.ended);
    }
  };
  const onTimeUpdate = () => {
    if (element.src !== source) {
      reset();
      return;
    }
    const progressed = advancing();
    lastTime = element.currentTime;
    if (!progressed) return;
    onRecovery(true);
    if (failure()) schedule();
    else cancel();
  };
  const listeners: Array<[string, EventListener]> = [
    ['error', onError], ['playing', onPlayable], ['canplay', onPlayable], ['loadeddata', onPlayable],
    ['timeupdate', onTimeUpdate], ['ended', reset], ['emptied', reset], ['loadstart', reset],
  ];
  for (const [name, listener] of listeners) element.addEventListener(name, listener);
  if (element.error) onError();
  return () => {
    cancel();
    for (const [name, listener] of listeners) element.removeEventListener(name, listener);
  };
}
