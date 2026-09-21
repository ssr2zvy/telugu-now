"""Map verified lexical parses to shared progression units; GI remains parser metadata."""
import collections, csv, hashlib, json

def progression_identity(row):
    chain=row['ordered_modifier_chain'].split('|') if row['ordered_modifier_chain'] else []
    assert len(chain)==int(row['modifier_count'])
    nesting=row['nesting_signature']
    if not chain:
        assert row['base_type']=='core_base'
        return 'BASE:v2:'+json.dumps([row['base_id'],nesting],ensure_ascii=False,separators=(',',':')), 1
    return 'CHAIN:v2:'+json.dumps([nesting,chain],ensure_ascii=False,separators=(',',':')), len(chain)+1

def group_targets(lexical_targets):
    groups={}; mapping={}
    for row in lexical_targets:
        tid,level=progression_identity(row)
        mapping[row['target_id']]=tid
        if tid not in groups:
            groups[tid]={'target_id':tid,'category_level':level,'base_id':row['base_id'] if level==1 else '',
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
