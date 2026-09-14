import { db } from '../db/database';
import type { ObservationDisplayKind, QuestionKeyboard, QuestionMode } from '../../../shared/contracts';

/** Displayed-observation mix: normal reading versus questions. */
export const QUESTION_PROBABILITY = 0.3;
/** Within questions, how often the underlying row is one the profile has seen. */
export const QUESTION_SEEN_PROBABILITY = 0.75;
/** Within questions, audio-given versus text-given. */
export const AUDIO_GIVEN_PROBABILITY = 0.6;

export const QUESTION_KEYBOARDS: QuestionKeyboard[] = ['windows-inscript', 'mac-standard', 'chromebook-dictation'];

export type QuestionPool = 'seen' | 'unseen';

export interface QuestionPlan {
  displayKind: ObservationDisplayKind;
  pool: QuestionPool | null;
  mode: QuestionMode | null;
  keyboard: QuestionKeyboard | null;
}

export const NORMAL_PLAN: QuestionPlan = { displayKind: 'normal', pool: null, mode: null, keyboard: null };

/**
 * Draws the display kind and, for questions, the pool, the given-medium and the
 * keyboard. Each draw is independent so the documented marginal probabilities
 * hold exactly.
 */
export function planNextDisplay(random: () => number = Math.random): QuestionPlan {
  if (random() >= QUESTION_PROBABILITY) return NORMAL_PLAN;
  const pool: QuestionPool = random() < QUESTION_SEEN_PROBABILITY ? 'seen' : 'unseen';
  const mode: QuestionMode = random() < AUDIO_GIVEN_PROBABILITY ? 'audio-given' : 'text-given';
  // Only audio-given questions type an answer, so only they need a keyboard.
  const keyboard = mode === 'audio-given'
    ? QUESTION_KEYBOARDS[Math.min(QUESTION_KEYBOARDS.length - 1, Math.floor(random() * QUESTION_KEYBOARDS.length))] ?? null
    : null;
  return { displayKind: 'question', pool, mode, keyboard };
}

const selectSeenCount = db.prepare(
  'SELECT COUNT(*) AS count FROM recording_displays WHERE profile_code = ? AND source_id = ? AND source_key = ?',
);

/** A row counts as seen when this profile has already displayed that recording. */
export function hasSeenRow(profileCode: string, sourceId: string, sourceKey: string): boolean {
  const row = selectSeenCount.get(profileCode, sourceId, sourceKey) as { count: number };
  return row.count > 0;
}

export function poolHasAnySeenRow(profileCode: string): boolean {
  const row = db.prepare(
    'SELECT COUNT(*) AS count FROM recording_displays WHERE profile_code = ?',
  ).get(profileCode) as { count: number };
  return row.count > 0;
}
