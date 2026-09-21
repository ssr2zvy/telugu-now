#!/usr/bin/env python3
"""Corpus GI analyzer for the Telugu morphology model.

This runner wraps corpus_analyze_end_peel.py and adds:
  - parsed/unparsed status
  - GI score
  - parsed or partial Unicode parts
  - partial modifier/barrier information for unparsed words

GI policy:
  GI is only calculated for GI-relevant words.
  A word is GI-relevant if it is a hardcoded/core grammatical base OR if any
  grammatical modifier/chain item is detected.
  Parsed core/base grammatical word: base score 1.
  Parsed non-core vocabulary word with no grammatical modifier: GI=N/A and
  gi_relevant=false.
  Parsed non-core vocabulary word with grammatical modifiers: base score 0,
  plus +1 for each detected grammatical modifier.
  Unparsed word with detected grammatical modifiers: unidentified-combo base
  score 1, plus +1 for each partial modifier.
  Unparsed word with no detected modifiers: GI=N/A and gi_relevant=false.
  Non-grammatical mechanisms such as compound_split and spelling_normalization
  are returned as parts but do not increase GI unless they contain a mod_* chain
  item.
"""
from __future__ import annotations

import argparse, csv, json, time
from pathlib import Path
from typing import Any, Dict, List, Tuple
from collections import defaultdict

from engine import nfc
from corpus_analyze_end_peel import EndPeelParser, load_rows, compact, chain_text, write_csv, summarize


NON_GI_CHAIN_ITEMS = {"compound_split", "spelling_normalization"}
WEAK_PART_NOTE = "weak_suffix_candidate"


def codepoints(s: str) -> List[str]:
    return [f"U+{ord(c):04X}" for c in (s or "")]


def is_gi_modifier(label: str) -> bool:
    """Count every detected grammatical chain item toward GI.

    The chain may contain labels like mod_*, agr_*, and other registered grammar
    pieces.  These are counted as modifiers/grammar operations.  Mechanism labels
    such as compound_split and spelling_normalization are emitted as parts but do
    not add GI by themselves.
    """
    if not label:
        return False
    if label in NON_GI_CHAIN_ITEMS:
        return False
    return True


def gi_modifier_count(chain: List[str]) -> int:
    return sum(1 for x in chain if is_gi_modifier(x))


def parsed_base_score(a: Dict[str, Any]) -> int:
    return 1 if a.get("base_type") == "core_base" else 0


def gi_value(base_score: int, mod_count: int) -> str:
    """Return GI score or N/A for GI-irrelevant words."""
    relevant = (base_score > 0) or (mod_count > 0)
    return str(base_score + mod_count) if relevant else "N/A"


def gi_relevant(base_score: int, mod_count: int) -> bool:
    return (base_score > 0) or (mod_count > 0)


def part_text(parts: List[Dict[str, Any]]) -> str:
    out = []
    for p in parts:
        role = p.get("role", "")
        surface = p.get("surface", "")
        label = p.get("modifier") or p.get("base_type") or role
        if role in {"modifier", "partial_modifier", "mechanism"}:
            out.append(f"{role}:{label}<{surface}>")
        else:
            out.append(f"{role}:{surface}")
    return " + ".join(out)


def parts_for_parsed(word: str, a: Dict[str, Any]) -> List[Dict[str, Any]]:
    chain = list(a.get("chain") or [])
    base_type = a.get("base_type", "")
    detected = a.get("detected_stem") or ""
    base = a.get("base") or ""
    features = a.get("active_features") or {}
    parts_from_features = features.get("parts") if isinstance(features, dict) else None

    base_surface = detected or (parts_from_features[0] if isinstance(parts_from_features, list) and parts_from_features else base)
    parts: List[Dict[str, Any]] = [{
        "role": "base" if base_type == "core_base" else "vocab_base",
        "surface": base_surface,
        "base": base,
        "base_type": base_type,
        "gi_contribution": parsed_base_score(a),
        "codepoints": codepoints(base_surface),
    }]

    if isinstance(parts_from_features, list) and len(parts_from_features) > 1:
        for extra in parts_from_features[1:]:
            parts.append({
                "role": "compound_component",
                "surface": extra,
                "base_type": "component",
                "gi_contribution": 0,
                "codepoints": codepoints(extra),
            })

    trace = list(a.get("trace") or [])
    for i, label in enumerate(chain):
        role = "modifier" if is_gi_modifier(label) else "mechanism"
        t = trace[i] if i < len(trace) else {}
        edit = t.get("edit") or {}
        inserted = edit.get("inserted", "")
        removed = edit.get("removed", "")
        surface_piece = inserted or removed or label
        parts.append({
            "role": role,
            "surface": surface_piece,
            "modifier": label,
            "rule": t.get("rule", ""),
            "gi_contribution": 1 if is_gi_modifier(label) else 0,
            "codepoints": codepoints(surface_piece),
        })
    return parts


