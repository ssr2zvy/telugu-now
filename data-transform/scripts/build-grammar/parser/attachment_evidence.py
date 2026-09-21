"""Conservative attachment evidence, independent of suffix-based POS guesses."""
import json
from pathlib import Path

POLICY_VERSION = 'attachment_evidence_v1'
LEXICAL_TYPES = json.loads(Path(__file__).with_name('verified_lexical_types.json').read_text())
VERIFIED_TYPES = LEXICAL_TYPES['entries']

def attachment_reason(engine, analysis):
    features = analysis.get('active_features') or {}
    normalized = 'spelling_normalization' in (analysis.get('chain') or []) or features.get('normalization_rule')
    if (normalized and features.get('normalization_confidence') not in ('high', 'verified')) or features.get('normalization_confidence') not in (None, 'high', 'verified'):
        return 'normalization_not_verified'
    if features.get('verified_components'):
        return ''
    if 'compound_split' in (analysis.get('chain') or []):
        return 'compound_components_not_verified'
    base = analysis.get('base', '')
    if analysis.get('base_type') == 'core_base':
        return '' if base in engine.bases else 'noncanonical_core_base'
    if analysis.get('base_type') != 'dictionary_non_core_base':
        return 'unverified_base_type'
    word = analysis.get('detected_stem') or base.split(':', 1)[-1]
    entry = VERIFIED_TYPES.get(word, {})
    if base.startswith('dictionary_non_core_base_verb:'):
        return '' if 'verb' in entry.get('pos', []) else 'verb_type_not_verified'
    # A dictionary noun can take nominal endings under existing rules, but must
    # not bootstrap a verbal chain from an untyped fragment through become/etc.
    for modifier in analysis.get('chain') or []:
        obj = engine.objects.get(modifier, {})
        if 'derived_verb' in obj.get('result_classes', []) and 'noun' not in entry.get('pos', []):
            return 'nominal_to_verb_attachment_not_verified'
    return ''
