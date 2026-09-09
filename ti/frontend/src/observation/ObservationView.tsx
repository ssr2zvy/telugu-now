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
  const [
    controlsVisible,
    setControlsVisible,
  ] = useState(false);
  const screenRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const screen = screenRef.current;
    if (!controlsVisible || !screen) return;
    let idleTimer: number;
    const scheduleHide = (event?: Event) => {
      window.clearTimeout(idleTimer);
      if (event instanceof PointerEvent && event.buttons !== 0) return;
      idleTimer = window.setTimeout(() => {
        if (screen.querySelector('.audio-player-bar:hover, .settings-trigger:hover, .audio-magnifier, .audio-speed-popover, :focus-visible')) {
          scheduleHide();
          return;
        }
        setControlsVisible(false);
      }, 3000);
    };
    const events = ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'pointerleave', 'keydown', 'focusin', 'focusout'];
    for (const event of events) screen.addEventListener(event, scheduleHide);
    scheduleHide();
    return () => {
      window.clearTimeout(idleTimer);
      for (const event of events) screen.removeEventListener(event, scheduleHide);
    };
  }, [controlsVisible]);
  const observation =
    state?.currentObservation ?? null;
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
  return (
    <main
      ref={screenRef}
      className={
        `app-shell observation-screen ${
          controlsVisible
            ? 'controls-visible'
            : ''
        }`
      }
      onClick={() =>
        setControlsVisible(
          (visible) => !visible,
        )
      }
    >
      {navigationEvent ? (
        <div
          key={navigationEvent.sequence}
          className="navigation-feedback"
          role="status"
          aria-label={`${navigationEvent.direction === 'next' ? 'Next' : 'Back'} request ${navigationEvent.sequence}`}
          data-sequence={navigationEvent.sequence}
        >
          {navigationEvent.direction === 'next' ? <ArrowRight size={18} aria-hidden="true" /> : <ArrowLeft size={18} aria-hidden="true" />}
          <span aria-hidden="true">{navigationEvent.sequence}</span>
        </div>
      ) : null}
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
          event.stopPropagation();
          if (event.detail === 0 && canBack) {
            void move('back');
          }
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (canBack) void move('back');
        }}
      />
      <section
        ref={typography.containerRef}
        className="observation-center"
      >
        {observation ? (
          <div
            ref={typography.textRef}
            className="observation-text"
            style={typography.style}
          >
            {observation.text}
          </div>
        ) : (
          <div className="observation-placeholder">
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
          event.stopPropagation();
          if (event.detail === 0 && canNext) {
            void move('next');
          }
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (canNext) void move('next');
        }}
      />
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
    </main>
  );
}
