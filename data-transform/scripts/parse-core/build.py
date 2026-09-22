#!/usr/bin/env python3
"""Stream the full source_rows corpus into a separate, resumable parsing database.

The source is read-only. Repeated words, phrases and rejected surface/target
decisions are cached on disk. Original code-point offsets and every raw token
are retained. Only complete, accepted curriculum matches enter the Core index.
"""
import argparse
from collections import Counter
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import time
import unicodedata

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'parser'))
from core_parser import CoreParser
from reviewed_matcher import ReviewedMatcher
import original_collector as tokenizer

SCHEMA = 1


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def text_hash(text):
    return hashlib.sha256(' '.join(unicodedata.normalize('NFC', text).split()).encode()).hexdigest()


def fingerprint():
    h = hashlib.sha256()
    for path in sorted(HERE.rglob('*')):
        if path.is_file() and path.suffix in {'.py', '.json'} and '__pycache__' not in path.parts:
            h.update(path.relative_to(HERE).as_posix().encode())
            h.update(path.read_bytes())
    return h.hexdigest()


def source_stamp(path):
    result = []
    for p in [path, Path(str(path) + '-wal')]:
        if p.exists():
            s = p.stat()
            result.append([p.name, s.st_size, s.st_mtime_ns])
    return result


def emit(**data):
    print(encode(data), flush=True)


