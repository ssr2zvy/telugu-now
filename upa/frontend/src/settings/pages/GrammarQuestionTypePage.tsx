import type { QuestionMode } from '../../../../shared/contracts';

/** Display recorded selection evidence; never reconstruct old probabilities from today's settings. */
export function GrammarQuestionTypePage({ selected, mode }: {
  selected: Record<string, unknown>; mode: QuestionMode | null;
}) {
  const value = selected.questionType;
  const curve = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const percent = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : '—';
  const rows: Array<[string, unknown]> = [
    ['Selected question type', mode ?? '—'],
    ['Selection policy', curve?.policy ?? 'Historical selection — curve not recorded'],
  ];
  if (curve) rows.push(
    ['Progression category', typeof curve.categoryIndex === 'number' ? curve.categoryIndex + 1 : '—'],
    ['Progression GI level', curve.categoryLevel ?? '—'],
    ['Grammar position at selection', curve.position],
    ['Progress within category', percent(curve.phase)],
    ['Text-given probability', percent(curve.textGiven)],
    ['Audio-given probability', percent(curve.audioGiven)],
    ['Selected-type probability', percent(curve.selectedProbability)],
    ['Random draw', curve.draw],
    ['All categories completed', curve.completed === true ? 'Yes — audio-heavy endpoint held' : 'No'],
    ['Update timing', 'Frozen for this batch of 10'],
  );
  return <table className="diagnostic-table"><tbody>{rows.map(([key, value]) => <tr key={key}><th scope="row">{key}</th><td>{String(value ?? '—')}</td></tr>)}</tbody></table>;
}
