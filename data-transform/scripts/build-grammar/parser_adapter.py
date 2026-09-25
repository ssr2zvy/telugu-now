"""Input/eligibility adapter. The supplied parser's grammar and GI rules are unchanged."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'parser'))
from selection_export import (EndPeelParser, canon_base_id, chain_list,
                              target_id_for, parse_confidence, PARSER_VERSION,
                              SCHEMA_VERSION)
from corpus_analyze_gi import gi_for_result, gi_modifier_count
from corpus_analyze_end_peel import compact

ADAPTER_VERSION = 'selection_adapter_v3_base_boundary_checks'
_parser = None


def parser_information():
    """Describe the actual initialized analyzer; does not change its rules."""
    import json
    metadata = json.loads((ROOT / 'parser' / 'lexicon_full_metadata.json').read_text())
    return {
        'version': PARSER_VERSION, 'adapterVersion': ADAPTER_VERSION,
        'targetSchemaVersion': SCHEMA_VERSION,
        'dictionaryId': metadata['dictionary_id'],
        'maxDepth': _parser.max_depth if _parser is not None else None,
        'maxStates': _parser.max_states if _parser is not None else None,
        'nesting': 'linear; joined compounds diagnostic until structured targets supported',
        'eligibilityPolicy': 'verified-attachments-highest-gi-unique-target',
        'attachmentPolicy': 'attachment_evidence_v1',
        'baseBoundaryPolicy': 'continue-registered-endings-deeper-or-strong-partial-excluded',
        'overlapPolicy': 'retain-verified-max-gi-unresolved-targets-excluded',
    }


def initialize(max_depth=6, max_states=500):
    global _parser
    _parser = EndPeelParser(max_depth=max_depth, max_states=max_states)


def analyze_word(word):
    p = _parser
    result = p.analyze(word)
    analyses = result.get('analyses') or []
    best = analyses[0] if analyses else None
    gi = gi_for_result(p, word, best)
    confidence = parse_confidence(result, best, gi)
    chain = chain_list(best) if best else []
    base = canon_base_id(best) if best else ''
    base_type = best.get('base_type', '') if best else ''
    features = best.get('active_features') or {} if best else {}
    tid = target_id_for(best, gi) if best else ''
    top = [a for a in analyses if gi_for_result(p, word, a)['gi_score'] == gi['gi_score']] if best else []
    identities = set()
    for a in top:
        agi = gi_for_result(p, word, a)
        identities.add((target_id_for(a, agi), canon_base_id(a),
                        tuple(chain_list(a)), str(agi['gi_score'])))
    reason = ''
    normalized = 'spelling_normalization' in chain or bool(features.get('normalization_rule'))
    normalization_confidence = features.get('normalization_confidence', 'not_provided' if normalized else 'not_applicable')
    if best is None:
        reason = 'unparsed_or_partial'
    elif not gi['gi_relevant'] or str(gi['gi_score']) == 'N/A':
        reason = ('unresolved_base_boundary' if any(a.get('validation_reason') == 'unresolved_base_boundary' for a in result.get('diagnostic_analyses', [])) else 'gi_irrelevant')
    elif confidence in {'partial', 'uncertain', 'none'}:
        reason = 'unresolved_confidence'
    elif not tid:
        reason = 'missing_target_id'
    elif len(identities) > 1:
        reason = 'unresolved_distinct_top_targets'
    elif base_type not in {'core_base', 'dictionary_non_core_base'}:
        reason = 'unverified_base_type'
    elif base_type == 'core_base' and base not in p.engine.bases:
        reason = 'noncanonical_core_base_id'
    elif normalized and normalization_confidence not in {'high', 'verified'}:
        reason = 'normalization_not_explicitly_verified'
    elif 'compound_split' in chain:
        reason = 'compound_structure_not_exported'
    elif 'spelling_normalization' in chain:
        # A future export must canonicalize the grammatical chain separately.
        reason = 'normalization_still_in_target_chain'
    eligible = not reason
    handoff_eligible = bool(best and gi['gi_relevant'] and str(gi['gi_score']) != 'N/A'
        and confidence not in {'uncertain', 'partial', 'none'} and tid
        and not (len(analyses) > 1 and p.rank(analyses[0]) == p.rank(analyses[1])))
    return {
        'overlap': result.get('overlap', False),
        'selection_policy': 'highest_verified_gi',
        'verified_analyses': analyses,
        'diagnostic_analyses': result.get('diagnostic_analyses', []),
        'base_boundary_checks': result.get('base_boundary_checks', {}),
        'word': word, 'status': 'parsed' if best else 'unparsed',
        'gi_relevant': bool(gi['gi_relevant']),
        'gi_score': int(gi['gi_score']) if str(gi['gi_score']) != 'N/A' else None,
        'base_id': base, 'base_type': base_type, 'ordered_modifier_chain': chain,
        'modifier_count': gi_modifier_count(chain), 'nesting_signature': 'linear',
        'modifier_tree_json': {'kind': 'linear', 'base_id': base, 'modifiers': chain},
        'parse_category': ('core_base' if base_type == 'core_base' else
                           'with_modifier' if chain else 'plain_noncore_vocab') if best else 'unparsed',
        'eligible': eligible, 'eligibility_reason': reason,
        'target_id': tid if eligible else '', 'candidate_target_id': tid,
        'grammar_pattern_id': ('GRAM:' + SCHEMA_VERSION + ':linear:' +
                               ('|'.join(chain) if chain else 'core_base_only')) if eligible else '',
        'parse_confidence': confidence, 'normalization_confidence': normalization_confidence,
        'normalization_ops': [{'rule': features.get('normalization_rule'),
                                'normalized_form': features.get('normalized_form')}] if normalized else [],
        'analysis_count': len(analyses), 'top_analysis_count': len(top),
        'top_canonical_target_count': len(identities), 'eligible_by_original_export': handoff_eligible,
        'best_rank': list(p.rank(best)) if best else None,
        'parts_json': gi.get('parts_json'), 'analysis_json': compact(best) if best else {},
        'partial_barrier': gi.get('partial_barrier'), 'partial_chain': gi.get('partial_chain'),
        'search': result.get('search', {}), 'parser_version': PARSER_VERSION,
        'target_schema_version': SCHEMA_VERSION, 'adapter_version': ADAPTER_VERSION,
    }
