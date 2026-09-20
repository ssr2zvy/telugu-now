import { createHash } from 'node:crypto';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { config } from '../config/config';
import { clean_word, token_spans, TOKENIZER_VERSION } from './telugu-tokenizer';
import { createStoredZip } from './stored-zip';

export class InvalidFrequencyExportRequestError extends Error {}

export interface FrequencyExportRequest {
  occurrenceLimit: number;
  frequencyLimit: number | null;
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

interface Occurrence {
  processingIndex: number;
  sourceId: string;
  transcriptId: string;
  tokenOrdinal: number;
  startOffset: number;
  endOffset: number;
  originalToken: string;
  normalizedWord: string;
}

interface SourceCounts {
  corpusTranscripts: number;
  availableOccurrences: number;
  contributingTranscripts: Set<string>;
  processedOccurrences: number;
}

const PROCESSING_ORDER_RULE = 'SQLite BINARY ascending source_id, then source_key; tokenizer candidates in start-offset order';
const FINGERPRINT_RULE = 'SHA-256 over UTF-8 JSON source records, then [source_id,source_key,exact_text] transcript arrays in processing order, separated by LF';

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
  if (!Number.isSafeInteger(request.occurrenceLimit) || request.occurrenceLimit <= 0
    || (request.frequencyLimit !== null
      && (!Number.isSafeInteger(request.frequencyLimit) || request.frequencyLimit <= 0))) {
    throw new InvalidFrequencyExportRequestError('Limits must be positive integers.');
  }
}

function openCorpus(databasePath: string): Database.Database {
  if (!fs.existsSync(databasePath)) throw new Error('CORPUS_NOT_PREPARED');
  return new Database(databasePath, { readonly: true, fileMustExist: true });
}

