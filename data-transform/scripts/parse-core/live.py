#!/usr/bin/env python3
"""One serialized, bounded worker; only frequencies.parse_result caches word parses.
No sentence/context parsing, occurrence copies, or used-observation exclusions.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import random
import sqlite3
import sys
import time
import unicodedata

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'parser'))
from core_parser import CoreParser


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def resolved_targets(result, graph):
    # Multiple targets from ONE resolved analysis are permitted. Ambiguity is not.
    if result.get('separation') != 'resolved_in_model':
        return dict(status='no_parse', reason=result.get('separation', 'unresolved'), targets=[])
    alias = graph['original_to_selectable']
    targets = set()
    for v in result.get('vocabulary_expression_matches', []):
        tid = alias.get('VOC:' + v['id'], 'VOC:' + v['id'])
        if tid in graph['nodes']:
            targets.add(tid)
    for a in result['analyses']:
        tid = alias.get('CHAIN:' + ','.join(a['chain']))
        if tid in graph['nodes']:
            targets.add(tid)
    return dict(status='parsed', targets=sorted(targets)) if targets else dict(status='no_parse', reason='no_core_target', targets=[])


class LiveParser:
    def __init__(self, frequency, corpus, availability, validation=None):
        self.parser = CoreParser()
        self.graph = json.loads((HERE / 'graph.json').read_text())
        self.db = sqlite3.connect(Path(frequency).resolve().as_uri() + '?mode=rw', uri=True)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA busy_timeout=5000')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA journal_size_limit=4194304')
        self.db.execute('PRAGMA cache_size=-8192')
        self.source = sqlite3.connect(Path(corpus).resolve().as_uri() + '?mode=ro', uri=True)
        self.source.row_factory = sqlite3.Row
        self.source.execute('ATTACH DATABASE ? AS availability', (Path(availability).resolve().as_uri()+'?mode=ro',))
        self.validation_path = validation
        self.validation = None
        if validation and Path(validation).exists():
            self.validation = sqlite3.connect(Path(validation).resolve().as_uri()+'?mode=ro', uri=True)
        meta = self.db.execute('SELECT * FROM metadata').fetchone()
        if meta is None:
            raise ValueError('Frequency metadata is missing')
        # Do not hash/rewrite the gigabyte corpus on startup. Compare the saved size
        # and mtime identity; these are the fields in the existing frequency builder.
        identity = json.loads(meta['identity'])
        canonical = identity.get('canonical', [])
        stat = Path(corpus).stat()
        if len(canonical) >= 5 and (canonical[3] != stat.st_size or abs(canonical[4] - stat.st_mtime_ns/1e6) > 2):
            raise ValueError('Frequency corpus identity is stale; rebuild frequency before live parsing')
        columns = {r['name'] for r in self.db.execute('PRAGMA table_info(frequencies)')}
        if 'parse_result' not in columns:
            self.db.execute('ALTER TABLE frequencies ADD COLUMN parse_result TEXT')
        mcols = {r['name'] for r in self.db.execute('PRAGMA table_info(metadata)')}
        if 'parse_cache_version' not in mcols:
            self.db.execute('ALTER TABLE metadata ADD COLUMN parse_cache_version TEXT')
        h = hashlib.sha256(b'frequency-live-strict-v1')
        for p in sorted(HERE.rglob('*')):
            if p.is_file() and p.suffix in ('.py', '.json') and '__pycache__' not in p.parts:
                h.update(p.relative_to(HERE).as_posix().encode()); h.update(p.read_bytes())
        self.version = h.hexdigest()
        old = self.db.execute('SELECT parse_cache_version FROM metadata').fetchone()[0]
        if old != self.version:
            self.db.execute('UPDATE frequencies SET parse_result=NULL WHERE parse_result IS NOT NULL')
            self.db.execute('UPDATE metadata SET parse_cache_version=?', (self.version,))
        # Reuse an existing leading normalized_word index if present.
        indexed = False
        for index in self.db.execute('PRAGMA index_list(occurrences)').fetchall():
            name = index['name'].replace('"', '""')
            cols = self.db.execute('PRAGMA index_info("'+name+'")').fetchall()
            indexed |= bool(cols and cols[0]['name'] == 'normalized_word')
        if not indexed:
            self.db.execute('CREATE INDEX live_occurrences_word ON occurrences(normalized_word)')
        self.db.commit()
        self.forms = defaultdict(set)
        alias = self.graph['original_to_selectable']
        for word, records in self.parser.index.items():
            for record in records:
                tid = alias.get('CHAIN:'+','.join(record['chain']))
                if tid:
                    self.forms[tid].add(unicodedata.normalize('NFC', word))
        for tid, target in self.graph['nodes'].items():
            if target['kind'] == 'vocabulary':
                self.forms[tid].update(unicodedata.normalize('NFC', s) for s in target.get('forms', []))
        self.patterns = {}
        for tid, target in self.graph['nodes'].items():
            forms = [s for s in self.forms[tid] if s and not any(c.isspace() for c in s)]
            # Every registered realization passes this Unicode prefilter. Exact full
            # chain matching happens in resolved_targets, never in the SQL filter.
            needles = sorted(set(s if target['kind']=='vocabulary' else s[-2:] for s in forms))
            self.patterns[tid] = dict(needles=needles, maxCodepoints=max([len(s) for s in forms], default=0),
                                      scope='registered-single-word-realizations')
        self.db.create_function('unicode_candidate', 2, self.candidate, deterministic=True)
        self.counts = Counter(); self.checked = self.parsed = 0
        for row in self.db.execute('SELECT parse_result FROM frequencies WHERE parse_result IS NOT NULL'):
            result = json.loads(row[0]); self.checked += 1
            self.parsed += result['status'] == 'parsed'
            self.counts.update(result['targets'])
        self.total = self.db.execute('SELECT COUNT(*) FROM frequencies').fetchone()[0]
        self.tokens = meta['total_occurrences']
        self.searches = {}

    def candidate(self, word, tid):
        return any(n in word for n in self.patterns[tid]['needles'])

    def stats(self):
        return dict(total=self.total, checked=self.checked, parsed=self.parsed,
                    rejected=self.checked-self.parsed, tokens=self.tokens, matches=dict(self.counts),
                    parserVersion=self.version, patterns=self.patterns)

    def observation(self, word, storage_identity, blocked):
        # Uniform over DISTINCT observations, not token occurrences. Repeated words
        # within one sentence do not give that sentence extra probability.
        if self.validation is None and self.validation_path and Path(self.validation_path).exists():
            self.validation = sqlite3.connect(Path(self.validation_path).resolve().as_uri()+'?mode=ro', uri=True)
        occurrences = self.db.execute("""SELECT source_id, source_key, MIN(occurrence_index) AS occurrence_index
            FROM occurrences WHERE normalized_word=? GROUP BY source_id,source_key""", (word,)).fetchall()
        random.shuffle(occurrences)
        for occurrence in occurrences:
            row = self.source.execute("""SELECT c.* FROM source_rows c
                WHERE source_id=? AND source_key=? AND audio_object_key<>''
                AND EXISTS(SELECT 1 FROM availability.source_complexity_members e
                    WHERE e.source_id=c.source_id AND e.source_key=c.source_key)""",
                (occurrence['source_id'], occurrence['source_key'])).fetchone()
            if row is None or row['text'] in blocked:
                continue
            if self.validation and self.validation.execute("SELECT 1 FROM audio_validation WHERE storage_identity=? AND object_key=? AND status='invalid'", (storage_identity,row['audio_object_key'])).fetchone():
                continue
            token = self.db.execute('SELECT * FROM occurrences WHERE occurrence_index=?', (occurrence['occurrence_index'],)).fetchone()
            return dict(source_id=row['source_id'],source_key=row['source_key'],text=row['text'],
                        audio_key=row['audio_object_key'],word=word,occurrence=dict(token))
        return None

    def find(self, request):
        tid = request['target']
        pattern = self.patterns[tid]
        state = self.searches.setdefault(request['searchId'], dict(cursor='', checked=0, candidates=0))
        rows = self.db.execute("""SELECT normalized_word FROM frequencies
            WHERE normalized_word>? AND parse_result IS NULL AND length(normalized_word)<=?
            AND unicode_candidate(normalized_word,?) ORDER BY normalized_word LIMIT 16""",
            (state['cursor'],pattern['maxCodepoints'],tid)).fetchall()
        found = None
        for row in rows:
            word = row[0]; state['cursor'] = word; state['checked'] += 1; state['candidates'] += 1
            result = resolved_targets(self.parser.analyze(word), self.graph)
            self.parser._productive_cache.clear()
            self.db.execute('UPDATE frequencies SET parse_result=? WHERE normalized_word=?', (compact(result),word))
            self.checked += 1; self.parsed += result['status']=='parsed'; self.counts.update(result['targets'])
            if tid in result['targets']:
                found = self.observation(word, request['storageIdentity'], request.get('blocked', []))
                if found:
                    break
        self.db.commit()
        source = 'new-parse'
        pending = not found and len(rows)==16
        if not found and not pending:
            source = 'cached-parse'
            words = [r[0] for r in self.db.execute("""SELECT normalized_word FROM frequencies
                WHERE parse_result IS NOT NULL AND length(normalized_word)<=? AND unicode_candidate(normalized_word,?)
                AND EXISTS(SELECT 1 FROM json_each(parse_result,'$.targets') WHERE value=?)""",
                (pattern['maxCodepoints'],tid,tid))]
            random.shuffle(words)
            for word in words:
                found = self.observation(word, request['storageIdentity'], request.get('blocked', []))
                if found:
                    break
        response = dict(row=found,pending=pending,source=source,checked=state['checked'],
                        matchedWords=self.counts[tid],pattern=pattern,stats=self.stats_summary())
        if not pending:
            self.searches.pop(request['searchId'], None)
        return response

    def stats_summary(self):
        return dict(total=self.total,checked=self.checked,parsed=self.parsed,rejected=self.checked-self.parsed,
                    tokens=self.tokens,matches=dict(self.counts),parserVersion=self.version)


def main():
    ap=argparse.ArgumentParser()
    for name in ('frequency','corpus','availability','validation'):
        ap.add_argument('--'+name, required=name!='validation')
    args=ap.parse_args()
    worker=LiveParser(args.frequency,args.corpus,args.availability,args.validation)
    print(compact(dict(ready=True,stats=worker.stats())),flush=True)
    for line in sys.stdin:
        request=json.loads(line)
        try:
            result=worker.find(request) if request['action']=='find' else worker.stats()
            print(compact(dict(id=request['id'],result=result)),flush=True)
        except Exception as e:
            print(compact(dict(id=request['id'],error=str(e))),flush=True)

if __name__=='__main__':
    main()
