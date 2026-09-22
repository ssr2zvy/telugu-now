"""Contrast metadata and attested-in-model transitions, separate from recognition.

Missing tags are unknown. A composite value is not silently split into alternatives.
No text replacement, unrestricted inflection, or Cartesian-product generation.
"""
from collections import defaultdict
from copy import deepcopy
from pathlib import Path
import json
import unicodedata
from .vendor.engine import features, GrammarError

METADATA = {'paradigm', 'base_type', 'lexical_status', 'catalogue_function',
            'traditional_alias', 'sense_status'}
FAMILIES = [
 ['mod_past','mod_future_habitual','mod_negative_future_habitual','mod_negative_past'],
 ['mod_accusative','mod_dative','mod_genitive','mod_instrumental','mod_comitative','mod_locative','mod_ablative','ext_vocative'],
 ['mod_relative_past','mod_relative_nonpast','mod_progressive_relative','mod_obligative_relative'],
 ['mod_relative_human_plural','mod_relative_human_honorific','mod_relative_masculine','mod_relative_nonhuman_singular','mod_relative_nonhuman_plural'],
 ['mod_ability','mod_inability'], ['mod_conditional','mod_negative_conditional'],
 ['mod_imperative_polite','mod_negative_imperative_polite'],
 ['mod_degree_intensive','mod_degree_attenuative'],
 ['mod_spatial_goal','mod_spatial_source'],
 ['mod_inclusive','mod_exclusive'],
 ['mod_honorific_singular_reference','mod_plain_plural_reference','mod_honorific_plural_reference'],
]
OPTIONAL = {'mod_plural':'number','mod_honorific':'respect','mod_additive':'addition',
            'mod_question':'clause_type','mod_focus':'focus'}

def tags(obj, key='features'):
    return features([x for x in obj.get(key, []) if '=' in x])

def changes(a, b):
    return {k:{'from':a.get(k),'to':b.get(k)} for k in sorted(set(a)|set(b)) if a.get(k)!=b.get(k)}

