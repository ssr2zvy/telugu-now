import type { DisplayObservation, ObservationAudio } from '../../../shared/contracts';

type ObservationContent = Pick<DisplayObservation, 'text' | 'audio' | 'kind' | 'question'>;

export function observationShowsText(observation: ObservationContent | null): boolean {
  if (!observation?.text.trim()) return false;
  if (observation.kind === 'question' && observation.question?.phase === 'comparison') return observation.question.mode === 'text-given';
  const activeQuestion = observation.kind === 'question' && observation.question?.phase === 'question'
    ? observation.question
    : null;
  return activeQuestion?.mode !== 'audio-given' || !observation.audio;
}

export function observationShowsPhaseIndicator(
  observation: ObservationContent | null,
  visibleAudio: ObservationAudio | null,
): boolean {
  if (observation?.kind === 'question' && observation.question?.phase === 'comparison') return true;
  return Boolean(observation) && (observationShowsText(observation) || Boolean(visibleAudio));
}
