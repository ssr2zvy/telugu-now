"""Reviewed shared-form learning targets, separate from parse uniqueness.

This module contains construction reviews, never benchmark word/answer lookups.
Review means an editorially supported interpretation, not absolute certification.
"""
from hashlib import sha256
from itertools import product
import json

FN='agr_third_feminine_or_neuter_singular_plain'
TAMS={('mod_past',),('mod_future_habitual',),('mod_durative','mod_aux_unna')}
AGREEMENTS={
    'agr_first_singular','agr_first_plural','agr_second_singular_plain',
    'agr_second_plural_or_honorific','agr_third_masculine_singular_plain',
    FN,'agr_third_human_plural_or_honorific','agr_third_nonhuman_plural'}
# These dictionary bases encode the same causative derivation. Keep both
# proofs, but do not create two learning targets merely for analysis depth.
DERIVED_EQUIVALENTS={'చేయించు':'చేయు','తినిపించు':'తిను','పాడించు':'పాడు'}
CAUSATIVES={'చేయు','తిను','విను','పాడు'}

def stable_id(prefix,value):
    raw=json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'))
    return prefix+'_'+sha256(raw.encode()).hexdigest()[:24]

def review_record(parser,a):
    chain=tuple(a['chain']);lemma=a['lemma'];fs=a['features']
    family=None;sources=[]
    if 'ext_vocative' in chain and 'mod_question' in chain:
        return {'status':'rejected_unlicensed','family':'stacked_vocative_question',
                'sources':['vocative_question_review'],
                'reason':'Vocative long-a was reused as an additional question suffix; no licensed composition.'}
    if chain and chain[-1] in AGREEMENTS:
        prefix=chain[:-1]
        if prefix in TAMS:
            family='finite_agreement';sources=['surrey_paradigms','messick_agreement']
        elif prefix==('mod_causative','mod_past') and lemma in CAUSATIVES:
            family='reviewed_causative';sources=['brown_grammar','causative_review','messick_agreement']
    noun='noun' in parser.lexemes[a['base_id']]['object']['classes']
    if noun and lemma.endswith('ుడు'):
        if chain in {('mod_genitive',),('mod_accusative',)}:
            family='formal_genitive_accusative';sources=['brown_nouns','typecraft_cases']
        elif chain in {('ext_vocative',),('mod_question',)}:
            family='vocative_or_nominal_question';sources=['brown_nouns','telugu_question_particle']
    if chain==('mod_relative_past','mod_relative_nonhuman_singular') and lemma in {'ఉండు','పుట్టు','కొను','విను'}:
        family='nominalized_relative';sources=['brown_grammar','relative_review']
    if family:
        return {'status':'reviewed_valid','family':family,'sources':sources,
                'reason':'Licensed construction; interpretation of a particular corpus occurrence may require context.',
                'evidence_scope':'construction-level editorial review, not a separately attested sentence for every form'}
    return {'status':'unreviewed','family':None,'sources':[],
            'reason':'Outside the shared-form construction review; no conclusion of invalidity.'}

def canonical_readings(a,index):
    lemma=a['lemma'];chain=list(a['chain']);fs=a['features'];alias=False
    if lemma in DERIVED_EQUIVALENTS:
        lemma=DERIVED_EQUIVALENTS[lemma];chain=['mod_causative']+chain;alias=True
    dims={}
    if 'agr_first_plural' in chain:
        dims['clusivity']=[fs['clusivity']] if fs.get('clusivity') in ('inclusive','exclusive') else ['inclusive','exclusive']
    if FN in chain:dims['gender']=['feminine','neuter']
    if fs.get('referent_number')=='unresolved':dims['referent']=['plural','honorific_singular']
    sense=fs.get('predicate')
    variants=product(*dims.values()) if dims else [()]
    for values in variants:
        distinctions=dict(zip(dims,values))
        identity={'lemma':lemma,'chain':chain,'distinctions':distinctions,'lexical_sense':sense}
        yield dict(identity,analysis_target_id=stable_id('analysis_v1',identity),
                   supporting_analysis_indices=[index],equivalent_derived_base=alias)

def learning_result(parser,analyses,strict_eligible):
    for a in analyses:a['review']=review_record(parser,a)
    reviewed=bool(analyses) and all(a['review']['status']=='reviewed_valid' for a in analyses)
    if not reviewed:
        return {'eligible':strict_eligible,'status':'model_single' if strict_eligible else 'unverified',
                'group':None,'reason':'Shared-form admission requires every candidate to pass a construction review.'}
    targets={}
    for i,a in enumerate(analyses):
        for t in canonical_readings(a,i):
            key=t['analysis_target_id']
            if key in targets:
                targets[key]['supporting_analysis_indices']+=t['supporting_analysis_indices']
                targets[key]['equivalent_derived_base']|=t['equivalent_derived_base']
            else:targets[key]=t
    targets=sorted(targets.values(),key=lambda t:t['analysis_target_id'])
    # Reuse a modifier/chain group's progress across lexical bases and spelling
    # variants. Distinct lexical-sense alternatives must keep their bases.
    mixed_bases=len({t['lemma'] for t in targets})>1
    members={}
    for t in targets:
        rule={'chain':t['chain'],'distinctions':t['distinctions'],'lexical_sense':t['lexical_sense']}
        if mixed_bases:rule['lemma']=t['lemma']
        tid=stable_id('rule_v1',rule)
        t['rule_target_id']=tid
        members[tid]=dict(rule,target_id=tid,required_successes=3)
    members=[members[k] for k in sorted(members)]
    ids=[m['target_id'] for m in members]
    return {'eligible':True,'status':'reviewed_shared' if len(members)>1 else 'reviewed_single',
            'review_basis':'construction-level assistant editorial review',
            'interpretations':targets,
            'group':{'id':stable_id('group_v1',ids),'members':members,
                     'member_count':len(members),'required_successes':3*len(members),
                     'success_credit_per_encounter':1,'separate_member_credit':False,
                     'counter_mode':'consecutive_correct',
                     'intended_reading':'unresolved' if len(members)>1 else 'single_within_review',
                     'context_discrimination_certified':False}}

class ProgressionTracker:
    """One shared streak: 3 successes per distinct target, never double credit.

    State is JSON-serializable; callers persist it with their learner data.
    Event IDs make replay idempotent. Incorrect attempts reset the streak.
    This tracks form learning, not which reading the learner identified.
    """
    def __init__(self,state=None):
        self.state=json.loads(json.dumps(state)) if state is not None else {'groups':{},'events':{}}

    def record(self,result,event_id,correct):
        learning=result['learning'];group=learning.get('group')
        if not learning['eligible'] or not group:raise ValueError('No reviewed progression group')
        if not isinstance(event_id,str) or not event_id:raise ValueError('event_id must be a nonempty string')
        if not isinstance(correct,bool):raise ValueError('correct must be boolean')
        event={'group_id':group['id'],'correct':correct}
        prior=self.state['events'].get(event_id)
        if prior is not None:
            if prior!=event:raise ValueError('event_id reused with different data')
            return dict(self.state['groups'][group['id']])
        counter=self.state['groups'].setdefault(group['id'],{
            'required_successes':group['required_successes'],'streak':0,'successful_encounters':0,
            'attempts':0,'completed':False})
        counter['attempts']+=1
        counter['successful_encounters']+=int(correct)
        counter['streak']=counter['streak']+1 if correct else 0
        counter['completed']=counter['streak']>=counter['required_successes']
        self.state['events'][event_id]=event
        return dict(counter)
