import { randomUUID } from 'node:crypto';
import { config } from '../../config/config';
import type { DataSource, PreparedSourceObservation, SourceCandidate } from '../../domain/source';

const TELUGU_GRAPHEMES = [
  'తె', 'లు', 'గు', 'నా', 'మ', 'వి', 'నీ', 'కు', 'చే', 'పు', 'అ', 'ది', 'ఇ', 'లా', 'వే', 'ళ్', 'ళి',
  'మా', 'ట', 'ప్ర', 'శ్', 'న', 'స', 'రి', 'కొ', 'త్', 'త', 'ప', 'దం', 'చూ', 'డు', 'వా', 'రు', 'ఏ', 'మీ',
];

function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomGrapheme(): string {
  const value = TELUGU_GRAPHEMES[Math.floor(Math.random() * TELUGU_GRAPHEMES.length)];
  return value ?? 'తె';
}

export class MockDataSource implements DataSource {
  readonly id = 'mock';
  readonly enabled = true;
  readonly selectionWeight = 1;

  selectCandidate(): SourceCandidate {
    return { sourceKey: randomUUID() };
  }

  async prepare(_candidate: SourceCandidate): Promise<PreparedSourceObservation> {
    const delayMs = randomIntInclusive(config.mockDelayMinMs, config.mockDelayMaxMs);
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));

    return {
      text: `${randomGrapheme()}${randomGrapheme()}`,
    };
  }
}
