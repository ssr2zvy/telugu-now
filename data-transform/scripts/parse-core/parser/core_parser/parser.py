"""Bounded, typed Telugu parser with independent vocabulary/chain results.

Recognition inverts forward realizations over an explicitly enumerated grammar.
No unrestricted dictionary-as-verb fallback and no gold surface lookup are used.
"""
from collections import defaultdict, Counter
from copy import deepcopy
from itertools import product
from pathlib import Path
import json
import unicodedata

from .vendor.engine import Engine, GrammarError, features, one, delta
from .repairs import install as install_repairs
from .learning import learning_result
from .review_repairs import install as install_review_repairs
from .productive_rules import install as install_productive_rules
from .surface_variants import install as install_surface_variants, choices as realization_choices

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data'
AGREEMENTS=['agr_first_singular','agr_first_plural','agr_second_singular_plain',
            'agr_second_plural_or_honorific','agr_third_masculine_singular_plain',
            'agr_third_feminine_or_neuter_singular_plain',
            'agr_third_human_plural_or_honorific','agr_third_nonhuman_plural']
CASE_TAGS={'mod_accusative':'ACC','mod_dative':'DAT','mod_genitive':'GEN',
           'mod_instrumental':'INS','mod_locative':'AT','mod_ablative':'ABL',
           'mod_spatial_source':'ABL','mod_spatial_goal':'DAT','ext_vocative':'VOC'}

def norm(word):return unicodedata.normalize('NFC',word.strip())

class TypedEngine(Engine):
    def _load_non_core_lexicon(self):return set()

    def apply(self,s,mid,request=None,depth=0):
        # Surface-changing operations only; semantic refinement still needs context
        # supplied by the caller. Its absence is never treated as a visible suffix.
        return super().apply(s,mid,request,depth)

