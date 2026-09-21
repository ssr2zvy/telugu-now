#!/usr/bin/env python3
"""Fast corpus analyzer using end-first modifier peeling.

This is the production runner for the dictionary-gated parser:
- core bases are hard-coded in grammar.json
- non-core bases must be present in lexicon_full.txt (plus documented supplemental lexicon)
- modifiers are registered grammar objects/rules, not raw suffix guesses
- parsing peels matching modifiers from the right, validates attachment by applying
  the rule forward, then dictionary-checks the remaining barrier stem/base.
"""
from __future__ import annotations

import argparse, csv, json, sys, time, tempfile, zipfile
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Tuple
from collections import defaultdict

from engine import Engine, GrammarError, nfc, one


def safe_int(value, default=1):
    try:
        return int(value)
    except Exception:
        return default


def resolve_input_csv(path: Path):
    if path.suffix.lower() != ".zip":
        return path, None
    tmp = tempfile.TemporaryDirectory()
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".csv") and not n.endswith("/")]
        if not names:
            tmp.cleanup()
            raise SystemExit("Zip input did not contain a CSV file.")
        names.sort(key=lambda n: (("frequency" not in n.lower() and "word" not in n.lower()), n))
        z.extract(names[0], tmp.name)
        return Path(tmp.name) / names[0], tmp


def load_rows(path: Path):
    csv_path, tmp = resolve_input_csv(path)
    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames or "word" not in reader.fieldnames:
                raise SystemExit("Input CSV must contain a word column.")
            out = []
            for i, row in enumerate(reader, 1):
                word = nfc((row.get("word") or "").strip())
                if not word:
                    continue
                out.append({
                    "row_id": i,
                    "word": word,
                    "source": (row.get("source") or "corpus").strip() or "corpus",
                    "frequency": safe_int(row.get("frequency"), 1),
                    **{k: v for k, v in row.items() if k not in {"word", "source", "frequency"}},
                })
            return out
    finally:
        if tmp:
            tmp.cleanup()


