import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type {
  ProfileStateResponse,
} from '../../../shared/contracts';
import {
  AudioPlayerBar,
  type AudioPlayerBarHandle,
} from './audio/AudioPlayerBar';
import {
  useObservationTypography,
} from './useObservationTypography';
import { WordProfile } from './word/WordProfile';
import { wordAtOffset } from './word/word-analysis';
import { useAppearance } from '../appearance';
import { ReaderTaps, readerTapRegions } from './reader-taps';
import { scrollControlsVisible } from './reader-scroll';
import { useReaderScroll } from './useReaderScroll';
import { ReadingContextMenu, type ReadingContextMenuState } from './ReadingContextMenu';
import { addBlacklistEntry } from '../api';

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 10;

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through to the legacy fallback below.
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try { document.execCommand('copy'); } finally { document.body.removeChild(textarea); }
}
interface ObservationViewProps {
  state: ProfileStateResponse | null;
  busy: boolean;
  navigationEvent: { sequence: number; direction: 'back' | 'next' } | null;
  onMove: (
    direction: 'back' | 'next',
  ) => Promise<boolean>;
  onOpenSettings: () => void;
}
export function ObservationView({
  state,
  busy,
  navigationEvent,
  onMove,
  onOpenSettings,
}: ObservationViewProps) {
  const { appearance } = useAppearance();
  const [
    controlsVisible,
    setControlsVisible,
  ] = useState(false);
  const [precisionInteraction, setPrecisionInteraction] = useState(0);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [selectedWord, setSelectedWord] = useState<{ word: string; observationId: string } | null>(null);
  const [readingMenu, setReadingMenu] = useState<ReadingContextMenuState | null>(null);
  const screenRef = useRef<HTMLElement>(null);
  const playerRef = useRef<AudioPlayerBarHandle>(null);
  const [taps] = useState(() => new ReaderTaps());
  const suppressNextClick = useRef(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressOrigin = useRef<{ x: number; y: number } | null>(null);
  const gesturePausedPlayback = useRef(false);
  const cancelLongPress = () => {
    if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    longPressOrigin.current = null;
  };
  const openReadingMenu = (x: number, y: number, text: string) => {
    taps.cancel();
    setControlsVisible(false);
    setReadingMenu({ text, x, y });
  };
  const scrollHandlers = useReaderScroll(screenRef, appearance.scrollMode && Boolean(state?.currentObservation?.audio), state?.currentObservation?.id, () => {
    taps.cancel();
    setControlsVisible(scrollControlsVisible(controlsVisible));
    setPrecisionInteraction(value => value + 1);
  }, () => taps.cancel());
  useEffect(() => {
    const screen = screenRef.current;
    if (!controlsVisible || !screen) return;
    let idleTimer: number;
    const activePointers = new Set<number>();
    const scheduleHide = (event?: Event) => {
      window.clearTimeout(idleTimer);
      if (event instanceof PointerEvent) {
        if (event.type === 'pointerdown') activePointers.add(event.pointerId);
        if (event.type === 'pointerup' || event.type === 'pointercancel' || event.type === 'lostpointercapture') activePointers.delete(event.pointerId);
      }
      if (activePointers.size > 0) return;
      idleTimer = window.setTimeout(() => {
        setControlsVisible(false);
      }, appearance.autoFadeSeconds * 1000);
    };
    const events = ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave', 'keydown', 'focusin', 'focusout'];
    for (const event of events) screen.addEventListener(event, scheduleHide);
    scheduleHide();
    return () => {
      window.clearTimeout(idleTimer);
      for (const event of events) screen.removeEventListener(event, scheduleHide);
    };
  }, [controlsVisible, appearance.autoFadeSeconds, precisionInteraction]);
  const observation =
    state?.currentObservation ?? null;
  useEffect(() => {
    taps.cancel();
    setControlsVisible(false);
    setReadingMenu(null);
    return () => taps.cancel();
  }, [taps, observation?.id, appearance.scrollMode]);
  const typography =
    useObservationTypography(
      observation,
    );
  const canBack =
    Boolean(state?.canBack) &&
    !busy;
  const canNext =
    Boolean(state?.canNext) &&
    !busy;
  const move = async (
    direction: 'back' | 'next',
  ) => {
    const moved =
      await onMove(direction);
    if (moved) {
      setControlsVisible(false);
    }
  };
  const wordAtPoint = (event: MouseEvent<HTMLElement>): string | null => {
    const element = event.target instanceof Element ? event.target.closest('.observation-text') : null;
    if (!element || !observation) {
      return null;
    }
    const browserDocument = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const position = browserDocument.caretPositionFromPoint?.(event.clientX, event.clientY);
    const range = position ? null : browserDocument.caretRangeFromPoint?.(event.clientX, event.clientY);
    const node = position?.offsetNode ?? range?.startContainer;
    const offset = position?.offset ?? range?.startOffset;
    if (!node || node !== element.firstChild || offset === undefined) {
      return null;
    }
    const word = wordAtOffset(observation.text, offset) ?? wordAtOffset(observation.text, offset - 1);
    const segment = word ? [...new Intl.Segmenter('te', { granularity: 'word' }).segment(observation.text)]
      .find(part => part.isWordLike && part.segment === word && offset >= part.index && offset <= part.index + part.segment.length) : null;
    if (!segment || !word) {
      return null;
    }
    const hit = document.createRange();
    hit.setStart(node, segment.index);
    hit.setEnd(node, segment.index + segment.segment.length);
    const inside = [...hit.getClientRects()].some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
    return inside ? word : null;
  };
  return (
    <main
      ref={screenRef}
      {...scrollHandlers}
      data-scroll-mode={appearance.scrollMode}
      className={
        `app-shell observation-screen ${
          controlsVisible
            ? 'controls-visible'
            : ''
        }`
      }
      onFocusCapture={(event) => {
        if (event.target.matches(':focus-visible')) {
          if (event.target.closest('.audio-player-bar')) {
            setControlsVisible(true);
          }
        }
      }}
      onKeyDownCapture={(event) => {
        if (event.target === event.currentTarget && (event.key === ' ' || event.key === 'Enter')) {
          event.preventDefault();
          if (!event.repeat) playerRef.current?.togglePlay();
          return;
        }
        if (event.target instanceof Element) {
          if (event.target.closest('.audio-player-bar')) {
            setControlsVisible(true);
          }
        }
      }}
      tabIndex={0}
      aria-label={appearance.scrollMode
        ? 'Reader. Tap to play or pause. Swipe left or right to show or hide audio controls.'
        : 'Reader. Tap above the bottom third to play or pause. Tap the bottom third for audio controls.'}
      onClick={(event) => {
        if (suppressNextClick.current) { suppressNextClick.current = false; return; }
        if (readingMenu) { setReadingMenu(null); return; }
        const bounds = screenRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const region = readerTapRegions(event.clientX, event.clientY, bounds);
        const word = wordAtPoint(event);
        const doubleRegion = word ? `word:${word}` : region.double;
        if (!window.getSelection()?.isCollapsed && !taps.matches(doubleRegion, event.clientX, event.clientY)) {
          taps.cancel();
          return;
        }
        // A single tap that will end up pausing playback must stop the audio
        // immediately, before the double-tap resolution delay, so the pause
        // lands exactly where the user tapped instead of bleeding later.
        const willTogglePlay = appearance.scrollMode
          ? (region.single !== 'controls' || !playerRef.current?.isPrecisionOpen())
          : region.single === 'playback';
        const eagerlyPaused = willTogglePlay && Boolean(playerRef.current?.isPlaying());
        if (eagerlyPaused) {
          gesturePausedPlayback.current = true;
          playerRef.current?.pause();
        }
        taps.tap(doubleRegion, event.clientX, event.clientY, () => {
          if (gesturePausedPlayback.current) playerRef.current?.resume();
          gesturePausedPlayback.current = false;
          window.getSelection()?.removeAllRanges();
          if (word && observation) {
            setControlsVisible(false);
            setSelectedWord({ word, observationId: observation.id });
          } else if (region.double === 'center') playerRef.current?.toggleAssociatedControls();
          else if (region.double === 'back' ? canBack : canNext) void move(region.double);
        }, () => {
          gesturePausedPlayback.current = false;
          if (appearance.scrollMode) {
            if (region.single === 'controls') {
              if (!playerRef.current?.isPrecisionOpen() && !eagerlyPaused) playerRef.current?.togglePlay();
            } else if (!eagerlyPaused) {
              playerRef.current?.togglePlay();
            }
          } else if (region.single === 'playback') { if (!eagerlyPaused) playerRef.current?.togglePlay(); }
          else if (!playerRef.current?.isPrecisionOpen()) setControlsVisible(visible => !visible);
        }, () => {
          if (gesturePausedPlayback.current) playerRef.current?.resume();
          gesturePausedPlayback.current = false;
          window.getSelection()?.removeAllRanges();
          onOpenSettings();
        });
      }}
      onMouseDownCapture={(event) => {
        if (event.button !== 0 || event.detail < 2) return;
        if (event.target instanceof Element && event.target.closest('button, .audio-player-bar, .word-profile')) return;
        event.preventDefault();
      }}
      onDoubleClick={(event) => event.preventDefault()}
    >
      {audioLoading ? (
        <div className="navigation-feedback audio-loading-indicator" role="status" aria-label="Loading audio">
          <span aria-hidden="true">...</span>
        </div>
      ) : navigationEvent ? (
        <div
          key={navigationEvent.sequence}
          className="navigation-feedback"
          role="status"
          aria-label={navigationEvent.direction === 'next' ? 'Next' : 'Back'}
          data-sequence={navigationEvent.sequence}
        >
          {navigationEvent.direction === 'next' ? <ArrowRight size={18} aria-hidden="true" /> : <ArrowLeft size={18} aria-hidden="true" />}
        </div>
      ) : null}
      <div className="nav-region">
        <button
          className="nav-zone nav-zone-left"
          type="button"
          aria-label="వెనుక"
          disabled={!canBack}
          onKeyDown={(event) => { if (event.repeat) event.preventDefault(); }}
          onClick={(
            event:
              MouseEvent<HTMLButtonElement>,
          ) => {
            if (event.detail === 0) {
              event.stopPropagation();
              if (canBack) void move('back');
            }
          }}
        />
      </div>
      <section
        ref={typography.containerRef}
        className="observation-center"
      >
        {observation ? (
          <div
            ref={typography.textRef}
            className="observation-text"
            style={typography.style}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              cancelLongPress();
              openReadingMenu(event.clientX, event.clientY, observation.text);
            }}
            onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
              if (event.pointerType !== 'touch') return;
              longPressOrigin.current = { x: event.clientX, y: event.clientY };
              const { clientX, clientY } = event;
              longPressTimer.current = window.setTimeout(() => {
                longPressTimer.current = null;
                longPressOrigin.current = null;
                suppressNextClick.current = true;
                openReadingMenu(clientX, clientY, observation.text);
              }, LONG_PRESS_MS);
            }}
            onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
              if (!longPressOrigin.current) return;
              const dx = event.clientX - longPressOrigin.current.x;
              const dy = event.clientY - longPressOrigin.current.y;
              if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) cancelLongPress();
            }}
            onPointerUp={cancelLongPress}
            onPointerCancel={cancelLongPress}
          >
            {observation.text}
          </div>
        ) : canNext ? (
          <button
            className="observation-start"
            type="button"
            aria-label="Start observations"
            onClick={(event) => {
              event.stopPropagation();
              void move('next');
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <ArrowRight size={32} strokeWidth={1.5} aria-hidden="true" />
          </button>
        ) : (
          <div className="observation-placeholder" role="status" aria-label="Loading observation">
            ...
          </div>
        )}
          <AudioPlayerBar
            ref={playerRef}
            observationId={observation?.id ?? null}
            audio={observation?.audio ?? null}
            sourceId={observation?.sourceId ?? null}
            sourceKey={observation?.sourceKey ?? null}
            defaultPlaybackRate={state?.audioSettings.playbackRate ?? 1}
            controlsVisible={controlsVisible}
            onLoadingChange={setAudioLoading}
            onPlaybackErrorChange={setAudioError}
            onPrecisionInteraction={() => {
              taps.cancel();
              setControlsVisible(true);
              setPrecisionInteraction(value => value + 1);
            }}
          />
      </section>
      <div className="nav-region">
        <button
          className="nav-zone nav-zone-right"
          type="button"
          aria-label="తర్వాత"
          disabled={!canNext}
          onKeyDown={(event) => { if (event.repeat) event.preventDefault(); }}
          onClick={(
            event:
              MouseEvent<HTMLButtonElement>,
          ) => {
            if (event.detail === 0) {
              event.stopPropagation();
              if (canNext) void move('next');
            }
          }}
        />
      </div>
      {audioError ? <div className="audio-reader-error" role="alert">{audioError}</div> : null}
      {selectedWord && selectedWord.observationId === observation?.id ? (
        <WordProfile key={`${selectedWord.observationId}:${selectedWord.word}`} word={selectedWord.word} onClose={() => setSelectedWord(null)} />
      ) : null}
      {readingMenu ? (
        <ReadingContextMenu
          menu={readingMenu}
          onCopy={(text) => void copyToClipboard(text)}
          onBlacklist={(text) => {
            if (state) void addBlacklistEntry(state.profileCode, text).catch(() => {});
          }}
          onOpenSettings={onOpenSettings}
          onClose={() => setReadingMenu(null)}
        />
      ) : null}
    </main>
  );
}