class CoreParser:
    VERSION='0.6.0-productive-core-v5'
    def __init__(self, include_benchmark_lexicon=True, extra_lexemes=(), build_index=True):
        data=json.loads((DATA/'lexicon.json').read_text())
        self.lexemes={x['id']:x for x in data['lexemes']
                      if include_benchmark_lexicon or not x['benchmark_only_lexeme']}
        # Typed external carriers need no curriculum entry or Core membership.
        # Pass a batch when starting a worker; never guess noun AND verb from
        # untyped dictionary membership. Caller-provided IDs must be new.
        for lex in extra_lexemes:
            if lex['id'] in self.lexemes:raise ValueError('duplicate lexical ID: '+lex['id'])
            if not lex['object']['classes']:raise ValueError('external carrier requires a verified word class')
            if lex.get('cores') or lex.get('vocabulary_ids'):raise ValueError('external carriers cannot silently edit the curriculum')
            self.lexemes[lex['id']]=deepcopy(lex)
        self.vocabulary_forms=data['vocabulary_forms']
        defs=json.loads((DATA/'modifier_definitions.json').read_text())
        self.modifiers={x['id']:x for x in defs['modifiers']}
        self.chains={x['id']:x for x in defs['chains']}
        model=json.loads((ROOT/'core_parser/vendor/grammar.json').read_text())
        model['non_core_base_policy']={'enabled':False,'require_dictionary':False}
        cat=model['catalogue']
        for k in list(cat):
            if k.startswith('objects.') and cat[k].get('kind')==['base_word'] and k[8:] not in self.lexemes:
                del cat[k]
        for bid,lex in self.lexemes.items():cat['objects.'+bid]=deepcopy(lex['object'])
        # One stem-driven past feminine/neuter rule for all typed verbs. This
        # generalizes the existing per-verb exceptions without using gold forms.
        rid='core_past_fn'
        cat['rules.'+rid]={'operation':['lexical_form'],'requires':['root_has:form_past_fn'],
             'field':['form_past_fn'],'receiver_stem_field':['stem_past'],
             'result_classes':['finite_predicate'],
             'set_features':['person=third','number=singular','gender=feminine_or_neuter','respect=plain','finiteness=finite']}
        for bid in self.lexemes:
            obj=cat['objects.'+bid]
            if 'form_past_fn' in obj and 'verb' in obj['classes']:
                oid='core_past_fn_'+bid
                cat['overrides.'+oid]={'owner':['object:'+bid],
                    'incoming':['object:agr_third_feminine_or_neuter_singular_plain'],
                    'when':['tam=past'],'scope':['descendants'],'priority':['999'],
                    'action':['replace_rule'],'replacement_rule':['rule:'+rid]}
                obj['incoming_overrides'].append('override:'+oid)
        # UniMorph contains vocatives; retain them as recognized non-core grammar.
        cat['objects.ext_vocative']={'kind':['modifier'],'classes':['case_modifier'],
            'forms':['ా'],'can_modify':['class:nominal'],'application_rules':['rule:core_vocative'],
            'can_be_modified_by':[],'incoming_overrides':[], 'result_classes':['inflected_nominal'],
            'features':['case=vocative'],'realization':['atomic']}
        cat['rules.core_vocative']={'operation':['select_stem_append'],
             'requires':['root_has:stem_vocative'],'stem_field':['stem_vocative'],
             'append':[],'result_classes':['inflected_nominal'],'set_features':['case=vocative']}
        cat['classes.nominal']['can_be_modified_by'].append('object:ext_vocative')
        # Correct the known locative + focus boundary instead of shortening లో.
        cat['rules.core_locative_focus']={'operation':['append'],'requires':[],
             'append':['నే'],'result_classes_mode':['preserve'],'result_classes':[],
             'set_features':['focus=exclusive']}
        cat['overrides.core_locative_focus']={'owner':['object:mod_locative'],
             'incoming':['object:mod_focus'],'when':[],'scope':['head'],'priority':['999'],
             'action':['replace_rule'],'replacement_rule':['rule:core_locative_focus']}
        cat['objects.mod_locative']['incoming_overrides'].append('override:core_locative_focus')
        # Formal nominal allomorphs are declarative receiver/stem rules. They are
        # applied productively, not as individual benchmark word exceptions.
        formal={'mod_accusative':('','accusative'),'mod_dative':('కొరకు','dative'),
                'mod_genitive':('యొక్క','genitive'),'mod_instrumental':('తో','instrumental'),
                'mod_locative':('యందు','locative'),'mod_ablative':('వలన','ablative')}
        for bid in self.lexemes:
            o=cat['objects.'+bid];form=o['forms'][0]
            if 'noun' not in o['classes'] or not form.endswith('ుడు'):continue
            o['stem_formal_oblique']=[form[:-2]+'ని']
            o['stem_formal_vocative']=[form[:-3]+'ా']
            for mid,(suffix,case) in formal.items():
                rid='formal_'+mid
                cat['rules.'+rid]={'operation':['select_stem_append'],'requires':['root_has:stem_formal_oblique'],
                    'stem_field':['stem_formal_oblique'],'append':[suffix],
                    'result_classes':['inflected_nominal'],'set_features':['case='+case,'register=formal']}
                oid=rid+'_'+bid
                cat['overrides.'+oid]={'owner':['object:'+bid],'incoming':['object:'+mid],
                    'when':['requested.variant=formal'],'scope':['self'],'priority':['999'],
                    'action':['replace_rule'],'replacement_rule':['rule:'+rid]}
                o['incoming_overrides'].append('override:'+oid)
            rid='formal_vocative';oid=rid+'_'+bid
            cat['rules.'+rid]={'operation':['select_stem_append'],'requires':['root_has:stem_formal_vocative'],
                 'stem_field':['stem_formal_vocative'],'append':[],'result_classes':['inflected_nominal'],
                 'set_features':['case=vocative','register=formal']}
            cat['overrides.'+oid]={'owner':['object:'+bid],'incoming':['object:ext_vocative'],
                 'when':['requested.variant=formal'],'scope':['self'],'priority':['999'],
                 'action':['replace_rule'],'replacement_rule':['rule:'+rid]}
            o['incoming_overrides'].append('override:'+oid)
        for mid,(suffix,case) in formal.items():
            if mid=='mod_accusative':continue  # Do not imitate bare genitive tagged ACC.
            rid='formal_plural_'+mid
            cat['rules.'+rid]={'operation':['strip_final_u_append'],'requires':[],
                 'append':[suffix],'result_classes':['inflected_nominal'],
                 'set_features':['case='+case,'register=formal']}
            cat['overrides.'+rid]={'owner':['object:mod_plural'],'incoming':['object:'+mid],
                 'when':['requested.variant=formal'],'scope':['head'],'priority':['999'],
                 'action':['replace_rule'],'replacement_rule':['rule:'+rid]}
            cat['objects.mod_plural']['incoming_overrides'].append('override:'+rid)
        cat['rules.core_plural_vocative']={'operation':['strip_final_u_append'],'requires':[],
             'append':['ారా'],'result_classes':['inflected_nominal'],'set_features':['case=vocative']}
        cat['overrides.core_plural_vocative']={'owner':['object:mod_plural'],'incoming':['object:ext_vocative'],
             'when':[],'scope':['head'],'priority':['999'],'action':['replace_rule'],
             'replacement_rule':['rule:core_plural_vocative']}
        cat['objects.mod_plural']['incoming_overrides'].append('override:core_plural_vocative')
        # Explicit mechanics for formerly contextual vector-verb placeholders.
        # The spelling is derivable, but the intended vector-verb sense still
        # requires context; analyze never treats these as certain examples.
        for mid,profile,effect in [('mod_completive_poo','poo','aspect=completive'),
                                   ('mod_benefactive_pettu','pettu_joined','beneficiary=other_or_contextual')]:
            cat['rules.'+mid]={'operation':['attach_profile'],'requires':[],
                'profile':[profile],'joiner':[],'result_classes':['derived_verb'],
                'set_features':[effect,'sense_status=context_required'],
                'source_refs':['experimental_composition_of_existing_perfective_and_vector_profile']}
        self.variant_requests=install_repairs(model,self.lexemes)
        install_surface_variants(model,self.lexemes)
        install_review_repairs(model,self.lexemes)
        install_productive_rules(model,self.lexemes)
        self.engine=TypedEngine(model)
        self.patterns={}; self.signature_entries=defaultdict(list)
        self._make_patterns()
        self.index=defaultdict(list)
        self._index_keys=defaultdict(set)
        self.realization_failures=Counter()
        self.realized_templates=defaultdict(set)
        if build_index:self._build_index()
        self._productive_cache={}
        del self._index_keys

    def expand(self,chain):
        out=[]
        for mid in chain:
            obj=self.engine.objects[mid]
            if obj.get('expands_to'):out.extend(self.expand([x.split(':')[1] for x in obj['expands_to']]))
            else:out.append(mid)
        return tuple(out)

    def _add_pattern(self,chain,entry=None):
        expanded=self.expand(chain)
        self.patterns[expanded]=True
        if entry and entry not in self.signature_entries[expanded]:
            self.signature_entries[expanded].append(entry)

    def _make_patterns(self):
        self._add_pattern([])
        for mid,m in self.modifiers.items():
            if m['kind']!='semantic_distinction':self._add_pattern([mid],mid)
        for cid,c in self.chains.items():
            choices=[c.get('slots',{}).get('agreement',[]) if x=='$agreement' else [x] for x in c['pattern']]
            for chain in product(*choices):self._add_pattern(chain,cid)
        # Useful complete combinations omitted from the importance catalogue
        # remain recognized_non_core rather than inheriting a component's core.
        self._add_pattern(['ext_vocative'])
        for mid in CASE_TAGS:
            self._add_pattern(['mod_plural',mid])
        for mid in ['mod_literary_progressive','mod_literary_future','mod_literary_past']:
            for agr in AGREEMENTS:self._add_pattern([mid,agr])
        for mid in ['mod_poetic_plural_apocope']:
            self._add_pattern(['mod_plural',mid])
        for rel in ['mod_relative_past','mod_relative_nonpast']:
            for nominal in ['mod_relative_human_honorific','mod_relative_nonhuman_plural']:
                self._add_pattern([rel,nominal])
                for case in ['mod_dative','mod_accusative']:self._add_pattern([rel,nominal,case])
            self._add_pattern([rel,'mod_extent'])
            self._add_pattern([rel,'mod_extent','mod_up_to'])
            self._add_pattern([rel,'mod_relative_nonhuman_singular','mod_focus_who'])
            self._add_pattern([rel,'mod_relative_human_plural','mod_all_humans'])
            self._add_pattern([rel,'mod_relative_human_plural','mod_all_humans','mod_dative','mod_universal_emphasis'])
        for chain in [['mod_accusative','mod_about'], ['mod_plural','mod_accusative','mod_about'],
                      ['mod_plural','mod_all_nominal_humans'],
                      ['mod_plural','mod_all_nominal_humans','mod_dative','mod_universal_emphasis'],
                      ['mod_plural','mod_via'], ['mod_literary_locative','mod_poetic_final_n']]:
            self._add_pattern(chain)
        for agr in AGREEMENTS:
            self._add_pattern(['mod_perfective_converb','mod_perfect_undu','mod_future_habitual',agr])
            self._add_pattern(['mod_perfective_converb','mod_completive_poo','mod_past',agr])
            for embedded in ['mod_say','mod_seem']:
                final='agr_third_feminine_or_neuter_singular_plain' if embedded=='mod_seem' else 'agr_first_singular'
                self._add_pattern(['mod_past',agr,embedded,'mod_past',final])
        for mid in ['mod_literary_progressive','mod_literary_future','mod_literary_past']:
            self._add_pattern(['mod_become',mid])
            for agr in AGREEMENTS:self._add_pattern(['mod_become',mid,agr])
        for case in CASE_TAGS:
            for clitic in ['mod_focus','mod_additive','mod_question']:
                self._add_pattern([case,clitic])

    def _build_index(self):
        trie={}
        for chain in self.patterns:
            node=trie
            for mid in chain:node=node.setdefault(mid,{})
            node[None]=True
        for bid,lex in self.lexemes.items():
            for form in lex['object']['forms']:
                requests=[{}]
                if 'noun' in lex['object']['classes']:requests.append({'variant':'formal'})
                requests.extend(self.variant_requests[bid])
                for request in requests:
                    initial=self.engine.start(bid,form)
                    def walk(state,node,active_request):
                        if None in node:self._record(state,form,active_request)
                        for mid,child in node.items():
                            if mid is None:continue
                            for next_request in realization_choices(self.engine,state,mid,active_request):
                                try:next_state=self.engine.apply(state,mid,next_request)
                                except GrammarError as exc:
                                    self.realization_failures[(mid,exc.code)]+=1
                                    continue
                                walk(next_state,child,next_request)
                    walk(initial,trie,request)

    def _record(self,s,base_form,request=None):
        if set(self.engine.closure(s['classes'])) & {'tam_stem','auxiliary_predicate_stem'}:
            return
        chain=tuple(s['chain']);word=s['surface'];key=(s['root'],chain,tuple(sorted(s['features'].items())))
        if key in self._index_keys[word]:return
        self._index_keys[word].add(key)
        record={'base_id':s['root'],'base_form':base_form,'lemma':self.lexemes[s['root']]['lemma'],
                'chain':list(chain),'features':s['features'],'classes':s['classes'],'request':request or {}}
        self.index[word].append(record)
        for eid in self.signature_entries.get(chain,[]):self.realized_templates[eid].add(word)

    def classify_chain(self,chain):
        chain=self.expand(chain)
        if not chain:return {'status':'no_modifiers','core':None,'entries':[]}
        ids=self.signature_entries.get(chain,[])
        # A named whole chain takes precedence over a composite alias only for
        # reporting; every matching catalogue identity is retained.
        cores=sorted({(self.chains.get(i) or self.modifiers[i])['core'] for i in ids})
        return {'status':('core_'+str(cores[0]) if len(cores)==1 else 'unresolved' if cores else 'recognized_non_core'),
                'core':cores[0] if len(cores)==1 else None,'possible_cores':cores,'entries':ids}

    def classify_base(self,bid):
        lex=self.lexemes[bid];cores=lex['cores']
        return {'status':'core_'+str(cores[0]) if len(cores)==1 else 'unresolved' if cores else 'non_core',
                'core':cores[0] if len(cores)==1 else None,'possible_cores':cores,
                'lemma':lex['lemma'],'vocabulary_ids':lex['vocabulary_ids'],
                'source':lex['source']}

    def projection(self,record):
        """Project only constructions represented in the small UniMorph snapshot.

        This is explicitly lossy: e.g. honorific reference isn't annotated there.
        Internal extended chains are never collapsed to a simple finite gold row.
        """
        chain=record['chain'];fs=record['features'];agr=[m for m in chain if m in AGREEMENTS]
        if agr:
            head=chain[:chain.index(agr[-1])]
            tense={('mod_past',):['PST'],('mod_future_habitual',):['FUT'],
                   ('mod_durative','mod_aux_unna'):['PRS','DUR']}.get(tuple(head))
            if tense is None or chain[-1]!=agr[-1]:return []
            agreements={AGREEMENTS[0]:[['1','SG']],AGREEMENTS[1]:[['1','PL']],
                AGREEMENTS[2]:[['2','SG']],AGREEMENTS[3]:[['2','PL']],
                AGREEMENTS[4]:[['3','MASC','SG']],AGREEMENTS[5]:[['3','FEM','SG']],
                AGREEMENTS[6]:[['3','MASC','PL'],['3','FEM','PL']],AGREEMENTS[7]:[]}
            return [sorted(['V']+a+tense) for a in agreements[agr[-1]]]
        if not chain and 'interjection' in self.lexemes[record['base_id']]['object']['classes']:
            return [['INTJ']]
        if not chain or all(m in CASE_TAGS or m=='mod_plural' for m in chain):
            if 'noun' not in self.engine.closure(self.lexemes[record['base_id']]['object']['classes']):return []
            case=next((CASE_TAGS[m] for m in reversed(chain) if m in CASE_TAGS),'NOM')
            return [sorted(['N','PL' if 'mod_plural' in chain else 'SG',case])]
        return []

    def unresolved_dimensions(self,r):
        f=r['features'];issues=[]
        if f.get('referent_number')=='unresolved':issues.append('plural_vs_honorific_reference')
        if f.get('gender')=='feminine_or_neuter':issues.append('feminine_vs_neuter')
        if 'agr_first_plural' in r['chain'] and f.get('clusivity') not in ('inclusive','exclusive'):
            issues.append('inclusive_vs_exclusive')
        if 'mod_completive_poo' in r['chain']:issues.append('completive_vs_literal_motion_requires_context')
        if 'mod_benefactive_pettu' in r['chain']:issues.append('benefactive_vs_literal_put_requires_context')
        return issues

    @property
    def feature_model(self):
        if not hasattr(self,'_feature_model'):
            from .feature_model import FeatureModel
            self._feature_model=FeatureModel(self)
        return self._feature_model

    def contrast(self,word,axis,value,scope='base',limit=50):
        return self.feature_model.contrast(word,axis,value,scope,limit)

    def neighbors(self,word=None,chain=None,scope='combined',limit=50,max_distance=1,min_distance=0):
        return self.feature_model.neighbors(word,chain,scope,limit,max_distance,min_distance)

    def analyze(self,word,include_trace=False,search_all_paths=False):
        word=norm(word)
        # Numeric Telugu characters are not words, despite occupying the same
        # Unicode block. Matches in the corpus use the original strict tokenizer.
        if any(c.isnumeric() or (not ('\u0c00'<=c<='\u0c7f' or c==' ')) for c in word):
            word_records=[]
            search={'complete_within_executable_rules':False,'cutoffs':['rejected_non_word_input']}
        elif search_all_paths or word not in self.index:
            word_records,search=self.productive_records(word)
        else:
            word_records=self.index.get(word,[])
            search={'scope':'all catalogued paths on every registered typed carrier',
                    'complete_within_curriculum_paths':True,'cutoffs':[]}
        records=word_records;analyses=[]
        for r in records:
            a=dict(r,base_category=self.classify_base(r['base_id']),modifier_category=self.classify_chain(r['chain']),
                   unimorph_projections=self.projection(r),unresolved_dimensions=self.unresolved_dimensions(r),
                   proof_scope='typed_carriers_and_licensed_rule_paths')
            if include_trace:
                state=self.engine.start(r['base_id'],r['base_form'])
                for i,mid in enumerate(r['chain']):state=self.engine.apply(state,mid,(r.get('step_requests') or [r.get('request',{})]*len(r['chain']))[i])
                a['trace']=state['trace'];a['structure']=state['tree']
            a['feature_structure']=self.feature_model.analysis_view(r)
            analyses.append(a)
        def consensus(field):
            values=[a[field] for a in analyses]
            if not values:return {'status':'unresolved','core':None}
            if field=='base_category':
                lemmas={v['lemma'] for v in values}
                if len(lemmas)>1:return {'status':'unresolved','core':None,'candidates':values}
            pairs={(v['status'],v['core']) for v in values}
            if len(pairs)==1:
                out=dict(values[0]);out['supported_by_all_registered_analyses']=True;return out
            return {'status':'unresolved','core':None,'candidates':values}
        signatures={(a['lemma'],tuple(a['chain']),tuple(sorted((k,v) for k,v in a['features'].items()
                     if k not in ('register','base_type','lexical_status')))) for a in analyses}
        ambiguous=len(signatures)>1 or any(a['unresolved_dimensions'] for a in analyses)
        # Registered-model uniqueness is deliberately not advertised as complete
        # Telugu uniqueness; additional unimplemented competitors may exist.
        incomplete=bool(search.get('cutoffs'))
        status='search_incomplete' if incomplete else 'unresolved' if not analyses else 'ambiguous' if ambiguous else 'resolved_in_model'
        result={'word':word,'base':consensus('base_category'),'modifiers':consensus('modifier_category'),
                'separation':status,'eligible_in_model':status=='resolved_in_model',
                'linguistically_certified':False,'analysis_count':len(analyses),'analyses':analyses,
                'vocabulary_expression_matches':self.vocabulary_forms.get(word,[]),
                'search_scope':search,
                'parser_version':self.VERSION}
        result['learning']=learning_result(self,analyses,result['eligible_in_model'])
        if incomplete:result['learning']['eligible']=False
        return result

    def productive_records(self,word,max_depth=16,max_states=4000,max_analyses=128):
        """On-demand reverse proof search, including paths outside the curriculum.

        Every inverse is replayed through the same typed attachment rules. Search
        cutoffs are explicit and cannot yield a certain progression target.
        No lexical carrier is required to be in Core 1, 2 or 3.
        """
        key=(word,max_depth,max_states,max_analyses)
        if key in self._productive_cache:return self._productive_cache[key]
        raw=self.engine.analyze(word,max_depth=max_depth,max_states=max_states,
                                max_analyses=max_analyses,include_tree=False)
        records=list(self.index.get(word,[]));seen={(r['base_id'],tuple(r['chain']),tuple(sorted(r['features'].items()))) for r in records}
        for a in raw.get('analyses',[]):
            if a['intermediate_stem']:continue
            bid=a['base'];fs=a['active_features'];sig=(bid,tuple(a['chain']),tuple(sorted(fs.items())))
            if sig in seen:continue
            seen.add(sig)
            records.append(dict(base_id=bid,base_form=a['trace'][0]['input'] if a['trace'] else word,
                lemma=self.lexemes[bid]['lemma'],chain=a['chain'],features=fs,classes=a['classes'],
                request={},step_requests=[t['request'] for t in a['trace']]))
        search=raw.get('search',dict(cutoffs=['invalid_input']))
        value=(records,search);self._productive_cache[key]=value
        return value

    def generate(self,base,chain,request=None):
        if any(m not in self.modifiers and m!='ext_vocative' for m in chain):
            raise GrammarError('unsupported_modifier')
        result=self.engine.generate(base,chain,request)
        result['modifier_category']=self.classify_chain(chain)
        result['base_category']=self.classify_base(result['base'])
        return result

    def search(self,modifier=None,base=None,core=None,eligible_only=True,limit=100,include_shared=False):
        out=[]
        target=self.expand([modifier]) if modifier in self.modifiers else None
        for word,records in sorted(self.index.items()):
            matched=False
            for r in records:
                chain=tuple(r['chain'])
                if base and base not in (r['base_id'],r['lemma'],r['base_form']):continue
                if core is not None and core not in self.lexemes[r['base_id']]['cores']:continue
                if modifier:
                    if modifier in self.chains:
                        if modifier not in self.signature_entries.get(chain,[]):continue
                    elif target:
                        if not any(chain[i:i+len(target)]==target for i in range(len(chain)-len(target)+1)):continue
                    else:continue
                matched=True;break
            if not matched:continue
            result=self.analyze(word)
            if eligible_only and not (result['eligible_in_model'] or
                    (include_shared and result['learning']['eligible'])):continue
            out.append(result)
            if len(out)>=limit:break
        return out
