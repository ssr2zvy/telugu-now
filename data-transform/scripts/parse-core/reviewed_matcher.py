"""Conservative curriculum matching over the parser's complete analysis lattice.

Raw Unicode retrieval proposes candidates. This adapter proves exact catalogue
scope or one reviewed spelling group, or uses a separately audited occurrence.
It never treats a raw hit, chain prefix, or likely contextual guess as credit.
"""
from collections import defaultdict
import hashlib
import json

ALLOWED_SHARED={'plural_vs_honorific_reference','feminine_vs_neuter','inclusive_vs_exclusive'}


def encode(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))


def fingerprint(records):
    return hashlib.sha256(encode(sorted(records,key=encode)).encode()).hexdigest()


class ReviewedMatcher:
    def __init__(self, parser, graph, tokenizer, reviews=()):
        self.parser=parser;self.graph=graph;self.tokenizer=tokenizer
        self.alias=graph['original_to_selectable'];self.nodes=graph['nodes']
        self.forms=defaultdict(set);self.spellings=defaultdict(set);self.trie={}
        self.cache={}
        self.reviews={(r['observation_id'],r['start_cp'],r['end_cp']):r for r in reviews}
        for surface,records in parser.index.items():
            for record in records:
                tid='CHAIN:'+','.join(record['chain'])
                if record['chain'] and tid in self.alias:self.forms[surface].add(self.alias[tid])
        for tid,node in self.nodes.items():
            if node['kind']=='vocabulary':
                for surface in node['forms']:self.forms[surface].add(tid)
        for form,targets in self.forms.items():
            parts=list(tokenizer.token_spans(form))
            if not parts or any(t[3] is None for t in parts):continue
            if parts[0][0]!=0 or parts[-1][1]!=len(form):continue
            if any(not form[a[1]:b[0]].isspace() for a,b in zip(parts,parts[1:])):continue
            norm=' '.join(t[3] for t in parts);self.spellings[norm].add(form)
            node=self.trie
            for part in parts:node=node.setdefault(part[3],{})
            node.setdefault(None,set()).update(targets)

    def decision(self,surface,tid):
        key=surface,tid
        if key in self.cache:return self.cache[key]
        spellings=sorted(self.spellings.get(surface,{surface}))
        records=[r for s in spellings for r in self.parser.index.get(s,[])]
        issues={i for r in records for i in self.parser.unresolved_dimensions(r)}
        represented={self.alias.get('CHAIN:'+','.join(r['chain']),'OUTSIDE:'+','.join(r['chain'])) for r in records}
        if self.nodes[tid]['kind']=='vocabulary':
            meanings={self.alias.get('VOC:'+m['id'],'VOC:'+m['id'])
                for s in spellings for m in self.parser.vocabulary_forms.get(s,[])}
            checks=[self.parser.analyze(s) for s in spellings if self.parser.index.get(s)]
            resolved=bool(checks) and all(c['eligible_in_model'] or c['learning']['eligible'] for c in checks)
            # A complete reviewed spelling group may disambiguate the learning
            # target without claiming to resolve its semantic reference.
            resolved=resolved or (len(represented)==1 and next(iter(represented)) in self.nodes)
            accepted=bool(records) and meanings=={tid} and resolved and not (issues-ALLOWED_SHARED)
            reason='exact_catalogue_form' if accepted else 'unresolved_vocabulary_analysis'
        else:
            accepted=bool(records) and represented=={tid} and not (issues-ALLOWED_SHARED)
            reason=('reviewed_shared_spelling' if self.nodes[tid].get('combined') else 'complete_path_consensus') if accepted else 'competing_or_unresolved_paths'
        proof=dict(accepted=accepted,reason=reason,target_id=tid,surface=surface,
            candidate_fingerprint=fingerprint(records),represented_targets=sorted(represented),
            retained_reference_alternatives=sorted(issues&ALLOWED_SHARED),
            unresolved_dimensions=sorted(issues-ALLOWED_SHARED),
            analyses=[dict(base_id=r['base_id'],ordered_components=r['chain'],features=r['features']) for r in records],
            confidence_scope='within the registered grammar and explicit curriculum; not absolute linguistic certainty')
        self.cache[key]=proof
        return proof

    def occurrence_decision(self,surface,tid,observation_id,text,start,end):
        proof=self.decision(surface,tid)
        review=self.reviews.get((observation_id,start,end))
        if review is None:return proof
        # Fail closed if the corpus text, original token span or candidate
        # lattice changes after review. Never reuse a surface-only decision.
        matches=(review['text']==text and review['surface']==surface and
                 review['candidate_fingerprint']==proof['candidate_fingerprint'])
        if not matches:
            return dict(proof,accepted=False,reason='stale_context_review',review_id=review['review_id'])
        chosen=review['chosen_canonical_target']
        if chosen is None:
            return dict(proof,accepted=False,reason='manually_reviewed_still_unresolved',review_id=review['review_id'])
        if self.nodes[tid]['kind']=='vocabulary':
            # This existing catalogue entry explicitly lists ఉండేవారు. A
            # context-reviewed finite "were/used to be" reading can qualify it;
            # the human-relative "people who stay" reading must not. This is
            # not credit to an unlisted bare ఉండు/ఎక్కడ base through inflection.
            if tid=='VOC:meaning_was_were' and surface=='ఉండేవారు':
                finite=chosen=='CHAIN:mod_relative_nonpast,mod_habitual_human'
                return dict(proof,accepted=finite,reason='manual_context_review' if finite else 'context_selects_other_meaning',
                    review_id=review['review_id'],chosen_canonical_target=chosen,
                    confidence_scope=review['review_scope'])
            return proof
        selected=self.alias.get(chosen,chosen)
        if selected not in proof['represented_targets']:
            return dict(proof,accepted=False,reason='review_target_not_in_current_analyses',review_id=review['review_id'])
        return dict(proof,accepted=selected==tid,reason='manual_context_review' if selected==tid else 'context_selects_other_target',
                    review_id=review['review_id'],chosen_canonical_target=chosen,
                    confidence_scope=review['review_scope'])

    def matches(self,observation_id,text):
        tokens=list(self.tokenizer.token_spans(text))
        for i,token in enumerate(tokens):
            node=self.trie;words=[]
            for j in range(i,len(tokens)):
                start,end,raw,norm=tokens[j]
                if norm is None or norm not in node:break
                if j>i and not text[tokens[j-1][1]:start].isspace():break
                node=node[norm];words.append(norm)
                if None in node:
                    surface=' '.join(words)
                    for tid in sorted(node[None]):
                        proof=self.occurrence_decision(surface,tid,observation_id,text,token[0],end)
                        yield dict(target_id=tid,observation_id=observation_id,start_cp=token[0],end_cp=end,
                                   token_index=i,surface=surface,accepted=int(proof['accepted']),reason=proof['reason'],proof=proof)
