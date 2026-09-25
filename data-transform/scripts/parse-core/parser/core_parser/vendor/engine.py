"""Recursive Telugu morphology. Data is loaded from adjacent grammar.json.

CLI: python engine.py analyze WORD
     python engine.py generate BASE MODIFIER ...
     python engine.py describe OBJECT
     python engine.py selftest
     python engine.py source

Python API: Engine().generate(base, chain), Engine().analyze(text).
Accepted analyses are proofs under this registered grammar, not certification of
every dialect or of a sentence's meaning. Uncovered forms remain unknown.
"""
import argparse
from pathlib import Path
import functools
import json
import sys
import unicodedata
from collections import defaultdict
from copy import deepcopy
from .sandhi import join as compound_join, split as compound_split

MODEL = json.loads(Path(__file__).with_name("grammar.json").read_text(encoding="utf-8"))

def one(d, key, default=''):
    a=d.get(key, []); return a[0] if a else default
def features(items): return dict(x.split('=',1) for x in items)
def nfc(text): return unicodedata.normalize('NFC',text)
def codes(text): return [f'U+{ord(c):04X}' for c in text]

class GrammarError(Exception):
    def __init__(self, code, detail=None):
        super().__init__(code); self.code=code; self.detail=detail or {}

def delta(before, after):
    """Exact local Unicode edit; no fictitious disjoint suffix spans after sandhi."""
    p=0
    while p<min(len(before),len(after)) and before[p]==after[p]: p+=1
    q=0
    while q<min(len(before)-p,len(after)-p) and before[-1-q]==after[-1-q]: q+=1
    end=len(before)-q if q else len(before)
    inserted=after[p:len(after)-q if q else len(after)]
    return {'start':p,'end':end,'removed':before[p:end],'inserted':inserted,
            'removed_codepoints':codes(before[p:end]),'inserted_codepoints':codes(inserted)}

