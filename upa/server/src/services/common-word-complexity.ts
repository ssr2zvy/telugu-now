import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export const MAX_COMMON_WORD_REDUCTION = 20;
export const DEFAULT_COMMON_WORD_REDUCTION = 2;

export interface CorpusTextRow {
  source_id: string;
  source_key: string;
  text: string;
  grapheme_count: number;
}

export interface CommonWord {
  word: string;
  occurrences: number;
  commonality: number;
}

const WORD_PATTERN = /[\p{L}\p{M}\p{N}]+/gu;

/** Words are matched on their surface form, normalized so ranking is stable. */
export function corpusWords(text: string): string[] {
  return text.normalize('NFC').match(WORD_PATTERN) ?? [];
}

function graphemeCount(text: string): number {
  return [...new Intl.Segmenter('te', { granularity: 'grapheme' }).segment(text)].length;
}

/**
 * Common Word Inclusion.
 *
 * Every word gets a commonality derived from how often it occurs in the corpus
 * itself, so a single fixed ranking emerges for a corpus generation. A word's
 * commonality is compared against the commonality of an average word, and each
 * word's graphemes are scaled by that difference: words more common than average
 * pull a sentence's complexity down, rarer-than-average words push it up. The
 * whole corpus is then rescaled so its mean complexity is unchanged, which keeps
 * the metric in grapheme-count units and removes the bias the scaling would
 * otherwise introduce.
 *
 *   commonality(w)  = (log f(w) - log f_min) / (log f_max - log f_min)   in [0, 1]
 *   average         = occurrence-weighted mean commonality
 *   relative(w)     = (commonality(w) - average) / max(average, 1 - average)  in [-1, 1]
 *   strength        = reduction / 20                                     in [0, 1]
 *   adjusted(row)   = SUM over words of graphemes(w) * (1 - strength * relative(w))
 *   value(row)      = max(1, round(adjusted(row) * corpusRaw / corpusAdjusted))
 *
 * A reduction of 0 reproduces the plain grapheme count exactly.
 */
export function wordCommonality(counts: Map<string, number>): Map<string, number> {
  const commonality = new Map<string, number>();
  if (!counts.size) return commonality;
  let minLog = Infinity;
  let maxLog = -Infinity;
  for (const occurrences of counts.values()) {
    const value = Math.log(occurrences);
    if (value < minLog) minLog = value;
    if (value > maxLog) maxLog = value;
  }
  const span = maxLog - minLog;
  for (const [word, occurrences] of counts) {
    commonality.set(word, span > 0 ? (Math.log(occurrences) - minLog) / span : 0.5);
  }
  return commonality;
}

export function averageCommonality(counts: Map<string, number>, commonality: Map<string, number>): number {
  let weighted = 0;
  let total = 0;
  for (const [word, occurrences] of counts) {
    weighted += occurrences * (commonality.get(word) ?? 0);
    total += occurrences;
  }
  return total > 0 ? weighted / total : 0.5;
}

export function relativeCommonality(value: number, average: number): number {
  const scale = Math.max(average, 1 - average);
  return scale > 0 ? (value - average) / scale : 0;
}

interface ClassRow { complexityValue: number; rowCount: number }

/**
 * Materializes the common-word ranking and, per reduction setting, the adjusted
 * complexity classes. Both are rebuilt only when the corpus generation changes,
 * so the ranking a profile selects against stays fixed while they read.
 */
