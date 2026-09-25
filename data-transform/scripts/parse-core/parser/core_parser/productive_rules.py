"""V5 typed attachment and compositional realization rules.

All rules are shared by generation and recognition. No corpus answers are read.
"""
from copy import deepcopy

NEW_MODIFIERS=[
 dict(id='mod_indefinite_oo',core=1,kind='modifier',forms=['ో'],meaning='indefinite/embedded-question wh form; sense needs its clause'),
 dict(id='mod_polarity_item',core=1,kind='modifier',forms=['ూ','ా','ీ'],meaning='wh polarity-sensitive expression; not itself clause negation'),
 dict(id='mod_adjectival_aina',core=2,kind='modifier',forms=['ైన','మైన'],meaning='nominal property expressed as an adjective'),
 dict(id='mod_adverbial_ga',core=2,kind='modifier',forms=['గా','ంగా'],meaning='manner/state adverbial on a licensed nominal or adjective'),
 dict(id='mod_locative_attributive_ni',core=2,kind='modifier',forms=['ని'],meaning='attributive ni following locative lo'),
]
WH={
 'ఎక్కడ':('ఎక్కడైనా','ఎక్కడో','ఎక్కడా','adverb'),
 'ఎప్పుడు':('ఎప్పుడైనా','ఎప్పుడో','ఎప్పుడూ','adverb'),
 'ఎలా':('ఎలాగైనా','ఎలాగో',None,'adverb'),
 'ఎవరు':('ఎవరైనా','ఎవరో','ఎవరూ','pronoun'),
 'ఏది':('ఏదైనా','ఏదో',None,'pronoun'),
 'ఏమి':('ఏమైనా','ఏమో','ఏమీ','pronoun'),
 'ఎంత':('ఎంతైనా','ఎంతో',None,'determiner'),
 'ఎన్ని':('ఎన్నైనా','ఎన్నో',None,'determiner'),
}