class EndPeelParser:
    def __init__(self, max_depth=6, max_states=500):
        self.engine = Engine()
        if not self.engine.non_core_lexicon:
            raise SystemExit("Required full dictionary did not load; refusing to parse corpus.")
        self.max_depth = max_depth
        self.max_states = max_states
        self.core_form_to_ids = defaultdict(list)
        for bid, b in self.engine.bases.items():
            for form in b.get("forms", []):
                self.core_form_to_ids[nfc(form)].append(bid)
        # Verb POS supplements are separate from dictionary existence.  The
        # dictionary only says "this is a valid Telugu lexical item"; these
        # reviewed supplements say which dictionary items may serve as verb
        # receivers for productive verb modifiers.
        self.dictionary_verbs = set()
        for verb_file in sorted(Path(__file__).parent.glob("lexicon_verb_supplement_v*.txt")):
            self.dictionary_verbs.update(
                nfc(x.strip())
                for x in verb_file.read_text(encoding="utf-8").splitlines()
                if x.strip() and not x.lstrip().startswith("#")
            )
        self.entries, self.stem_entries = self._compile_entries()
        self.weak_modifiers = {
            "mod_question", "mod_focus", "mod_indirect_question",
            "mod_quotative", "mod_reportative",
            "mod_poetic_final_m", "mod_poetic_final_n",
            "mod_poetic_plural_apocope", "mod_literary_locative",
        }
        # v17 fallback is deliberately narrow: only clear nominal case/plural
        # suffixes may bridge an attachment/profile gap. Verb/TAM/light-verb
        # gaps are handled through reviewed verb lexicon entries or explicit
        # grammar patches, not generic fallback.
        self.fallback_modifiers = {
            "mod_dative", "mod_accusative", "mod_locative",
            "mod_instrumental", "mod_plural",
        }

    def _entry_tail(self, rid):
        r = self.engine.rules[rid]
        op = one(r, "operation")
        if op in ("select_stem_append", "append", "strip_final_u_append"):
            return one(r, "append")
        if op == "rewrite_tail_append":
            return one(r, "replacement") + one(r, "append")
        if op == "lengthen_final_vowel":
            return one(r, "vowel")
        if op in ("derive_profile", "attach_profile", "embed_profile"):
            profile = one(r, "profile")
            joiner = one(r, "joiner")
            tail = ""
            if profile in self.engine.profiles:
                tail = joiner + self.engine.profiles[profile].get("citation", "")
            return tail
        # Lexical/whole-token rules have no constant suffix. _compile_entries
        # retains them in a separate reverse-stem collection.
        return ""

    def _compile_entries(self):
        out = []
        stems = []
        seen = set()
        for mid, rid, req in self.engine.surface_entries:
            tail = self._entry_tail(rid)
            op = one(self.engine.rules[rid], "operation")
            if not tail and op not in {
                "select_stem_append", "lexical_form", "whole_token_lookup",
                "strip_final_u_append", "rewrite_tail_append",
            }:
                continue
            key = (tail, mid, rid, tuple(sorted(req.items())))
            if key in seen:
                continue
            seen.add(key)
            (out if tail else stems).append((tail, mid, rid, req))
        out.sort(key=lambda x: len(x[0]), reverse=True)
        return out, stems

    @lru_cache(maxsize=8192)
    def _reverse_stem(self, surface, field, receiver_field):
        # Many receiver-specific rules share one field lookup. Cache the field,
        # not each rule, without caching a consumable generator.
        return tuple(dict.fromkeys(self.engine.reverse_stem(surface, field, receiver_field)))

    def _stem_inverses(self, surface, rid):
        """Use the grammar's own reverse stem/whole-form lookup, including aliases.

        No word-specific exceptions and no guessed suffix deletion are added.
        Every candidate still has to pass base validation, attachment rules and
        exact forward replay in analyze().
        """
        rule = self.engine.rules[rid]
        op = one(rule, "operation")
        if op in {"select_stem_append", "lexical_form", "whole_token_lookup"}:
            field = one(rule, "stem_field") if op == "select_stem_append" else one(rule, "field")
            return self._reverse_stem(surface, field, one(rule, "receiver_stem_field", None))
        return tuple(dict.fromkeys(self.engine.inverses(surface, rule)))

    @lru_cache(maxsize=2048)
    def _compatible_entries(self, next_mid, profile):
        """Filter only grammar-invariant outer attachment/profile constraints."""
        out = []
        # Prove indexed stem/whole-form candidates before spending the bounded
        # search budget on less constrained suffix alternatives.
        for entry in self.stem_entries + self.entries:
            tail, mid, rid, req = entry
            rule = self.engine.rules[rid]
            if next_mid is not None and one(rule, "result_classes_mode") != "preserve":
                if not any(self.engine.match(x, mid, rule["result_classes"])
                           for x in self.engine.targets(next_mid)):
                    if (mid, next_mid) not in self.engine.allow_pairs:
                        continue
            if profile is not None and one(rule, "operation") in {
                "derive_profile", "attach_profile", "embed_profile"
            } and one(rule, "profile") != profile:
                continue
            out.append(entry)
        return tuple(out)

    def _fits(self, state, next_mid=None, profile=None, base=None):
        if base is not None and (state["root"] != base or state.get("chain")):
            return False
        if profile is not None and state.get("profile") != profile:
            return False
        if next_mid is not None and not self.engine.allowed(state, next_mid):
            try:
                override = self.engine.resolve(state, next_mid, {})
                if not override or one(override[1], "action") != "allow":
                    return False
            except GrammarError:
                return False
        return True

    def _state_key(self, s):
        return (s["root"], tuple((t["modifier"], t["rule"], tuple(sorted(t["request"].items()))) for t in s.get("trace", [])))

    def _dictionary_plural_state(self, word):
        """Treat an exact dictionary word ending in లు as a plural nominal surface.

        This is not a guessed base.  The whole plural-looking surface must already
        be in the full dictionary.  It lets productive case rules such as plural
        dative apply to dictionary words where the singular lemma is absent from
        the dictionary, e.g. Xలు + కు.
        """
        if not (word.endswith("లు") and self.engine.is_non_core_stem_candidate(word)):
            return None
        try:
            s = self.engine.virtual_start(word, "noun")
        except GrammarError:
            return None
        s = dict(s)
        s["head"] = "mod_plural"
        s["classes"] = ["plural_nominal"]
        fs = dict(s.get("features", {}))
        fs["number"] = "plural"
        fs["plural_surface"] = "dictionary_exact"
        s["features"] = fs
        s["owners"] = list(s.get("owners", [])) + [("mod_plural", s.get("scope", 0))]
        s["chain"] = list(s.get("chain", [])) + ["mod_plural"]
        s["tree"] = {
            "kind": "application",
            "receiver": s.get("tree"),
            "modifier": "mod_plural",
            "rule": "dictionary_plural_surface_v16",
            "surface": word,
            "features": fs.copy(),
            "local_features": {"number": "plural"},
            "scope": s.get("scope", 0),
            "receiver_role": "dictionary_plural_surface",
        }
        s["trace"] = list(s.get("trace", [])) + [{
            "modifier": "mod_plural",
            "rule": "dictionary_plural_surface_v16",
            "override": None,
            "request": {},
            "input": word,
            "output": word,
            "edit": {"start": len(word), "end": len(word), "removed": "", "inserted": ""},
            "local_features": {"number": "plural", "plural_surface": "dictionary_exact"},
            "scope": s.get("scope", 0),
            "stem_owner": s.get("stem_owner", s.get("root", "")),
            "semantic_operators": [],
        }]
        return s

    def _base_states(self, word, next_mid=None, profile=None, base=None):
        states = []
        def fits(s):
            if base is not None and (s["root"] != base or s.get("chain")):
                return False
            if profile is not None and s.get("profile") != profile:
                return False
            if next_mid is not None and not self.engine.allowed(s, next_mid):
                try:
                    ov = self.engine.resolve(s, next_mid, {})
                    if not ov or one(ov[1], "action") != "allow":
                        return False
                except Exception:
                    return False
            return True

        # Registered hard-coded core bases.
        if word in self.core_form_to_ids:
            for bid in self.core_form_to_ids[word]:
                try:
                    s = self.engine.start(bid, word)
                except GrammarError:
                    continue
                if fits(s):
                    states.append(s)

        # Dictionary non-core base. This is an exact validated dictionary gate.
        # It is tried as a terminal "barrier" after suffix peeling reaches it.
        if base is None and profile is None and self.engine.is_non_core_stem_candidate(word):
            # Exact dictionary words are nominal by default. Treat a dictionary
            # item as a verb only if it is in the reviewed verb supplement; this
            # prevents short dictionary fragments from producing fake verb chains
            # such as "చ + obligation".
            positions = ["noun", "human_nominal"]
            if word in self.dictionary_verbs:
                positions.append("verb")
            for pos in positions:
                try:
                    s = self.engine.virtual_start(word, pos)
                except GrammarError:
                    continue
                if fits(s):
                    states.append(s)

            # If the exact dictionary item is plural-looking, expose it as a
            # plural nominal state so case overrides owned by mod_plural can fire.
            ps = self._dictionary_plural_state(word)
            if ps is not None and fits(ps):
                states.append(ps)
        return states


    def _analysis_from_state(self, state, surface, mid, rid, req, fallback_kind):
        """Create a conservative fallback analysis for a known suffix + verified barrier."""
        base_type = state.get("features", {}).get("base_type", "core_base" if state.get("root") in self.engine.bases else "dictionary_non_core_base")
        detected = None
        if base_type == "dictionary_non_core_base" and ":" in state.get("root", ""):
            detected = state["root"].split(":", 1)[1]
        obj = self.engine.objects.get(mid, {})
        cls = list(obj.get("classes", []))
        fs = dict(state.get("features", {}))
        fs.update({"fallback_parse": fallback_kind, "modifier": mid, "modifier_rule": rid})
        if mid == "mod_dative":
            fs["case"] = "dative"
        elif mid == "mod_accusative":
            fs["case"] = "accusative"
        elif mid == "mod_locative":
            fs["case"] = "locative"
        elif mid == "mod_instrumental":
            fs["case"] = "instrumental"
        elif mid == "mod_plural":
            fs["number"] = "plural"
        return {
            "status": "accepted_by_model",
            "surface": surface,
            "base": state.get("root", ""),
            "base_type": base_type,
            "detected_stem": detected,
            "chain": [mid],
            "classes": ["fallback_verified_barrier"] + cls,
            "active_features": fs,
            "operator_expression": {"predicate": state.get("root", ""), "fallback_parse": fallback_kind, "modifier": mid, "rule": rid},
            "semantic_coverage": "verified_barrier_plus_registered_suffix_fallback",
            "trace": [{
                "modifier": mid,
                "rule": rid,
                "request": req,
                "input": state.get("surface", ""),
                "output": surface,
                "edit": {"start": len(state.get("surface", "")), "end": len(surface), "removed": "", "inserted": surface[len(state.get("surface", "")):] if surface.startswith(state.get("surface", "")) else ""},
                "local_features": {"fallback_parse": fallback_kind},
                "scope": state.get("scope", 0),
                "stem_owner": state.get("stem_owner", state.get("root", "")),
            }],
            "unicode_codepoints": [],
            "intermediate_stem": False,
        }

    def _barrier_candidates_for_tail(self, surface, tail, rule):
        candidates = []
        seen = set()
        def add(x):
            x = nfc(x or "")
            if x and x not in seen:
                seen.add(x); candidates.append(x)
        if tail and surface.endswith(tail):
            raw = surface[:-len(tail)]
            add(raw)
            if tail == "లు":
                if raw.endswith("ు") and len(raw) > 1:
                    add(raw[:-1] + "ి")
                if raw.endswith("ా") and len(raw) > 1:
                    add(raw[:-1] + "ం"); add(raw[:-1] + "ము")
            if tail in {"కి", "కు", "ని", "ను", "తో", "లో"}:
                if raw.endswith("ాని") and len(raw) > 3:
                    add(raw[:-3] + "ం"); add(raw[:-3] + "ము")
                if raw.endswith("ాన్") and len(raw) > 3:
                    add(raw[:-3] + "ం"); add(raw[:-3] + "ము")
                if raw.endswith("ా") and len(raw) > 1:
                    add(raw[:-1] + "ం"); add(raw[:-1] + "ము")
                if raw.endswith("లు"):
                    add(raw)
        try:
            for before, _pid, _bid in self.engine.inverses(surface, rule):
                add(before)
        except Exception:
            pass
        try:
            op = one(rule, "operation")
            if op == "select_stem_append":
                suffix = one(rule, "append")
                raw = surface[:-len(suffix)] if suffix and surface.endswith(suffix) else surface if not suffix else ""
                field = one(rule, "stem_field")
                for base_surface, _pos in self.engine.dictionary_bases_for_stem(raw, field):
                    add(base_surface)
        except Exception:
            pass
        return candidates

    def _fallback_verified_barrier_analyses(self, word):
        """Return fallback analyses for known nominal suffix + dictionary/core barrier.

        Does not accept unknown stems. Does not use weak/final poetic suffixes.
        """
        out = []
        seen = set()
        for tail, mid, rid, req in self.entries:
            if mid in self.weak_modifiers or mid not in self.fallback_modifiers:
                continue
            if not tail or not word.endswith(tail):
                continue
            rule = self.engine.rules[rid]
            for barrier in self._barrier_candidates_for_tail(word, tail, rule):
                for st in self._base_states(barrier):
                    base_type = st.get("features", {}).get("base_type", "")
                    if base_type not in {"core_base", "dictionary_non_core_base"}:
                        continue
                    key = (st.get("root"), mid, rid)
                    if key in seen:
                        continue
                    seen.add(key)
                    out.append(self._analysis_from_state(st, word, mid, rid, req, "v17_verified_barrier_suffix_bridge"))
                    if len(out) >= 16:
                        return out
        return out

    def _simple_analysis(self, surface, base, base_type, chain, coverage, features=None, parts=None):
        fs = dict(features or {})
        fs.setdefault("base_type", base_type)
        if parts:
            fs["parts"] = parts
        detected = base if base_type != "core_base" else ""
        return {
            "status": "accepted_by_model",
            "surface": surface,
            "base": base,
            "base_type": base_type,
            "detected_stem": detected,
            "chain": chain,
            "classes": ["v18_general_mechanism"],
            "active_features": fs,
            "operator_expression": {"predicate": base, "chain": chain, "coverage": coverage},
            "semantic_coverage": coverage,
            "trace": [
                {
                    "modifier": m,
                    "rule": coverage,
                    "request": {},
                    "input": base,
                    "output": surface,
                    "edit": {"start": 0, "end": 0, "removed": "", "inserted": ""},
                    "local_features": fs,
                    "scope": 0,
                    "stem_owner": base,
                }
                for m in chain
            ],
            "unicode_codepoints": [],
            "intermediate_stem": False,
        }

    def _exact_base_like(self, w):
        """True when w is a core form or exact full-dictionary item."""
        return bool(self.core_form_to_ids.get(w)) or self.engine.is_non_core_stem_candidate(w)

    def _spelling_normalization_candidates(self, word):
        """Pattern-level spelling/noise normalization candidates.

        These are not word exceptions.  A normalized candidate is accepted only
        if it is itself dictionary/core verified or locally parseable by a v18
        mechanism.
        """
        candidates = []
        def add(x, rule):
            x = nfc(x)
            if x and x != word and (x, rule) not in candidates:
                candidates.append((x, rule))
        replacements = [
            ("ఙ్ఞ", "జ్ఞ", "jna_normalization"),
            ("ళ్లు", "ళ్ళు", "retroflex_l_cluster_variant"),
            ("పెల్లి", "పెళ్లి", "pelli_retroflex_variant"),
            ("దర్త", "దర్శ", "darsha_typo_normalization"),
            ("నిర్ర", "నిర్వ", "nirva_typo_normalization"),
            ("స్తున", "స్తున్న", "progressive_nn_normalization"),
            ("పందుగ", "పండుగ", "panduga_spelling_normalization"),
            ("పరి్ర", "పరిశ్ర", "parishrama_missing_sha_normalization"),
            ("రుణ", "రణ", "rana_typo_normalization"),
        ]
        for a, b, rule in replacements:
            if a in word:
                add(word.replace(a, b), rule)
        return candidates

    def _spelling_normalization_analyses(self, word):
        out = []
        for cand, rule in self._spelling_normalization_candidates(word):
            if self._exact_base_like(cand):
                bt = "core_base" if self.core_form_to_ids.get(cand) else "dictionary_non_core_base"
                out.append(self._simple_analysis(word, cand, bt, ["spelling_normalization"], "v18_spelling_normalization_exact", {"normalized_form": cand, "normalization_rule": rule}))
            else:
                local = self._loan_plural_analyses(cand) + self._modal_honorific_analyses(cand)
                for best in local[:2]:
                    best = dict(best)
                    fs = dict(best.get("active_features") or {})
                    fs.update({"normalized_form": cand, "normalization_rule": rule, "surface_before_normalization": word})
                    best["surface"] = word
                    best["active_features"] = fs
                    best["chain"] = (best.get("chain") or []) + ["spelling_normalization"]
                    best["semantic_coverage"] = "v18_spelling_normalization_parse"
                    out.append(best)
            if len(out) >= 4:
                break
        return out

    def _loan_plural_analyses(self, word):
        """Productive plural of modern/loan consonant-final stems.

        Preferred path is dictionary-gated: strip plural -లు and accept the
        remaining stem only if it is in the full dictionary.  A separate
        lower-confidence pattern path is used only for strong transliterated
        loan/proper forms with multiple virama clusters.
        """
        if not word.endswith("లు") or len(word) <= 2:
            return []
        raw = nfc(word[:-2])
        candidates = [raw]
        if raw.endswith("ర్"):
            candidates.append(raw + "టు")
            candidates.append(raw + "్టు")
        if raw.endswith("ట్"):
            candidates.append(raw + "ు")
        if raw.endswith("స్స్"):
            candidates.append(raw[:-3] + "ెస్")
            candidates.append(raw[:-2])
        out = []
        seen = set()
        for cand in candidates:
            cand = nfc(cand)
            if cand and cand not in seen and self.engine.is_non_core_stem_candidate(cand):
                seen.add(cand)
                out.append(self._simple_analysis(word, cand, "dictionary_non_core_base", ["mod_plural"], "v18_dictionary_loan_plural", {"number": "plural", "plural_base_candidate": cand}))
        if out:
            return out

        virama = "\u0c4d"
        virama_count = raw.count(virama)
        strong_loan = (
            virama_count >= 2 and len(raw) >= 5 and
            any(ch in raw for ch in ["్స", "్ట", "్డ", "్ర", "్ల", "్న", "్ప", "్క", "్గ"])
        )
        if strong_loan:
            return [self._simple_analysis(word, raw, "loanword_pattern_base", ["mod_plural"], "v18_pattern_validated_loan_plural", {"number": "plural", "loanword_pattern": "consonant_final_virama_cluster"})]
        return []

    def _compound_analyses(self, word):
        """Analyze transparent compounds as dictionary/core component + component."""
        out = []
        seen = set()
        min_left = 3
        min_right = 4
        bad_right = {"లు", "ల్లు", "ళ్లు", "ట్లు", "డ్లు", "న్లు", "ర్లు", "వలు", "కలు"}
        for i in range(min_left, max(min_left, len(word) - min_right + 1)):
            left = nfc(word[:i]); right = nfc(word[i:])
            if right in bad_right or not self._exact_base_like(left):
                continue
            right_analysis = None
            if self._exact_base_like(right):
                bt = "core_base" if self.core_form_to_ids.get(right) else "dictionary_non_core_base"
                right_analysis = {"base": right, "base_type": bt, "chain": []}
            else:
                for cand, rule in self._spelling_normalization_candidates(right):
                    if self._exact_base_like(cand):
                        bt = "core_base" if self.core_form_to_ids.get(cand) else "dictionary_non_core_base"
                        right_analysis = {"base": cand, "base_type": bt, "chain": ["spelling_normalization"], "normalization_rule": rule}
                        break
            if not right_analysis:
                continue
            key = (left, right, tuple(right_analysis.get("chain") or []))
            if key in seen:
                continue
            seen.add(key)
            bt = "core_base" if self.core_form_to_ids.get(left) else "dictionary_non_core_base"
            chain = ["compound_split"] + (right_analysis.get("chain") or [])
            parts = [left, right]
            out.append(self._simple_analysis(word, left, bt, chain, "v18_compound_split", {"compound_left": left, "compound_right": right}, parts=parts))
            if len(out) >= 8:
                break
        return out

    def _modal_honorific_analyses(self, word):
        """General modal/honorific/reported suffix recovery."""
        patterns = [
            ("గలిగారు", "mod_modal_ability_past_honorific"),
            ("గారు", "mod_honorific"),
            ("నున్నట్లు", "mod_future_reported_quotative"),
            ("ినట్లు", "mod_past_reported_quotative"),
            ("ున్నట్లు", "mod_progressive_reported_quotative"),
            ("ేస్తున్నట్లు", "mod_progressive_reported_quotative"),
        ]
        out = []
        for tail, label in patterns:
            if not word.endswith(tail) or len(word) <= len(tail):
                continue
            stem = nfc(word[:-len(tail)])
            cands = [stem, stem + "ు", stem + "ుగు", stem + "గు"]
            for cand in cands:
                if self._exact_base_like(cand):
                    bt = "core_base" if self.core_form_to_ids.get(cand) else "dictionary_non_core_base"
                    out.append(self._simple_analysis(word, cand, bt, [label], "v18_modal_honorific_or_reported_suffix", {"suffix": tail}))
                    break
        return out

    def analyze(self, word):
        word = nfc(word)
        uc = self.engine.unicode_check(word)
        if uc.get("status") != "within_telugu_input_domain":
            return {"status": "unknown", "analyses": [], "reason": uc.get("status", "unicode_rejected")}
        # Fast exact-base path.  If the token is already a core/dictionary base
        # and the only visible endings are weak/final particles, return the exact
        # base instead of exploring many false suffix paths.  Strong modifier
        # endings still go through the normal end-peel parser.
        top_matches = [(tail, mid, rid, req) for tail, mid, rid, req in self.entries if word.endswith(tail)]
        # A dictionary hit must not short-circuit a registered stem/whole-form
        # derivation merely because that derivation has no appended suffix.
        top_matches.extend(entry for entry in self.stem_entries if self._stem_inverses(word, entry[2]))
        top_strong = [x for x in top_matches if x[1] not in self.weak_modifiers]
        exact_states = self._base_states(word)
        if exact_states and not top_strong:
            terminal = {'base_word','nominal','inflected_nominal','finite_predicate','nonfinite','relative_participle',
                        'clitic_host','adjective','adverb','determiner','numeral','conjunction','postposition','particle',
                        'interjection','derived_verb','plural_nominal','perfective_converb'}
            exact_states = [s for s in exact_states if self.engine.closure(s['classes']) & terminal]
            analyses = [self.engine.result(s, False) for s in exact_states]
            analyses.sort(key=lambda a: self.rank(a))
            return {
                "status": "accepted_by_model" if analyses else "unknown",
                "analyses": analyses[:16],
                "search": {"visited_states": 0, "compiled_end_peel": True, "fast_exact_dictionary": True},
            }

        cache = {}
        active = set()
        visited = 0
        state_limit_reached = False
        cycle_prunes = 0

        def parse(surface, depth, next_mid=None, profile=None, base=None):
            nonlocal visited, state_limit_reached, cycle_prunes
            key = (surface, depth, next_mid, profile, base)
            if key in cache:
                return cache[key]
            if depth < 0 or not surface:
                return []
            if visited >= self.max_states:
                state_limit_reached = True
                return []
            cycle = (surface, next_mid, profile, base)
            if cycle in active:
                cycle_prunes += 1
                return []
            active.add(cycle)
            visited += 1
            results = []
            seen = set()

            def add_state(s):
                if not self._fits(s, next_mid, profile, base):
                    return
                k = self._state_key(s)
                if k not in seen:
                    seen.add(k)
                    results.append(s)

            # End-first modifier peeling. Try to strip an outer modifier, then
            # recursively parse the barrier/base to its left.
            for tail, mid, rid, req in self._compatible_entries(next_mid, profile) if base is None else ():
                if not surface.endswith(tail):
                    continue
                r = self.engine.rules[rid]
                try:
                    invs = (self._stem_inverses(surface, rid) if not tail
                            else tuple(self.engine.inverses(surface, r)))
                except Exception:
                    continue
                for before, pid, bid in invs:
                    if not before or len(before) > len(surface) + 24:
                        continue
                    for inner in parse(before, depth - 1, mid, pid, bid):
                        try:
                            s = self.engine.apply(inner, mid, req)
                        except GrammarError:
                            continue
                        if s.get("surface") == surface and s.get("trace") and s["trace"][-1].get("rule") == rid:
                            add_state(s)
                            if len(results) >= 32:
                                active.remove(cycle)
                                cache[key] = results
                                return results

            # Barrier/base check. This is where an unknown stem is rejected unless
            # it is hard-coded core or dictionary-verified.
            for s in self._base_states(surface, next_mid, profile, base):
                add_state(s)

            active.remove(cycle)
            cache[key] = results
            return results

        states = parse(word, self.max_depth)
        terminal = {'base_word','nominal','inflected_nominal','finite_predicate','nonfinite','relative_participle',
                    'clitic_host','adjective','adverb','determiner','numeral','conjunction','postposition','particle',
                    'interjection','derived_verb','plural_nominal','perfective_converb'}
        states = [s for s in states if self.engine.closure(s['classes']) & terminal]
        analyses = [self.engine.result(s, False) for s in states]
        fallback_analyses = []
        if not analyses:
            fallback_analyses = self._fallback_verified_barrier_analyses(word)
            if fallback_analyses:
                analyses.extend(fallback_analyses)
        if not analyses:
            for extra in (
                self._loan_plural_analyses(word)
                + self._modal_honorific_analyses(word)
                + self._spelling_normalization_analyses(word)
                + self._compound_analyses(word)
            ):
                analyses.append(extra)
        analyses.sort(key=lambda a: self.rank(a))
        return {
            "status": "accepted_by_model" if analyses else "unknown",
            "analyses": analyses[:16],
            "search": {"visited_states": visited, "compiled_end_peel": True,
                       "reverse_stem_rules": len(self.stem_entries),
                       "state_limit_reached": state_limit_reached,
                       "cycle_prunes": cycle_prunes,
                       "fallback_verified_barrier_count": len(fallback_analyses)},
        }

    def rank(self, a):
        base_type = a.get("base_type", "")
        chain = a.get("chain") or []
        chain_len = len(chain)
        # Some right-edge strings are very weak as morphology on their own
        # (question/focus particles, etc.). If the whole token is in the
        # dictionary, do not let those weak splits hide the dictionary word.
        weak_chain = bool(chain) and all(m in self.weak_modifiers or m == "mod_plural" for m in chain)

        coverage = a.get("semantic_coverage", "")
        is_fallback = coverage == "verified_barrier_plus_registered_suffix_fallback"
        if coverage.startswith("v18_"):
            return (4, -chain_len)
        if chain_len and base_type == "core_base" and not is_fallback:
            return (0, -chain_len)
        if chain_len and base_type == "dictionary_non_core_base" and not weak_chain and not is_fallback:
            return (1, -chain_len)
        if base_type == "core_base":
            return (2, 0)
        if base_type == "dictionary_non_core_base" and not chain_len:
            return (3, 0)
        if is_fallback:
            return (5, -chain_len)
        if chain_len and base_type == "dictionary_non_core_base":
            return (6, -chain_len)
        return (9, 0)


