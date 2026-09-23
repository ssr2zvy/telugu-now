import type { DisplayObservation } from '../../../../shared/contracts';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};
const text = (...values: unknown[]): string => values.find(v => typeof v === 'string' && v.length) as string ?? '';

// Validate saved spans against the actual token. Older catalogs used code points;
// frequency producers can supply UTF-16 offsets. Never highlight an unchecked span.
export function matchedWordEvidence(selected: Record<string, unknown>, sentence: string) {
  const occurrence = record(selected.occurrence);
  const word = text(occurrence.original_token, occurrence.token_surface, occurrence.surface,
    selected.word, occurrence.word, occurrence.normalized_word);
  const normalized = text(selected.word, occurrence.normalized_word, occurrence.word, word);
  const points = Array.from(sentence);
  const start = occurrence.start_offset ?? occurrence.start_cp;
  const end = occurrence.end_offset ?? occurrence.end_cp;
  const spans = new Set<string>();
  if (typeof start === 'number' && typeof end === 'number' && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && word) {
    if (points.slice(start, end).join('') === word) spans.add(JSON.stringify([points.slice(0,start).join(''),word,points.slice(end).join('')]));
    if (sentence.slice(start, end) === word) spans.add(JSON.stringify([sentence.slice(0,start),word,sentence.slice(end)]));
  }
  let parts: [string,string,string] | null = spans.size === 1 ? JSON.parse([...spans][0]!) : null;
  let location = parts ? 'saved-span' : 'unavailable';
  // If a legacy record lacks offsets, show a unique literal occurrence only.
  // Do not guess which occurrence was selected when the word repeats.
  if (!parts && word) {
    const index = sentence.indexOf(word);
    const joinsWord = (char:string) => /[\p{L}\p{M}\p{N}_\u200c\u200d]/u.test(char);
    if (index >= 0 && sentence.indexOf(word,index+1) < 0 && !joinsWord(Array.from(sentence.slice(0,index)).at(-1)??'') && !joinsWord(Array.from(sentence.slice(index+word.length))[0]??'')) {
      parts = [sentence.slice(0,index),word,sentence.slice(index+word.length)];
      location = 'unique-word';
    }
  }
  return {word,normalized,parts,location};
}

export function SelectedWordMatch({observation}: {observation: DisplayObservation | null}) {
  if (!observation) return <p>No observation loaded.</p>;
  const selected = observation.grammar?.target;
  if (!selected) return <p>No selection record saved for this observation.</p>;
  const evidence = matchedWordEvidence(selected,observation.text);
  const rule = record(selected.observationSelection);
  return <div className="parser-settings">
    <dl className="parser-metrics">
      <dt>Word</dt><dd lang="te">{evidence.word || 'Not recorded'}</dd>
      <dt>Parse</dt><dd>{selected.parseSource === 'cached-parse' ? 'Reused' : selected.parseSource === 'new-parse' ? 'New' : 'Not recorded'}</dd>
      <dt>Word selection</dt><dd>{selected.wordSelection === 'shortest-codepoints-v1' ? 'Shortest match' : 'Earlier selection rule'}</dd>
      <dt>Observation selection</dt><dd>{rule.policy === 'core1-shortest-five-v1' ? `Random among ${String(rule.poolSize)} shortest` : rule.policy === 'all-matching-random-v1' ? 'Random among all matches' : 'Earlier selection rule'}</dd>
      <dt>Sentence length</dt><dd>{String(rule.length ?? '—')}</dd>
    </dl>
    <p className="parser-sentence" lang="te">{evidence.parts ? <>{evidence.parts[0]}<mark>{evidence.parts[1]}</mark>{evidence.parts[2]}</> : observation.text}</p>
    {!evidence.parts && evidence.word ? <p>Exact word position unavailable.</p> : null}
    <p className="parser-muted">{selected.policy === 'frequency-word-cache-v1' ? 'Only the selected word was checked for this selection.' : 'Evidence from the saved selection.'}</p>
    <section className="parser-block"><h2>Saved record</h2><pre>{JSON.stringify({observationId:observation.id,sourceId:observation.sourceId,sourceKey:observation.sourceKey,selection:selected},null,2)}</pre></section>
  </div>;
}