class Engine:
    VOWELS=set('ాిీుూృౄెేైొోౌౢౣ')
    def __init__(self, model=None):
        self.model=deepcopy(MODEL if model is None else model)
        self.d=self.model['catalogue']; self.profiles=self.model['profiles']
        self.objects={k[8:]:v for k,v in self.d.items() if k.startswith('objects.')}
        self.rules={k[6:]:v for k,v in self.d.items() if k.startswith('rules.')}
        self.overrides={k[10:]:v for k,v in self.d.items() if k.startswith('overrides.')}
        self.classes={k[8:]:v for k,v in self.d.items() if k.startswith('classes.')}
        self.bases={k:v for k,v in self.objects.items() if v['kind']==['base_word']}
        # Registered base_word objects are the approved core-base list.
        # Non-core bases are accepted only when the remaining base is present in
        # an explicit dictionary/lexicon. This prevents the analyzer from
        # swallowing arbitrary unknown words or suffix-bearing noise as bases.
        policy=self.model.get('non_core_base_policy',{})
        self.allow_non_core_bases=policy.get('enabled', True)
        self.allow_non_core_standalone=policy.get('allow_standalone', True)
        self.require_non_core_dictionary=policy.get('require_dictionary', True)
        self.non_core_lexicon=self._load_non_core_lexicon()
        self.non_core_stem_index=defaultdict(set)
        self._build_non_core_stem_index()
        self._closure_cache={}
        self.validate()
        self.entries=[]; seen=set()
        for mid,m in self.objects.items():
            if m['kind']!=['modifier'] or m.get('expands_to'): continue
            candidates=[(ref.split(':',1)[1],{}) for ref in m['application_rules']]
            for ov in self.overrides.values():
                if ov['incoming']==['object:'+mid] and ov['action']==['replace_rule']:
                    req={c.split('=',1)[0][10:]:c.split('=',1)[1] for c in ov['when'] if c.startswith('requested.')}
                    candidates += [(ref.split(':',1)[1],req) for ref in ov['replacement_rule']]
            for rid,req in candidates:
                key=(mid,rid,tuple(sorted(req.items())))
                if key in seen or one(self.rules[rid],'operation')=='contextual_realization':continue
                seen.add(key);self.entries.append((mid,rid,req))
        self.allow_pairs={(one(o,'owner').split(':')[-1],one(o,'incoming').split(':')[-1]) for o in self.overrides.values() if o['action']==['allow']}
        self.unconditional_forbid_pairs={(one(o,'owner').split(':')[-1],one(o,'incoming').split(':')[-1])
            for o in self.overrides.values() if o['action']==['forbid'] and o['scope']==['head'] and not o['when']}
        self.zero_entries=[x for x in self.entries if one(self.rules[x[1]],'operation')=='identity']
        self.surface_entries=[x for x in self.entries if one(self.rules[x[1]],'operation')!='identity']
        self.base_form_index=defaultdict(list)
        self.registered_stem_index=defaultdict(list)
        for bid,b in self.bases.items():
            for form in b['forms']:self.base_form_index[form].append(bid)
            for field,values in b.items():
                if field.startswith(('stem_','form_','realized_')) and values:
                    self.registered_stem_index[field,values[0]].append(bid)

    def validate(self):
        def walk(nodes,key):
            seen=set()
            def visit(node,active):
                if node in active: raise GrammarError('schema_cycle',{'node':node})
                if node in seen:return
                if node not in nodes:raise GrammarError('dangling_reference',{'node':node})
                for ref in nodes[node].get(key,[]):visit(ref.split(':')[-1],active|{node})
                seen.add(node)
            for node in nodes:visit(node,set())
        walk(self.classes,'inherits');walk(self.objects,'expands_to')
        for oid,o in self.objects.items():
            for field in self.d['schema.object']['required']:
                if field not in o:raise GrammarError('missing_object_field',{'object':oid,'field':field})
            for ref in o['incoming_overrides']:
                ov=self.overrides[ref.split(':',1)[1]]
                if ov['owner']!=['object:'+oid]:raise GrammarError('invalid_override_owner',{'object':oid})
            for c in o['classes']+o['result_classes']:
                if c not in self.classes:raise GrammarError('dangling_class',{'class':c})
        maps={'object':self.objects,'class':self.classes,'rule':self.rules,'override':self.overrides}
        for section,entry in self.d.items():
            if not section.startswith(('objects.','classes.','rules.','overrides.')):continue
            for vals in entry.values():
                for val in vals:
                    kind,sep,name=val.partition(':')
                    if sep and kind in maps and name not in maps[kind]:raise GrammarError('dangling_reference',{'value':val})

    def closure(self, ids):
        key=tuple(sorted(ids))
        if key not in self._closure_cache:
            out=set(ids)
            for c in ids:out.update(self.closure(self.classes[c]['inherits']))
            self._closure_cache[key]=frozenset(out)
        return self._closure_cache[key]


    def _load_non_core_lexicon(self):
        """Load the mandatory full dictionary used for dictionary_non_core_base.

        Full implementation policy:
        - core bases are hard-coded in grammar.json and do not need dictionary lookup.
        - non-core bases/stems must be verified against lexicon_full.txt.
        - corpus words are never auto-promoted into dictionary entries.
        - if the full dictionary file is missing or empty, initialization fails
          and corpus analysis must not produce results.
        """
        full_path=Path(__file__).with_name("lexicon_full.txt")
        legacy_path=Path(__file__).with_name("lexicon.json")
        if not full_path.exists():
            if self.require_non_core_dictionary:
                raise GrammarError('missing_required_full_lexicon', {'path': str(full_path)})
            return set()

        core_forms={one(b,'forms') for b in self.bases.values()}
        out=set()
        try:
            with full_path.open("r", encoding="utf-8") as f:
                for line in f:
                    w=nfc(line.strip().replace("\ufeff",""))
                    if not w:
                        continue
                    variants={w, nfc(w.replace("\u200c","").replace("\u200d",""))}
                    for vv in variants:
                        if not vv or vv in core_forms:
                            continue
                        # Keep dictionary exact but normalize away zero-width joiners
                        # that appear in source lexica as rendering hints.
                        if any('\u0C00' <= ch <= '\u0C7F' for ch in vv):
                            out.add(vv)
        except Exception as e:
            if self.require_non_core_dictionary:
                raise GrammarError('malformed_required_full_lexicon', {'path': str(full_path), 'error': str(e)})
            return set()

        # Optional small supplemental JSON is allowed only as additive, never as a
        # replacement for the mandatory full dictionary.
        if legacy_path.exists():
            try:
                data=json.loads(legacy_path.read_text(encoding="utf-8"))
                extra=[]
                if isinstance(data, dict):
                    if isinstance(data.get("non_core_bases"), list):
                        extra.extend(data["non_core_bases"])
                    if isinstance(data.get("words"), list):
                        extra.extend(data["words"])
                    entries=data.get("entries")
                    if isinstance(entries, dict):
                        extra.extend(entries.keys())
                    elif isinstance(entries, list):
                        for item in entries:
                            if isinstance(item, str):
                                extra.append(item)
                            elif isinstance(item, dict):
                                for key in ("lemma","base","word","form"):
                                    val=item.get(key)
                                    if isinstance(val, str):
                                        extra.append(val); break
                    for k in data:
                        if isinstance(k, str) and any('\u0C00' <= ch <= '\u0C7F' for ch in k):
                            extra.append(k)
                elif isinstance(data, list):
                    extra.extend(data)
                for w in extra:
                    w=nfc(str(w).strip())
                    if w and w not in core_forms:
                        out.add(w)
            except Exception:
                # Supplemental JSON errors do not override a successfully loaded
                # mandatory full dictionary.
                pass

        if self.require_non_core_dictionary and not out:
            raise GrammarError('empty_required_full_lexicon', {'path': str(full_path)})
        return out

    def _non_core_stem_fields_for_base(self, surface, pos='noun'):
        """Return productive stem aliases for a dictionary base.

        The aliases are deliberately small and transparent. They let suffix
        rules find a dictionary lemma instead of treating a suffix-bearing word
        as a whole unknown base.
        """
        stems={}
        if pos=='noun':
            stems['form']=surface
            stems['stem_plural']=surface
            stems['stem_accusative']=surface
            stems['stem_dative']=surface
            stems['stem_instrumental']=surface
            stems['stem_locative']=surface
            stems['stem_ablative']=surface
            # Common neuter -ం nouns such as పుస్తకం/మంచం use oblique stems
            # పుస్తకా-, పుస్తకాని-, పుస్తకాన్- before several endings.
            if surface.endswith('ం') and len(surface)>1:
                base=surface[:-1]
                stems['stem_plural']=base+'ా'
                stems['stem_accusative']=base+'ాన్'
                stems['stem_dative']=base+'ాని'
            # Common -ము spelling alternation to -మా-/-మాని-.
            if surface.endswith('ము') and len(surface)>2:
                base=surface[:-2]+'మ'
                stems.setdefault('stem_plural', base+'ా')
                stems.setdefault('stem_accusative', base+'ాన్')
                stems.setdefault('stem_dative', base+'ాని')
            # Common -ి nouns often take -ు before plural లు:
            # చరరాశి -> చరరాశు + లు = చరరాశులు.
            if surface.endswith('ి') and len(surface)>1:
                stems.setdefault('stem_plural', surface[:-1]+'ు')
        else:
            stems['form']=surface
            for field in ('stem_past','stem_infinitive','stem_perfective',
                          'stem_verbal_noun','stem_obligative','stem_imperative_polite',
                          'stem_durative','stem_future','stem_self','stem_relative_past',
                          'stem_relative_nonpast','stem_conditional','stem_concessive',
                          'stem_causative','stem_hortative','stem_oddu'):
                stems[field]=surface
        return stems

    def _build_non_core_stem_index(self):
        """Large dictionaries are kept as exact sets, not expanded indexes.

        Earlier seed versions expanded every dictionary word into every possible
        productive stem alias. That is fine for a tiny seed list but not for a
        full dictionary. Full-dictionary parsing now computes the few possible
        lemma/base candidates lazily in dictionary_bases_for_stem().
        """
        return None

    def dictionary_bases_for_stem(self, value, field=None):
        """Return dictionary bases compatible with a recovered stem value.

        This is a dictionary gate, not a guesser. Candidate bases are only
        returned when the candidate itself exists in the full dictionary.
        """
        value=nfc(value)
        candidates=[]

        def add(surface, pos):
            surface=nfc(surface)
            if surface and surface in self.non_core_lexicon:
                candidates.append((surface,pos))

        # Direct exact stem/base.
        add(value,'noun'); add(value,'verb')

        # Productive noun stem inversions matching _non_core_stem_fields_for_base.
        # Common neuter -ం nouns: మంచం -> మంచాని before dative, మంచాన్ before accusative.
        if field in (None,'stem_dative') and value.endswith('ాని') and len(value)>3:
            add(value[:-3]+'ం','noun')
            if value[:-3].endswith('మ'):
                add(value[:-4]+'ము','noun')
        if field in (None,'stem_accusative') and value.endswith('ాన్') and len(value)>3:
            add(value[:-3]+'ం','noun')
            if value[:-3].endswith('మ'):
                add(value[:-4]+'ము','noun')
        if field in (None,'stem_plural','stem_locative','stem_ablative','stem_instrumental') and value.endswith('ా') and len(value)>1:
            add(value[:-1]+'ం','noun')
            if value[:-1].endswith('మ'):
                add(value[:-2]+'ము','noun')
        # Invert -ి noun plural stem: చరరాశులు -> stem చరరాశు -> lemma చరరాశి.
        if field in (None,'stem_plural') and value.endswith('ు') and len(value)>1:
            add(value[:-1]+'ి','noun')

        # Do not invent arbitrary verb roots. For verb-like dictionary entries
        # the surface/stem itself must already be listed.
        seen=set(); out=[]
        for item in candidates:
            if item not in seen:
                seen.add(item); out.append(item)
        return out


    def start(self, base, form=None):
        if isinstance(base,str) and (base.startswith('non_core_') or base.startswith('dictionary_non_core_base_')) and ':' in base:
            if base.startswith('dictionary_non_core_base_'):
                pos,surface0=base[len('dictionary_non_core_base_'):].split(':',1)
            else:
                pos,surface0=base[len('non_core_'):].split(':',1)
            if form is not None and form != surface0:
                raise GrammarError('unregistered_base_form')
            return self.virtual_start(surface0,pos)
        if base not in self.bases:
            matches=[k for k,v in self.bases.items() if base in v['forms']]
            if len(matches)!=1:raise GrammarError('unknown_or_ambiguous_base',{'base':base,'candidates':matches})
            base=matches[0]
        b=self.bases[base]; surface=form if form is not None else one(b,'forms')
        if surface not in b['forms']:raise GrammarError('unregistered_base_form')
        fs=features(b['features'])
        fs.setdefault('base_type','core_base')
        return {'root':base,'head':base,'surface':surface,'classes':b['classes'][:], 'features':fs,
                'stems':{k:one(b,k) for k in b if k.startswith(('stem_','form_','realized_'))},
                'profile':None,'stem_owner':base,'scope':0,'owners':[(base,0)],'chain':[],
                'operator_expression':{'predicate':base},
                'tree':{'kind':'base','object':base,'surface':surface,'features':fs.copy(),'scope':0},'trace':[]}

    def is_non_core_stem_candidate(self, text):
        """Dictionary-gated virtual base gate.

        A non-core base must be present in lexicon.json when require_dictionary
        is enabled. This keeps arbitrary Telugu-looking strings from being
        accepted as lexical bases.
        """
        text=nfc(text)
        if not self.allow_non_core_bases or not text or ' ' in text:
            return False
        for c in text:
            if c in '\u200c\u200d':
                return False
            if not 0x0c00 <= ord(c) <= 0x0c7f:
                return False
        if not any('\u0c05' <= c <= '\u0c39' or '\u0c58' <= c <= '\u0c5a' for c in text):
            return False
        if self.require_non_core_dictionary:
            return text in self.non_core_lexicon
        return True

    def non_core_stems(self, surface, pos):
        """Stem aliases for dictionary non-core bases."""
        return self._non_core_stem_fields_for_base(surface, pos)

    def virtual_start(self, surface, pos):
        if not self.is_non_core_stem_candidate(surface):
            raise GrammarError('invalid_non_core_stem', {'surface': surface})
        base_type='dictionary_non_core_base' if surface in self.non_core_lexicon else 'non_core_base'
        lexical_status='dictionary' if surface in self.non_core_lexicon else 'detected'
        if pos=='verb':
            classes=['verb']; fs={'pos':'verb','base_type':base_type,'lexical_status':lexical_status}
        elif pos=='human_nominal':
            classes=['proper_noun','human_nominal']; fs={'pos':'proper_noun','animacy':'human','number':'singular','base_type':base_type,'lexical_status':lexical_status}
        else:
            classes=['noun']; fs={'pos':'noun','number':'singular','animacy':'unknown','base_type':base_type,'lexical_status':lexical_status}
        root=base_type+'_'+pos+':'+surface
        stems=self.non_core_stems(surface, 'verb' if pos=='verb' else 'noun')
        return {'root':root,'head':root,'surface':surface,'classes':classes, 'features':fs,
                'stems':stems,'profile':None,'stem_owner':root,'scope':0,'owners':[(root,0)],'chain':[],
                'operator_expression':{'predicate':root,'detected_stem':surface,'base_type':base_type},
                'tree':{'kind':'base','object':root,'surface':surface,'features':fs.copy(),'scope':0,
                        'base_type':base_type,'detected_stem':surface},'trace':[]}

    def virtual_candidates(self, word, next_mid=None):
        """Return virtual non-core base states compatible with the next modifier."""
        if not self.is_non_core_stem_candidate(word):
            return []
        if next_mid is None and not self.allow_non_core_standalone:
            return []
        candidates=[]
        # Try the main receiver interfaces. Compatibility filtering happens below.
        for pos in ('noun','human_nominal','verb'):
            try:
                s=self.virtual_start(word,pos)
            except GrammarError:
                continue
            if next_mid is None or self.allowed(s,next_mid):
                candidates.append(s)
        return candidates

    def condition(self, c,s,req):
        k,sep,v=c.partition('=')
        if not sep:raise GrammarError('bad_condition',{'condition':c})
        if k=='surface_ends':return s['surface'].endswith(v)
        if k=='head':return s['head']==v
        if k=='stem_owner':return s['stem_owner']==v
        if k=='ancestor':return any(oid==v and scope==s['scope'] for oid,scope in s['owners'])
        if k.startswith('requested.'):return req.get(k[10:])==v
        return s['features'].get(k)==v

    def match(self,selector,oid,classes):
        kind,value=selector.split(':',1)
        return (kind=='object' and value==oid) or (kind=='class' and value in self.closure(classes))

    def targets(self, mid):
        m=self.objects[mid]; sels=m['can_modify'][:]
        for c in self.closure(m['classes']):sels+=self.classes[c]['can_modify']
        return sels

    def allowed(self,s,mid):
        m=self.objects[mid]
        sels=self.objects[s['head']]['can_be_modified_by'][:] if s['head'] in self.objects else []
        for c in self.closure(s['classes']):sels+=self.classes[c]['can_be_modified_by']
        return any(self.match(x,mid,m['classes']) for x in sels) and any(self.match(x,s['head'],s['classes']) for x in self.targets(mid))

    def resolve(self,s,mid,req):
        candidates=[]
        for owner,scope_id in s['owners']:
            if scope_id!=s['scope'] or owner not in self.objects:continue
            for ref in self.objects[owner]['incoming_overrides']:
                name=ref.split(':',1)[1];ov=self.overrides[name]
                if ov['incoming']!=['object:'+mid]:continue
                scope=one(ov,'scope')
                if scope=='self' and (s['chain'] or s['head']!=owner):continue
                if scope=='head' and s['head']!=owner:continue
                if not all(self.condition(c,s,req) for c in ov['when']):continue
                candidates.append(((int(one(ov,'priority')),len(ov['when'])),name,ov))
        if not candidates:return None
        rank=max(c[0] for c in candidates);winners=[c for c in candidates if c[0]==rank]
        decisions={(one(c[2],'action'),tuple(c[2]['replacement_rule'])) for c in winners}
        if len(decisions)>1:raise GrammarError('override_conflict',{'overrides':[x[1] for x in winners]})
        return winners[0][1:]

    def apply(self,s,mid,request=None,depth=0):
        req=request or {}
        if depth>128:raise GrammarError('expansion_depth')
        if mid not in self.objects:raise GrammarError('unknown_modifier',{'modifier':mid})
        m=self.objects[mid]
        if m['kind']!=['modifier']:raise GrammarError('not_a_modifier',{'object':mid})
        ov=self.resolve(s,mid,req);action=one(ov[1],'action') if ov else None
        if action=='forbid':raise GrammarError('forbidden',{'override':ov[0]})
        if action!='allow' and not self.allowed(s,mid):raise GrammarError('incompatible',{'head':s['head'],'modifier':mid})
        if m.get('expands_to') and action!='replace_rule':
            result=s
            for child in m['expands_to']:result=self.apply(result,child.split(':',1)[1],req,depth+1)
            result=result.copy();result['owners']=result['owners']+[(mid,result['scope'])]
            # The executable proof is always the expanded atomic chain.
            return result
        ref=one(ov[1],'replacement_rule') if action=='replace_rule' else one(m,'application_rules')
        if not ref:raise GrammarError('unresolved_realization',{'modifier':mid})
        rid=ref.split(':',1)[1];r=self.rules[rid]
        if r.get('receiver_classes_any') and not set(r['receiver_classes_any'])&self.closure(s['classes']):raise GrammarError('unsatisfied_receiver_class')
        for requirement in r['requires']:
            if requirement.startswith('root_has:') and requirement.split(':',1)[1] not in s['stems']:raise GrammarError('unresolved_realization',{'missing_stem':requirement.split(':',1)[1]})
            if requirement.startswith('feature:') and not self.condition(requirement.split(':',1)[1],s,req):raise GrammarError('unsatisfied_feature')
            if requirement.startswith('surface_ends:') and not s['surface'].endswith(requirement.split(':',1)[1]):raise GrammarError('unresolved_realization')
            if requirement=='registered_realization_for_this_receiver_and_modifier':raise GrammarError('unresolved_realization',{'modifier':mid})
        op=one(r,'operation');suffix=one(r,'append');before=s['surface'];surface=before
        stems=s['stems'];profile=s['profile'];stem_owner=s['stem_owner'];scope=s['scope']
        def stem(field):
            if field not in stems:raise GrammarError('unresolved_realization',{'missing_stem':field,'owner':stem_owner})
            return stems[field]
        if op=='select_stem_append':surface=stem(one(r,'stem_field'))+suffix
        elif op=='append':surface+=suffix
        elif op=='prepend_phrase':surface=one(r,'prefix')+' '+surface
        elif op=='identity':pass
        elif op in ('lexical_form','whole_token_lookup'):
            if r.get('receiver_stem_field') and before!=stem(one(r,'receiver_stem_field')):
                raise GrammarError('unresolved_realization',{'receiver_stem':'does_not_match'})
            surface=stem(one(r,'field'))
        elif op=='strip_final_u_append':
            if not surface.endswith('ు'):raise GrammarError('unresolved_realization')
            surface=surface[:-1]+suffix
        elif op=='rewrite_tail_append':
            tail=one(r,'tail')
            if not tail or not surface.endswith(tail):raise GrammarError('unresolved_realization')
            surface=surface[:-len(tail)]+one(r,'replacement')+suffix
        elif op=='lengthen_final_vowel':
            sign=one(r,'vowel')
            if surface and surface[-1] in self.VOWELS:surface=surface[:-1]+sign
            elif surface.endswith('ం'):surface=surface[:-1]+'మ'+sign
            elif surface and '\u0c15'<=surface[-1]<='\u0c39':surface+=sign
            else:raise GrammarError('unresolved_realization')
            if surface==before:
                # Intonation may turn a word into a question, but unchanged
                # text supplies no evidence of a written extra modifier.
                # Explicit semantic identity refinements are handled separately.
                raise GrammarError('no_overt_modifier_evidence')
        elif op in ('derive_profile','attach_profile','embed_profile'):
            prefix=stem(one(r,'stem_field')) if op=='derive_profile' else surface
            if op=='embed_profile':
                if not prefix or prefix[-1] not in r['drop_vowels']:raise GrammarError('unresolved_realization',{'boundary':'unregistered_complement_join'})
                prefix=prefix[:-1]
            prefix+=one(r,'joiner');profile=one(r,'profile');p=self.profiles[profile]
            surface=prefix+p['citation'];stems={k:prefix+v for k,v in p.items() if k!='citation'};stem_owner=mid
        elif op=='compound_join':
            right_id=one(r,'lexical_object').split(':',1)[1]
            right=self.bases[right_id]
            allowed=self.objects[s['head']].get('compound_junctions',[])
            try:surface,boundary=compound_join(before,one(right,'forms'),self.model['compound_boundaries'],allowed)
            except ValueError:raise GrammarError('unresolved_realization',{'boundary':'unregistered_compound_boundary'})
            # The right lexical head supplies the next receiver interface; old
            # nominal stems/features must not leak across the compound boundary.
            stems={};profile=None;stem_owner=mid
        elif op=='contextual_realization':raise GrammarError('unresolved_realization',{'modifier':mid})
        else:raise GrammarError('unimplemented_operation',{'operation':op})
        local=features(r['set_features'])
        new_scope=one(r,'feature_mode')=='new_scope'
        fs=features(right['features']) if op=='compound_join' else {} if new_scope else s['features'].copy()
        if new_scope:scope+=1
        for k,v in features(r.get('default_features',[])).items():fs.setdefault(k,v)
        fs.update(local)
        expression=s['operator_expression']
        for operator in r.get('semantic_operators',[]):
            expression={'operator':operator,'operand':expression,'scope':scope,'introduced_by':mid}
        classes=s['classes'][:] if one(r,'result_classes_mode')=='preserve' else r['result_classes'][:]
        surface=nfc(surface)
        record={'modifier':mid,'rule':rid,'override':ov[0] if ov else None,'request':dict(req),
                'input':before,'output':surface,'edit':delta(before,surface),'local_features':local,
                'scope':scope,'stem_owner':stem_owner,'semantic_operators':r.get('semantic_operators',[])}
        tree={'kind':'application','receiver':s['tree'],'modifier':mid,'rule':rid,
              'override':record['override'],'surface':surface,'features':fs.copy(),
              'local_features':local,'scope':scope,'operator_expression':expression,'receiver_role':one(r,'receiver_role','modified_object')}
        if op=='compound_join':
            tree['lexical_right']=self.start(right_id)['tree']
            tree['boundary_rule']=boundary
            record['lexical_right']=right_id
            record['boundary_rule']=boundary
        return {'root':s['root'],'head':mid,'surface':surface,'classes':classes,'features':fs,
                'stems':stems,'profile':profile,'stem_owner':stem_owner,'scope':scope,
                'owners':s['owners']+[(mid,scope)],'chain':s['chain']+[mid],
                'tree':tree,'operator_expression':expression,'trace':s['trace']+[record]}

    def generate(self,base,chain,request=None):
        state=self.start(base)
        for item in chain:
            if isinstance(item,dict):mid=item['modifier'];req=item.get('request',request or {})
            else:mid=item;req=request or {}
            state=self.apply(state,mid,req)
        return self.result(state)

    def result(self,s,tree=True):
        base_type=s['features'].get('base_type','core_base' if s['root'] in self.bases else 'non_core_base')
        out={'status':'accepted_by_model','surface':s['surface'],'base':s['root'],
             'base_type':base_type,
             'detected_stem':s['root'].split(':',1)[1] if base_type in ('non_core_base','dictionary_non_core_base') and ':' in s['root'] else None,
             'chain':s['chain'],'classes':s['classes'],'active_features':s['features'],
             'operator_expression':s['operator_expression'],'semantic_coverage':'registered_operators_only',
             'trace':s['trace'],'unicode_codepoints':codes(s['surface']),
             'intermediate_stem':bool(self.closure(s['classes'])&{'tam_stem','auxiliary_predicate_stem'})}
        if tree:out['tree']=s['tree']
        return out

    def reverse_stem(self,value,field,receiver_field=None):
        emitted=False
        for bid in self.registered_stem_index.get((field,value),()):
            b=self.bases[bid];emitted=True
            if receiver_field:
                if b.get(receiver_field):yield one(b,receiver_field),None,None
            else:
                for form in b['forms']:yield form,None,bid
        for pid,p in self.profiles.items():
            if field not in p:continue
            if receiver_field and receiver_field not in p:continue
            tail=p[field]
            if not tail or value.endswith(tail):
                emitted=True
                prefix=value[:-len(tail)] if tail else value
                yield prefix+p[receiver_field if receiver_field else 'citation'],pid,None
        # Dictionary non-core support: if a recovered stem field corresponds to
        # a dictionary lemma, return that lemma's surface form to the parser.
        # This prevents suffix-bearing words from being swallowed as whole
        # unknown bases while still permitting productive rules.
        if receiver_field is None and field.startswith('stem_') and field != 'stem_genitive':
            for surface,pos in self.dictionary_bases_for_stem(value, field):
                yield surface,None,None

    def inverses(self,surface,r):
        op=one(r,'operation');suffix=one(r,'append')
        def strip(text,tail):return text[:-len(tail)] if tail and text.endswith(tail) else text if not tail else None
        if op in ('select_stem_append','lexical_form','whole_token_lookup'):
            raw=strip(surface,suffix if op=='select_stem_append' else '')
            if raw is not None:yield from self.reverse_stem(raw,one(r,'stem_field') if op=='select_stem_append' else one(r,'field'),one(r,'receiver_stem_field',None))
        elif op=='append':
            raw=strip(surface,suffix)
            if raw is not None:yield raw,None,None
        elif op=='prepend_phrase':
            prefix=one(r,'prefix')+' '
            if surface.startswith(prefix):yield surface[len(prefix):],None,None
        elif op=='strip_final_u_append':
            raw=strip(surface,suffix)
            if raw is not None:yield raw+'ు',None,None
        elif op=='rewrite_tail_append':
            raw=strip(surface,one(r,'replacement')+suffix)
            if raw is not None:yield raw+one(r,'tail'),None,None
        elif op=='compound_join':
            right=self.bases[one(r,'lexical_object').split(':',1)[1]]
            for before,boundary in compound_split(surface,one(right,'forms'),self.model['compound_boundaries']):
                yield before,None,None
        elif op=='lengthen_final_vowel':
            vowel=one(r,'vowel')
            if surface.endswith(vowel):
                raw=surface[:-len(vowel)]
                yield raw,None,None
                for v in sorted(self.VOWELS):yield raw+v,None,None
                if raw.endswith('మ'):yield raw[:-1]+'ం',None,None
        elif op in ('derive_profile','attach_profile','embed_profile'):
            raw=strip(surface,self.profiles[one(r,'profile')]['citation'])
            if raw is None:return
            raw=strip(raw,one(r,'joiner'))
            if raw is None:return
            if op=='derive_profile':yield from self.reverse_stem(raw,one(r,'stem_field'))
            elif op=='embed_profile':
                for vowel in r['drop_vowels']:yield raw+vowel,None,None
            else:yield raw,None,None

    def unicode_check(self,text):
        if not text:return {'status':'rejected_input','reason':'empty_input'}
        for i,c in enumerate(text):
            if c==' ' or c in '\u200c\u200d':continue
            if not 0x0c00<=ord(c)<=0x0c7f:
                return {'status':'outside_supported_unicode','index':i,'codepoint':codes(c)[0]}
        # Do not confuse a block-membership test with complete orthographic validation.
        return {'status':'within_telugu_input_domain','normalization':'NFC',
                'orthographic_validity':'not_inferred_from_block_membership'}

    def analyze(self,text,max_depth=24,max_states=20000,max_analyses=64,include_tree=True):
        original=text;text=nfc(text);uc=self.unicode_check(text)
        if uc['status']!='within_telugu_input_domain':return {'status':'unknown','unicode':uc,'analyses':[]}
        cache={};active=set();cutoffs=set();visited=0
        # Results are atomic proofs. Macro aliases do not multiply the same derivation.
        def key_state(s):return (s['root'],tuple((t['modifier'],t['rule'],tuple(sorted(t['request'].items()))) for t in s['trace']))
        def fits(s,next_mid,profile,base):
            if base is not None and (s['root']!=base or s['chain']):return False
            if profile is not None and s['profile']!=profile:return False
            if next_mid is not None and not self.allowed(s,next_mid):
                # A receiver-owned allow override can override default attachment permissions.
                ov=self.resolve(s,next_mid,{})
                if not ov or one(ov[1],'action')!='allow':return False
            return True
        @functools.lru_cache(maxsize=None)
        def eligible_entries(next_mid,profile):
            # Attachment/profile filtering is invariant across input substrings.
            # Keep every explicit receiver-owned allow exception.
            found=[]
            for mid,rid,req in self.surface_entries:
                r=self.rules[rid]
                if (mid,next_mid) in self.unconditional_forbid_pairs:continue
                if next_mid is not None and one(r,'result_classes_mode')!='preserve' and not any(self.match(x,mid,r['result_classes']) for x in self.targets(next_mid)):
                    if (mid,next_mid) not in self.allow_pairs:continue
                if profile is not None and one(r,'operation') in ('derive_profile','attach_profile','embed_profile') and one(r,'profile')!=profile:continue
                found.append((mid,rid,req))
            return found
        def parse(word,depth,next_mid=None,profile=None,base=None):
            nonlocal visited
            key=(word,depth,next_mid,profile,base)
            if key in cache:return cache[key]
            if not word:return []
            if depth<0:cutoffs.add('max_depth');return []
            if visited>=max_states:cutoffs.add('max_states');return []
            cycle=(word,next_mid,profile,base)
            if cycle in active:cutoffs.add('cycle_guard');return []
            active.add(cycle);visited+=1;out=[];seen=set()
            def add(s):
                k=key_state(s)
                if k in seen:return
                if len(out)>=max_analyses:cutoffs.add('max_analyses');return
                seen.add(k);out.append(s)
            found_registered_base=False
            for bid in self.base_form_index.get(word,()):
                found_registered_base=True
                s=self.start(bid,word)
                if fits(s,next_mid,profile,base):add(s)
            # End-first parsing: try to prove visible modifier chains before
            # accepting a dictionary word as a standalone non-core base. This
            # prevents full-form dictionary entries from swallowing suffixes.
            if base is None:
                for mid,rid,req in eligible_entries(next_mid,profile):
                    r=self.rules[rid]
                    for before,pid,bid in self.inverses(word,r):
                        if len(before)>len(text)+24:cutoffs.add('inverse_length_bound');continue
                        for inner in parse(before,depth-1,mid,pid,bid):
                            try:s=self.apply(inner,mid,req)
                            except GrammarError:continue
                            if s['surface']==word and s['trace'][-1]['rule']==rid and fits(s,next_mid,profile,base):add(s)
            # Only after modifier-chain proofs are attempted do we accept an
            # exact dictionary non-core word as a standalone base.
            if base is None and profile is None and not found_registered_base:
                for s in self.virtual_candidates(word,next_mid):
                    if fits(s,next_mid,profile,base):add(s)
            # Finite zero-surface interpretations are enumerated and independently verified.
            cursor=0
            while cursor<len(out):
                s=out[cursor];cursor+=1
                for mid,rid,req in self.zero_entries:
                    if len(s['chain'])>=max_depth:continue
                    try:z=self.apply(s,mid,req)
                    except GrammarError:continue
                    if z['surface']==word and fits(z,next_mid,profile,base):add(z)
            active.remove(cycle);cache[key]=out;return out
        states=parse(text,max_depth)
        terminal={'base_word','nominal','inflected_nominal','finite_predicate','nonfinite','relative_participle',
                  'clitic_host','adjective','adverb','determiner','numeral','conjunction','postposition','particle','interjection','derived_verb'}
        states=[s for s in states if self.closure(s['classes'])&terminal]
        def non_core_has_overt_grammar(s):
            if s['root'] in self.bases:
                return True
            if s['features'].get('base_type')=='dictionary_non_core_base' and self.allow_non_core_standalone and not s['chain']:
                return True
            return any(t['edit']['removed'] or t['edit']['inserted'] for t in s['trace'])
        states=[s for s in states if non_core_has_overt_grammar(s)]
        return {'status':'accepted_by_model' if states else 'unknown','input':original,'normalized':text,
                'unicode':uc,'ambiguous':len(states)>1,'analyses':[self.result(s,include_tree) for s in states],
                'search':{'visited_states':visited,'max_depth':max_depth,'max_states':max_states,
                          'max_analyses':max_analyses,'cutoffs':sorted(cutoffs),
                          'complete_within_executable_rules':not cutoffs},
                'language_coverage':'bounded_lexicon_and_registered_rules',
                'unresolved_catalogue_rules_present':any(one(r,'operation')=='contextual_realization' for r in self.rules.values())}

    def describe(self,identifier=None):
        if identifier is None:
            return {'format':self.model['format'],'version':self.model['version'],'coverage':self.model['coverage'],
                    'counts':{'bases':len(self.bases),'objects':len(self.objects),'rules':len(self.rules),'overrides':len(self.overrides)},
                    'sources':self.model['sources'],'commands':['analyze','generate','describe','unicode','examples','selftest','source']}
        if identifier.startswith('profiles.'):
            name=identifier.split('.',1)[1]
            if name not in self.profiles:raise GrammarError('unknown_profile',{'profile':name})
            return {'id':identifier,'prefix_rule':'each value is appended to the explicitly selected receiver prefix',
                    'forms':{k:{'text':v,'codepoints':codes(v)} for k,v in self.profiles[name].items()}}
        key=identifier if identifier in self.d else 'objects.'+identifier
        if key not in self.d:raise GrammarError('unknown_identifier',{'identifier':identifier})
        entry=self.d[key]
        return {'id':key,'definition':entry,'forms_unicode':[{'form':v,'codepoints':codes(v)} for v in entry.get('forms',[])],
                'rules':{r:self.rules[r.split(':',1)[1]] for r in entry.get('application_rules',[])},
                'passed_overrides':{o:self.overrides[o.split(':',1)[1]] for o in entry.get('incoming_overrides',[])}}

    def selftest(self,reverse=False):
        passed=[]
        for key,case in self.d.items():
            if not key.startswith('applications.'):continue
            try:
                out=self.generate(one(case,'receiver').split(':',1)[1],[m.split(':',1)[1] for m in case['modifiers']],features(case['requested']))
                assert not case['expected_failure'],key
                assert out['surface'] in case['expected_forms'],(key,out['surface'],case['expected_forms'])
                for k,v in features(case.get('expected_features',[])).items():assert out['active_features'].get(k)==v,(key,k,out['active_features'])
                assert not set(case.get('absent_features',[]))&set(out['active_features']),key
            except GrammarError as e:assert e.code in case['expected_failure'],(key,e.code,e.detail)
            passed.append(key)
        for word,base,chain,req in self.model['examples']:
            out=self.generate(base,chain,req)
            assert out['surface']==word,(word,out['surface'])
            for step in out['trace']:
                edit=step['edit'];replayed=step['input'][:edit['start']]+edit['inserted']+step['input'][edit['end']:]
                assert replayed==step['output'],step
            if reverse:
                back=self.analyze(word,include_tree=False)
                assert any(a['base']==base and a['chain']==out['chain'] for a in back['analyses']),(word,'missing reverse proof',back['search'])
            passed.append(word)
        # Inner negation and past tense must not leak into the outer thinking predicate.
        for index,embedded_key,embedded_value in [(1,'modality','obligation'),(7,'tam','negative_past'),(8,'modality','prohibition')]:
            word,base,chain,req=self.model['examples'][index];out=self.generate(base,chain,req)
            assert out['active_features']['polarity']=='affirmative'
            assert 'modality' not in out['active_features']
            node=out['tree']
            while node.get('modifier')!='mod_think':node=node['receiver']
            assert node['receiver']['features'][embedded_key]==embedded_value
            assert node['scope']>node['receiver']['scope']
            passed.append('feature_scope_'+str(index))
        for chain in [['mod_self_benefactive','mod_causative'],['mod_self_benefactive','mod_self_benefactive']]:
            try:self.generate('verb_cheyu',chain)
            except GrammarError as e:assert e.code=='forbidden'
            else:raise AssertionError('receiver override failed to prohibit '+str(chain))
            passed.append('override_'+chain[-1])
        past=self.generate('verb_cheyu',['mod_causative','mod_past','agr_third_feminine_or_neuter_singular_plain'])
        assert past['surface']=='చేయించింది',past['surface']
        assert past['trace'][-1]['override']=='mod_causative_past_fn'
        passed.append('derived_stem_owner_beats_original_lexeme')
        noun=self.generate('verb_gurtupettu',['mod_self_benefactive','mod_inability_converb','mod_aux_poo','mod_relative_past','mod_relative_human_plural','mod_dative'])
        assert noun['surface']=='గుర్తుపెట్టుకోలేకపోయినవాళ్లకు'
        passed.append('case_after_relative_nominalization')
        if reverse:
            ambiguity=self.analyze('చేయలేదు',include_tree=False)
            chains=[a['chain'] for a in ambiguity['analyses']]
            assert ['mod_negative_past'] in chains
            assert ['mod_inability','agr_third_feminine_or_neuter_singular_plain'] in chains
            assert ambiguity['ambiguous']
            passed.append('negative_past_and_inability_ambiguity')
            assert self.analyze('అజ్ఞాతపదరూపం',include_tree=False)['status']=='unknown'
            passed.append('unregistered_form_remains_unknown')
            limited=self.analyze(self.model['examples'][0][0],max_states=1,include_tree=False)
            assert not limited['search']['complete_within_executable_rules']
            passed.append('search_limit_is_reported')
        for slot,word in [
            ('first_singular','చేయించుకోలేకపోతున్నాను'),('first_plural','చేయించుకోలేకపోతున్నాము'),
            ('second_singular_plain','చేయించుకోలేకపోతున్నావు'),('second_plural_or_honorific','చేయించుకోలేకపోతున్నారు'),
            ('third_masculine_singular_plain','చేయించుకోలేకపోతున్నాడు'),
            ('third_feminine_or_neuter_singular_plain','చేయించుకోలేకపోతున్నది'),
            ('third_human_plural_or_honorific','చేయించుకోలేకపోతున్నారు'),('third_nonhuman_plural','చేయించుకోలేకపోతున్నాయి')]:
            out=self.generate('verb_cheyu',['mod_causative','mod_self_benefactive','mod_ongoing_inability_poo','agr_'+slot])
            assert out['surface']==word
            if reverse:
                back=self.analyze(word,include_tree=False)
                assert any(a['chain']==out['chain'] for a in back['analyses']),slot
            passed.append('nested_agreement_'+slot)
        for base,chain,word in [
            ('verb_cheyu',['mod_causative','mod_self_benefactive','mod_obligation'],'చేయించుకోవాలి'),
            ('verb_cheyu',['mod_causative','mod_self_benefactive','mod_verbal_noun'],'చేయించుకోవడం'),
            ('verb_cheyu',['mod_inability_converb','mod_aux_poo','mod_past','agr_third_human_plural_or_honorific'],'చేయలేకపోయారు'),
            ('verb_matlaadu',['mod_past','agr_third_feminine_or_neuter_singular_plain'],'మాట్లాడింది'),
            ('verb_konu',['mod_self_benefactive','mod_obligation'],'కొనుక్కోవాలి'),
            ('verb_teesukuraa',['mod_obligation'],'తీసుకురావాలి')]:
            out=self.generate(base,chain);assert out['surface']==word,(word,out['surface'])
            if reverse:
                back=self.analyze(word,include_tree=False)
                assert any(a['base']==base and a['chain']==out['chain'] for a in back['analyses']),(word,back['search'])
            passed.append('derived_paradigm_'+word)
        return {'status':'passed','cases':len(passed),'reverse_stress_tests':reverse,'checks':passed}