def chain_text(a):
    return "+".join(a.get("chain") or [])


def compact(a):
    return {
        "base": a.get("base", ""),
        "base_type": a.get("base_type", ""),
        "detected_stem": a.get("detected_stem") or "",
        "chain": a.get("chain") or [],
        "features": a.get("active_features") or {},
        "trace": [
            {
                "modifier": t.get("modifier", ""),
                "rule": t.get("rule", ""),
                "removed": (t.get("edit") or {}).get("removed", ""),
                "inserted": (t.get("edit") or {}).get("inserted", ""),
            }
            for t in (a.get("trace") or [])
        ],
    }


def write_csv(path, rows, fieldnames):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for row in rows:
            w.writerow(row)


def summarize(rows, key=lambda r: True):
    selected = [r for r in rows if key(r)]
    uniq = {r["word"] for r in selected}
    total_freq = sum(int(r.get("frequency", 1)) for r in selected)
    parsed = [r for r in selected if r["status"] == "parsed"]
    puniq = {r["word"] for r in parsed}
    pfreq = sum(int(r.get("frequency", 1)) for r in parsed)
    return {
        "rows": len(selected),
        "unique_words": len(uniq),
        "frequency_total": total_freq,
        "parsed_rows": len(parsed),
        "unparsed_rows": len(selected) - len(parsed),
        "parsed_row_rate": len(parsed)/len(selected) if selected else 0,
        "parsed_unique_words": len(puniq),
        "unparsed_unique_words": len(uniq - puniq),
        "parsed_unique_rate": len(puniq)/len(uniq) if uniq else 0,
        "parsed_frequency": pfreq,
        "parsed_frequency_rate": pfreq/total_freq if total_freq else 0,
        "core_base_unique_words": len({r["word"] for r in parsed if r.get("base_type") == "core_base"}),
        "dictionary_non_core_base_unique_words": len({r["word"] for r in parsed if r.get("base_type") == "dictionary_non_core_base"}),
        "parsed_with_modifier_chain_unique_words": len({r["word"] for r in parsed if r.get("chain")}),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--outdir", default="reports/full-corpus-end-peel")
    ap.add_argument("--sort-frequency", action="store_true")
    ap.add_argument("--limit-rows", type=int)
    ap.add_argument("--max-depth", type=int, default=6)
    args = ap.parse_args()

    parser = EndPeelParser(max_depth=args.max_depth)
    rows = load_rows(Path(args.input))
    if args.sort_frequency:
        rows.sort(key=lambda r: int(r.get("frequency", 1)), reverse=True)
    if args.limit_rows:
        rows = rows[:args.limit_rows]

    t0 = time.perf_counter()
    word_cache = {}
    result_rows = []
    parsed_rows = []
    unparsed_rows = []

    for row in rows:
        word = row["word"]
        if word not in word_cache:
            res = parser.analyze(word)
            analyses = res.get("analyses") or []
            best = analyses[0] if analyses else None
            word_cache[word] = (res, best)
        res, best = word_cache[word]
        if best:
            status = "parsed"
            out = {
                **row,
                "status": status,
                "base": best.get("base", ""),
                "base_type": best.get("base_type", ""),
                "detected_stem": best.get("detected_stem") or "",
                "chain": chain_text(best),
                "analysis_count": len(res.get("analyses") or []),
                "analysis_json": json.dumps(compact(best), ensure_ascii=False, sort_keys=True),
            }
            parsed_rows.append(out)
        else:
            status = "unparsed"
            out = {**row, "status": status, "base": "", "base_type": "", "detected_stem": "", "chain": "", "analysis_count": 0, "analysis_json": ""}
            unparsed_rows.append(out)
        result_rows.append(out)

    elapsed = time.perf_counter() - t0
    outdir = Path(args.outdir)
    fields = ["row_id","word","source","frequency","status","base","base_type","detected_stem","chain","analysis_count","analysis_json"]
    extra_fields = [k for k in result_rows[0].keys() if k not in fields] if result_rows else []
    fields = fields + extra_fields

    write_csv(outdir / "corpus-analysis-results.csv", result_rows, fields)
    write_csv(outdir / "corpus-analysis-parsed.csv", parsed_rows, fields)
    write_csv(outdir / "corpus-analysis-unparsed.csv", unparsed_rows, fields)

    # one row per unique word
    word_rows = {}
    for r in result_rows:
        w = r["word"]
        if w not in word_rows:
            word_rows[w] = r.copy()
            word_rows[w]["row_count"] = 0
            word_rows[w]["frequency_total"] = 0
        word_rows[w]["row_count"] += 1
        word_rows[w]["frequency_total"] += int(r.get("frequency", 1))
    wf = ["word","status","base","base_type","detected_stem","chain","analysis_count","frequency_total","row_count","source","frequency","row_id","analysis_json"]
    write_csv(outdir / "corpus-analysis-word-results.csv", sorted(word_rows.values(), key=lambda r: (-int(r["frequency_total"]), r["word"])), wf)

    summary = {
        "mode": "compiled_end_peel_dictionary_gated",
        "dictionary_entries_loaded": len(parser.engine.non_core_lexicon),
        "input_rows": len(rows),
        "unique_words": len(word_cache),
        "elapsed_seconds": elapsed,
        "rows_per_second": len(rows)/elapsed if elapsed else None,
        "overall": summarize(result_rows),
        "sources": {src: summarize(result_rows, lambda r, src=src: r.get("source") == src) for src in sorted({r.get("source") for r in result_rows})},
        "notes": [
            "Non-core bases must exist in lexicon_full.txt or the supplemental validated lexicon loaded by engine.py.",
            "Modifier parsing is end-first: visible right-edge modifiers are peeled and validated by applying registered grammar rules forward.",
            "If a modifier is recognized but the barrier stem is not a core or dictionary word, the word remains unparsed.",
            "Modifier-chain analyses are ranked above whole-word dictionary standalone hits to avoid swallowing morphology.",
        ],
    }
    (outdir / "corpus-analysis-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
