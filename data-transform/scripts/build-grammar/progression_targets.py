"""Count canonical grammatical components, excluding non-core vocabulary bases."""
import csv, hashlib, json

PROGRESSION_POLICY = 'grammatical-components-v3'


def progression_base_id(row):
    """Only core grammar bases belong to the progression identity."""
    return row['base_id'] if row['base_type'] == 'core_base' else ''

def progression_identity(row):
    raw_chain = row['ordered_modifier_chain']
    chain = raw_chain.split('|') if isinstance(raw_chain, str) and raw_chain else list(raw_chain or [])
    if len(chain) != int(row['modifier_count']):
        raise ValueError('Modifier count does not match the complete canonical chain')
    if any(not isinstance(modifier, str) or not modifier for modifier in chain):
        raise ValueError('Every modifier must have a canonical identity')
    if row['base_type'] not in {'core_base', 'dictionary_non_core_base'}:
        raise ValueError('Progression requires a verified base type')
    base = progression_base_id(row)
    if row['base_type'] == 'core_base' and not base:
        raise ValueError('Core grammar base identity is required')
    nesting=row['nesting_signature']
    if not nesting:
        raise ValueError('Nesting signature is required')
    level = len(chain) + int(bool(base))
    if level == 0:
        raise ValueError('Bare non-core vocabulary is not a progression target')
    # Typed components prevent core bases and modifiers with equal ID text colliding.
    # Parser IDs already combine verified surface variants; never key by raw spelling.
    components = ([['core_base', base]] if base else []) + [['modifier', mod] for mod in chain]
    target = 'UNIT:v3:' + json.dumps([nesting, components], ensure_ascii=False, separators=(',', ':'))
    return target, level

def group_targets(lexical_targets):
    groups={}; mapping={}
    for row in lexical_targets:
        tid,level=progression_identity(row)
        mapping[row['target_id']]=tid
        if tid not in groups:
            groups[tid]={'target_id':tid,'category_level':level,'base_id':progression_base_id(row),
                'ordered_modifier_chain':row['ordered_modifier_chain'],'nesting_signature':row['nesting_signature'],
                'modifier_count':int(row['modifier_count']),'lexical_target_ids':[],'parser_gi_scores':set()}
        groups[tid]['lexical_target_ids'].append(row['target_id'])
        groups[tid]['parser_gi_scores'].add(int(row['gi_score']))
    result=[]
    for tid in sorted(groups):
        row=groups[tid];row['parser_gi_scores']=sorted(row['parser_gi_scores']);result.append(row)
    return result,mapping

def write_inventory(out,targets,pools):
    path=out/'progression_targets.csv'
    rows=[]
    for t in targets:
        observations={oid for obs in pools[t['target_id']].values() for oid in obs}
        rows.append({**t,'distinct_observation_count':len(observations),
            'total_occurrence_count':sum(len(occ) for obs in pools[t['target_id']].values() for occ in obs.values())})
    with path.open('w',encoding='utf-8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader()
        for row in rows:w.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,list) else v for k,v in row.items()})
    return hashlib.sha256(path.read_bytes()).hexdigest()
