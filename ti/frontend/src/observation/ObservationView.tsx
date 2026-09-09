import {
  useState,
  type MouseEvent,
} from 'react';
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
  onMove: (
    direction: 'back' | 'next',
  ) => Promise<boolean>;
  onOpenSettings: () => void;
}
export function ObservationView({
  state,
  busy,
  onMove,
  onOpenSettings,
}: ObservationViewProps) {
  const [
    controlsVisible,
    setControlsVisible,
  ] = useState(false);
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
      <button
        className="nav-zone nav-zone-left"
        type="button"
        aria-label="వెనుక"
        disabled={!canBack}
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