def choose_partial_entry(parser: EndPeelParser, surface: str):
    """Choose the most informative right-edge modifier candidate for partial parsing."""
    matches = []
    for tail, mid, rid, req in parser.entries:
        if tail and surface.endswith(tail):
            weak = mid in parser.weak_modifiers
            matches.append((weak, -len(tail), tail, mid, rid, req))
    if not matches:
        return None
    matches.sort()
    weak, neg_len, tail, mid, rid, req = matches[0]
    return tail, mid, rid, req, bool(weak)


def partial_for_unparsed(parser: EndPeelParser, word: str, max_depth: int = 6) -> Dict[str, Any]:
    """Peel detectable right-edge modifiers without accepting unknown bases.

    This is deliberately diagnostic: it records what was recognized even when
    the final barrier/stem fails the dictionary/core gate or the chain is not
    licensed by the full parser.
    """
    current = nfc(word)
    modifiers: List[Dict[str, Any]] = []
    visited = set()

    for _ in range(max_depth):
        if current in visited:
            break
        visited.add(current)
        chosen = choose_partial_entry(parser, current)
        if not chosen:
            break
        tail, mid, rid, req, weak = chosen
        rule = parser.engine.rules[rid]
        candidates = parser._barrier_candidates_for_tail(current, tail, rule)
        if not candidates and tail and current.endswith(tail):
            candidates = [current[:-len(tail)]]
        # Prefer a verified barrier if one exists, otherwise the shortest
        # reasonable candidate from the inverse list.
        verified = [c for c in candidates if parser._exact_base_like(c)]
        if verified:
            barrier = sorted(verified, key=lambda x: (len(x), x))[0]
        elif candidates:
            barrier = sorted(candidates, key=lambda x: (abs(len(current)-len(x)), len(x)))[0]
        else:
            barrier = current[:-len(tail)] if tail else current
        if not barrier or barrier == current:
            break
        modifiers.append({
            "role": "partial_modifier",
            "surface": tail,
            "modifier": mid,
            "rule": rid,
            "request": req,
            "weak": weak,
            "gi_contribution": 1 if is_gi_modifier(mid) else 0,
            "codepoints": codepoints(tail),
        })
        current = nfc(barrier)

    base_verified = parser._exact_base_like(current)
    if base_verified:
        base_role = "verified_barrier_but_chain_failed"
        base_type = "core_or_dictionary"
    else:
        base_role = "unidentified_combo"
        base_type = "unknown"

    parts = [{
        "role": base_role,
        "surface": current,
        "base_type": base_type,
        "gi_contribution": 1,
        "codepoints": codepoints(current),
    }] + list(reversed(modifiers))

    chain = [m["modifier"] for m in reversed(modifiers)]
    return {
        "partial_barrier": current,
        "partial_barrier_verified": base_verified,
        "partial_chain": chain,
        "partial_modifier_count": gi_modifier_count(chain),
        "parts": parts,
        "parts_text": part_text(parts),
        "parts_json": json.dumps(parts, ensure_ascii=False, sort_keys=True),
    }


