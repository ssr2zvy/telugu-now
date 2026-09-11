import { config } from '../../config/config';
import type { DataSource, PreparedSourceObservation, SourceCandidate, SourceComplexityClass } from '../../domain/source';
const TELUGU_GRAPHEMES = ['తె', 'లు', 'గు', 'నా', 'మ', 'వి', 'నీ', 'కు', 'చే', 'పు', 'అ', 'ది', 'ఇ', 'లా', 'వే', 'ళ్', 'ళి', 'మా', 'ట', 'ప్ర', 'శ్', 'న', 'స', 'రి', 'కొ', 'త్', 'త', 'ప', 'దం', 'చూ', 'డు', 'వా', 'రు', 'ఏ', 'మీ'];
function randomIntInclusive(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomGrapheme(): string { return TELUGU_GRAPHEMES[Math.floor(Math.random() * TELUGU_GRAPHEMES.length)] ?? 'తె'; }
export class LegacyIteration1MockDataSource implements DataSource {
  readonly id = 'mock'; readonly enabled = false;
  rowCount(): number { return 0; }
  complexityClasses(): readonly SourceComplexityClass[] { return []; }
  candidateAt(_complexityValue: number, _classIndex: number): SourceCandidate { throw new Error('Legacy Iteration 1 mock source is not selectable.'); }
  info() { return { sourceId: this.id, displayName: 'Legacy Iteration 1 mock', provider: 'Telugu Now', license: 'Development compatibility source', upstreamUrl: null, catalogVersion: 1, acceptedRows: 0, rejectedRows: 0, complexityMetric: 'word-count' as const, status: 'fixture' as const }; }
  async prepare(_sourceKey: string): Promise<PreparedSourceObservation> {
    const delayMs = randomIntInclusive(config.mockDelayMinMs, config.mockDelayMaxMs);
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    const text = `${randomGrapheme()}${randomGrapheme()}`;
    return { text, media: [{ kind: 'text', language: 'te', text }] };
  }
}
