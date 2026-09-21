import { db as userDb } from '../db/database';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config/config';
import { audioStorageIdentity, audioValidationStore } from '../services/audio-validation-store';
import { probabilities, pick, type Progress } from './model';
import { chooseQuestionType, type QuestionTypeSelection } from './question-type';
import type { GrammarParserDiagnostics, GrammarParserInfo } from '../../../shared/contracts';
export const grammarDirectory=path.join(path.dirname(config.corpusDatabasePath),'grammar');
export const progressionPolicy='grammatical-components-v3';
export interface Target {target_id:string;level:number;chain_json:string;base_id:string;nesting:string}
export interface GrammarChoice { sourceId:string;sourceKey:string;snapshot: Record<string,unknown>;targetId:string;category:number;targetIndex:number;questionType:QuestionTypeSelection }
export class GrammarCatalog {
  readonly db:Database.Database; readonly targets:Target[][]; readonly sizes:number[]; readonly identity:Record<string,string>;
  constructor(readonly filename:string) {
    this.db=new Database(filename,{readonly:true,fileMustExist:true});
    try {
      if((this.db.pragma('quick_check') as {quick_check:string}[])[0]?.quick_check!=='ok')throw new Error('Invalid grammar database');
      if((this.db.prepare("SELECT value FROM metadata WHERE key='complete'").get() as {value:string}|undefined)?.value!=='true')throw new Error('Incomplete grammar database');
      this.identity=JSON.parse((this.db.prepare("SELECT value FROM metadata WHERE key='identity'").get() as {value:string}).value);
      if(this.identity.policy!==progressionPolicy)throw new Error('Grammar catalog uses an older progression policy; rebuild before activation. Active older inventories require an explicit progress migration.');
      const targets=this.db.prepare('SELECT * FROM targets ORDER BY target_id').all() as Target[];
      this.targets=[...new Set(targets.map(t=>t.level))].sort((a,b)=>a-b).map(l=>targets.filter(t=>t.level===l));
      this.sizes=this.targets.map(t=>t.length);if(!this.sizes.length)throw new Error('Empty grammar inventory');
      void audioValidationStore.revision;
      this.db.prepare('ATTACH DATABASE ? AS corpus').run(config.corpusDatabasePath);
      this.db.prepare('ATTACH DATABASE ? AS availability').run(config.corpusAvailabilityPath);
      this.db.prepare('ATTACH DATABASE ? AS validation').run(config.audioValidationPath);
    }catch(e){this.db.close();throw e;}
  }
  close(){this.db.close();}
  parserDiagnostics(active:boolean):GrammarParserDiagnostics {
    const metadata=(key:string)=>{const row=this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key) as {value:string}|undefined;return row?JSON.parse(row.value):null;};
    return {active,available:true,parser:(metadata('parser_info') ?? {version:this.identity.parser_version}) as GrammarParserInfo,
      policy:this.identity.policy??null,rulesSha256:this.identity.parser_sha256??null,inventoryId:this.identity.inventory_id??null,
      stats:metadata('stats')??{},exclusions:metadata('exclusions')??{}};
  }
  private candidates=`FROM members m JOIN observations o ON o.id=m.observation_id
    JOIN corpus.source_rows r ON r.source_id=o.source_id AND r.source_key=o.source_key
    JOIN availability.source_complexity_members a ON a.source_id=o.source_id AND a.source_key=o.source_key
    WHERE m.target_id=? AND r.text NOT IN (SELECT value FROM json_each(?))
    AND NOT EXISTS(SELECT 1 FROM validation.audio_validation v WHERE v.storage_identity=? AND v.object_key=o.audio_key AND v.status='invalid')`;
  assertUsable(profile:string){
    const blocked=(userDb.prepare('SELECT text FROM profile_blacklisted_sentences WHERE profile_code=?').all(profile) as {text:string}[]).map(r=>r.text);
    const query='SELECT target_id FROM targets t WHERE NOT EXISTS(SELECT 1 '+this.candidates.replace('m.target_id=?','m.target_id=t.target_id')+') LIMIT 1';
    if(this.db.prepare(query).get(JSON.stringify(blocked),audioStorageIdentity(config)))throw new Error('GRAMMAR_TARGET_UNAVAILABLE: restore audio or remove a blocking blacklist entry');
  }
  choose(profile:string,state:Progress,random=Math.random,requiredTarget?:string):GrammarChoice {
    const probs=probabilities(this.sizes,state);
    let j=pick(probs,random),t=Math.floor(random()*this.sizes[j]!);
    if(requiredTarget){j=this.targets.findIndex(tier=>tier.some(x=>x.target_id===requiredTarget));if(j<0)throw new Error('Unknown replacement target');t=this.targets[j]!.findIndex(x=>x.target_id===requiredTarget);}
    const blocked=(userDb.prepare('SELECT text FROM profile_blacklisted_sentences WHERE profile_code=?').all(profile) as {text:string}[]).map(r=>r.text);
    const target=this.targets[j]![t]!,params=[target.target_id,JSON.stringify(blocked),audioStorageIdentity(config)];
    const lengths=this.db.prepare('SELECT m.length,COUNT(*) AS count '+this.candidates+' GROUP BY m.length ORDER BY m.length').all(...params) as {length:number;count:number}[];
    if(!lengths.length)throw new Error('GRAMMAR_TARGET_UNAVAILABLE: restore audio or remove a blocking blacklist entry');
    const weights=lengths.map(l=>1/l.length**2),li=pick(weights,random),chosen=lengths[li]!;
    const obs=this.db.prepare('SELECT o.*,r.text '+this.candidates+' AND m.length=? ORDER BY o.source_id,o.source_key LIMIT 1 OFFSET ?').get(...params,chosen.length,Math.floor(random()*chosen.count)) as {id:number;source_id:string;source_key:string;text:string};
    const tokens=this.db.prepare('SELECT * FROM occurrences WHERE target_id=? AND observation_id=? ORDER BY token_index').all(target.target_id,obs.id) as Record<string,unknown>[];
    const occurrence=tokens[Math.floor(random()*tokens.length)]!;
    occurrence.token_surface=Array.from(obs.text).slice(Number(occurrence.start_cp),Number(occurrence.end_cp)).join('');
    const parsedRow=this.db.prepare('SELECT parse_json FROM words WHERE word=?').get(occurrence.word) as {parse_json:string}|undefined;
    const parse=parsedRow?JSON.parse(parsedRow.parse_json) as Record<string,unknown>:null;
    const parser=parse?{version:parse.parser_version,adapterVersion:parse.adapter_version,targetSchemaVersion:parse.target_schema_version,
      status:parse.status,confidence:parse.parse_confidence,eligible:parse.eligible,eligibilityReason:parse.eligibility_reason,
      baseId:parse.base_id,baseType:parse.base_type,chain:parse.ordered_modifier_chain,modifierCount:parse.modifier_count,
      giScore:parse.gi_score,normalizationConfidence:parse.normalization_confidence,normalizationOps:parse.normalization_ops,
      analysisCount:parse.analysis_count,topTargetCount:parse.top_canonical_target_count,parts:parse.parts_json,
      search:parse.search,rulesSha256:this.identity.parser_sha256}:null;
    const questionType=chooseQuestionType(this.sizes,state,random);
    const route={questionMode:questionType.selectedProbability,category:requiredTarget?1:probs[j]!,target:requiredTarget?1:1/this.sizes[j]!,length:weights[li]!/weights.reduce((a,b)=>a+b,0),observation:1/chosen.count,occurrence:1/tokens.length};
    const vocabulary=this.db.prepare('SELECT c.*,v.rank,v.frequency,v.probability FROM vocabulary_occurrences c LEFT JOIN vocabulary v ON v.word=c.word WHERE c.observation_id=? ORDER BY c.token_index').all(obs.id);
    const chain=JSON.parse(target.chain_json) as string[];
    const components=[...(target.base_id?[{kind:'core_base',id:target.base_id}]:[]),...chain.map(id=>({kind:'modifier',id}))];
    return {sourceId:obs.source_id,sourceKey:obs.source_key,targetId:target.target_id,category:j,targetIndex:t,questionType,snapshot:{mode:'grammar',questionType:{...questionType,categoryLevel:this.targets[questionType.categoryIndex]![0]!.level},policy:this.identity.policy,inventoryId:this.identity.inventory_id,sourceId:obs.source_id,sourceKey:obs.source_key,targetId:target.target_id,category:j,categoryLevel:target.level,coreBaseId:target.base_id||null,components,chain,nesting:target.nesting,parser,occurrence,length:chosen.length,position:state.position,probabilities:probs,route,routeProbability:Object.values(route).reduce((a,b)=>a*b,1),replacement:!!requiredTarget,vocabulary}};
  }
}