def gi_for_result(parser: EndPeelParser, word: str, best: Dict[str, Any] | None) -> Dict[str, Any]:
    if best:
        chain = list(best.get("chain") or [])
        base = parsed_base_score(best)
        mod_count = gi_modifier_count(chain)
        parts = parts_for_parsed(word, best)
        return {
            "gi_relevant": gi_relevant(base, mod_count),
            "gi_score": gi_value(base, mod_count),
            "gi_base_score": base,
            "gi_modifier_count": mod_count,
            "partial_barrier": "",
            "partial_barrier_verified": "",
            "partial_chain": "",
            "parts_text": part_text(parts),
            "parts_json": json.dumps(parts, ensure_ascii=False, sort_keys=True),
        }

    partial = partial_for_unparsed(parser, word)
    mod_count = partial["partial_modifier_count"]
    # Unparsed words only get the unidentified-combo base score when there is
    # at least one detected grammatical modifier.  If no modifier can be
    # recognized, they are GI-irrelevant and receive N/A.
    base = 1 if mod_count > 0 else 0
    return {
        "gi_relevant": gi_relevant(base, mod_count),
        "gi_score": gi_value(base, mod_count),
        "gi_base_score": base,
        "gi_modifier_count": mod_count,
        "partial_barrier": partial["partial_barrier"],
        "partial_barrier_verified": partial["partial_barrier_verified"],
        "partial_chain": "+".join(partial["partial_chain"]),
        "parts_text": partial["parts_text"],
        "parts_json": partial["parts_json"],
    }


