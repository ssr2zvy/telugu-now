import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type {
  ProfileStateResponse,
} from '../../../shared/contracts';
import {
  SettingsIcon,
} from '../components/icons';
import {
  AudioPlayerBar,
} from './audio/AudioPlayerBar';
import {
  useObservationTypography,
} from './useObservationTypography';
import { WordProfile } from './word/WordProfile';
import { wordAtOffset } from './word/word-analysis';
import { useAppearance } from '../appearance';
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
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [selectedWord, setSelectedWord] = useState<{ word: string; observationId: string } | null>(null);
  const screenRef = useRef<HTMLElement>(null);
  const controlsClickTimer = useRef<number | undefined>(undefined);
  const cancelControlsClick = () => {
    window.clearTimeout(controlsClickTimer.current);
    controlsClickTimer.current = undefined;
  };
  useEffect(() => {
    const screen = screenRef.current;
    if ((!controlsVisible && !settingsVisible) || !screen) return;
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
        setSettingsVisible(false);
      }, appearance.autoFadeSeconds * 1000);
    };
    const events = ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave', 'keydown', 'focusin', 'focusout'];
    for (const event of events) screen.addEventListener(event, scheduleHide);
    scheduleHide();
    return () => {
      window.clearTimeout(idleTimer);
      for (const event of events) screen.removeEventListener(event, scheduleHide);
    };
  }, [controlsVisible, settingsVisible, appearance.autoFadeSeconds]);
  const observation =
    state?.currentObservation ?? null;
  useEffect(() => () => {
    window.clearTimeout(controlsClickTimer.current);
    controlsClickTimer.current = undefined;
  }, [observation?.id]);
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
      setSettingsVisible(false);
    }
  };
  return (
    <main
      ref={screenRef}
      className={
        `app-shell observation-screen ${
          controlsVisible
            ? 'controls-visible'
            : ''
        } ${settingsVisible ? 'settings-visible' : ''}`
      }
      onFocusCapture={(event) => {
        if (event.target.matches(':focus-visible')) {
          if (event.target.closest('.audio-player-bar')) setControlsVisible(true);
          if (event.target.closest('.settings-trigger')) setSettingsVisible(true);
        }
      }}
      onKeyDownCapture={(event) => {
        if (event.target instanceof Element) {
          if (event.target.closest('.audio-player-bar')) setControlsVisible(true);
          if (event.target.closest('.settings-trigger')) setSettingsVisible(true);
        }
      }}
      onClick={(event) => {
        cancelControlsClick();
        if (event.detail > 1) return;
        const center = screenRef.current?.querySelector('.observation-center')?.getBoundingClientRect();
        if (center && event.clientX >= center.left && event.clientX <= center.right) {
          if (!window.getSelection()?.isCollapsed) return;
          controlsClickTimer.current = window.setTimeout(() => {
            controlsClickTimer.current = undefined;
            if (window.getSelection()?.isCollapsed) setControlsVisible((visible) => !visible);
          }, 500);
          return;
        }
        setControlsVisible((visible) => !visible);
      }}
      onDoubleClick={(event) => {
        const center = screenRef.current?.querySelector('.observation-center')?.getBoundingClientRect();
        if (center && event.clientX >= center.left && event.clientX <= center.right) {
          cancelControlsClick();
          setSettingsVisible(true);
        }
      }}
    >
      {navigationEvent ? (
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
          onDoubleClick={(event) => {
            event.stopPropagation();
            if (canBack) void move('back');
          }}
        />
      </div>
      <section
        ref={typography.containerRef}
        className="observation-center"
        onDoubleClick={(event) => {
          event.stopPropagation();
          cancelControlsClick();
          setSettingsVisible(true);
        }}
      >
        {observation ? (
          <div
            ref={typography.textRef}
            className="observation-text"
            style={typography.style}
            onMouseDown={event => {
              cancelControlsClick();
              if (event.button === 0 && event.detail > 1) event.preventDefault();
            }}
            onDoubleClick={event => {
              event.preventDefault();
              event.stopPropagation();
              cancelControlsClick();
              const element = event.currentTarget;
              const browserDocument = document as Document & {
                caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
                caretRangeFromPoint?: (x: number, y: number) => Range | null;
              };
              const position = browserDocument.caretPositionFromPoint?.(event.clientX, event.clientY);
              const range = position ? null : browserDocument.caretRangeFromPoint?.(event.clientX, event.clientY);
              const node = position?.offsetNode ?? range?.startContainer;
              const offset = position?.offset ?? range?.startOffset;
              if (!node || node !== element.firstChild || offset === undefined) {
                setSettingsVisible(true);
                return;
              }
              const word = wordAtOffset(observation.text, offset) ?? wordAtOffset(observation.text, offset - 1);
              if (!word) {
                setSettingsVisible(true);
                return;
              }
              const segment = [...new Intl.Segmenter('te', { granularity: 'word' }).segment(observation.text)]
                .find(part => part.isWordLike && part.segment === word && offset >= part.index && offset <= part.index + part.segment.length);
              if (!segment) {
                setSettingsVisible(true);
                return;
              }
              const hit = document.createRange();
              hit.setStart(node, segment.index);
              hit.setEnd(node, segment.index + segment.segment.length);
              const inside = [...hit.getClientRects()].some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
              if (inside) {
                window.getSelection()?.removeAllRanges();
                setControlsVisible(false);
                setSelectedWord({ word, observationId: observation.id });
              } else {
                setSettingsVisible(true);
              }
            }}
          >
            {observation.text}
          </div>
        ) : canNext ? (
          <button
            className="observation-start"
            type="button"
            aria-label="Start observations"
            title="Start observations"
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
        {observation?.audio ? (
          <AudioPlayerBar
            key={observation.id}
            audio={observation.audio}
            sourceId={observation.sourceId}
            sourceKey={observation.sourceKey}
            defaultPlaybackRate={state?.audioSettings.playbackRate ?? 1}
          />
        ) : null}
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
          onDoubleClick={(event) => {
            event.stopPropagation();
            if (canNext) void move('next');
          }}
        />
      </div>
      <button
        className="settings-trigger"
        type="button"
        aria-label="అమరికలు"
        onClick={(
          event:
            MouseEvent<HTMLButtonElement>,
        ) => {
          event.stopPropagation();
          onOpenSettings();
        }}
      >
        <SettingsIcon />
      </button>
      {selectedWord && selectedWord.observationId === observation?.id ? (
        <WordProfile key={`${selectedWord.observationId}:${selectedWord.word}`} word={selectedWord.word} onClose={() => setSelectedWord(null)} />
      ) : null}
    </main>
  );
}
