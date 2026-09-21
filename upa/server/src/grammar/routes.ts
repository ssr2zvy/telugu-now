import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config/config';
import { db } from '../db/database';
import { evaluate,system } from './service';
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
 const status=()=>({enabled:workerEnabled(),active:system().active===1,job:{...job(),file:undefined},operatorTokenRequired:true});
 app.get('/:code/grammar',c=>c.json(status()));
 app.post('/:code/grammar/:action',async c=>{
  if(!workerEnabled())return c.json({error:'Migration worker disabled'},409);
  const expected=process.env.GRAMMAR_MIGRATION_TOKEN,got=c.req.header('x-grammar-operator-token')??'';
  if(!expected||Buffer.byteLength(expected)!==Buffer.byteLength(got)||!timingSafeEqual(Buffer.from(expected),Buffer.from(got)))return c.json({error:'Operator token required'},403);
  try{
   if(c.req.param('action')==='build')await startMigration();
   else if(c.req.param('action')==='activate'){
    if(system().active)return c.json(status());
    const ready=await validateActivation();
    db.transaction(()=>{
      if(system().active)return;
      // All profiles switch globally. Existing displayed history stays intact.
      const profiles=db.prepare('SELECT code FROM profiles').all() as {code:string}[];
      for(const profile of profiles)clearQueue(profile.code);
      db.prepare('UPDATE grammar_system SET active=1,catalog_path=?,inventory_id=?,catalog_sha=?,corpus_stamp=? WHERE id=1').run(ready.file,ready.inventoryId,ready.sha,corpusStamp());
    }).immediate();
   }else return c.json({error:'Unknown action'},404);
   return c.json(status());
  }catch(e){return c.json({error:e instanceof Error?e.message:'Migration failed'},409);}
 });
 app.post('/:code/grammar-evaluations/:observationId',async c=>{
  const body=await c.req.json().catch(()=>null) as {result?:unknown}|null;
  if(typeof body?.result!=='boolean')return c.json({error:'An explicit correct/incorrect answer is required'},400);
  try{evaluate(c.req.param('code'),c.req.param('observationId'),body.result);return c.body(null,204);}
  catch(e){return c.json({error:e instanceof Error?e.message:'Evaluation failed'},409);}
 });
 return app;
}
