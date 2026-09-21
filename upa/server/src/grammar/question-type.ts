import type { QuestionMode } from '../../../shared/contracts';
import type { Progress } from './model';

/** Two ranks of the same 1/r Zipf family used by the grammar curve. */
const zipfWeights = [1, 1 / 2] as const;
const peak = zipfWeights[0] / (zipfWeights[0] + zipfWeights[1]);
const tail = 1 - peak;
export const QUESTION_TYPE_POLICY = 'category-local-reversing-zipf-v1';

export interface QuestionTypeCurve {
  policy: typeof QUESTION_TYPE_POLICY;
  position: number;
  /** Zero-based progression category, independent of the category sampled for review. */
  categoryIndex: number;
  categoryCount: number;
  phase: number;
  completed: boolean;
  textGiven: number;
  audioGiven: number;
}
export interface QuestionTypeSelection extends QuestionTypeCurve {
  mode: QuestionMode;
  draw: number;
  selectedProbability: number;
}

export function questionTypeCurve(sizes: readonly number[], state: Progress): QuestionTypeCurve {
  if (!sizes.length || sizes.some(n => !Number.isInteger(n) || n < 1)) throw new Error('Empty grammar inventory');
  if (!Number.isFinite(state.position)) throw new Error('Invalid grammar position');
  const K = sizes.length;
  // At completion there is no next category: hold the final audio-heavy endpoint.
  const position = state.completed ? K : Math.min(K, Math.max(0, state.position));
  const categoryIndex = Math.min(K - 1, Math.floor(position));
  const phase = state.completed ? 1 : Math.min(1, position - categoryIndex);
  const textGiven = (1 - phase) * peak + phase * tail;
  return { policy: QUESTION_TYPE_POLICY, position, categoryIndex, categoryCount: K,
    phase, completed: state.completed, textGiven, audioGiven: 1 - textGiven };
}

export function chooseQuestionType(sizes: readonly number[], state: Progress, random = Math.random): QuestionTypeSelection {
  const curve = questionTypeCurve(sizes, state);
  const draw = random();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new Error('Question-type draw must be in [0, 1)');
  const mode: QuestionMode = draw < curve.textGiven ? 'text-given' : 'audio-given';
  return { ...curve, mode, draw, selectedProbability: mode === 'text-given' ? curve.textGiven : curve.audioGiven };
}
