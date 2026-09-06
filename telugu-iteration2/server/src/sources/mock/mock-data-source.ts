import type {
  DataSource,
  PreparedSourceObservation,
  SourceCandidate,
  SourceCatalogRow,
} from '../../domain/source';
import { config } from '../../config/config';

// Compatibility-only resolver for pending Iteration 1 rows that may exist in a user's
// database during an upgrade. It is not part of the Iteration 2 selectable catalog.
const TELUGU_GRAPHEMES = [
  'తె', 'లు', 'గు', 'నా', 'మ', 'వి', 'నీ', 'కు', 'చే', 'పు', 'అ', 'ది', 'ఇ', 'లా', 'వే', 'ళ్', 'ళి',
  'మా', 'ట', 'ప్ర', 'శ్', 'న', 'స', 'రి', 'కొ', 'త్', 'త', 'ప', 'దం', 'చూ', 'డు', 'వా', 'రు', 'ఏ', 'మీ',
];

function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomGrapheme(): string {
  return TELUGU_GRAPHEMES[Math.floor(Math.random() * TELUGU_GRAPHEMES.length)] ?? 'తె';
}

export class LegacyIteration1MockDataSource implements DataSource {
  readonly id = 'mock';
  readonly enabled = false;

  catalog(): readonly SourceCatalogRow[] {
    return [];
  }

  async prepare(_candidate: SourceCandidate): Promise<PreparedSourceObservation> {
    const delayMs = randomIntInclusive(config.mockDelayMinMs, config.mockDelayMaxMs);
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    return { text: `${randomGrapheme()}${randomGrapheme()}` };
  }
}
