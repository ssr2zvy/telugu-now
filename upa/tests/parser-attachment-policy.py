import sys, unittest
from pathlib import Path
repo=Path(__file__).resolve().parents[2]
worker=repo/'data-transform/scripts/build-grammar'
if not worker.exists():worker=repo/'local-machine/data-transform/scripts/build-grammar'
sys.path.insert(0,str(worker))
import parser_adapter as adapter
from attachment_evidence import attachment_reason
from corpus_analyze_gi import gi_for_result

class AttachmentPolicyTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  adapter.initialize();cls.parser=adapter._parser
 def test_joined_word_not_false_permission(self):
  result=adapter.analyze_word('పిలుపునిచ్చారు')
  self.assertEqual(result['gi_score'],4)
  components=result['verified_analyses'][0]['active_features']
  self.assertEqual((components['compound_left'],components['compound_right']),('పిలుపును','ఇచ్చారు'))
  self.assertFalse(any('mod_permissive' in a['chain'] for a in result['verified_analyses']))
  self.assertTrue(result['overlap']);self.assertFalse(result['eligible'])
 def test_permission_on_verified_infinitive(self):
  result=adapter.analyze_word('పిలవనిచ్చారు')
  self.assertEqual(result['gi_score'],3)
  self.assertIn('mod_permissive',result['ordered_modifier_chain'])
  self.assertEqual(result['base_id'],'పిలవ')
 def test_dictionary_membership_does_not_verify_verb(self):
  candidate={'base':'dictionary_non_core_base_verb:పిలుపు','base_type':'dictionary_non_core_base',
             'detected_stem':'పిలుపు','chain':['mod_permissive']}
  self.assertEqual(attachment_reason(self.parser.engine,candidate),'verb_type_not_verified')
 def test_unverified_nominal_cannot_bootstrap_a_verb(self):
  candidate={'base':'dictionary_non_core_base_noun:పి','base_type':'dictionary_non_core_base',
             'detected_stem':'పి','chain':['mod_plural','mod_become','mod_permissive']}
  self.assertEqual(attachment_reason(self.parser.engine,candidate),'nominal_to_verb_attachment_not_verified')
 def test_core_and_nominal_regressions(self):
  for word,gi in [('చేశాను',3),('మంచానికి',1)]:
   result=adapter.analyze_word(word)
   self.assertEqual(result['gi_score'],gi);self.assertTrue(result['eligible'])
 def test_maximum_uses_verified_analyses_only(self):
  result=adapter.analyze_word('పిలవనిచ్చారు')
  self.assertTrue(result['diagnostic_analyses'])
  scores=[gi_for_result(self.parser,'పిలవనిచ్చారు',a)['gi_score'] for a in result['verified_analyses']]
  self.assertEqual(result['gi_score'],max(int(s) for s in scores if s!='N/A'))
 def test_compound_search_runs_even_after_simple_success(self):
  self.assertTrue(self.parser._analyze_simple('పిలుపునిచ్చారు')['analyses'])
  self.assertTrue(any(a.get('active_features',{}).get('verified_components') for a in self.parser.analyze('పిలుపునిచ్చారు')['analyses']))
 def test_inflected_dictionary_base_does_not_hide_a_deeper_base(self):
  result=adapter.analyze_word('శ్రీకాకుళంలోని')
  self.assertFalse(result['eligible'])
  rejected=[a for a in result['diagnostic_analyses'] if a.get('validation_reason')=='unresolved_base_boundary']
  self.assertTrue(rejected)
  deeper=rejected[0]['base_boundary_check']['deeper_analyses']
  self.assertTrue(any('mod_locative' in a['chain'] for a in deeper))
 def test_known_base_does_not_short_circuit_registered_endings(self):
  result=self.parser._analyze_simple('మంచం')
  self.assertNotIn('fast_exact_dictionary',result.get('search',{}))
  self.assertGreater(result['search']['visited_states'],0)
 def test_unverified_normalization_excluded(self):
  candidate={'base':'verb_cheyu','base_type':'core_base','chain':[],
             'active_features':{'normalization_confidence':'medium'}}
  self.assertEqual(attachment_reason(self.parser.engine,candidate),'normalization_not_verified')

class BuildIntegrationTests(unittest.TestCase):
 def test_real_parser_catalog_preserves_overlap_without_crediting_wrong_target(self):
  import tempfile, sqlite3, json, contextlib, io
  import build_grammar
  with tempfile.TemporaryDirectory() as folder:
   corpus=Path(folder)/'corpus.sqlite';output=Path(folder)/'grammar.sqlite'
   with sqlite3.connect(corpus) as db:
    db.executescript("CREATE TABLE sources(source_id TEXT,status TEXT); INSERT INTO sources VALUES('test','ready'); CREATE TABLE source_rows(source_id TEXT,source_key TEXT,text TEXT,audio_object_key TEXT);")
    db.execute('INSERT INTO source_rows VALUES(?,?,?,?)',('test','1','చేశాను మంచానికి పిలుపునిచ్చారు పిలవనిచ్చారు','audio.wav'))
   before=corpus.read_bytes()
   with contextlib.redirect_stdout(io.StringIO()):build_grammar.build(corpus,output)
   self.assertEqual(before,corpus.read_bytes())
   with sqlite3.connect(output) as db:
    payload,target=db.execute('SELECT parse_json,target_id FROM words WHERE word=?',('పిలుపునిచ్చారు',)).fetchone()
    parsed=json.loads(payload)
    self.assertEqual(parsed['gi_score'],4);self.assertTrue(parsed['overlap']);self.assertIsNone(target)
    self.assertEqual(db.execute('SELECT COUNT(*) FROM occurrences').fetchone()[0],2)
    info=json.loads(db.execute("SELECT value FROM metadata WHERE key='parser_info'").fetchone()[0])
    self.assertEqual(info['attachmentPolicy'],'attachment_evidence_v1')

if __name__=='__main__':unittest.main()
