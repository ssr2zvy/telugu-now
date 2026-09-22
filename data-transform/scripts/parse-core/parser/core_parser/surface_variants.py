"""Construction-scoped alternate realizations, with replayable requests.

No input-word rewrites and no expected-surface lookup. Optional requests are
branched only at the step that consumes them, rather than rebuilding the whole
lexicon for every Cartesian combination of spelling options.
"""
from copy import deepcopy
from .vendor.engine import one

FN='agr_third_feminine_or_neuter_singular_plain'
PL='agr_first_plural'

def install(model,lexemes):
    cat=model['catalogue']
    def override(owner,mid,rid,rule,when=(),scope='head',priority=800):
        cat['rules.'+rid]=rule
        oid=rid+'_'+owner
        cat['overrides.'+oid]={'owner':['object:'+owner],'incoming':['object:'+mid],
            'scope':[scope],'when':list(when),'action':['replace_rule'],
            'replacement_rule':['rule:'+rid],'priority':[str(priority)]}
        cat['objects.'+owner]['incoming_overrides'].append('override:'+oid)
    # Existing grammar already has -ాం for these heads. The index did not request it.
    # Modal/negative heads require -ం, not -ాం, because their stem retains its vowel.
    for owner in ['mod_ability','mod_inability','mod_negative_future_habitual']:
        r=deepcopy(cat['rules.'+owner+'_first_plural']);r['append']=['ం']
        override(owner,PL,'core_short_'+owner,r,['requested.ending=short'])
    override('mod_prospective',PL,'core_prospective_first_plural_short',
             deepcopy(cat['rules.agreement_first_plural_short']),['requested.ending=short'])
    # Agreement contractions are licensed on an auxiliary stem, not on any string
    # ending in న్న. The derived past alternative is restricted to the కొను profiles.
    base=cat['rules.agreement_third_feminine_or_neuter_singular_plain']
    for tail,replacement,label in [('తున్న','తోంది','t'),('టున్న','టోంది','tt'),(' ఉన్న',' ఉంది','free')]:
        r=deepcopy(base);r.update(operation=['rewrite_tail_append'],requires=['surface_ends:'+tail],tail=[tail],replacement=[replacement],append=[])
        override('mod_aux_unna',FN,'core_contracted_aux_'+label,r,
                 ['requested.aux_form=contracted','surface_ends='+tail])
        if label=='t':
            override('mod_prospective',FN,'core_contracted_prospective',r,
                     ['requested.aux_form=contracted','surface_ends='+tail])
    r=deepcopy(base);r.update(operation=['rewrite_tail_append'],requires=['surface_ends:న్న'],tail=['న్న'],replacement=['ంది'],append=[])
    for owner in ['mod_self_benefactive','mod_think']:
        override(owner,FN,'core_contracted_konu_past',r,
                 ['requested.derived_past=contracted','tam=past','head=mod_past','stem_owner='+owner,'surface_ends=న్న'],scope='descendants',priority=1300)
    # Same locative tags, specific -లు + లో boundary; formal realization stays separate.
    r=deepcopy(cat['rules.plural_locative'])
    r.update(operation=['rewrite_tail_append'],requires=['surface_ends:లు'],tail=['లు'],replacement=['ల్లో'],append=[])
    override('mod_plural','mod_locative','core_plural_locative_contracted',r,
             ['requested.locative=contracted','surface_ends=లు'])
    # Spaces are allowed at these phrase boundaries only.
    r=deepcopy(cat['rules.mod_avoidance_tappu']);r['joiner']=[' ']
    override('mod_negative_link','mod_avoidance_tappu','core_spaced_unavoidability',r,['requested.unavoidability_boundary=space'])
    r=deepcopy(cat['rules.mod_nominal_negative']);r['append']=[' లేదు']
    override('mod_verbal_noun','mod_nominal_negative','core_spaced_nominal_negative',r,['requested.negative_boundary=space'])
    # Explicit catalogue alignment: additive is a function with suffix and particle
    # realizations. The trace/request distinguishes them; the chain ID stays stable.
    r=deepcopy(cat['rules.mod_additive_default']);r.update(operation=['append'],requires=[],append=[' కూడా'])
    for field in ['vowel','tail','replacement']:r.pop(field,None)
    for owner in ['mod_plural']+[bid for bid,l in lexemes.items() if 'noun' in l['object']['classes']]:
        override(owner,'mod_additive','core_additive_particle',r,['requested.additive=particle'],scope='head',priority=200)
    cat['objects.mod_additive']['forms'].append('కూడా')
    for bid,lex in lexemes.items():
        o=cat['objects.'+bid]
        if o.get('stem_verbal_noun'):
            r=deepcopy(cat['rules.mod_verbal_noun_default']);r.update(stem_field=['stem_verbal_noun'],requires=['root_has:stem_verbal_noun'])
            override(bid,'mod_verbal_noun','core_lexical_verbal_noun_stem',r,scope='self',priority=1300)
        if o.get('stem_permissive'):
            r=deepcopy(cat['rules.mod_permissive']);r.update(stem_field=['stem_permissive'],requires=['root_has:stem_permissive'])
            override(bid,'mod_permissive','core_permissive_stem',r,scope='self',priority=1300)
        if o.get('stem_perfective_full'):
            r=deepcopy(cat['rules.mod_perfective_converb_default']);r.update(stem_field=['stem_perfective_full'],requires=['root_has:stem_perfective_full'])
            override(bid,'mod_perfective_converb','core_full_converb',r,['requested.converb=full'],scope='self',priority=1300)
        # Lexical -కొను predicates need the same ట allomorph as derived -కొను.
        if lex.get('nasal_tam') or lex['lemma'].endswith('కొను') and lex['lemma']!='కొను':
            for mid,field,suffix in [('mod_future_habitual','stem_future','ట'),('mod_durative','stem_durative','టూ'),('mod_conditional','stem_conditional','టే')]:
                r=deepcopy(cat['rules.'+mid+'_default']);r.update(operation=['select_stem_append'],stem_field=[field],requires=['root_has:'+field],append=[suffix])
                override(bid,mid,'core_lexical_konu_'+mid,r,scope='self',priority=1300)


def choices(engine,state,mid,request):
    """Yield existing request plus applicable, strictly scoped alternatives."""
    yield request
    head=state['head'];extra=None
    if mid==PL and head in {'mod_past','mod_future_habitual','mod_aux_unna','mod_aux_unta','mod_ability','mod_inability','mod_negative_future_habitual','mod_prospective'}:
        extra=('ending','short')
    elif mid==FN and head in {'mod_aux_unna','mod_prospective'}:extra=('aux_form','contracted')
    elif mid==FN and head=='mod_past' and state['stem_owner'] in {'mod_self_benefactive','mod_think'} and state['surface'].endswith('న్న'):
        extra=('derived_past','contracted')
    elif mid=='mod_locative' and head=='mod_plural' and request.get('variant')!='formal' and state['surface'].endswith('లు'):
        extra=('locative','contracted')
    elif mid=='mod_avoidance_tappu' and head=='mod_negative_link':extra=('unavoidability_boundary','space')
    elif mid=='mod_nominal_negative' and head=='mod_verbal_noun':extra=('negative_boundary','space')
    elif mid=='mod_additive' and (head=='mod_plural' or head==state['root'] and 'noun' in state['classes']):extra=('additive','particle')
    elif mid=='mod_perfective_converb' and head==state['root'] and 'stem_perfective_full' in state['stems']:extra=('converb','full')
    if extra and extra[0] not in request:yield dict(request,**{extra[0]:extra[1]})