export function getAvailableFrequencyOccurrences(databasePath = config.corpusDatabasePath): number {
  const database = openCorpus(databasePath);
  try {
    let count = 0;
    database.exec('BEGIN');
    const rows = database.prepare(`
      SELECT r.text
      FROM source_rows r JOIN sources s ON s.source_id = r.source_id
      WHERE s.status IN ('ready', 'fixture')
      ORDER BY r.source_id COLLATE BINARY, r.source_key COLLATE BINARY
    `).iterate() as Iterable<{ text: string }>;
    for (const row of rows) {
      for (const span of token_spans(row.text)) if (clean_word(span.token) !== null) count += 1;
    }
    database.exec('COMMIT');
    return count;
  } catch (error) {
    if (database.inTransaction) database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

export function generateFrequencyExport(
  request: FrequencyExportRequest,
  databasePath = config.corpusDatabasePath,
  exportedAt = new Date(),
): Uint8Array {
  validateRequest(request);
  const database = openCorpus(databasePath);
  try {
    database.exec('BEGIN');
    const sources = database.prepare(`
      SELECT source_id, display_name, provider, license, upstream_url, catalog_version
      FROM sources WHERE status IN ('ready', 'fixture')
      ORDER BY source_id COLLATE BINARY
    `).all() as CorpusSource[];
    const transcripts = database.prepare(`
      SELECT r.source_id, r.source_key, r.text, r.audio_object_key, r.source_metadata_json
      FROM source_rows r JOIN sources s ON s.source_id = r.source_id
      WHERE s.status IN ('ready', 'fixture')
      ORDER BY r.source_id COLLATE BINARY, r.source_key COLLATE BINARY
    `).iterate() as Iterable<CorpusTranscript>;

    const fingerprint = createHash('sha256');
    for (const source of sources) {
      fingerprint.update(`${JSON.stringify({ sourceId: source.source_id, catalogVersion: source.catalog_version })}\n`);
    }
    const counts = new Map<string, SourceCounts>(sources.map(source => [source.source_id, {
      corpusTranscripts: 0,
      availableOccurrences: 0,
      contributingTranscripts: new Set<string>(),
      processedOccurrences: 0,
    }]));
    const occurrences: Occurrence[] = [];
    const contributing = new Map<string, CorpusTranscript>();
    const frequencies = new Map<string, number>();
    let availableOccurrences = 0;

    for (const transcript of transcripts) {
      fingerprint.update(`${JSON.stringify([transcript.source_id, transcript.source_key, transcript.text])}\n`);
      const sourceCounts = counts.get(transcript.source_id)!;
      sourceCounts.corpusTranscripts += 1;
      const spans = token_spans(transcript.text);
      for (let tokenOrdinal = 0; tokenOrdinal < spans.length; tokenOrdinal += 1) {
        const span = spans[tokenOrdinal]!;
        const word = clean_word(span.token);
        if (word === null) continue;
        availableOccurrences += 1;
        sourceCounts.availableOccurrences += 1;
        if (occurrences.length >= request.occurrenceLimit) continue;
        const occurrence: Occurrence = {
          processingIndex: occurrences.length + 1,
          sourceId: transcript.source_id,
          transcriptId: transcript.source_key,
          tokenOrdinal,
          startOffset: span.start,
          endOffset: span.end,
          originalToken: span.token,
          normalizedWord: word,
        };
        occurrences.push(occurrence);
        sourceCounts.processedOccurrences += 1;
        sourceCounts.contributingTranscripts.add(transcript.source_key);
        contributing.set(`${transcript.source_id}\0${transcript.source_key}`, transcript);
        frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
      }
    }

    const completeRanking = [...frequencies.entries()]
      .sort(([leftWord, leftCount], [rightWord, rightCount]) =>
        rightCount - leftCount || (leftWord < rightWord ? -1 : leftWord > rightWord ? 1 : 0))
      .map(([word, frequency], index) => ({ rank: index + 1, word, frequency }));
    const ranking = request.frequencyLimit === null
      ? completeRanking
      : completeRanking.slice(0, request.frequencyLimit);
    const actualOccurrences = occurrences.length;
    const completeFrequencyTotal = completeRanking.reduce((sum, item) => sum + item.frequency, 0);
    const topXIsCompleteRankingPrefix = ranking.every((item, index) => {
      const complete = completeRanking[index];
      return complete?.rank === item.rank
        && complete.word === item.word
        && complete.frequency === item.frequency;
    });
    if (completeFrequencyTotal !== actualOccurrences || occurrences.length !== actualOccurrences) {
      throw new Error('Frequency export totals do not match.');
    }
    if (!topXIsCompleteRankingPrefix) throw new Error('Frequency export ranking is not a prefix.');

    const includedSourceIds = sources
      .filter(source => (counts.get(source.source_id)?.processedOccurrences ?? 0) > 0)
      .map(source => source.source_id);
    const metadata = {
      corpus: {
        databaseVersion: null,
        sourceCatalogVersions: Object.fromEntries(
          sources.map(source => [source.source_id, source.catalog_version]),
        ),
        fingerprintSha256: fingerprint.digest('hex'),
        fingerprintRule: FINGERPRINT_RULE,
        includedSourceIds,
      },
      exportedAt: exportedAt.toISOString(),
      settings: {
        requestedOccurrenceLimit: request.occurrenceLimit,
        requestedFrequencyRows: request.frequencyLimit,
        completeFrequencyListRequested: request.frequencyLimit === null,
      },
      counts: {
        availableAcceptedOccurrences: availableOccurrences,
        actualProcessedOccurrences: actualOccurrences,
        contributingTranscripts: contributing.size,
        fullSampleVocabularySize: completeRanking.length,
        exportedFrequencyRows: ranking.length,
      },
      frequencyListComplete: ranking.length === completeRanking.length,
      tokenizerVersion: TOKENIZER_VERSION,
      processingOrderRule: PROCESSING_ORDER_RULE,
      offsetSemantics: 'Unicode code points; start inclusive and end exclusive in original transcript text',
      tokenOrdinalSemantics: 'Zero-based among all tokenizer candidates, including rejected candidates',
      perSource: sources.map(source => {
        const item = counts.get(source.source_id)!;
        return {
          sourceId: source.source_id,
          corpusTranscripts: item.corpusTranscripts,
          availableAcceptedOccurrences: item.availableOccurrences,
          contributingTranscripts: item.contributingTranscripts.size,
          processedOccurrences: item.processedOccurrences,
        };
      }),
      validation: {
        completeFrequencyTotal,
        occurrenceMappingRows: occurrences.length,
        totalsMatch: completeFrequencyTotal === actualOccurrences,
        topXIsCompleteRankingPrefix,
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
          ['processing_order_index', 'source_id', 'transcript_id', 'token_ordinal', 'start_offset', 'end_offset', 'original_token', 'normalized_word'],
          occurrences.map(item => [
            item.processingIndex, item.sourceId, item.transcriptId, item.tokenOrdinal,
            item.startOffset, item.endOffset, item.originalToken, item.normalizedWord,
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
  }
}