def main():
    parser=argparse.ArgumentParser(description='Recursive Telugu object grammar. Unknown is not invalid.')
    sub=parser.add_subparsers(dest='command')
    a=sub.add_parser('analyze');a.add_argument('text');a.add_argument('--max-depth',type=int,default=24)
    a.add_argument('--max-states',type=int,default=20000);a.add_argument('--max-analyses',type=int,default=64);a.add_argument('--no-tree',action='store_true')
    g=sub.add_parser('generate');g.add_argument('base');g.add_argument('modifiers',nargs='*');g.add_argument('--request',default='{}',help='JSON feature requests, e.g. {"variant":"contracted"}')
    d=sub.add_parser('describe');d.add_argument('identifier',nargs='?')
    sub.add_parser('unicode');sub.add_parser('examples');sub.add_parser('source')
    t=sub.add_parser('selftest');t.add_argument('--reverse',action='store_true')
    args=parser.parse_args();engine=Engine()
    try:
        if args.command=='analyze':
            if min(args.max_depth,args.max_states,args.max_analyses)<1:parser.error('search limits must be positive')
            out=engine.analyze(args.text,args.max_depth,args.max_states,args.max_analyses,not args.no_tree)
        elif args.command=='generate':
            req=json.loads(args.request)
            if not isinstance(req,dict):parser.error('--request must be a JSON object')
            out=engine.generate(args.base,args.modifiers,req)
        elif args.command=='describe':out=engine.describe(args.identifier)
        elif args.command=='unicode':out=engine.model['unicode']
        elif args.command=='examples':out=[{'word':w,'base':b,'chain':c,'request':r} for w,b,c,r in engine.model['examples']]
        elif args.command=='selftest':out=engine.selftest(args.reverse)
        elif args.command=='source':
            print(Path(__file__).read_text(encoding="utf-8"));return
        else:out=engine.describe()
    except GrammarError as e:
        out={'status':'unknown' if e.code in ('unresolved_realization','unknown_modifier','unknown_or_ambiguous_base') else 'rejected_by_model',
             'reason':e.code,'detail':e.detail}
    print(json.dumps(out,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
