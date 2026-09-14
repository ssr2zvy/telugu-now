import { useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import type { DisplayObservation } from '../../../../shared/contracts';
import { AudioPlayerBar, type AudioPlayerBarHandle } from '../audio/AudioPlayerBar';
import { useObservationTypography } from '../useObservationTypography';
import { ObservationText } from '../ObservationText';
import type { QuestionAnswer } from './QuestionView';

interface AnswerViewProps {
  observation: DisplayObservation;
  answer: QuestionAnswer;
  playbackRate: number;
  onNext: () => void;
}

/**
 * Split answer page: the real observation keeps the full normal-observation
 * presentation in three quarters of the screen, and the user's own answer sits
 * in the remaining quarter — leading side on wide screens, top on tall ones.
 */
export function AnswerView({ observation, answer, playbackRate, onNext }: AnswerViewProps) {
  const observationPlayer = useRef<AudioPlayerBarHandle>(null);
  const answerPlayer = useRef<AudioPlayerBarHandle>(null);
  const typography = useObservationTypography(observation);
  const answerTypography = useObservationTypography(observation);
  const audioGiven = observation.question?.mode === 'audio-given';

  return (
    <main className="app-shell answer-screen" aria-label="Answer">
      <section className="answer-user" aria-label="Your answer">
        {audioGiven ? (
          <div className="answer-typed observation-text" lang="te" style={answerTypography.style}>
            {answer.typed ? <ObservationText text={answer.typed} /> : '—'}
          </div>
        ) : (
          <div className="answer-user-audio">
            <AudioPlayerBar
              ref={answerPlayer}
              observationId={`${observation.id}:answer`}
              audio={answer.recording
                ? { url: answer.recording.url, mimeType: 'audio/wav', durationSeconds: answer.recording.durationSeconds }
                : null}
              sourceId={observation.sourceId}
              sourceKey={`${observation.sourceKey}:answer`}
              defaultPlaybackRate={playbackRate}
              controlsVisible
            />
          </div>
        )}
      </section>

      <section ref={typography.containerRef} className="observation-center answer-observation">
        <div ref={typography.textRef} className="observation-text" style={typography.style}>
          <ObservationText text={observation.text} />
        </div>
        <AudioPlayerBar
          ref={observationPlayer}
          observationId={observation.id}
          audio={observation.audio}
          sourceId={observation.sourceId}
          sourceKey={observation.sourceKey}
          defaultPlaybackRate={playbackRate}
          controlsVisible
        />
      </section>

      <div className="question-actions">
        <button type="button" className="question-next" aria-label="Next" title="Next" onClick={onNext}>
          <ArrowRight size={20} aria-hidden="true" />
        </button>
      </div>
    </main>
  );
}