def install(model,lexemes):
    cat=model['catalogue']
    cat['classes.fixed_expression']=dict(inherits=['base_word'],can_modify=[],
        can_be_modified_by=['class:clitic'],incoming_overrides=[])
    cat['classes.closed_wh_expression']=dict(inherits=['clitic_host'],can_modify=[],
        can_be_modified_by=[],incoming_overrides=[])
    cat['classes.clitic']['can_modify'].append('class:fixed_expression')
    # The declared clitic interfaces already include adverbs and particles;
    # an older rule-level receiver list accidentally disabled those interfaces.
    for mid in ['mod_focus','mod_additive','mod_question']:
        r=cat['rules.'+mid+'_default']
        r['receiver_classes_any'] += ['adverb','postposition','determiner','numeral',
            'conjunction','particle','interjection','fixed_expression']
    def override(owner,mid,name,rule=None,when=(),scope='self',action='replace_rule'):
        name='productive_'+name+'_'+owner
        if rule is not None:cat['rules.'+name]=rule
        cat['overrides.'+name]=dict(owner=['object:'+owner],incoming=['object:'+mid],
            when=list(when),scope=[scope],priority=['4100'],action=[action],
            replacement_rule=['rule:'+name] if rule is not None else [])
        cat['objects.'+owner]['incoming_overrides'].append('override:'+name)
    def modifier(mid,classes,targets,rule,forms):
        cat['objects.'+mid]=dict(kind=['modifier'],classes=classes,forms=forms,
            can_modify=targets,application_rules=['rule:productive_'+mid],
            can_be_modified_by=['class:clitic'],incoming_overrides=[],
            result_classes=rule['result_classes'],features=[],realization=['atomic'])
        cat['rules.productive_'+mid]=rule

    # Closed, reviewed wh receiver paradigms. These are lexical allomorph fields,
    # not a rule permitting arbitrary words + అయినా / ఓ / polarity markers.
    mids=['mod_indefinite_aina','mod_indefinite_oo','mod_polarity_item']
    for mid in mids:
        field='form_'+mid
        modifier(mid,[],[],dict(operation=['lexical_form'],requires=['root_has:'+field],
            field=[field],result_classes=['adverb'],set_features=['wh_form='+mid]),
            ['ైనా'] if mid==mids[0] else ['ో'] if mid==mids[1] else ['ూ','ా','ీ'])
    for bid,lex in lexemes.items():
        o=cat['objects.'+bid]
        for form in o['forms']:
            if form not in WH:continue
            *values,pos=WH[form]
            if pos=='pronoun':
                case_stem={'ఎవరు':'ఎవరి','ఏది':'దేని','ఏమి':'దేని'}[form]
                o['stem_dative']=[case_stem];o['stem_accusative']=[case_stem]
                o['stem_genitive']=[case_stem]
                o['stem_instrumental']=[case_stem];o['stem_locative']=[case_stem]
                o['stem_ablative']=[case_stem]
                for case,suffix in [('mod_dative','కి'),('mod_accusative','ని')]:
                    override(bid,case,'wh_case_'+case,
                        dict(operation=['select_stem_append'],requires=['root_has:stem_'+('dative' if case.endswith('dative') else 'accusative')],
                             stem_field=['stem_dative' if case.endswith('dative') else 'stem_accusative'],append=[suffix],
                             result_classes=['inflected_nominal'],set_features=['case='+('dative' if case.endswith('dative') else 'accusative')]))
            for mid,value in zip(mids,values):
                if value is None:continue
                field='form_'+mid;o[field]=[value]
                o['can_be_modified_by'].append('object:'+mid)
                cat['objects.'+mid]['can_modify'].append('object:'+bid)
                r=deepcopy(cat['rules.productive_'+mid]);r['result_classes']=['closed_wh_expression']
                override(bid,mid,'wh_'+mid,r)
                # Case precedes indefinite marking: ఎవరి-కి-ఐనా -> ఎవరికిైనా
                # with the licensed i+ai contraction -> ఎవరికైనా. Do not take
                # an indefinite form and reset it to the root's case stem.
                if mid in mids[:2]:
                    for case in ['mod_dative','mod_accusative','mod_spatial_goal']:
                        cat['objects.'+mid]['can_modify'].append('object:'+case)
                        cat['objects.'+case]['can_be_modified_by'].append('object:'+mid)
                        for tail in ['ి','ు']:
                            r2=dict(operation=['rewrite_tail_append'],requires=['surface_ends:'+tail],
                                tail=[tail],replacement=['ైనా' if mid==mids[0] else 'ో'],append=[],
                                result_classes=['closed_wh_expression'],set_features=['wh_form='+mid])
                            override(bid,mid,'wh_after_'+mid+'_'+case+'_'+str(ord(tail)),r2,
                                     when=['head='+case,'surface_ends='+tail],scope='descendants')

    # Productive property and manner forms on nouns; no verb/adjective guessing.
    modifier('mod_adjectival_aina',['adjectival_derivation'],['class:noun'],
        dict(operation=['select_stem_append'],requires=['root_has:stem_adjectival'],
            stem_field=['stem_adjectival'],append=['ైన'],result_classes=['adjective'],
            set_features=['derivation=property_adjective']),['ైన','మైన'])
    modifier('mod_adverbial_ga',['adjectival_derivation'],['class:noun','class:adjective'],
        dict(operation=['append'],requires=[],append=['గా'],result_classes=['adverb'],
            set_features=['derivation=manner_or_state']),['గా'])
    cat['classes.nominal']['can_be_modified_by'] += ['object:mod_adjectival_aina','object:mod_adverbial_ga']
    modifier('mod_locative_attributive_ni',[],['object:mod_locative'],
        dict(operation=['append'],requires=['surface_ends:లో'],append=['ని'],
            result_classes=['adjective'],set_features=['nominal_relation=locative_attributive']),['ని'])
    cat['objects.mod_locative']['can_be_modified_by'].append('object:mod_locative_attributive_ni')
    # Adjectival predicates need an overt nominalizer before nominal clitics:
    # బలమైన-ది-ఏ -> బలమైనదే, not a fabricated bare-adjective question.
    nominalizers={'mod_relative_nonhuman_singular':'ది',
        'mod_relative_nonhuman_plural':'వి','mod_relative_masculine':'వాడు',
        'mod_relative_human_honorific':'వారు','mod_relative_human_plural':'వాళ్లు'}
    for mid,ending in nominalizers.items():
        cat['objects.'+mid]['can_modify'].append('class:adjective')
        cat['classes.adjective']['can_be_modified_by'].append('object:'+mid)
        cat['objects.mod_adjectival_aina']['can_be_modified_by'].append('object:'+mid)
        # Case modifies the newly nominalized phrase, never the original
        # lexical noun's case stem (which would erase the preceding modifiers).
        oblique={'ది':'దాని','వి':'వాటి','వాడు':'వాడి','వారు':'వారి','వాళ్లు':'వాళ్ల'}[ending]
        for case,suffix in [('mod_dative','కి' if oblique.endswith('ి') else 'కు'),
                            ('mod_accusative','ని' if oblique.endswith('ి') else 'ను'),
                            ('mod_genitive',''),('mod_locative','లో'),
                            ('mod_instrumental','తో'),('mod_comitative','తో'),
                            ('mod_ablative',' నుంచి')]:
            replacement=oblique+suffix
            if ending=='ది' and case=='mod_accusative':replacement='దాన్ని'
            r=dict(operation=['rewrite_tail_append'],requires=['surface_ends:'+ending],
                tail=[ending],replacement=[replacement],append=[],result_classes=['inflected_nominal'],
                set_features=['case='+case.removeprefix('mod_')])
            override(mid,case,'nominalized_'+case,r,scope='head')

    # Long-a boundaries retain the adverb/converb, with -nē/-nā/-nū.
    for owner in ['mod_adverbial_ga','mod_negative_converb']:
        for incoming,suffix in [('mod_focus','నే'),('mod_question','నా'),('mod_additive','నూ')]:
            r=deepcopy(cat['rules.'+incoming+'_default'])
            r.update(operation=['append'],requires=[],append=[suffix],result_classes_mode=['preserve'])
            r.pop('receiver_classes_any',None)
            override(owner,incoming,'long_a_'+incoming,r,scope='head')
    # A resulting locative adjective does not also take a nominal case suffix.
    for bid,lex in lexemes.items():
        o=cat['objects.'+bid];form=lex['lemma']
        if any(c in o['classes'] for c in ['adverb','postposition','fixed_expression']):
            if form.endswith(('ా','ీ','ూ','ే','ో')):
                for incoming,suffix in [('mod_focus','నే'),('mod_question','నా'),('mod_additive','నూ')]:
                    r=deepcopy(cat['rules.'+incoming+'_default'])
                    r.update(operation=['append'],requires=[],append=[suffix],result_classes_mode=['preserve'])
                    override(bid,incoming,'long_word_'+incoming,r)
        if 'noun' in o['classes']:
            # Adjectival -మైన after anusvara: బలం -> బలమైన.
            o['stem_adjectival']=[form[:-1]+'మ' if form.endswith('ం') else form[:-1] if form.endswith(('ు','ి')) else form]
            # Case ending depends on the selected stem, not a guessed POS.
            for mid,field,suffix in [('mod_dative','stem_dative','కి'),('mod_accusative','stem_accusative','ని')]:
                stem=o.get(field,[None])[0]
                if stem and stem.endswith(('ి','ీ','ఇ','ఈ')):
                    original=cat['objects.'+mid]['application_rules'][0].split(':',1)[1]
                    r=deepcopy(cat['rules.'+original]);r.update(operation=['select_stem_append'],
                        requires=['root_has:'+field],stem_field=[field],append=[suffix])
                    override(bid,mid,'front_vowel_'+mid,r)
        # Spatial wh/deictic words admit directional suffixes although they are
        # adverbs, not nominal or verb carriers.
        if form in {'ఇక్కడ','అక్కడ','ఎక్కడ','లోపల','బయట','ముందు','వెనుక'}:
            for mid,suffix in [('mod_spatial_goal','ికి' if form.endswith('డ') else 'కి'),
                               ('mod_spatial_source',' నుంచి')]:
                cat['objects.'+bid]['can_be_modified_by'].append('object:'+mid)
                cat['objects.'+mid]['can_modify'].append('object:'+bid)
                r=dict(operation=['append'],requires=[],append=[suffix],
                    result_classes=['adverb'],set_features=['spatial='+('goal' if mid.endswith('goal') else 'source')])
                # ఇక్కడ + ికి is the registered orthographic boundary.
                override(bid,mid,'spatial_'+mid,r)

    # Polar questioning of focused X is X-ē-nā. Overwriting a previous clitic
    # vowel would erase a modifier yet wrongly count it in the path.
    clitics=['mod_focus','mod_additive','mod_question']
    for left in clitics:
        for right in clitics:
            if left=='mod_focus' and right=='mod_question':
                r=deepcopy(cat['rules.mod_question_default']);r.update(operation=['append'],
                    requires=[],append=['నా'],result_classes_mode=['preserve'])
                r.pop('receiver_classes_any',None)
                override(left,right,'preserve_focus_question',r,scope='head')
            else:override(left,right,'no_erased_clitic_'+right,scope='head',action='forbid')
