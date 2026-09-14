import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Circle, Square } from 'lucide-react';
import type { DisplayObservation } from '../../../../shared/contracts';
import { AudioPlayerBar, type AudioPlayerBarHandle } from '../audio/AudioPlayerBar';
import { useObservationTypography } from '../useObservationTypography';
import { useReaderScroll } from '../useReaderScroll';
import { scrollControlsVisible, type ScrollDirection } from '../reader-scroll';
import { ReaderTaps, readerTapRegions } from '../reader-taps';
import { useAppearance } from '../../appearance';
import { ObservationText } from '../ObservationText';
import { VirtualKeyboard } from './VirtualKeyboard';
import { useAnswerRecorder } from './useAnswerRecorder';

export interface QuestionAnswer {
  typed: string;
  recording: { url: string; durationSeconds: number } | null;
}

interface QuestionViewProps {
  observation: DisplayObservation;
  playbackRate: number;
  onSubmit: (answer: QuestionAnswer) => void;
}

/**
 * The question screen. The audio-given form gives the recording and takes a
 * typed answer; the text-given form gives the text and takes a recorded answer.
 * In both, the Toggle Trigger reveals the answering surface.
 */
export function QuestionView({ observation, playbackRate, onSubmit }: QuestionViewProps) {
  const { appearance } = useAppearance();
  const question = observation.question;
  const audioGiven = question?.mode === 'audio-given';
  const screenRef = useRef<HTMLElement>(null);
  const playerRef = useRef<AudioPlayerBarHandle>(null);
  const [taps] = useState(() => new ReaderTaps());
  const [answeringOpen, setAnsweringOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState('');
  const [revealDirection, setRevealDirection] = useState<ScrollDirection>(1);
  const revealedBy = useRef<ScrollDirection | null>(null);
  const recorder = useAnswerRecorder();
  const typography = useObservationTypography(audioGiven ? null : observation);

  const toggleAnswering = (direction: ScrollDirection | null) => {
    if (direction !== null) {
      const visible = scrollControlsVisible(answeringOpen, revealedBy.current, direction);
      if (!answeringOpen) {
        revealedBy.current = direction;
        setRevealDirection(direction);
      }
      setAnsweringOpen(visible);
      return;
    }
    setAnsweringOpen(open => !open);
  };

  const scrollHandlers = useReaderScroll(screenRef, appearance.scrollMode, observation.id, direction => {
    taps.cancel();
    toggleAnswering(direction);
  }, () => taps.cancel());

  useEffect(() => {
    setAnsweringOpen(false);
    setTyped('');
    setPending('');
    revealedBy.current = null;
    return () => taps.cancel();
  }, [observation.id, taps]);

  const submit = () => {
    recorder.stop();
    onSubmit({ typed: typed + (pending ? '' : ''), recording: recorder.answer });
  };

  return (
    <main
      ref={screenRef}
      {...scrollHandlers}
      data-scroll-mode={appearance.scrollMode}
      data-reveal-direction={revealDirection}
      className={`app-shell observation-screen question-screen${answeringOpen ? ' controls-visible answering-open' : ''}`}
      data-question-mode={question?.mode ?? 'audio-given'}
      aria-label={audioGiven
        ? 'Question. Listen to the audio and type what you hear.'
        : 'Question. Read the text and record yourself speaking it.'}
      onClick={(event) => {
        const bounds = screenRef.current?.getBoundingClientRect();
        if (!bounds) return;
        if (event.target instanceof Element && event.target.closest('.virtual-keyboard, .audio-player-bar, .question-actions, .question-answer-area')) return;
        const region = readerTapRegions(event.clientX, event.clientY, bounds);
        taps.tap(region.double, event.clientX, event.clientY, {
          onDouble: () => playerRef.current?.toggleTransportControls(),
          onSingle: () => {
            // Tap Mode uses the bottom third as the toggle trigger; Scroll Mode
            // reserves taps for play/pause and toggles on swipe instead.
            if (!appearance.scrollMode && region.single === 'controls') toggleAnswering(null);
            else playerRef.current?.togglePlay();
          },
        });
      }}
    >
      <section ref={typography.containerRef} className="observation-center question-center">
        {audioGiven ? (
          <div className="question-prompt" role="status">
            <span aria-hidden="true">♪</span>
          </div>
        ) : (
          <div ref={typography.textRef} className="observation-text" style={typography.style}>
            <ObservationText text={observation.text} />
          </div>
        )}
        <AudioPlayerBar
          ref={playerRef}
          observationId={audioGiven ? observation.id : `${observation.id}:answer`}
          audio={audioGiven ? observation.audio : recorder.answer
            ? { url: recorder.answer.url, mimeType: 'audio/wav', durationSeconds: recorder.answer.durationSeconds }
            : null}
          sourceId={observation.sourceId}
          sourceKey={observation.sourceKey}
          defaultPlaybackRate={playbackRate}
          controlsVisible
          onPrecisionInteraction={() => taps.cancel()}
        />
      </section>

      {audioGiven ? (
        <div className="question-answer-area" hidden={!answeringOpen}>
          {/* Typed text survives the keyboard being swiped away. */}
          <div className="question-typed" lang="te" style={typography.style} aria-live="polite">
            <ObservationText text={typed} />
            {pending ? <span className="question-pending">{pending}</span> : null}
          </div>
          {question?.keyboard ? (
            <VirtualKeyboard
              keyboard={question.keyboard}
              value={typed}
              pending={pending}
              onChange={(value, rest) => { setTyped(value); setPending(rest); }}
            />
          ) : null}
        </div>
      ) : (
        <div className="question-answer-area question-record-area" hidden={!answeringOpen}>
          <button
            type="button"
            className={`question-record${recorder.recording ? ' question-record-active' : ''}`}
            aria-pressed={recorder.recording}
            aria-label={recorder.recording ? 'Stop recording' : 'Record'}
            onClick={() => {
              if (recorder.recording) recorder.stop();
              // Re-recording continues from the playhead instead of restarting.
              else void recorder.start(playerRef.current?.currentTime() ?? 0);
            }}
          >
            {recorder.recording ? <Square size={18} aria-hidden="true" /> : <Circle size={18} aria-hidden="true" />}
          </button>
          {recorder.error ? <p className="question-error" role="alert">{recorder.error}</p> : null}
        </div>
      )}

      <div className="question-actions">
        <button type="button" className="question-next" aria-label="Next" title="Next" onClick={submit}>
          <ArrowRight size={20} aria-hidden="true" />
        </button>
      </div>
    </main>
  );
}
