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
        c.executescript('CREATE TABLE source_rows(source_id TEXT,source_key TEXT,text TEXT,audio_object_key TEXT,grapheme_count INTEGER);')
        c.executemany('INSERT INTO source_rows VALUES(?,?,?,?,?)',[('s','1','అది అది','1.wav',7),('s','2','అది','2.wav',3),('s','3','అదే','3.wav',3)]);c.commit();c.close()
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
        with patch.object(live.random,'choice',side_effect=lambda pool:pool[0]) as choice:
            result=self.worker.observation('అది','test',[])
            self.assertEqual(len(choice.call_args.args[0]),2)
            self.assertEqual(result['observation_selection']['poolSize'],2)
            self.assertEqual(result['source_key'],'2')
    def add_observation(self,key,length,available=True,audio=True):
        self.worker.db.execute('INSERT INTO occurrences(source_id,source_key,normalized_word) VALUES(?,?,?)',('s',key,'అది'))
        self.worker.db.commit()
        with sqlite3.connect(self.root/'corpus.sqlite') as c:
            c.execute('INSERT INTO source_rows VALUES(?,?,?,?,?)',('s',key,'అది '+'x'*length,key+'.wav' if audio else '',length))
        if available:
            with sqlite3.connect(self.root/'availability.sqlite') as a:
                a.execute('INSERT INTO source_complexity_members VALUES(?,?)',('s',key))
    def test_core1_samples_only_five_shortest_distinct_observations(self):
        for n in [9,11,13,15,17]:self.add_observation(str(n),n)
        with patch.object(live.random,'choice',side_effect=lambda pool:pool[-1]) as choice:
            result=self.worker.observation('అది','test',[],core=1)
            self.assertEqual([r['grapheme_count'] for r in choice.call_args.args[0]],[3,7,9,11,13])
            self.assertEqual(result['source_key'],'13')
            self.assertEqual(result['observation_selection'],dict(policy='core1-shortest-five-v1',poolSize=5,length=13,lengthMetric='corpus-grapheme-count'))
    def test_ineligible_observations_are_excluded_before_shortest_five(self):
        for n in [9,11,13,15,17]:self.add_observation(str(n),n)
        self.add_observation('unavailable',1,available=False);self.add_observation('no-audio',2,audio=False)
        self.worker.validation=sqlite3.connect(':memory:')
        self.worker.validation.executescript("CREATE TABLE audio_validation(storage_identity TEXT,object_key TEXT,status TEXT); INSERT INTO audio_validation VALUES('test','2.wav','invalid');")
        with patch.object(live.random,'choice',side_effect=lambda pool:pool[0]) as choice:
            self.worker.observation('అది','test',['అది అది'],core=1)
            self.assertEqual([r['grapheme_count'] for r in choice.call_args.args[0]],[9,11,13,15,17])
    def test_later_cores_keep_unrestricted_random_observation_policy(self):
        self.add_observation('long',99)
        result=self.worker.observation('అది','test',[],core=2)
        self.assertEqual(result['observation_selection']['policy'],'all-matching-random-v1')
        self.assertIsNone(result['observation_selection']['poolSize'])
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
    def add_word(self, word, saved=None, playable=True):
        self.worker.patterns['A'] = dict(needles=['అ'], maxCodepoints=100)
        self.worker.db.execute('INSERT INTO frequencies VALUES(?,1,?)', (word,live.compact(saved) if saved else None))
        if playable:
            self.worker.db.execute('INSERT INTO occurrences(source_id,source_key,normalized_word) VALUES(?,?,?)', ('s',word,word))
            # Worker source is read-only, so fixture writes use a separate connection.
            with sqlite3.connect(self.root/'corpus.sqlite') as c:
                c.execute('INSERT INTO source_rows VALUES(?,?,?,?,?)',('s',word,word,word+'.wav',len(word)))
            with sqlite3.connect(self.root/'availability.sqlite') as a:
                a.execute('INSERT INTO source_complexity_members VALUES(?,?)',('s',word))
        self.worker.db.commit()
    def test_shortest_unchecked_word_beats_alphabetical_order(self):
        self.add_word('అవ')
        self.assertEqual(self.find()['row']['word'],'అవ')
    def test_shorter_cached_word_beats_longer_unchecked_word(self):
        self.add_word('అవ',dict(status='parsed',targets=['A','B']))
        r=self.find();self.assertEqual(r['row']['word'],'అవ');self.assertEqual(r['source'],'cached-parse')
        self.assertEqual(self.worker.parser.calls,[]);self.assertEqual(r['row']['matched_targets'],['A','B'])
    def test_shorter_unchecked_word_beats_longer_cached_word(self):
        self.worker.db.execute('UPDATE frequencies SET parse_result=?',(live.compact(dict(status='parsed',targets=['A'])),))
        self.add_word('అవ')
        r=self.find();self.assertEqual(r['row']['word'],'అవ');self.assertEqual(r['source'],'new-parse')
    def test_shortest_unplayable_or_no_parse_is_skipped(self):
        self.add_word('అ',dict(status='no_parse',targets=[]))
        self.add_word('అవ',dict(status='parsed',targets=['A']),playable=False)
        self.assertEqual(self.find()['row']['word'],'అది')
    def test_bounded_chunks_eventually_reach_shortest_playable_match(self):
        for n in range(20):self.add_word('అ'+chr(0x61+n),playable=False)
        r=self.find();self.assertTrue(r['pending']);self.assertEqual(r['checked'],16)
        while r['pending']:r=self.find()
        self.assertEqual(r['row']['word'],'అది');self.assertEqual(len(self.worker.parser.calls),21)
        self.assertEqual(len(set(self.worker.parser.calls)),21)
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
