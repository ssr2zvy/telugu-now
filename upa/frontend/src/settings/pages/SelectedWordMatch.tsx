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
  if (!observation) return <section><h3>Current observation</h3><p>No observation is displayed yet. The preparation status below shows what the app is doing.</p></section>;
  const selected = observation.grammar?.target;
  if (!selected) return <section><h3>Current observation</h3><p>This saved observation has no target or matched-word record. This is missing selection history, not a parser loading state.</p><p>{observation.text}</p></section>;
  const evidence = matchedWordEvidence(selected,observation.text);
  const observationRule = record(selected.observationSelection);
  const live = selected.policy === 'frequency-word-cache-v1';
  const target = text(selected.label,selected.targetId);
  const matches = Array.isArray(selected.matchedTargets) ? selected.matchedTargets.map(record) : [];
  return <section aria-label="Current observation match">
    <h3>Current observation: {evidence.word ? 'matched word saved' : 'word evidence unavailable'}</h3>
    {evidence.word ? <>
      <p>Matched word: <strong lang="te" style={{fontSize:'1.4em'}}>{evidence.word}</strong></p>
      <p>Selected object: <strong>{target || 'Not recorded'}</strong>{selected.core ? ` · Core ${selected.core}` : ''}</p>
      <p lang="te" style={{fontSize:'1.2em',lineHeight:1.8,overflowWrap:'anywhere'}}>{evidence.parts ? <>{evidence.parts[0]}<mark style={{background:'#ffe08a',color:'#201800',padding:'0 .12em'}}>{evidence.parts[1]}</mark>{evidence.parts[2]}</> : observation.text}</p>
      {!evidence.parts ? <p>The word was saved, but its exact occurrence cannot be located reliably in this text.</p> : null}
      <p>{live ? 'This word matched the selected object. The other words in this observation were not checked for this selection; they are not marked as failures.' : 'This is the word recorded by the earlier selection system. It is not a new live parse of this observation.'}</p>
      <p>{selected.parseSource === 'cached-parse' ? 'The saved word parse was reused; parsing this word is already complete.' : selected.parseSource === 'new-parse' ? 'The word was parsed successfully when this question was selected.' : 'The saved record does not say whether its parse was new or reused.'}</p>
      {selected.wordSelection === 'shortest-codepoints-v1' ? <p>The shortest matching word with an available observation was chosen. Length is measured in Unicode code points. Observation selection is shown below.</p> : <p>This question was selected before shortest-word selection was installed. The new rule applies to newly selected questions.</p>}
      {observationRule.policy === 'core1-shortest-five-v1' ? <p>Core 1 observation: chosen randomly from the {String(observationRule.poolSize)} shortest usable observations containing this word (up to five). Sentence length: {String(observationRule.length)} characters, using the corpus grapheme count.</p>
        : observationRule.policy === 'all-matching-random-v1' ? <p>Observation: chosen randomly from all usable observations containing this word.</p>
        : <p>This saved question predates the Core 1 shortest-five observation rule. Newly selected Core 1 questions use it.</p>}
      {Array.isArray(selected.chain) && selected.chain.length ? <p>Parsed modifier chain: {selected.chain.map(String).join(' → ')}</p> : null}
      {matches.length > 1 ? <p>This same resolved parse also matched: {matches.filter(m=>m.id!==selected.targetId).map(m=>text(m.label,m.id)).join(' · ')}. Progress for this question belongs to the selected object above.</p> : null}
      <details><summary>Saved match identifiers</summary><p>Object: {text(selected.targetId)}</p><p>Word in frequency: {evidence.normalized}</p><p>Source: {observation.sourceId} / {observation.sourceKey}</p><p>Observation: {observation.id}</p></details>
    </> : <>
      <p>Selected object: {target || 'Not recorded'}</p><p>{observation.text}</p>
      <p>This older selection did not save which word matched. That cannot be recovered from the object name alone. Answer this question and continue; newly selected questions save the matched word and its occurrence.</p>
      <p>This does not mean that the sentence failed parsing or that the parser is still loading.</p>
    </>}
  </section>;
}
