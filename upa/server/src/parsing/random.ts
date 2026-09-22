import { sourceRegistry, type SourceRegistry } from '../services/source-registry';
import { SelectionUnavailableError } from '../services/selection-engine';

/** Availability indices are merely dense row addresses here. Neither source
 * weights nor complexity values influence the probability: every row is 1/N. */
export function uniformAudioRow(registry: SourceRegistry = sourceRegistry, random = Math.random) {
  const sources = registry.selectableSources().map(source => ({ source, count: source.rowCount() }));
  const total = sources.reduce((sum, s) => sum + s.count, 0);
  if (!total) throw new SelectionUnavailableError('No corpus observations with available audio');
  let offset = Math.floor(random() * total);
  for (const { source, count } of sources) {
    if (offset >= count) { offset -= count; continue; }
    for (const group of source.complexityClasses()) {
      if (offset >= group.rowCount) { offset -= group.rowCount; continue; }
      const row = source.candidateAt(group.complexityValue, offset);
      return { sourceId: source.id, sourceKey: row.sourceKey,
        snapshot: { mode: 'random', sourceId: source.id, sourceKey: row.sourceKey, eligibleAudioRows: total, rowProbability: 1 / total } };
    }
  }
  throw new SelectionUnavailableError('Audio availability changed; retry selection');
}
