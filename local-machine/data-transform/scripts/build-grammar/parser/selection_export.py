#!/usr/bin/env python3
"""Sentence-level parser/GI export for selection-agent integration.

Input:
  CSV with observation_id,sentence_text columns
  or JSONL with observation_id and sentence_text fields.

Outputs:
  all_token_parses.csv
  eligible_targets.csv
  target_occurrences.csv
  ineligible_or_ambiguous.csv
  summary.json

Offset convention:
  Unicode code-point offsets, zero-based, end-exclusive, relative to the original
  sentence string as received by this script. NFC normalization is applied only
  per-token for parser lookup; original token_surface and original spans are kept.
"""
from __future__ import annotations

import argparse, csv, json, re, sys
from pathlib import Path
from collections import defaultdict, Counter
from typing import Any, Dict, Iterable, List, Tuple

from engine import nfc
from corpus_analyze_end_peel import EndPeelParser, compact
from corpus_analyze_gi import gi_for_result, part_text, is_gi_modifier


TOKEN_RE = re.compile(r"[\w\u0C00-\u0C7F]+", re.UNICODE)
SCHEMA_VERSION = "target_schema_v1"
PARSER_VERSION = "v20_gi_relevance_stemfix_v1"


def read_observations(path: Path) -> List[Dict[str, str]]:
    if path.suffix.lower() == ".jsonl":
        rows = []
        with path.open("r", encoding="utf-8") as f:
            for i, line in enumerate(f, 1):
                if not line.strip():
                    continue
                obj = json.loads(line)
                oid = str(obj.get("observation_id") or obj.get("id") or f"obs_{i:06d}")
                text = str(obj.get("sentence_text") or obj.get("text") or obj.get("sentence") or "")
                rows.append({"observation_id": oid, "sentence_text": text})
        return rows
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        r = csv.DictReader(f)
        if not r.fieldnames:
            raise SystemExit("Input CSV has no header.")
        text_col = "sentence_text" if "sentence_text" in r.fieldnames else ("text" if "text" in r.fieldnames else None)
        if text_col is None:
            raise SystemExit("Input CSV must contain sentence_text or text column.")
        out = []
        for i, row in enumerate(r, 1):
            oid = str(row.get("observation_id") or row.get("id") or f"obs_{i:06d}")
            out.append({"observation_id": oid, "sentence_text": row.get(text_col) or ""})
        return out


def iter_tokens(sentence: str):
    for idx, m in enumerate(TOKEN_RE.finditer(sentence)):
        yield idx, m.group(0), m.start(), m.end()


def best_analysis(parser: EndPeelParser, word: str):
    result = parser.analyze(word)
    analyses = result.get("analyses") or []
    if not analyses:
        return result, None
    analyses = sorted(analyses, key=parser.rank)
    return result, analyses[0]


def canon_base_id(a: Dict[str, Any]) -> str:
    base_type = a.get("base_type") or ""
    if base_type == "core_base":
        return str(a.get("base") or "")
    # Dictionary/loan/compound bases: use the detected surface stem when available.
    return str(a.get("detected_stem") or a.get("base") or "")


def chain_list(a: Dict[str, Any]) -> List[str]:
    return [str(x) for x in (a.get("chain") or []) if str(x)]


def nesting_signature(a: Dict[str, Any]) -> str:
    # Current production chains are linear. Keep the field so future tree-based
    # targets do not need a schema break.
    return "linear"


def grammar_pattern_id(chain: List[str], gi_score: str, base_type: str) -> str:
    if not chain:
        if base_type == "core_base":
            return f"GRAM:{SCHEMA_VERSION}:core_base_only"
        return ""
    return f"GRAM:{SCHEMA_VERSION}:{'|'.join(chain)}"