class FeatureModel:
    def __init__(self, parser):
        self.parser=parser
        self.engine=parser.engine
        self.lexical=defaultdict(list)
        self.groups=defaultdict(set)
        data=json.loads((Path(__file__).resolve().parents[1]/'data/contrast_families.json').read_text())
        known_forms=set(parser.vocabulary_forms)
        known_forms.update(f for o in self.engine.bases.values() for f in o.get('forms',[]))
        self.unregistered_lexical_members=[]
        for family in data['families']:
            for member in family['members']:
                if member['form'] not in known_forms:
                    self.unregistered_lexical_members.append(member['form'])
                    continue
                self.lexical[member['form']].append({'family':family['id'], 'features':{family['axis']:member['value']}})
        # Existing deictic paradigms already supply the grammar tags and stems.
        # IDs are only used to identify their declared proximal/distal pair.
        for bid, lex in parser.lexemes.items():
            ft=tags(lex['object'])
            if ft.get('deixis') in ('proximal','distal'):
                family=bid.replace('_proximal','_DEIXIS').replace('_distal','_DEIXIS')
                for form in lex['object'].get('forms',[]):
                    self.lexical[form].append({'family':family,'features':{'deixis':ft['deixis']}})
            if ft.get('pos')=='pronoun' and 'person' in ft:
                family='reflexive_reference' if 'reflexive' in bid else 'personal_reference'
                for form in lex['object'].get('forms',[]):
                    self.lexical[form].append({'family':family,'features':{}})
        self.modifier_families=[set(f) for f in FAMILIES]
        self.modifier_families.append({m for m in self.engine.objects if m.startswith('agr_')})
        self.rule_users=defaultdict(set)
        for mid,obj in self.engine.objects.items():
            for ref in obj.get('application_rules',[]): self.rule_users[ref.removeprefix('rule:')].add(mid)
        for override in self.engine.overrides.values():
            for ref in override.get('replacement_rule',[]):
                for incoming in override.get('incoming',[]):
                    if incoming.startswith('object:'):self.rule_users[ref.removeprefix('rule:')].add(incoming[7:])
        self.modifier_rules=defaultdict(set)
        for rid,mids in self.rule_users.items():
            for mid in mids:self.modifier_rules[mid].add(rid)

    def base_view(self, bid, form=None):
        obj=self.parser.lexemes[bid]['object'] if bid is not None else {'forms':[form]}
        form=form or obj['forms'][0]
        return {'features':tags(obj), 'lexical_contrasts':deepcopy(self.lexical.get(form,[])),
                'missing_feature_policy':'unknown', 'form':form}

    def record_features(self, record, scope):
        if scope=='result':return dict(record['features'])
        if scope!='base':raise ValueError('scope must be base or result')
        view=self.base_view(record['base_id'],record['base_form'])
        out=dict(view['features'])
        for item in view['lexical_contrasts']:out.update(item['features'])
        return out

    def analysis_view(self, record):
        return {'base':self.base_view(record['base_id'],record['base_form']),
                'result':dict(record['features']),
                'modifier_steps':[{'position':i,'id':mid,'rule_options':sorted(self.modifier_rules[mid])}
                                  for i,mid in enumerate(record['chain'])],
                'scope_note':'Base and result are separate. Use --trace for actual rule choices, local effects and nested scopes.',
                'missing_feature_policy':'unknown; absence is not the opposite value'}

    def inventory(self):
        schema=defaultdict(set)
        def observe(mapping):
            for k,v in mapping.items():schema[k].add(v)
        rules={}
        for rid,rule in self.engine.rules.items():
            assignments=tags(rule,'set_features');defaults=tags(rule,'default_features')
            observe(assignments);observe(defaults)
            conditions={}
            for condition in rule.get('requires',[])+rule.get('when',[]):
                if '=' in condition:
                    k,v=condition.split('=',1);conditions[k]=v;observe({k:v})
            effects=set(assignments)|set(defaults)
            overrides={oid:ov for oid,ov in self.engine.overrides.items() if 'rule:'+rid in ov.get('replacement_rule',[])}
            for ov in overrides.values():
                for condition in ov.get('when',[]):
                    if '=' in condition:
                        k,v=condition.split('=',1);observe({k:v})
            rules[rid]={'feature_assignments':assignments,'feature_defaults':defaults,
                'contrast_axes':sorted(effects-METADATA),'status':'feature_effect_declared' if effects-METADATA else 'no_direct_feature_effect',
                'incoming_objects':sorted(self.rule_users[rid]),'conditions':conditions,
                'scope_mode':rule.get('feature_mode',['preserve']),
                'unicode_and_grammar_rule':deepcopy(rule),'override_selectors':deepcopy(overrides)}
        modifiers={}
        for mid,definition in self.parser.modifiers.items():
            obj=self.engine.objects.get(mid,{})
            observe(tags(obj))
            related=sorted(self.modifier_rules[mid])
            modifiers[mid]={'core':definition['core'],'declared_features':tags(obj),
                'rule_ids':related,'grammar_object':deepcopy(obj),'definition':deepcopy(definition),
                'contrast_axes':sorted(set(tags(obj))-METADATA | {k for r in related for k in rules.get(r,{}).get('contrast_axes',[])}),
                'status':'registered_rules' if related else 'composite_or_contextual_see_definition'}
        def component_axes(mid, seen=None):
            seen=set() if seen is None else seen
            if mid in seen:return set()
            seen.add(mid)
            axes=set(modifiers.get(mid,{}).get('contrast_axes',[]))
            for ref in self.engine.objects.get(mid,{}).get('expands_to',[]):
                axes.update(component_axes(ref.removeprefix('object:'),seen))
            return axes
        for mid,entry in modifiers.items():
            entry['contrast_axes']=sorted(component_axes(mid))
            entry['switch_families']=[sorted(f) for f in self.modifier_families if mid in f]
        chains={}
        for cid,definition in self.parser.chains.items():
            steps=[]
            for position,mid in enumerate(definition.get('expanded_pattern',definition['pattern'])):
                options=definition.get('slots',{}).get(mid[1:],[]) if mid.startswith('$') else [mid]
                steps.append({'position':position,'modifier_options':options,
                    'contrast_axes':sorted({axis for option in options for axis in component_axes(option)})})
            chains[cid]={**deepcopy(definition),'feature_steps':steps,
                         'scope_policy':'Ordered effects; do not union local features into the final scope.'}
        bases={}
        for bid in self.parser.lexemes:
            view=self.base_view(bid);observe(view['features'])
            for form in self.engine.bases[bid].get('forms',[]):
                for item in self.lexical.get(form,[]):observe(item['features'])
            bases[bid]={'cores':self.parser.lexemes[bid]['cores'], **view,
                'forms':self.engine.bases[bid].get('forms',[]),
                'form_contrasts':{f:self.lexical.get(f,[]) for f in self.engine.bases[bid].get('forms',[])},
                'stem_and_form_fields':{k:v for k,v in self.engine.bases[bid].items() if k.startswith(('stem_','form_','realized_'))}}
        vocab={f:{'entries':entries,'lexical_contrasts':self.lexical.get(f,[]),
                  'contrast_status':'declared' if f in self.lexical else 'not_declared'}
               for f,entries in self.parser.vocabulary_forms.items()}
        for records in self.parser.index.values():
            for record in records:observe(record['features'])
        for items in self.lexical.values():
            for item in items:observe(item['features'])
        return {'version':'1.0','policy':{'missing':'unknown','contrasts':'categorical, not Boolean or necessarily ordered',
            'surface_change':'may change, remain syncretic, or be unavailable',
            'authority':'inherited grammar plus editorial lexical families; not independent certification',
            'coverage':'all shipped records exported; unlisted lexical relationships remain unannotated'},
            'schema':{k:{'values':sorted(v),'kind':'metadata' if k in METADATA else 'feature',
                         'unknown_allowed':True,'composite_values_are_atomic':True,
                         'rule_realizers':{value:[rid for rid,r in rules.items() if r['feature_assignments'].get(k)==value or r['feature_defaults'].get(k)==value] for value in sorted(v)}} for k,v in sorted(schema.items())},
            'bases':bases,'vocabulary_forms':vocab,'modifiers':modifiers,'chains':chains,
            'rules':rules,'profiles':deepcopy(self.engine.profiles),
            'overrides':deepcopy(self.engine.overrides),'classes':deepcopy(self.engine.classes),
            'unregistered_lexical_members':self.unregistered_lexical_members}

    def modifier_axes(self, mid, seen=None):
        seen=set() if seen is None else seen
        if mid in seen:return set()
        seen.add(mid)
        obj=self.engine.objects.get(mid,{})
        axes=set(tags(obj))
        for rid in self.modifier_rules[mid]:
            rule=self.engine.rules[rid]
            axes.update(tags(rule,'set_features'));axes.update(tags(rule,'default_features'))
        for ref in obj.get('expands_to',[]):axes.update(self.modifier_axes(ref.removeprefix('object:'),seen))
        return axes-METADATA

    def compatible_chain(self, left, right, axis):
        if left==right:return True
        if len(left)==len(right):
            changed=[(a,b) for a,b in zip(left,right) if a!=b]
            if len(changed)!=1:return False
            a,b=changed[0]
            return (any({a,b}<=family for family in self.modifier_families)
                    or axis in self.modifier_axes(a)&self.modifier_axes(b))
        for optional,feature in OPTIONAL.items():
            if axis==feature:
                for longer,shorter in [(left,right),(right,left)]:
                    if any(m==optional and longer[:i]+longer[i+1:]==shorter for i,m in enumerate(longer)):return True
        return False

    def contrast(self, word, axis, value, scope='base', limit=50):
        if scope not in ('base','result'):raise ValueError('scope must be base or result')
        if limit<1:raise ValueError('limit must be positive')
        word=unicodedata.normalize('NFC',word.strip())
        sources=self.source_records(word,scope=='base')
        matches=[]
        for i,source in enumerate(sources):
            before=self.record_features(source,scope)
            # Unknown to known is a refinement, not an opposite switch.
            if axis not in before or before[axis]==value:continue
            families={x['family'] for x in self.lexical.get(source['base_form'],[])}
            for surface,target in self.all_records(scope=='base'):
                if scope=='base':
                    other={x['family'] for x in self.lexical.get(target['base_form'],[])}
                    if not families&other or source['chain']!=target['chain']:continue
                elif source['base_id']!=target['base_id'] or source['base_form']!=target['base_form'] or not self.compatible_chain(source['chain'],target['chain'],axis):continue
                after=self.record_features(target,scope)
                if after.get(axis)!=value:continue
                diff=changes(before,after)
                matches.append({'source_analysis':i,'word':surface,'base_id':target['base_id'],
                    'chain':target['chain'],'features':after,'changes':diff,
                    'other_feature_changes':{k:v for k,v in diff.items() if k!=axis and k not in METADATA},
                    'same_surface':surface==word,'request':target['request'],
                    'proof_scope':'lexical_catalogue' if target.get('catalogue_only') else 'registered_lexicon_and_enumerated_rule_paths'})
        matches.sort(key=lambda m:(len(m['other_feature_changes']),m['word'],m['source_analysis'],m['chain']))
        return {'word':word,'scope':scope,'axis':axis,'target_value':value,'source_analysis_count':len(sources),
                'status':'available_in_model' if matches else 'unavailable_in_model',
                'match_count':len(matches),'truncated':len(matches)>limit,'matches':matches[:limit],
                'linguistically_certified':False,
                'note':'All source analyses are retained. No result means unknown or unsupported, not ungrammatical. Missing tags are never assumed to be opposites.'}

    def catalogue_record(self, word):
        return {'base_id':None,'base_form':word,'lemma':word,'chain':[],
                'features':{},'request':{},'catalogue_only':True}

    def source_records(self, word, include_catalogue=True):
        records=self.parser.index.get(word,[])
        if not records and include_catalogue and word in self.parser.vocabulary_forms:
            return [self.catalogue_record(word)]
        return records

    def all_records(self, include_catalogue=True):
        for word,records in self.parser.index.items():
            for record in records:yield word,record
        if include_catalogue:
            for word in self.parser.vocabulary_forms:
                if word not in self.parser.index:yield word,self.catalogue_record(word)

    def related_bases(self, a, b):
        if a['base_id'] is not None and a['base_id']==b['base_id']:return True
        if a['base_form']==b['base_form']:return True
        fa={x['family'] for x in self.lexical.get(a['base_form'],[])}
        fb={x['family'] for x in self.lexical.get(b['base_form'],[])}
        return bool(fa&fb)

    def chain_vector(self, record):
        """Tags from actual ordered rule applications, keeping scope boundaries."""
        if not record['chain']:return {},[]
        key=(record['base_id'],record['base_form'],tuple(record['chain']),
             json.dumps(record['request'],sort_keys=True))
        if not hasattr(self,'_chain_vectors'):self._chain_vectors={}
        if key in self._chain_vectors:return self._chain_vectors[key]
        state=self.engine.start(record['base_id'],record['base_form'])
        vector={};shape=[]
        for i,mid in enumerate(record['chain']):
            before=dict(state['features'])
            state=self.engine.apply(state,mid,record['request'])
            step=state['trace'][-1];rule=self.engine.rules[step['rule']]
            local=tags(rule,'default_features')
            if rule.get('feature_mode')!=['new_scope']:
                local={k:v for k,v in local.items() if k not in before}
            local.update(step['local_features'])
            local={k:v for k,v in local.items() if k not in METADATA}
            vector.update({f'step[{i}].{k}':v for k,v in local.items()})
            # Untagged operations are not assumed to share meaning.
            shape.append({'scope':step['scope'],'untagged_identity':None if local else mid})
        self._chain_vectors[key]=(vector,shape)
        return vector,shape

    def neighbor_vector(self, record, scope):
        vector={}
        if scope!='chain':
            vector.update({'base.'+k:v for k,v in self.record_features(record,'base').items() if k not in METADATA})
        if scope!='base':
            chain,shape=self.chain_vector(record);vector.update(chain)
        else:shape=record['chain']
        return vector,shape

    def neighbors(self, word=None, chain=None, scope='combined', limit=50, max_distance=1, min_distance=0):
        """Broad nearest neighbors over recorded tags, including zero-distance ties.

        Missing keys are not flips. Positional scopes and opaque operations must
        agree, but a shared lexical meaning family is not required.
        """
        if scope not in ('base','combined','chain'):raise ValueError('invalid scope')
        if limit<1:raise ValueError('limit must be positive')
        if not 0<=min_distance<=max_distance:raise ValueError('require 0 <= min_distance <= max_distance')
        if chain is not None:
            scope='chain';expanded=self.parser.expand(chain)
            # Preserve distinct realized grammatical readings of the requested chain.
            candidates={}
            for surface,record in self.all_records(False):
                signature=(tuple(record['chain']),tuple(sorted(record['features'].items())))
                candidates.setdefault(signature,(surface,record))
            pool=list(candidates.values())
            sources=[r for _,r in pool if tuple(r['chain'])==expanded]
        else:
            word=unicodedata.normalize('NFC',(word or '').strip())
            sources=self.source_records(word)
            pool=None
        matches=[];seen=set()
        for si,source in enumerate(sources):
            before,shape=self.neighbor_vector(source,scope)
            for surface,target in (pool if pool is not None else self.all_records()):
                if scope!='chain' and surface==word and target==source:continue
                if scope=='base' and source['chain']!=target['chain']:continue
                if scope!='base' and len(source['chain'])!=len(target['chain']):continue
                after,other_shape=self.neighbor_vector(target,scope)
                if not before or shape!=other_shape or set(before)!=set(after):continue
                different=[k for k in before if before[k]!=after[k]]
                if not min_distance<=len(different)<=max_distance:continue
                if scope=='chain' and source['chain']==target['chain'] and not different:continue
                axis=different[0] if len(different)==1 else None
                signature=(si,tuple(target['chain']),tuple(sorted(after.items())))
                if scope!='chain':signature+=(surface,target['base_id'])
                if signature in seen:continue
                seen.add(signature)
                matches.append({'word':surface,'source_analysis':si,'base_id':target['base_id'],
                    'chain':target['chain'],'changed_tag':axis,'from':before.get(axis),'to':after.get(axis),
                    'tag_distance':len(different),'normalized_distance':len(different)/len(before),'shared_tag_count':len(before)-len(different),'compared_tag_count':len(before),'changes':changes(before,after),'tags':after,'same_surface':surface==word,
                    'evidence':'lexical_catalogue' if target.get('catalogue_only') else 'grammar_derivation',
                    'modifier_category':self.parser.classify_chain(target['chain'])})
        matches.sort(key=lambda m:(m['normalized_distance'],-m['compared_tag_count'],m['tag_distance'],m['changed_tag'] or '',m['word'],m['chain'],m['source_analysis']))
        return {'query':chain if chain is not None else word,'scope':scope,
                'status':'matches_found' if matches else 'no_verified_tag_neighbor_in_model',
                'min_distance':min_distance,'max_distance':max_distance,'source_analysis_count':len(sources),'match_count':len(matches),
                'truncated':len(matches)>limit,'matches':matches[:limit],
                'distance_counts':{str(d):sum(m['tag_distance']==d for m in matches) for d in range(min_distance,max_distance+1)},
                'comparison':'Rank by differing values / compared tags, then more compared tags; retain raw distance filters. Missing keys are not flips.',
                'limitations':'Broad tag similarity is allowed, including noun-only matches. Tag distance does not establish semantic synonymy. Chain-only results use realized examples.',
                'linguistically_certified':False}
