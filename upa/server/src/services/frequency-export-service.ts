import { randomInt } from 'node:crypto';
import Database from 'better-sqlite3';
import { config } from '../config/config';
import { openFrequencyIndex } from './frequency-index';
import { TOKENIZER_VERSION } from './telugu-tokenizer';
import { createStoredZip } from './stored-zip';

export class InvalidFrequencyExportRequestError extends Error {}

export interface FrequencyExportRequest {
  occurrenceLimit: number;
}

interface CorpusSource {
  source_id: string;
  display_name: string;
  provider: string;
  license: string;
  upstream_url: string | null;
  catalog_version: number;
}

interface CorpusTranscript {
  source_id: string;
  source_key: string;
  text: string;
  audio_object_key: string;
  source_metadata_json: string;
}

interface IndexedOccurrence {
  occurrence_index: number;
  source_id: string;
  source_key: string;
  token_ordinal: number;
  start_offset: number;
  end_offset: number;
  original_token: string;
  normalized_word: string;
}

interface FrequencyMetadata {
  generation: string;
  corpus_fingerprint_sha256: string;
  total_occurrences: number;
}

type RandomIndex = (maxExclusive: number) => number;

function csvCell(value: string | number | null): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function csv(header: readonly string[], rows: readonly (readonly (string | number | null)[])[]): string {
  return `\uFEFF${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function metadataValue(json: string, names: readonly string[]): string | null {
  try {
    const value = JSON.parse(json) as Record<string, unknown>;
    for (const name of names) {
      const candidate = value[name];
      if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate);
    }
  } catch {
    return null;
  }
  return null;
}

function validateRequest(request: FrequencyExportRequest): void {
  if (!Number.isSafeInteger(request.occurrenceLimit) || request.occurrenceLimit <= 0) {
    throw new InvalidFrequencyExportRequestError('Occurrence limit must be a positive integer.');
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
    return frequency.prepare('SELECT * FROM occurrences ORDER BY occurrence_index').all() as IndexedOccurrence[];
  }
  if (indexes.length === 0) return [];
  const rows = frequency.prepare(`
    SELECT * FROM occurrences
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
  exportedAt = new Date(),
  random: RandomIndex = randomInt,
  frequencyPath = databasePath === config.corpusDatabasePath
    ? config.corpusFrequencyPath : `${databasePath}.frequency.sqlite`,
): Uint8Array {
  validateRequest(request);
  const frequency = openFrequencyIndex({ corpusDatabasePath: databasePath, corpusFrequencyPath: frequencyPath });
  if (!frequency) throw new Error('CORPUS_FREQUENCY_MISSING_OR_INCOMPATIBLE');
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    database.exec('BEGIN');
    const sources = database.prepare(`
      SELECT source_id, display_name, provider, license, upstream_url, catalog_version
      FROM sources WHERE status IN ('ready', 'fixture')
      ORDER BY source_id COLLATE BINARY
    `).all() as CorpusSource[];
    const indexMetadata = frequency.prepare(`
      SELECT generation, corpus_fingerprint_sha256, total_occurrences FROM metadata
    `).get() as FrequencyMetadata;
    const occurrences = selectedOccurrences(frequency, request.occurrenceLimit, random);
    const frequencies = new Map<string, number>();
    const contributing = new Map<string, CorpusTranscript>();
    const processedBySource = new Map<string, number>();
    const contributingBySource = new Map<string, Set<string>>();
    const transcriptQuery = database.prepare(`
      SELECT source_id, source_key, text, audio_object_key, source_metadata_json
      FROM source_rows WHERE source_id = ? AND source_key = ?
    `);
    for (const occurrence of occurrences) {
      frequencies.set(occurrence.normalized_word, (frequencies.get(occurrence.normalized_word) ?? 0) + 1);
      processedBySource.set(occurrence.source_id, (processedBySource.get(occurrence.source_id) ?? 0) + 1);
      const transcriptKey = `${occurrence.source_id}\0${occurrence.source_key}`;
      if (!contributing.has(transcriptKey)) {
        const transcript = transcriptQuery.get(
          occurrence.source_id, occurrence.source_key,
        ) as CorpusTranscript | undefined;
        if (!transcript) throw new Error('Frequency occurrence transcript is missing.');
        contributing.set(transcriptKey, transcript);
        const sourceTranscripts = contributingBySource.get(occurrence.source_id) ?? new Set<string>();
        sourceTranscripts.add(occurrence.source_key);
        contributingBySource.set(occurrence.source_id, sourceTranscripts);
      }
    }
    const ranking = occurrences.length === indexMetadata.total_occurrences
      ? (frequency.prepare(`
          SELECT normalized_word AS word, occurrence_count AS frequency
          FROM frequencies
          ORDER BY occurrence_count DESC, normalized_word ASC
        `).all() as Array<{ word: string; frequency: number }>)
          .map((item, index) => ({ rank: index + 1, ...item }))
      : [...frequencies.entries()]
          .sort(([leftWord, leftCount], [rightWord, rightCount]) =>
            rightCount - leftCount || (leftWord < rightWord ? -1 : leftWord > rightWord ? 1 : 0))
          .map(([word, frequencyCount], index) => ({ rank: index + 1, word, frequency: frequencyCount }));
    const indexedSourceCounts = new Map(
      (frequency.prepare('SELECT source_id, transcript_count, occurrence_count FROM source_counts').all() as Array<{
        source_id: string; transcript_count: number; occurrence_count: number;
      }>).map(item => [item.source_id, item]),
    );
    const includedSourceIds = sources
      .filter(source => (processedBySource.get(source.source_id) ?? 0) > 0)
      .map(source => source.source_id);
    const completeFrequencyTotal = ranking.reduce((sum, item) => sum + item.frequency, 0);
    if (completeFrequencyTotal !== occurrences.length) throw new Error('Frequency export totals do not match.');
    const metadata = {
      corpus: {
        databaseVersion: null,
        sourceCatalogVersions: Object.fromEntries(
          sources.map(source => [source.source_id, source.catalog_version]),
        ),
        fingerprintSha256: indexMetadata.corpus_fingerprint_sha256,
        includedSourceIds,
      },
      frequencyIndexGeneration: indexMetadata.generation,
      exportedAt: exportedAt.toISOString(),
      settings: { requestedOccurrenceLimit: request.occurrenceLimit },
      counts: {
        availableAcceptedOccurrences: indexMetadata.total_occurrences,
        actualProcessedOccurrences: occurrences.length,
        contributingTranscripts: contributing.size,
        sampleVocabularySize: ranking.length,
        exportedFrequencyRows: ranking.length,
      },
      frequencyListCompleteForSample: true,
      tokenizerVersion: TOKENIZER_VERSION,
      samplingRule: 'Uniform random sample without replacement from all indexed accepted occurrences',
      offsetSemantics: 'Unicode code points; start inclusive and end exclusive in original transcript text',
      tokenOrdinalSemantics: 'Zero-based among all tokenizer candidates, including rejected candidates',
      perSource: sources.map(source => ({
        sourceId: source.source_id,
        corpusTranscripts: indexedSourceCounts.get(source.source_id)?.transcript_count ?? 0,
        availableAcceptedOccurrences: indexedSourceCounts.get(source.source_id)?.occurrence_count ?? 0,
        contributingTranscripts: contributingBySource.get(source.source_id)?.size ?? 0,
        processedOccurrences: processedBySource.get(source.source_id) ?? 0,
      })),
      validation: {
        completeFrequencyTotal,
        occurrenceMappingRows: occurrences.length,
        totalsMatch: completeFrequencyTotal === occurrences.length,
      },
    };
    const transcriptRows = [...contributing.values()].map(transcript => [
      transcript.source_id,
      transcript.source_key,
      metadataValue(transcript.source_metadata_json, [
        'sentenceId', 'sentence_id', 'recordId', 'record_id', 'utteranceId', 'utterance_id', 'id',
      ]),
      metadataValue(transcript.source_metadata_json, ['upstreamAudioPath', 'audioFilename'])
        ?? transcript.audio_object_key,
      transcript.text,
      transcript.source_metadata_json,
    ]);
    const includedSources = sources.filter(source => includedSourceIds.includes(source.source_id));
    const archive = createStoredZip([
      {
        name: 'frequencies.csv',
        data: csv(['rank', 'word', 'frequency'], ranking.map(item => [item.rank, item.word, item.frequency])),
      },
      {
        name: 'occurrences.csv',
        data: csv(
          ['sample_index', 'source_id', 'transcript_id', 'token_ordinal', 'start_offset', 'end_offset', 'original_token', 'normalized_word'],
          occurrences.map((item, index) => [
            index + 1, item.source_id, item.source_key, item.token_ordinal,
            item.start_offset, item.end_offset, item.original_token, item.normalized_word,
          ]),
        ),
      },
      {
        name: 'transcripts.csv',
        data: csv(
          ['source_id', 'transcript_id', 'original_dataset_record_id', 'stable_media_file_reference', 'original_text', 'source_metadata_json'],
          transcriptRows,
        ),
      },
      {
        name: 'sources.csv',
        data: csv(
          ['source_id', 'source_name', 'dataset_collection_name', 'dataset_collection_version', 'provider', 'license', 'original_source_url'],
          includedSources.map(source => [
            source.source_id, source.display_name, source.display_name, source.catalog_version,
            source.provider, source.license, source.upstream_url,
          ]),
        ),
      },
      { name: 'metadata.json', data: `${JSON.stringify(metadata, null, 2)}\n` },
    ]);
    database.exec('COMMIT');
    return archive;
  } catch (error) {
    if (database.inTransaction) database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
    frequency.close();
  }
}