def target_id_for(a: Dict[str, Any], gi: Dict[str, Any]) -> str:
    chain = chain_list(a)
    base = canon_base_id(a)
    sig = nesting_signature(a)
    if not chain and a.get("base_type") == "core_base":
        return f"CORE:{SCHEMA_VERSION}:{base}:{sig}"
    if chain:
        return f"LEX:{SCHEMA_VERSION}:{base}:{sig}:{'|'.join(chain)}"
    return ""


def parse_confidence(result: Dict[str, Any], a: Dict[str, Any] | None, gi: Dict[str, Any]) -> str:
    if a is None:
        return "partial" if gi.get("gi_relevant") else "none"
    coverage = str(a.get("semantic_coverage") or "")
    features = a.get("active_features") or {}
    if features.get("normalization_confidence") == "uncertain":
        return "uncertain"
    if coverage.startswith("v18_"):
        # v18 mechanisms are accepted by the model but should remain traceable.
        return "verified_mechanism"
    return "high"


def is_eligible(result: Dict[str, Any], a: Dict[str, Any] | None, gi: Dict[str, Any], confidence: str) -> bool:
    if a is None:
        return False
    if not gi.get("gi_relevant"):
        return False
    if str(gi.get("gi_score")) == "N/A":
        return False
    if confidence in {"uncertain", "partial", "none"}:
        return False
    # If multiple analyses remain and the top two have equal rank, exclude until resolved.
    analyses = result.get("analyses") or []
    if len(analyses) > 1:
        ranks = [EndPeelParser().rank(x) for x in analyses[:2]]  # safe but not ideal; replaced by caller? kept simple
        if ranks[0] == ranks[1]:
            return False
    return bool(target_id_for(a, gi))


def row_for_token(parser: EndPeelParser, obs: Dict[str, str], token_index: int, surface: str, start: int, end: int) -> Dict[str, Any]:
    parser_word = nfc(surface)
    result, a = best_analysis(parser, parser_word)
    gi = gi_for_result(parser, parser_word, a)
    confidence = parse_confidence(result, a, gi)
    eligible = False
    # Do not instantiate a second parser for rank; simpler ambiguity test below.
    if a is not None and gi.get("gi_relevant") and str(gi.get("gi_score")) != "N/A" and confidence not in {"uncertain", "partial", "none"}:
        analyses = result.get("analyses") or []
        tied = False
        if len(analyses) > 1:
            s0 = parser.rank(analyses[0])
            s1 = parser.rank(analyses[1])
            tied = s0 == s1
        eligible = (not tied) and bool(target_id_for(a, gi))
    if a:
        chain = chain_list(a)
        base_id = canon_base_id(a)
        base_type = a.get("base_type") or ""
        tid = target_id_for(a, gi) if eligible else ""
        gpid = grammar_pattern_id(chain, str(gi.get("gi_score")), base_type) if eligible else ""
        parse_category = "core_base" if base_type == "core_base" else ("with_modifier" if chain else "plain_noncore_vocab")
        analysis_json = json.dumps(compact(a), ensure_ascii=False, sort_keys=True)
    else:
        chain = []
        base_id = gi.get("partial_barrier") or ""
        base_type = "unknown"
        tid = ""
        gpid = ""
        parse_category = "unparsed_partial" if gi.get("gi_relevant") else "unparsed_no_gi"
        analysis_json = "{}"
    occurrence_id = f"{obs['observation_id']}:{token_index}:{tid}" if eligible else ""
    return {
        "observation_id": obs["observation_id"],
        "token_index": token_index,
        "char_start_cp": start,
        "char_end_cp": end,
        "token_surface": surface,
        "token_nfc": parser_word,
        "status": "parsed" if a else "unparsed",
        "eligible": str(bool(eligible)).lower(),
        "parse_confidence": confidence,
        "gi_relevant": str(bool(gi.get("gi_relevant"))).lower(),
        "gi_score": gi.get("gi_score"),
        "base_id": base_id,
        "base_type": base_type,
        "parse_category": parse_category,
        "ordered_modifier_chain": "|".join(chain),
        "nesting_signature": nesting_signature(a or {}),
        "target_id": tid,
        "grammar_pattern_id": gpid,
        "occurrence_id": occurrence_id,
        "partial_barrier": gi.get("partial_barrier", ""),
        "partial_chain": gi.get("partial_chain", ""),
        "parts_text": gi.get("parts_text", ""),
        "parts_json": gi.get("parts_json", ""),
        "analysis_json": analysis_json,
    }


