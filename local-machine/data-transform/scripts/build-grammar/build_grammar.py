#!/usr/bin/env python3
"""Resumable derived grammar catalog; never writes the corpus. Called by the optional app worker.
Tigris publication belongs to the Node host, which inherits the existing SDK credentials.
"""
import argparse, csv, hashlib, json, os, sqlite3, time
from pathlib import Path
from original_collector import token_spans
from parser_adapter import initialize, analyze_word, PARSER_VERSION
from progression_targets import progression_identity
ROOT=Path(__file__).resolve().parent

def digest(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for chunk in iter(lambda:f.read(4*1024*1024),b''):h.update(chunk)
 return h.hexdigest()

def report(**data):print(json.dumps(data,ensure_ascii=False),flush=True)

def build(corpus,output,availability=None):
 try: os.nice(10)
 except (AttributeError,OSError): pass
 corpus=Path(corpus).resolve();output=Path(output).resolve()
 if corpus==output:raise ValueError('Corpus and derived output must differ')
 initial=corpus.stat(); report(phase='fingerprinting',processed=0)
 sha=digest(corpus)
 parser_sha=hashlib.sha256(''.join(digest(p) for p in sorted((ROOT/'parser').iterdir()) if p.is_file() and p.suffix in {'.py','.json','.txt'}).encode()).hexdigest()
 identity=dict(schema=1,adapter_sha256=digest(ROOT/'parser_adapter.py'),tokenizer_sha256=digest(ROOT/'original_collector.py'),availability_sha256=digest(availability) if availability else None,corpus_sha256=sha,parser_version=PARSER_VERSION,parser_sha256=parser_sha,policy='shared-chain-v2')
 src=sqlite3.connect(corpus.as_uri()+'?mode=ro',uri=True);src.row_factory=sqlite3.Row
 out=sqlite3.connect(output);out.execute('PRAGMA journal_mode=DELETE');out.execute('PRAGMA cache_size=-8192');out.execute('PRAGMA temp_store=FILE')
 out.executescript('''
 CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS words(word TEXT PRIMARY KEY,parse_json TEXT NOT NULL,target_id TEXT,plain_noncore INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS targets(target_id TEXT PRIMARY KEY,level INTEGER NOT NULL,chain_json TEXT NOT NULL,base_id TEXT NOT NULL,nesting TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS observations(id INTEGER PRIMARY KEY,source_id TEXT NOT NULL,source_key TEXT NOT NULL,length INTEGER NOT NULL,audio_key TEXT NOT NULL,UNIQUE(source_id,source_key));
 CREATE TABLE IF NOT EXISTS occurrences(observation_id INTEGER NOT NULL,target_id TEXT NOT NULL,word TEXT NOT NULL,token_index INTEGER NOT NULL,start_cp INTEGER NOT NULL,end_cp INTEGER NOT NULL,gi INTEGER NOT NULL,lexical_id TEXT NOT NULL,PRIMARY KEY(observation_id,token_index));
 CREATE TABLE IF NOT EXISTS vocabulary_occurrences(observation_id INTEGER NOT NULL,word TEXT NOT NULL,token_index INTEGER NOT NULL,start_cp INTEGER NOT NULL,end_cp INTEGER NOT NULL,PRIMARY KEY(observation_id,token_index));
 CREATE TABLE IF NOT EXISTS vocabulary(word TEXT PRIMARY KEY,rank INTEGER,frequency INTEGER,probability REAL);
 ''')
 previous=out.execute("SELECT value FROM metadata WHERE key='identity'").fetchone()
 if previous and {k:v for k,v in json.loads(previous[0]).items() if k!='inventory_id'}!=identity:raise ValueError('Staged build belongs to a different corpus/parser; use a new output path')
 out.execute("INSERT OR REPLACE INTO metadata VALUES('identity',?)",(json.dumps(identity),));out.commit()
 query="SELECT source_id,source_key,text,audio_object_key FROM source_rows WHERE source_id IN (SELECT source_id FROM sources WHERE status='ready')"
 if availability:
  src.execute('ATTACH DATABASE ? AS avail',(Path(availability).resolve().as_uri()+'?mode=ro',))
  query+=' AND EXISTS(SELECT 1 FROM avail.source_complexity_members a WHERE a.source_id=source_rows.source_id AND a.source_key=source_rows.source_key)'
 total=src.execute('SELECT COUNT(*) FROM ('+query+')').fetchone()[0]
 processed=out.execute('SELECT COUNT(*) FROM observations').fetchone()[0]
 words=out.execute('SELECT COUNT(*) FROM words').fetchone()[0]
 last=out.execute("SELECT value FROM metadata WHERE key='cursor'").fetchone();cursor=json.loads(last[0]) if last else ['', '']
 initialize(); started=time.monotonic()
 report(phase='analyzing',processed=processed,total=total,uniqueWords=words)
 for row in src.execute(query+' AND (source_id,source_key) > (?,?) ORDER BY source_id,source_key',cursor):
  spans=list(token_spans(row['text']));length=sum(w is not None for _,_,_,w in spans)
  oid=out.execute('INSERT INTO observations(source_id,source_key,length,audio_key) VALUES(?,?,?,?)',(row['source_id'],row['source_key'],length,row['audio_object_key'])).lastrowid
  for token,(start,end,surface,word) in enumerate(spans):
   if word is None:continue
   cached=out.execute('SELECT parse_json,target_id FROM words WHERE word=?',(word,)).fetchone()
   if cached:parsed=json.loads(cached[0]);tid=cached[1]
   else:
    parsed=analyze_word(word);tid=None
    if parsed['eligible']:
     t=dict(parsed,ordered_modifier_chain='|'.join(parsed['ordered_modifier_chain']))
     tid,level=progression_identity(t)
     out.execute('INSERT OR IGNORE INTO targets VALUES(?,?,?,?,?)',(tid,level,json.dumps(parsed['ordered_modifier_chain']),parsed['base_id'] if level==1 else '',parsed['nesting_signature']))
    plain=parsed['status']=='parsed' and parsed['base_type']=='dictionary_non_core_base' and not parsed['gi_relevant']
    out.execute('INSERT INTO words VALUES(?,?,?,?)',(word,json.dumps(parsed,ensure_ascii=False),tid,int(plain)));words+=1
   if parsed['status']=='parsed' and parsed['base_type']=='dictionary_non_core_base' and not parsed['gi_relevant']:
    out.execute('INSERT INTO vocabulary_occurrences VALUES(?,?,?,?,?)',(oid,word,token,start,end))
   if tid:out.execute('INSERT INTO occurrences VALUES(?,?,?,?,?,?,?,?)',(oid,tid,word,token,start,end,parsed['gi_score'],parsed['target_id']))
  processed+=1
  out.execute("INSERT OR REPLACE INTO metadata VALUES('cursor',?)",(json.dumps([row['source_id'],row['source_key']]),))
  if processed%25==0:
   out.commit();report(phase='analyzing',processed=processed,total=total,uniqueWords=words,seconds=round(time.monotonic()-started))
 out.commit();report(phase='indexing',processed=processed,total=total,uniqueWords=words)
 out.executescript('''
 CREATE INDEX IF NOT EXISTS occurrences_target ON occurrences(target_id,observation_id);
 CREATE TABLE IF NOT EXISTS members(target_id TEXT NOT NULL,observation_id INTEGER NOT NULL,length INTEGER NOT NULL,PRIMARY KEY(target_id,observation_id));
 DELETE FROM members;
 INSERT INTO members SELECT DISTINCT c.target_id,c.observation_id,o.length FROM occurrences c JOIN observations o ON o.id=c.observation_id;
 CREATE INDEX IF NOT EXISTS members_length ON members(target_id,length,observation_id);
 ''')
 with (ROOT/'fixed_vocabulary.csv').open() as f:
  for row in csv.DictReader(f):out.execute('INSERT OR REPLACE INTO vocabulary VALUES(?,?,?,?)',(row['word'],int(row['rank']),int(row['frequency']),float(row['probability'])))
 stats={'observations':processed,'words':words,'targets':out.execute('SELECT COUNT(*) FROM targets').fetchone()[0],'occurrences':out.execute('SELECT COUNT(*) FROM occurrences').fetchone()[0]}
 if not stats['targets']:raise ValueError('No eligible targets')
 if corpus.stat().st_mtime_ns!=initial.st_mtime_ns or corpus.stat().st_size!=initial.st_size:raise ValueError('Corpus changed during build')
 identity['inventory_id']=hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest()
 out.execute("INSERT OR REPLACE INTO metadata VALUES('identity',?)",(json.dumps(identity),))
 # Exclude inventory_id when comparing on a resumed, already complete build.
 out.execute("INSERT OR REPLACE INTO metadata VALUES('stats',?)",(json.dumps(stats),))
 out.execute("INSERT OR REPLACE INTO metadata VALUES('complete','true')");out.commit()
 assert out.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 out.close();src.close();report(phase='built',processed=processed,total=total,**stats)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--corpus',required=True);p.add_argument('--output',required=True);p.add_argument('--availability');a=p.parse_args();build(a.corpus,a.output,a.availability)
