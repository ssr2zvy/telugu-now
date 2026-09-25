"""Reviewed v4 realization repairs, installed after historical rule installers.

These are receiver/rule changes, never answers looked up from the test corpus.
Genuine grammatical ambiguity remains in the analysis lattice.
"""
from copy import deepcopy


def install(model, lexemes):
    cat = model['catalogue']

    def override(owner, incoming, name, rule, when=(), scope='head', action='replace_rule'):
        cat['rules.' + name] = rule
        cat['overrides.' + name] = dict(owner=['object:' + owner],
            incoming=['object:' + incoming], when=list(when), scope=[scope],
            priority=['3100'], action=[action],
            replacement_rule=['rule:' + name] if action == 'replace_rule' else [],
            source_refs=['review_v4_realization'])
        cat['objects.' + owner]['incoming_overrides'].append('override:' + name)

    # A long -ō is not a short final vowel that can be replaced by -ā/-ū/-ē.
    # Restrict to the actually realized locative/instrumental/comitative ending;
    # historical/formal allomorphs do not receive this repair blindly.
    for owner, ending in [('mod_locative', 'లో'), ('mod_instrumental', 'తో'),
                          ('mod_comitative', 'తో')]:
        for incoming, suffix, effect in [('mod_question', 'నా', 'question=polar'),
                                         ('mod_additive', 'నూ', 'focus=additive'),
                                         ('mod_focus', 'నే', 'focus=exclusive')]:
            old = cat['rules.' + incoming + '_default']
            rule = deepcopy(old)
            rule.update(operation=['append'], requires=['surface_ends:' + ending],
                        append=[suffix], result_classes_mode=['preserve'])
            # Preserve the existing feature vocabulary rather than inventing a
            # second representation for the same grammatical operation.
            override(owner, incoming, 'review_v4_' + owner + '_' + incoming,
                     rule, ['surface_ends=' + ending])
    cat['overrides.core_locative_focus']['when'] = ['surface_ends=లో']

    # The formal -ుని- oblique before తో does not become instrumental-only:
    # స్నేహితునితో can express companionship as well. Mirror only these
    # already typed, variant-requested allomorphs, preserving the case reading.
    for key, value in list(cat.items()):
        if not key.startswith('overrides.') or value.get('incoming') != ['object:mod_instrumental']:
            continue
        if value.get('when') != ['requested.variant=formal'] or value.get('scope') != ['self']:
            continue
        rid=value['replacement_rule'][0].split(':',1)[1]
        rule=deepcopy(cat['rules.'+rid])
        rule['set_features']=[f.replace('case=instrumental','case=comitative') for f in rule.get('set_features',[])]
        owner=value['owner'][0].split(':',1)[1]
        override(owner,'mod_comitative','review_v4_formal_comitative_'+owner,
                 rule,value['when'],scope='self')

    # This bounded grammar has no reviewed rule licensing a focused possessive
    # predicate directly from the zero/formal genitive. Do not manufacture
    # ఇంటే / యొక్కే as evidence. A nominalizer would need its own full path.
    override('mod_genitive','mod_focus','review_v4_genitive_focus_unverified',{},
             action='forbid')

    # ఉండు has retroflex -ట- here. Existing finite/auxiliary sandhi rules already
    # distinguish త and ట once the correct stem boundary is supplied.
    for incoming, suffix in [('mod_future_habitual', 'ట'),
                              ('mod_durative', 'టూ'), ('mod_conditional', 'టే')]:
        rule = deepcopy(cat['rules.' + incoming + '_default'])
        rule['append'] = [suffix]
        override('base_undu', incoming, 'review_v4_undu_' + incoming, rule, scope='self')

    # ఎక్కడైనా: an explicitly scoped interrogative + indefinite construction.
    # This does not license arbitrary nouns/verbs followed by అయినా. Other wh
    # bases can be added only with a reviewed receiver form, not suffix guessing.
    bid = 'lex_63ffdbf44661abdd'
    mid = 'mod_indefinite_aina'
    obj = cat['objects.' + bid]
    obj['form_wh_indefinite'] = ['ఎక్కడైనా']
    obj['can_be_modified_by'].append('object:' + mid)
    cat['objects.' + mid] = dict(kind=['modifier'], classes=[], forms=['ైనా'],
        can_modify=['object:' + bid], application_rules=['rule:review_v4_wh_indefinite'],
        can_be_modified_by=[], incoming_overrides=[], result_classes=['adverb'],
        features=['quantification=indefinite_free_choice'], realization=['atomic'])
    cat['rules.review_v4_wh_indefinite'] = dict(operation=['lexical_form'],
        requires=['root_has:form_wh_indefinite'], field=['form_wh_indefinite'],
        result_classes=['adverb'], set_features=['quantification=indefinite_free_choice'],
        source_refs=['review_v4_ekkadaina'])


def changed_analysis_reason(record):
    """Bounded whitelist for the regression diff; no unrelated loss is allowed."""
    path = record['chain']
    if record['base_id'] == 'base_undu' and path and path[0] in {
            'mod_future_habitual', 'mod_durative', 'mod_conditional'}:
        return 'undu_retroflex_stem_boundary'
    for left, right in zip(path, path[1:]):
        if left=='mod_genitive' and right=='mod_focus':
            return 'genitive_focus_requires_reviewed_nominalization'
        if left in {'mod_locative', 'mod_instrumental', 'mod_comitative'} and right in {
                'mod_question', 'mod_additive', 'mod_focus'}:
            return 'case_clitic_boundary_preservation'
    return None