def summarize_gi(result_rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not result_rows:
        return {}

    def is_rel(r: Dict[str, Any]) -> bool:
        v = r.get("gi_relevant")
        return v is True or str(v).lower() == "true"

    def fnum(x):
        try:
            return float(x)
        except Exception:
            return None

    relevant_rows = [r for r in result_rows if is_rel(r)]
    irrelevant_rows = [r for r in result_rows if not is_rel(r)]
    total_freq = sum(int(r.get("frequency", 1)) for r in result_rows)
    relevant_freq = sum(int(r.get("frequency", 1)) for r in relevant_rows)
    irrelevant_freq = sum(int(r.get("frequency", 1)) for r in irrelevant_rows)
    gi_vals = [fnum(r.get("gi_score")) for r in relevant_rows]
    gi_vals = [v for v in gi_vals if v is not None]
    weighted_sum = sum((fnum(r.get("gi_score")) or 0.0) * int(r.get("frequency", 1)) for r in relevant_rows)

    by_status: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in result_rows:
        by_status[r.get("status", "")].append(r)

    def row_summary(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
        rel = [r for r in rows if is_rel(r)]
        vals = [fnum(r.get("gi_score")) for r in rel]
        vals = [v for v in vals if v is not None]
        return {
            "rows": len(rows),
            "gi_relevant_rows": len(rel),
            "gi_irrelevant_rows": len(rows) - len(rel),
            "mean_gi_relevant_only": sum(vals)/len(vals) if vals else None,
            "max_gi_relevant_only": max(vals) if vals else None,
        }

    hist: Dict[str, int] = defaultdict(int)
    for r in relevant_rows:
        hist[str(r.get("gi_score"))] += 1

    return {
        "gi_relevant_rows": len(relevant_rows),
        "gi_irrelevant_rows": len(irrelevant_rows),
        "gi_relevant_frequency_total": relevant_freq,
        "gi_irrelevant_frequency_total": irrelevant_freq,
        "gi_relevant_row_rate": len(relevant_rows) / len(result_rows) if result_rows else 0,
        "gi_relevant_frequency_rate": relevant_freq / total_freq if total_freq else 0,
        "mean_gi_relevant_only": sum(gi_vals) / len(gi_vals) if gi_vals else None,
        "max_gi_relevant_only": max(gi_vals) if gi_vals else None,
        "frequency_weighted_mean_gi_relevant_only": weighted_sum / relevant_freq if relevant_freq else None,
        "gi_histogram_relevant_rows": dict(sorted(hist.items(), key=lambda kv: float(kv[0]))),
        "by_status": {s: row_summary(rows) for s, rows in sorted(by_status.items())},
    }

def main():
    ap = argparse.ArgumentParser(description="Run corpus parseability and grammatical-intensity scoring.")
    ap.add_argument("input", help="CSV or ZIP with word/source/frequency columns.")
    ap.add_argument("--outdir", default="reports/corpus-gi-analysis")
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
    word_cache: Dict[str, Tuple[Dict[str, Any], Dict[str, Any] | None, Dict[str, Any]]] = {}
    result_rows = []
    parsed_rows = []
    unparsed_rows = []

    for row in rows:
        word = row["word"]
        if word not in word_cache:
            res = parser.analyze(word)
            analyses = res.get("analyses") or []
            best = analyses[0] if analyses else None
            gi = gi_for_result(parser, word, best)
            word_cache[word] = (res, best, gi)
        res, best, gi = word_cache[word]
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
                **gi,
            }
            parsed_rows.append(out)
        else:
            status = "unparsed"
            out = {
                **row,
                "status": status,
                "base": "",
                "base_type": "unidentified_combo",
                "detected_stem": gi.get("partial_barrier", ""),
                "chain": gi.get("partial_chain", ""),
                "analysis_count": 0,
                "analysis_json": "",
                **gi,
            }
            unparsed_rows.append(out)
        result_rows.append(out)

    elapsed = time.perf_counter() - t0
    outdir = Path(args.outdir)
    fields = [
        "row_id","word","source","frequency","status","gi_relevant","gi_score","gi_base_score","gi_modifier_count",
        "base","base_type","detected_stem","chain","partial_barrier","partial_barrier_verified",
        "partial_chain","parts_text","parts_json","analysis_count","analysis_json"
    ]
    extra_fields = [k for k in result_rows[0].keys() if k not in fields] if result_rows else []
    fields = fields + extra_fields

    write_csv(outdir / "corpus-gi-results.csv", result_rows, fields)
    write_csv(outdir / "corpus-gi-parsed.csv", parsed_rows, fields)
    write_csv(outdir / "corpus-gi-unparsed.csv", unparsed_rows, fields)

    word_rows: Dict[str, Dict[str, Any]] = {}
    for r in result_rows:
        w = r["word"]
        if w not in word_rows:
            word_rows[w] = r.copy()
            word_rows[w]["row_count"] = 0
            word_rows[w]["frequency_total"] = 0
        word_rows[w]["row_count"] += 1
        word_rows[w]["frequency_total"] += int(r.get("frequency", 1))
    wf = [
        "word","status","gi_relevant","gi_score","gi_base_score","gi_modifier_count","base","base_type",
        "detected_stem","chain","partial_barrier","partial_barrier_verified","partial_chain",
        "parts_text","parts_json","analysis_count","frequency_total","row_count","source",
        "frequency","row_id","analysis_json"
    ]
    write_csv(outdir / "corpus-gi-word-results.csv", sorted(word_rows.values(), key=lambda r: (-int(r["frequency_total"]), r["word"])), wf)

    base_summary = {
        "mode": "compiled_end_peel_dictionary_gated_with_gi",
        "dictionary_entries_loaded": len(parser.engine.non_core_lexicon),
        "input_rows": len(rows),
        "unique_words": len(word_cache),
        "elapsed_seconds": elapsed,
        "rows_per_second": len(rows)/elapsed if elapsed else None,
        "overall": summarize(result_rows),
        "gi": summarize_gi(result_rows),
        "notes": [
            "GI relevance: core_base or detected grammatical modifier=true; plain non-core vocab and no-modifier unknown=false.",
            "GI parsed base score: core_base=1, non-core vocabulary/loan/pattern base=0.",
            "GI unparsed base score: unidentified_combo=1 only when a partial modifier was detected; otherwise GI=N/A.",
            "Each detected chain item named mod_* adds +1.",
            "compound_split and spelling_normalization are emitted in parts but do not add GI unless they contain a mod_* item.",
            "Unparsed rows include partial_barrier, partial_chain, parts_text, and parts_json for the recognizable right-edge pieces.",
        ],
    }
    (outdir / "corpus-gi-summary.json").write_text(json.dumps(base_summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(base_summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