def write_csv(path: Path, rows: List[Dict[str, Any]], fieldnames: List[str]):
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow(row)


def main():
    ap = argparse.ArgumentParser(description="Export Telugu parser/GI targets and occurrences for the selection agent.")
    ap.add_argument("input", help="CSV or JSONL with observation_id,sentence_text.")
    ap.add_argument("--outdir", default="reports/selection_export")
    ap.add_argument("--max-depth", type=int, default=6)
    args = ap.parse_args()

    parser = EndPeelParser(max_depth=args.max_depth)
    observations = read_observations(Path(args.input))
    outdir = Path(args.outdir); outdir.mkdir(parents=True, exist_ok=True)

    all_rows: List[Dict[str, Any]] = []
    for obs in observations:
        for token_index, surface, start, end in iter_tokens(obs["sentence_text"]):
            all_rows.append(row_for_token(parser, obs, token_index, surface, start, end))

    fields = [
        "observation_id","token_index","char_start_cp","char_end_cp","token_surface","token_nfc",
        "status","eligible","parse_confidence","gi_relevant","gi_score","base_id","base_type",
        "parse_category","ordered_modifier_chain","nesting_signature","target_id","grammar_pattern_id",
        "occurrence_id","partial_barrier","partial_chain","parts_text","parts_json","analysis_json"
    ]
    write_csv(outdir/"all_token_parses.csv", all_rows, fields)
    eligible_rows = [r for r in all_rows if r["eligible"] == "true"]
    ineligible_rows = [r for r in all_rows if r["eligible"] != "true"]
    write_csv(outdir/"target_occurrences.csv", eligible_rows, fields)
    write_csv(outdir/"ineligible_or_ambiguous.csv", ineligible_rows, fields)

    # Inventory.
    by_target: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in eligible_rows:
        by_target[r["target_id"]].append(r)
    target_rows = []
    for tid, rows in sorted(by_target.items()):
        first = rows[0]
        obs_ids = {r["observation_id"] for r in rows}
        target_rows.append({
            "target_id": tid,
            "grammar_pattern_id": first["grammar_pattern_id"],
            "gi_score": first["gi_score"],
            "base_id": first["base_id"],
            "base_type": first["base_type"],
            "ordered_modifier_chain": first["ordered_modifier_chain"],
            "nesting_signature": first["nesting_signature"],
            "parse_category": first["parse_category"],
            "distinct_observation_count": len(obs_ids),
            "total_occurrence_count": len(rows),
            "parser_version": PARSER_VERSION,
            "target_schema_version": SCHEMA_VERSION,
        })
    target_fields = [
        "target_id","grammar_pattern_id","gi_score","base_id","base_type","ordered_modifier_chain",
        "nesting_signature","parse_category","distinct_observation_count","total_occurrence_count",
        "parser_version","target_schema_version"
    ]
    write_csv(outdir/"eligible_targets.csv", target_rows, target_fields)

    summary = {
        "parser_version": PARSER_VERSION,
        "target_schema_version": SCHEMA_VERSION,
        "offset_convention": "Unicode code-point offsets, zero-based, end-exclusive",
        "observations": len(observations),
        "tokens": len(all_rows),
        "eligible_occurrences": len(eligible_rows),
        "eligible_targets": len(target_rows),
        "ineligible_or_ambiguous_tokens": len(ineligible_rows),
        "gi_target_counts": dict(Counter(r["gi_score"] for r in target_rows)),
        "gi_occurrence_counts": dict(Counter(r["gi_score"] for r in eligible_rows)),
    }
    (outdir/"summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
