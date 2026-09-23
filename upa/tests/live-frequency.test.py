"""Word-cache invariants with a tiny deterministic parser and corpus."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
MODULE=ROOT/'data-transform/scripts/parse-core/live.py'
spec=importlib.util.spec_from_file_location('live',MODULE)
live=importlib.util.module_from_spec(spec);spec.loader.exec_module(live)

GRAPH={'nodes':{'A':{'id':'A','core':1,'kind':'vocabulary','forms':['అది','అదే'],'neighbors':['B']},
                'B':{'id':'B','core':1,'kind':'chain','chain':['x'],'neighbors':['A']}},
       'original_to_selectable':{'VOC:a':'A','CHAIN:x':'B'}}
class Parser:
    def __init__(self):
        self.index={'అది':[{'chain':['x']}],'అదే':[{'chain':['x']}]}
        self._productive_cache={};self.calls=[]
    def analyze(self,word):
        self.calls.append(word)
        return {'separation':'resolved_in_model','analyses':[{'chain':['x']}],
                'vocabulary_expression_matches':[{'id':'a'}]}

class LiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        (self.root/'graph.json').write_text(json.dumps(GRAPH))
        c=sqlite3.connect(self.root/'corpus.sqlite')
        c.executescript('CREATE TABLE source_rows(source_id TEXT,source_key TEXT,text TEXT,audio_object_key TEXT);')
        c.executemany('INSERT INTO source_rows VALUES(?,?,?,?)',[('s','1','అది అది','1.wav'),('s','2','అది','2.wav'),('s','3','అదే','3.wav')]);c.commit();c.close()
        a=sqlite3.connect(self.root/'availability.sqlite');a.execute('CREATE TABLE source_complexity_members(source_id TEXT,source_key TEXT)');a.executemany('INSERT INTO source_complexity_members VALUES(?,?)',[('s',str(n)) for n in (1,2,3)]);a.commit();a.close()
        f=sqlite3.connect(self.root/'frequency.sqlite');f.executescript('''CREATE TABLE metadata(identity TEXT,total_occurrences INTEGER);
          INSERT INTO metadata VALUES('{}',4);
          CREATE TABLE frequencies(normalized_word TEXT PRIMARY KEY,occurrence_count INTEGER) WITHOUT ROWID;
          INSERT INTO frequencies VALUES('అది',3),('అదే',1);
          CREATE TABLE occurrences(occurrence_index INTEGER PRIMARY KEY,source_id TEXT,source_key TEXT,normalized_word TEXT);
          INSERT INTO occurrences VALUES(1,'s','1','అది'),(2,'s','1','అది'),(3,'s','2','అది'),(4,'s','3','అదే');''');f.close()
        self.patch1=patch.object(live,'CoreParser',Parser);self.patch1.start()
        self.patch2=patch.object(live,'HERE',self.root);self.patch2.start()
        self.worker=live.LiveParser(self.root/'frequency.sqlite',self.root/'corpus.sqlite',self.root/'availability.sqlite')
    def tearDown(self):
        self.worker.db.close();self.worker.source.close()
        if self.worker.validation:self.worker.validation.close()
        self.patch1.stop();self.patch2.stop();self.tmp.cleanup()
    def find(self,tid='A',search='q'):
        return self.worker.find({'target':tid,'searchId':search,'storageIdentity':'test','blocked':[]})
    def test_one_cache_column_and_multiple_targets(self):
        r=self.find();self.assertEqual(r['source'],'new-parse')
        value=self.worker.db.execute('SELECT parse_result FROM frequencies WHERE normalized_word=?',(r['row']['word'],)).fetchone()[0]
        self.assertEqual(json.loads(value)['targets'],['A','B'])
        self.assertEqual(self.worker.checked,1)
        self.assertEqual([r['name'] for r in self.worker.db.execute('PRAGMA table_info(frequencies)')],['normalized_word','occurrence_count','parse_result'])
    def test_unchecked_before_cached_then_reuse(self):
        first=self.find()['row']['word'];second=self.find(search='2')['row']['word'];self.assertNotEqual(first,second)
        third=self.find(search='3');self.assertEqual(third['source'],'cached-parse');self.assertEqual(self.worker.parser.calls,[first,second])
        self.assertIsNotNone(self.find('B','4')['row'])
    def test_observation_sampling_deduplicates_occurrences(self):
        with patch.object(live.random,'shuffle') as shuffle:
            self.worker.observation('అది','test',[])
            self.assertEqual(len(shuffle.call_args.args[0]),2)
    def test_ambiguous_is_no_parse(self):
        result=live.resolved_targets({'separation':'ambiguous','analyses':[{'chain':['x']}],'vocabulary_expression_matches':[{'id':'a'}]},GRAPH)
        self.assertEqual(result['status'],'no_parse');self.assertEqual(result['targets'],[])
    def test_unrelated_target_does_not_poison_parse(self):
        result=live.resolved_targets({'separation':'resolved_in_model','analyses':[{'chain':['x']}],'vocabulary_expression_matches':[]},GRAPH)
        self.assertEqual(result,{'status':'parsed','targets':['B']})
    def test_no_context_or_previous_observation_exclusions(self):
        r=self.find();self.assertIsNotNone(r['row'])
        for n in range(5):self.assertIsNotNone(self.find(search=str(n))['row'])
        self.assertEqual(self.worker.checked,2)
    def test_parser_version_change_invalidates_cache(self):
        self.find();self.worker.db.execute("UPDATE metadata SET parse_cache_version='old'");self.worker.db.commit()
        w=live.LiveParser(self.root/'frequency.sqlite',self.root/'corpus.sqlite',self.root/'availability.sqlite')
        self.assertEqual(w.checked,0);self.assertEqual(w.counts,{})
        w.db.close();w.source.close()
    def test_all_registered_forms_pass_unicode_and_length_bounds(self):
        for tid,forms in self.worker.forms.items():
            for word in forms:
                self.assertTrue(self.worker.candidate(word,tid));self.assertLessEqual(len(word),self.worker.patterns[tid]['maxCodepoints'])

if __name__=='__main__':unittest.main()
