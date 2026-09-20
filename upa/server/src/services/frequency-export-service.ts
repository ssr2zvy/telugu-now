import { randomInt } from 'node:crypto';
import type Database from 'better-sqlite3';
import { config } from '../config/config';
import { openFrequencyIndex } from './frequency-index';

export class InvalidFrequencyExportRequestError extends Error {}

export interface FrequencyExportRequest {
  occurrenceLimit: number;
}

interface IndexedOccurrence {
  occurrence_index: number;
  normalized_word: string;
}

interface FrequencyMetadata {
  total_occurrences: number;
}

type RandomIndex = (maxExclusive: number) => number;

function csvCell(value: string | number | null): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function csv(header: readonly string[], rows: readonly (readonly (string | number | null)[])[]): string {
  return `\uFEFF${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function validateRequest(request: FrequencyExportRequest): void {
  if (!Number.isSafeInteger(request.occurrenceLimit) || request.occurrenceLimit <= 0
    || request.occurrenceLimit > config.maxFrequencyExportOccurrences) {
    throw new InvalidFrequencyExportRequestError(
      `Occurrence limit must be an integer from 1 through ${config.maxFrequencyExportOccurrences}.`,
    );
  }
}

function sampledIndexes(total: number, requested: number, random: RandomIndex): number[] | null {
  const count = Math.min(total, requested);
  if (count === total) return null;
  const selected = new Set<number>();
  for (let candidateRange = total - count; candidateRange < total; candidateRange += 1) {
    const candidate = random(candidateRange + 1);
    selected.add(selected.has(candidate) ? candidateRange : candidate);
  }
  const indexes = [...selected].map(index => index + 1);
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const other = random(index + 1);
    [indexes[index], indexes[other]] = [indexes[other]!, indexes[index]!];
  }
  return indexes;
}

function selectedOccurrences(
  frequency: Database.Database,
  requested: number,
  random: RandomIndex,
): IndexedOccurrence[] {
  const metadata = frequency.prepare(
    'SELECT total_occurrences FROM metadata',
  ).get() as { total_occurrences: number };
  const indexes = sampledIndexes(metadata.total_occurrences, requested, random);
  if (indexes === null) {
    return frequency.prepare(
      'SELECT occurrence_index, normalized_word FROM occurrences ORDER BY occurrence_index',
    ).all() as IndexedOccurrence[];
  }
  if (indexes.length === 0) return [];
  const rows = frequency.prepare(`
    SELECT occurrence_index, normalized_word FROM occurrences
    WHERE occurrence_index IN (SELECT value FROM json_each(?))
  `).all(JSON.stringify(indexes)) as IndexedOccurrence[];
  const byIndex = new Map(rows.map(row => [row.occurrence_index, row]));
  return indexes.map(index => byIndex.get(index)!);
}

export function getAvailableFrequencyOccurrences(
  frequencyOptions = {
    corpusDatabasePath: config.corpusDatabasePath,
    corpusFrequencyPath: config.corpusFrequencyPath,
  },
): number {
  const frequency = openFrequencyIndex(frequencyOptions);
  if (!frequency) throw new Error('CORPUS_FREQUENCY_MISSING_OR_INCOMPATIBLE');
  try {
    return (frequency.prepare('SELECT total_occurrences FROM metadata').get() as FrequencyMetadata).total_occurrences;
  } finally {
    frequency.close();
  }
}

export function generateFrequencyExport(
  request: FrequencyExportRequest,
  databasePath = config.corpusDatabasePath,
  random: RandomIndex = randomInt,
  frequencyPath = databasePath === config.corpusDatabasePath
    ? config.corpusFrequencyPath : `${databasePath}.frequency.sqlite`,
): Uint8Array<ArrayBuffer> {
  validateRequest(request);
  const frequency = openFrequencyIndex({ corpusDatabasePath: databasePath, corpusFrequencyPath: frequencyPath });
  if (!frequency) throw new Error('CORPUS_FREQUENCY_MISSING_OR_INCOMPATIBLE');
  try {
    const indexMetadata = frequency.prepare(`
      SELECT total_occurrences FROM metadata
    `).get() as FrequencyMetadata;
    const occurrences = selectedOccurrences(frequency, request.occurrenceLimit, random);
    const frequencies = new Map<string, number>();
    for (const occurrence of occurrences) {
      frequencies.set(occurrence.normalized_word, (frequencies.get(occurrence.normalized_word) ?? 0) + 1);
    }
    const ranking = occurrences.length === indexMetadata.total_occurrences
      ? (frequency.prepare(`
          SELECT normalized_word AS word, occurrence_count AS frequency
          FROM frequencies
          ORDER BY occurrence_count DESC, normalized_word ASC
        `).all() as Array<{ word: string; frequency: number }>)
      : [...frequencies.entries()]
          .sort(([leftWord, leftCount], [rightWord, rightCount]) =>
            rightCount - leftCount || (leftWord < rightWord ? -1 : leftWord > rightWord ? 1 : 0))
          .map(([word, frequencyCount]) => ({ word, frequency: frequencyCount }));
    return new TextEncoder().encode(csv(['word', 'frequency'], ranking.map(item => [item.word, item.frequency])));
  } finally {
    frequency.close();
  }
}