export class CommonWordStore {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS common_word_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS common_word_frequency (
        word TEXT PRIMARY KEY,
        occurrences INTEGER NOT NULL,
        commonality REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS adjusted_complexity_rows (
        reduction INTEGER NOT NULL,
        source_id TEXT NOT NULL,
        source_key TEXT NOT NULL,
        complexity_value INTEGER NOT NULL,
        class_index INTEGER NOT NULL,
        PRIMARY KEY (reduction, source_id, source_key)
      );
      CREATE INDEX IF NOT EXISTS idx_adjusted_complexity_member
        ON adjusted_complexity_rows(reduction, source_id, complexity_value, class_index);
      CREATE TABLE IF NOT EXISTS adjusted_complexity_counts (
        reduction INTEGER NOT NULL,
        source_id TEXT NOT NULL,
        complexity_value INTEGER NOT NULL,
        row_count INTEGER NOT NULL,
        PRIMARY KEY (reduction, source_id, complexity_value)
      );
    `);
  }

  close(): void { this.db.close(); }

  private meta(key: string): string {
    const row = this.db.prepare('SELECT value FROM common_word_meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? '';
  }

  private setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO common_word_meta (key, value) VALUES (?, ?)').run(key, value);
  }

  /** Rebuilds the word ranking when the corpus changes. Blacklisted sentences are left out. */
  buildRanking(generation: string, rows: () => Iterable<CorpusTextRow>, blacklisted: ReadonlySet<string>): void {
    if (this.meta('ranking_generation') === generation && this.meta('ranking_blacklist') === String(blacklisted.size)) return;
    const counts = new Map<string, number>();
    for (const row of rows()) {
      if (blacklisted.has(row.text)) continue;
      for (const word of corpusWords(row.text)) counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    const commonality = wordCommonality(counts);
    const average = averageCommonality(counts, commonality);
    const insert = this.db.prepare('INSERT INTO common_word_frequency (word, occurrences, commonality) VALUES (?, ?, ?)');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM common_word_frequency').run();
      this.db.prepare('DELETE FROM adjusted_complexity_rows').run();
      this.db.prepare('DELETE FROM adjusted_complexity_counts').run();
      for (const [word, occurrences] of counts) insert.run(word, occurrences, commonality.get(word) ?? 0);
      this.setMeta('ranking_generation', generation);
      this.setMeta('ranking_blacklist', String(blacklisted.size));
      this.setMeta('ranking_average', String(average));
      this.setMeta('built_reductions', '');
    })();
  }

  get average(): number {
    const value = Number(this.meta('ranking_average'));
    return Number.isFinite(value) ? value : 0.5;
  }

  /** The ranked common-word list, most common first. */
  topWords(limit = 200): CommonWord[] {
    return this.db.prepare(
      'SELECT word, occurrences, commonality FROM common_word_frequency ORDER BY occurrences DESC, word ASC LIMIT ?',
    ).all(limit) as CommonWord[];
  }

  hasReduction(reduction: number): boolean {
    return this.meta('built_reductions').split(',').includes(String(reduction));
  }

  /** Materializes adjusted complexity classes for one reduction setting. */
  buildReduction(reduction: number, rows: () => Iterable<CorpusTextRow>): void {
    if (this.hasReduction(reduction)) return;
    const strength = Math.min(Math.max(reduction, 0), MAX_COMMON_WORD_REDUCTION) / MAX_COMMON_WORD_REDUCTION;
    const average = this.average;
    const commonality = new Map<string, number>();
    for (const row of this.db.prepare('SELECT word, commonality FROM common_word_frequency').iterate() as Iterable<{ word: string; commonality: number }>) {
      commonality.set(row.word, row.commonality);
    }

    const adjusted: Array<{ source_id: string; source_key: string; value: number }> = [];
    let rawTotal = 0;
    let adjustedTotal = 0;
    for (const row of rows()) {
      let value = 0;
      let counted = 0;
      for (const word of corpusWords(row.text)) {
        const graphemes = graphemeCount(word);
        counted += graphemes;
        const relative = relativeCommonality(commonality.get(word) ?? average, average);
        value += graphemes * (1 - strength * relative);
      }
      // Punctuation and spacing are outside words; keep them at full weight.
      const remainder = Math.max(row.grapheme_count - counted, 0);
      adjusted.push({ source_id: row.source_id, source_key: row.source_key, value: value + remainder });
      rawTotal += row.grapheme_count;
      adjustedTotal += value + remainder;
    }
    const scale = adjustedTotal > 0 ? rawTotal / adjustedTotal : 1;

    const indices = new Map<string, number>();
    const insertRow = this.db.prepare(`
      INSERT OR REPLACE INTO adjusted_complexity_rows (reduction, source_id, source_key, complexity_value, class_index)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertCount = this.db.prepare(`
      INSERT OR REPLACE INTO adjusted_complexity_counts (reduction, source_id, complexity_value, row_count)
      VALUES (?, ?, ?, ?)
    `);
    this.db.transaction(() => {
      for (const entry of adjusted) {
        const value = Math.max(1, Math.round(entry.value * scale));
        const key = `${entry.source_id}\u0000${value}`;
        const index = indices.get(key) ?? 0;
        indices.set(key, index + 1);
        insertRow.run(reduction, entry.source_id, entry.source_key, value, index);
      }
      for (const [key, count] of indices) {
        const [sourceId, value] = key.split('\u0000');
        insertCount.run(reduction, sourceId, Number(value), count);
      }
      const built = this.meta('built_reductions').split(',').filter(Boolean);
      built.push(String(reduction));
      this.setMeta('built_reductions', [...new Set(built)].join(','));
    })();
  }

  classes(sourceId: string, reduction: number): ClassRow[] {
    return this.db.prepare(`
      SELECT complexity_value AS complexityValue, row_count AS rowCount
      FROM adjusted_complexity_counts
      WHERE reduction = ? AND source_id = ?
      ORDER BY complexity_value ASC
    `).all(reduction, sourceId) as ClassRow[];
  }

  sourceKeyAt(sourceId: string, reduction: number, complexityValue: number, classIndex: number): string | undefined {
    const row = this.db.prepare(`
      SELECT source_key FROM adjusted_complexity_rows
      WHERE reduction = ? AND source_id = ? AND complexity_value = ? AND class_index = ?
    `).get(reduction, sourceId, complexityValue, classIndex) as { source_key?: string } | undefined;
    return row?.source_key;
  }

  placementOf(sourceId: string, reduction: number, sourceKey: string): { complexityValue: number; classIndex: number } | undefined {
    const row = this.db.prepare(`
      SELECT complexity_value AS complexityValue, class_index AS classIndex
      FROM adjusted_complexity_rows
      WHERE reduction = ? AND source_id = ? AND source_key = ?
    `).get(reduction, sourceId, sourceKey) as { complexityValue: number; classIndex: number } | undefined;
    return row;
  }
}
