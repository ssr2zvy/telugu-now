import { attempt as selectionAttempt, evaluate as evaluateSelection } from '../parsing/state';
import { initialProgress, type Progress } from './model';
import { categoryCurve } from './category-view';
import type { GrammarCategoryDiagnostics } from '../../../shared/contracts';
import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config/config';
import { db } from '../db/database';
import { evaluate,system,getCatalog,openBatch } from './service';
import { GrammarCatalog } from './store';
import type { GrammarParserDiagnostics } from '../../../shared/contracts';
import { workerEnabled,job,startMigration,validateActivation } from './migration';
import {corpusStamp} from './persistence';
import { clearQueue } from '../services/queue-service';
export function grammarRoutes(){
 const app=new Hono();
 for(const resource of ['/:code/grammar','/:code/grammar/:action','/:code/grammar-evaluations/:observationId']) app.use(resource,async(c,next)=>{
  if(!config.profileCodes.has(c.req.param('code')??''))return c.json({error:'invalid-profile-code'},404);
  if(c.req.method!=='GET'){
   const origin=c.req.header('origin');if(origin){try{if(new URL(origin).host!==c.req.header('host'))return c.json({error:'invalid-origin'},403);}catch{return c.json({error:'invalid-origin'},403);}}
  }
  await next();
 });
 const status=()=>({enabled:false,active:false,job:{...job(),file:undefined},operatorTokenRequired:true});
 app.get('/:code/grammar',c=>c.json(status()));
 app.get('/:code/grammar/diagnostics',c=>{
  try{
   if(system().active)return c.json(getCatalog().parserDiagnostics(true));
   const ready=job();
   if(ready.phase==='ready'&&ready.file){const catalog=new GrammarCatalog(ready.file);try{return c.json(catalog.parserDiagnostics(false));}finally{catalog.close();}}
   const empty:GrammarParserDiagnostics={active:false,available:false,parser:null,policy:null,rulesSha256:null,inventoryId:null,stats:{},exclusions:{}};
   return c.json(empty);
  }catch(e){return c.json({error:e instanceof Error?e.message:'Parser diagnostics unavailable'},409);}
 });
 app.get('/:code/grammar/category',c=>{
  try {
   const empty:GrammarCategoryDiagnostics={available:false,position:0,completed:false,stateSource:'initial',categories:[],coreBases:[],singleModifiers:[]};
   if(!system().active)return c.json(empty);
   const cat=getCatalog(), profile=c.req.param('code');
   const batch=openBatch(profile);
   const saved=db.prepare('SELECT inventory_id,state_json FROM grammar_progress WHERE profile_code=?').get(profile) as {inventory_id:string;state_json:string}|undefined;
   if(saved && saved.inventory_id!==cat.identity.inventory_id)throw new Error('Grammar inventory migration required');
   const state:Progress=batch?JSON.parse(batch.state_json):saved?JSON.parse(saved.state_json):initialProgress(cat.sizes);
   const labelRow=cat.db.prepare("SELECT value FROM metadata WHERE key='grammar_labels'").get() as {value:string}|undefined;
   const labels:Record<string,{forms:string[]}>=labelRow?JSON.parse(labelRow.value):{};
   const data:GrammarCategoryDiagnostics={...empty,available:true,position:state.position,completed:state.completed,stateSource:batch?'batch':saved?'progress':'initial',categories:categoryCurve(cat.targets.map(group=>group[0]!.level),cat.sizes,state)};
   cat.targets.forEach((group,j)=>group.forEach((target,t)=>{
    const chain=JSON.parse(target.chain_json) as string[];
    const core=!!target.base_id && chain.length===0;
    const modifier=!target.base_id && chain.length===1;
    if(!core && !modifier)return;
    const id=core?target.base_id:chain[0]!;
    const examples=(cat.db.prepare('SELECT word FROM occurrences WHERE target_id=? GROUP BY word ORDER BY COUNT(*) DESC,word LIMIT 3').all(target.target_id) as {word:string}[]).map(row=>row.word);
    (core?data.coreBases:data.singleModifiers).push({id,forms:labels[id]?.forms??[],examples,streak:state.streaks[j]?.[t]??0});
   }));
   return c.json(data);
  }catch(e){return c.json({error:e instanceof Error?e.message:'Category unavailable'},409);}
 });
 app.post('/:code/grammar/:action',c=>c.json({error:'Use Settings → Parsing & Selection Mode. The earlier global GI activation is archived.'},410));
 app.post('/:code/grammar-evaluations/:observationId',async c=>{
  const body=await c.req.json().catch(()=>null) as {result?:unknown}|null;
  if(typeof body?.result!=='boolean')return c.json({error:'An explicit correct/incorrect answer is required'},400);
  try{const code=c.req.param('code'),id=c.req.param('observationId');if(selectionAttempt(id,code))evaluateSelection(code,id,body.result);else evaluate(code,id,body.result,false);return c.body(null,204);}
  catch(e){return c.json({error:e instanceof Error?e.message:'Evaluation failed'},409);}
 });
 return app;
}
