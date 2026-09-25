import { probabilities, type Progress } from './model';
export function categoryCurve(levels: number[], sizes: number[], state: Progress) {
  const current = probabilities(sizes, state);
  const original = probabilities(sizes, { ...state, position: 0, completed: false });
  const position = Math.max(0, Math.min(levels.length - 1, state.position));
  const whole = Math.floor(position), part = position - whole;
  return levels.map((level, index) => ({ level, probability: current[index]!, initialProbability: original[index]!, targetCount: sizes[index]!,
    reversal: state.completed ? 1 : index <= whole ? (whole > 0 ? 1 : part) : index === whole + 1 ? part : 0 }));
}
