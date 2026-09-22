"""Reviewed lexical allomorphs and finite endings; no benchmark-answer reads.

Requests choose a licensed variant; they never change the claimed morphology.
Sources are documented in data/review_sources.json.
"""
from copy import deepcopy

FN='agr_third_feminine_or_neuter_singular_plain'

def install(model,lexemes):
    cat=model['catalogue']; requests={bid:[] for bid in lexemes}
    # A vocative addresses someone; it is not a nominal predicate to which the
    # polar-question clitic can be attached by simply reusing its final long a.
    # This structural restriction applies to generation and recognition alike.
    # Bare nominal predicates retain their independent question analysis.
    cat['overrides.core_vocative_no_polar_question']={
        'owner':['object:ext_vocative'], 'incoming':['object:mod_question'],
        'when':[], 'scope':['descendants'], 'priority':['2000'],
        'action':['forbid'], 'replacement_rule':[],
        'source_refs':['vocative_question_review']}
    cat['objects.ext_vocative']['incoming_overrides'].append(
        'override:core_vocative_no_polar_question')
    def override(owner,mid,rid,rule,when,scope='descendants'):
        cat['rules.'+rid]=rule
        oid=rid+'_'+owner
        cat['overrides.'+oid]={'owner':['object:'+owner], 'incoming':['object:'+mid],
            'when':when,'scope':[scope],'priority':['1200'],'action':['replace_rule'],
            'replacement_rule':['rule:'+rid]}
        cat['objects.'+owner]['incoming_overrides'].append('override:'+oid)

    # Full -కొన్న- coexists with contracted -కున్న- across the registered
    # lexical -కొను family. Its agreement endings remain the ordinary ones.
    for bid,lex in lexemes.items():
        o=cat['objects.'+bid];form=lex['lemma']
        if 'verb' not in o['classes']:continue
        if form.endswith('కొను'):
            prefix=form[:-len('కొను')]
            o['stem_past_full_konu']=[prefix+'కొన్న']
            o['form_past_fn_full_konu']=[prefix+'కొన్నది']
            r=deepcopy(cat['rules.mod_past_default'])
            r.update(stem_field=['stem_past_full_konu'],requires=['root_has:stem_past_full_konu'])
            r['source_refs']=['andukunna_usage','brown_grammar']
            override(bid,'mod_past','core_past_full_konu',r,
                     ['requested.spelling=full_konu'],scope='self')
            r=deepcopy(cat['rules.core_past_fn'])
            r.update(field=['form_past_fn_full_konu'],receiver_stem_field=['stem_past_full_konu'],
                     requires=['root_has:form_past_fn_full_konu'])
            r['source_refs']=['andukunna_usage','brown_grammar']
            override(bid,FN,'core_past_fn_full_konu',r,
                     ['requested.spelling=full_konu','tam=past','stem_owner='+bid])
            requests[bid].append({'spelling':'full_konu'})
        if form=='వెళ్లు':
            o['stem_durative_full']=['వెళు']
            r=deepcopy(cat['rules.mod_durative_default'])
            r.update(stem_field=['stem_durative_full'],requires=['root_has:stem_durative_full'])
            r['source_refs']=['vellutunna_usage']
            override(bid,'mod_durative','core_durative_full_vellu',r,
                     ['requested.spelling=full_vellu'],scope='self')
            requests[bid].append({'spelling':'full_vellu'})
        if form=='ఆడు':
            # Attested regional -తాది, scoped to the reviewed lexical class.
            # Broad application to every verb would need a larger dialect audit.
            r=deepcopy(cat['rules.agreement_third_feminine_or_neuter_singular_plain'])
            r['append']=['ాది'];r['set_features'].append('register=regional')
            r['source_refs']=['regional_adatadi']
            override(bid,FN,'core_regional_future_adi',r,
                     ['requested.register=regional','tam=future_habitual','surface_ends=త','stem_owner='+bid])
            requests[bid].append({'register':'regional'})
        if o.get('stem_relative_past'):
            requests[bid].append({'past_form':'uncontracted'})

    # The uncontracted finite past ending (e.g. పుట్టినది) is distinct from
    # relative-participle + nominalizer, even when the two spellings coincide.
    r=deepcopy(cat['rules.agreement_third_feminine_or_neuter_singular_plain'])
    r.update(operation=['select_stem_append'],stem_field=['stem_relative_past'],
             requires=['root_has:stem_relative_past'],append=['ది'])
    r['source_refs']=['brown_grammar']
    override('mod_past',FN,'core_past_fn_uncontracted',r,
             ['requested.past_form=uncontracted','tam=past'],scope='head')
    return requests