def build(corpus, output, chunk_size=100, stop_after=None):
    corpus, output = Path(corpus).resolve(), Path(output).resolve()
    if corpus == output:
        raise ValueError('Corpus and parsing database must be separate files')
    output.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    stamp = source_stamp(corpus)
    emit(phase='fingerprinting', processed=0)
    h = hashlib.sha256()
    for p in [corpus, Path(str(corpus) + '-wal')]:
        if p.exists():
            with p.open('rb') as f:
                for block in iter(lambda: f.read(4 * 1024 * 1024), b''):
                    h.update(block)
    if stamp != source_stamp(corpus):
        raise ValueError('STALE_INPUT: corpus changed during fingerprinting')
    parser_hash = fingerprint()
    graph = json.loads((HERE / 'graph.json').read_text())
    inventory = hashlib.sha256(encode(graph).encode()).hexdigest()
    identity = dict(schema=SCHEMA, parserVersion=CoreParser.VERSION,
                    parserHash=parser_hash, inventoryId=inventory, corpusHash=h.hexdigest())
    src = sqlite3.connect(corpus.as_uri() + '?mode=ro', uri=True)
    src.row_factory = sqlite3.Row
    source_version = src.execute('PRAGMA data_version').fetchone()[0]
    src.execute('BEGIN')
    total = src.execute('SELECT COUNT(*) FROM source_rows').fetchone()[0]
    db = sqlite3.connect(output)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA synchronous=NORMAL')
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA cache_size=-16384')
    db.executescript('''
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS targets(id TEXT PRIMARY KEY,core INTEGER NOT NULL,kind TEXT NOT NULL,definition_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS edges(left_id TEXT,right_id TEXT,core INTEGER,PRIMARY KEY(left_id,right_id));
      CREATE TABLE IF NOT EXISTS rows(id INTEGER PRIMARY KEY,source_id TEXT NOT NULL,source_key TEXT NOT NULL,text_hash TEXT NOT NULL,length INTEGER NOT NULL,audio_key TEXT NOT NULL,UNIQUE(source_id,source_key));
      CREATE TABLE IF NOT EXISTS words(id INTEGER PRIMARY KEY,surface TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,status TEXT NOT NULL,recognized INTEGER NOT NULL,parseable INTEGER NOT NULL,analysis_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS row_words(row_id INTEGER NOT NULL REFERENCES rows(id),token_index INTEGER NOT NULL,start_cp INTEGER NOT NULL,end_cp INTEGER NOT NULL,raw TEXT NOT NULL,word_id INTEGER REFERENCES words(id),PRIMARY KEY(row_id,token_index));
      CREATE TABLE IF NOT EXISTS decisions(surface TEXT NOT NULL,target_id TEXT NOT NULL,accepted INTEGER NOT NULL,reason TEXT NOT NULL,proof_json TEXT NOT NULL,PRIMARY KEY(surface,target_id));
      CREATE TABLE IF NOT EXISTS matches(row_id INTEGER NOT NULL REFERENCES rows(id),target_id TEXT NOT NULL REFERENCES targets(id),start_cp INTEGER NOT NULL,end_cp INTEGER NOT NULL,token_index INTEGER NOT NULL,surface TEXT NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(row_id,target_id,start_cp,end_cp));
      CREATE TABLE IF NOT EXISTS members(target_id TEXT NOT NULL REFERENCES targets(id),row_id INTEGER NOT NULL REFERENCES rows(id),core INTEGER NOT NULL,length INTEGER NOT NULL,PRIMARY KEY(target_id,row_id));
      CREATE INDEX IF NOT EXISTS shortest_member ON members(target_id,length,row_id);
      CREATE TABLE IF NOT EXISTS row_cores(row_id INTEGER NOT NULL REFERENCES rows(id),core INTEGER NOT NULL,PRIMARY KEY(row_id,core));
      CREATE INDEX IF NOT EXISTS rows_by_core ON row_cores(core,row_id);
    ''')
    def meta(key, fallback=None):
        row = db.execute('SELECT value FROM metadata WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else fallback
    def save(key, value):
        db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)', (key, encode(value)))
    old = meta('identity')
    if old and old != identity:
        raise ValueError('STALE_INPUT: checkpoint belongs to different corpus/parser; start a new build')
    if meta('complete', False):
        emit(phase='complete', **meta('stats', {}), identity=identity)
        return
    save('identity', identity)
    save('complete', False)
    db.executemany('INSERT OR IGNORE INTO targets VALUES(?,?,?,?)',
                   [(t, n['core'], n['kind'], encode(n)) for t, n in graph['nodes'].items()])
    db.executemany('INSERT OR IGNORE INTO edges VALUES(?,?,?)',
                   [(e['left'], e['right'], e['core']) for e in graph['edges']])
    db.commit()
    checkpoint = meta('checkpoint', dict(processed=0, tokens=0, source='', key=''))
    processed, tokens = checkpoint['processed'], checkpoint['tokens']
    unique = db.execute("SELECT COUNT(*) FROM words WHERE kind='word'").fetchone()[0]
    emit(phase='loading-parser', processed=processed, total=total, uniqueWords=unique)
    parser = CoreParser()
    raw_analyze = parser.analyze
    counters = Counter()

    @lru_cache(maxsize=512)
    def analyze(surface, **kwargs):
        row = db.execute('SELECT analysis_json FROM words WHERE surface=?', (surface,)).fetchone()
        if row:
            counters['diskCacheHits'] += 1
            return json.loads(row[0])
        result = raw_analyze(surface)
        # Keep all canonical candidates and search limits, without duplicating
        # the large display-only feature tree for every surface in the volume.
        for a in result['analyses']:
            a.pop('feature_structure', None)
            a.pop('unimorph_projections', None)
        db.execute('INSERT INTO words(surface,kind,status,recognized,parseable,analysis_json) VALUES(?,?,?,?,?,?)',
                   (surface, 'phrase' if ' ' in surface else 'word', result['separation'],
                    int(bool(result['analyses'])), int(result['eligible_in_model'] or result['learning']['eligible']), encode(result)))
        counters['parseCalls'] += 1
        # The disk cache is authoritative; do not retain all unseen words in RAM.
        parser._productive_cache.clear()
        return result
    parser.analyze = analyze
    reviews = json.loads((HERE / 'context_reviews.json').read_text())
    for r in reviews:
        r['observation_id'] = text_hash(r['text'])
    matcher = ReviewedMatcher(parser, graph, tokenizer, reviews)
    original_decision = matcher.decision

    @lru_cache(maxsize=2048)
    def decision(surface, target_id):
        cached = db.execute('SELECT proof_json FROM decisions WHERE surface=? AND target_id=?', (surface, target_id)).fetchone()
        if cached:
            return json.loads(cached[0])
        result = original_decision(surface, target_id)
        db.execute('INSERT INTO decisions VALUES(?,?,?,?,?)',
                   (surface, target_id, int(result['accepted']), result['reason'], encode(result)))
        matcher.cache.clear()
        return result
    matcher.decision = decision
    cursor = src.execute('SELECT source_id,source_key,text,audio_object_key FROM source_rows WHERE (source_id,source_key)>(?,?) ORDER BY source_id,source_key',
                         (checkpoint['source'], checkpoint['key']))
    last_update = 0
    invocation_rows = 0
    while True:
        rows = cursor.fetchmany(chunk_size)
        if not rows:
            break
        for row in rows:
            text = row['text']
            spans = list(tokenizer.token_spans(text))
            accepted_length = sum(norm is not None for _, _, _, norm in spans)
            th = text_hash(text)
            rid = db.execute('INSERT INTO rows(source_id,source_key,text_hash,length,audio_key) VALUES(?,?,?,?,?)',
                             (row['source_id'], row['source_key'], th, accepted_length, row['audio_object_key'] or '')).lastrowid
            for i, (start, end, raw, norm) in enumerate(spans):
                word_id = None
                if norm is not None:
                    analyze(norm)
                    word_id = db.execute('SELECT id FROM words WHERE surface=?', (norm,)).fetchone()[0]
                    tokens += 1
                db.execute('INSERT INTO row_words VALUES(?,?,?,?,?,?)', (rid, i, start, end, raw, word_id))
            for match in matcher.matches(th, text):
                if not match['accepted']:
                    continue
                tid = match['target_id']
                core = graph['nodes'][tid]['core']
                db.execute('INSERT OR IGNORE INTO matches VALUES(?,?,?,?,?,?,?)',
                           (rid, tid, match['start_cp'], match['end_cp'], match['token_index'], match['surface'], match['reason']))
                db.execute('INSERT OR IGNORE INTO members VALUES(?,?,?,?)', (tid, rid, core, accepted_length))
                db.execute('INSERT OR IGNORE INTO row_cores VALUES(?,?)', (rid, core))
            processed += 1
            invocation_rows += 1
            checkpoint = dict(processed=processed, tokens=tokens, source=row['source_id'], key=row['source_key'])
            if time.monotonic() - last_update > 1:
                emit(phase='parsing', processed=processed, total=total, tokens=tokens,
                     uniqueWords=db.execute("SELECT COUNT(*) FROM words WHERE kind='word'").fetchone()[0], **counters)
                last_update = time.monotonic()
        save('checkpoint', checkpoint)
        db.commit()
        if stop_after is not None and invocation_rows >= stop_after:
            emit(phase='paused', processed=processed, total=total)
            db.close(); src.close()
            return
    src.commit()
    if source_version != src.execute('PRAGMA data_version').fetchone()[0] or stamp != source_stamp(corpus):
        raise ValueError('STALE_INPUT: corpus changed during parsing; new build required')
    emit(phase='indexing', processed=processed, total=total, tokens=tokens)
    core_stats = []
    for core in [1, 2, 3]:
        counts = db.execute('SELECT COUNT(*),COUNT(DISTINCT r.text_hash),SUM(CASE WHEN r.audio_key<>\'\' THEN 1 ELSE 0 END) FROM row_cores c JOIN rows r ON r.id=c.row_id WHERE c.core=?', (core,)).fetchone()
        targets = db.execute('SELECT COUNT(*) FROM targets WHERE core=?', (core,)).fetchone()[0]
        present = db.execute('SELECT COUNT(DISTINCT target_id) FROM members WHERE core=?', (core,)).fetchone()[0]
        core_stats.append(dict(core=core, observations=counts[0], distinctTexts=counts[1],
                               observationsWithAudio=counts[2] or 0, targets=targets, targetsWithExamples=present))
    stats = dict(processed=processed, total=total, tokens=tokens,
                 uniqueWords=db.execute("SELECT COUNT(*) FROM words WHERE kind='word'").fetchone()[0],
                 uniquePhrases=db.execute("SELECT COUNT(*) FROM words WHERE kind='phrase'").fetchone()[0],
                 recognizedWords=db.execute("SELECT COUNT(*) FROM words WHERE kind='word' AND recognized=1").fetchone()[0],
                 parseableWords=db.execute("SELECT COUNT(*) FROM words WHERE kind='word' AND parseable=1").fetchone()[0],
                 coreStats=core_stats, elapsedSeconds=round(time.monotonic()-started, 3), **counters)
    save('stats', stats)
    save('corpusStamp', stamp)
    save('complete', True)
    db.commit()
    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise ValueError('Parsing database failed integrity check')
    db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    db.execute('PRAGMA journal_mode=DELETE')
    db.close(); src.close()
    emit(phase='complete', **stats, identity=identity)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--corpus', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--chunk-size', type=int, default=100)
    ap.add_argument('--stop-after', type=int, help='Checkpoint/resume verification; never used by the app')
    args = ap.parse_args()
    if not 1 <= args.chunk_size <= 1000:
        ap.error('chunk-size must be between 1 and 1000')
    try:
        build(args.corpus, args.output, args.chunk_size, args.stop_after)
    except Exception as error:
        emit(phase='failed', error=str(error))
        raise
