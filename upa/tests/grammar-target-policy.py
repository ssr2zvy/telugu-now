"""Behavioral checks for grammatical components and the derived catalog boundary."""
import contextlib
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / 'data-transform/scripts/build-grammar'
sys.path.insert(0, str(SCRIPT))
from progression_targets import PROGRESSION_POLICY, progression_identity, group_targets
import build_grammar


def parsed(base, chain=(), core=False, spelling='word'):
    return dict(word=spelling, base_id=base,
                base_type='core_base' if core else 'dictionary_non_core_base',
                ordered_modifier_chain=list(chain), modifier_count=len(chain),
                nesting_signature='linear', gi_score=len(chain) + int(core),
                target_id='LEX:' + json.dumps([base, list(chain)]),
                status='parsed', gi_relevant=bool(chain or core), eligible=bool(chain or core))


class PolicyTests(unittest.TestCase):
    def test_complexity_counts_only_grammatical_components(self):
        cases = [(parsed('core', core=True), 1),
                 (parsed('bed', ['dative']), 1),
                 (parsed('bed', ['plural', 'dative']), 2),
                 (parsed('core', ['past'], core=True), 2),
                 (parsed('core', ['past', 'first_singular'], core=True), 3)]
        for row, expected in cases:
            with self.subTest(row=row):
                self.assertEqual(progression_identity(row)[1], expected)

    def test_vocabulary_bases_share_one_complete_target(self):
        a = parsed('bed', ['plural', 'dative'])
        b = parsed('house', ['plural', 'dative'])
        self.assertEqual(progression_identity(a), progression_identity(b))
        grouped, mapping = group_targets([a, b])
        self.assertEqual(len(grouped), 1)
        self.assertEqual(grouped[0]['base_id'], '')
        self.assertEqual(len(set(mapping.values())), 1)

    def test_core_base_remains_in_both_bare_and_modified_targets(self):
        a = parsed('verb_cheyu', ['past'], core=True)
        b = parsed('verb_vacchu', ['past'], core=True)
        self.assertNotEqual(progression_identity(a)[0], progression_identity(b)[0])
        self.assertNotEqual(progression_identity(a)[0], progression_identity(parsed('noun', ['past']))[0])
        groups, _ = group_targets([a, parsed('verb_cheyu', core=True)])
        self.assertTrue(all(g['base_id'] == 'verb_cheyu' for g in groups))

    def test_order_length_and_nesting_distinguish_paths(self):
        rows = [parsed('noun', ['A', 'B']), parsed('noun', ['B', 'A']),
                parsed('noun', ['C', 'B']), parsed('noun', ['B']),
                dict(parsed('noun', ['A', 'B']), nesting_signature='different-attachment')]
        self.assertEqual(len({progression_identity(r)[0] for r in rows}), 5)

    def test_canonical_variants_share_but_different_functions_do_not(self):
        ki = parsed('మంచం', ['mod_dative'], spelling='మంచానికి')
        ku = parsed('మంచం', ['mod_dative'], spelling='verified-alternate-surface')
        self.assertEqual(progression_identity(ki), progression_identity(ku))
        self.assertNotEqual(progression_identity(ki), progression_identity(parsed('మంచం', ['other_function'])))
        self.assertNotEqual(progression_identity(parsed('mod_dative', core=True))[0], progression_identity(ki)[0])

    def test_plain_vocabulary_and_unverified_input_cannot_be_targets(self):
        for row in [parsed('bed'), dict(parsed('bed', ['A']), base_type='unidentified_combo'),
                    dict(parsed('bed', ['A']), modifier_count=2),
                    dict(parsed('core', core=True), base_id='')]:
            with self.subTest(row=row), self.assertRaises(ValueError):
                progression_identity(row)

    def test_catalog_merges_occurrences_without_leaking_vocabulary_bases(self):
        # Deterministic verified parse fixtures isolate catalog wiring from parser coverage.
        words = {'నేను': parsed('pronoun_nenu', core=True),
                 'మంచానికి': parsed('మంచం', ['mod_dative']),
                 'ఇంటికి': parsed('ఇల్లు', ['mod_dative']),
                 'చేశాను': parsed('verb_cheyu', ['mod_past', 'agr_first_singular'], core=True),
                 'మంచం': parsed('మంచం')}
        with tempfile.TemporaryDirectory() as temp:
            corpus, output = Path(temp)/'corpus.sqlite', Path(temp)/'grammar.sqlite'
            with sqlite3.connect(corpus) as db:
                db.executescript("CREATE TABLE sources(source_id TEXT,status TEXT); INSERT INTO sources VALUES('test','ready'); CREATE TABLE source_rows(source_id TEXT,source_key TEXT,text TEXT,audio_object_key TEXT);")
                db.execute('INSERT INTO source_rows VALUES(?,?,?,?)', ('test','1',' '.join(words)+' మంచానికి','audio.wav'))
            before = corpus.read_bytes()
            with patch.object(build_grammar, 'initialize'), patch.object(build_grammar, 'analyze_word', side_effect=words.__getitem__), contextlib.redirect_stdout(io.StringIO()):
                build_grammar.build(corpus, output)
                build_grammar.build(corpus, output)  # Resume must not duplicate counts.
            self.assertEqual(corpus.read_bytes(), before)
            with sqlite3.connect(output) as db:
                targets = db.execute('SELECT level,base_id,chain_json FROM targets ORDER BY level,base_id').fetchall()
                self.assertEqual(targets, [(1,'','["mod_dative"]'), (1,'pronoun_nenu','[]'), (3,'verb_cheyu','["mod_past", "agr_first_singular"]')])
                self.assertEqual(db.execute('SELECT COUNT(*) FROM occurrences').fetchone()[0], 5)
                dative = progression_identity(words['మంచానికి'])[0]
                self.assertEqual(db.execute('SELECT COUNT(*) FROM occurrences WHERE target_id=?',(dative,)).fetchone()[0], 3)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM vocabulary_occurrences').fetchone()[0], 1)
                identity = json.loads(db.execute("SELECT value FROM metadata WHERE key='identity'").fetchone()[0])
                self.assertEqual(identity['policy'], PROGRESSION_POLICY)
                self.assertEqual(identity['progression_sha256'], build_grammar.digest(SCRIPT/'progression_targets.py'))
                identity['policy'] = 'shared-chain-v2'
                db.execute("UPDATE metadata SET value=? WHERE key='identity'", (json.dumps(identity),))
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(ValueError, 'different corpus/parser/policy'):
                build_grammar.build(corpus, output)


if __name__ == '__main__':
    unittest.main()
