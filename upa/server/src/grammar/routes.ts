import { Hono } from 'hono';
import { config } from '../config/config';
import { evaluate } from '../parsing/state';
import { parsingDiagnostics } from '../parsing/diagnostics';
import { ensureLaunchQueue } from '../services/queue-service';
export function grammarRoutes(){
 const app=new Hono();
 for(const resource of ['/:code/grammar','/:code/grammar/:action','/:code/grammar-evaluations/:observationId'])app.use(resource,async(c,next)=>{
  if(!config.profileCodes.has(c.req.param('code')??''))return c.json({error:'invalid-profile-code'},404);
  if(c.req.method!=='GET'){const origin=c.req.header('origin');if(origin){try{if(new URL(origin).host!==c.req.header('host'))return c.json({error:'invalid-origin'},403);}catch{return c.json({error:'invalid-origin'},403);}}}
  await next();
 });
 app.get('/:code/grammar',c=>c.json({active:true,policy:'frequency-word-cache-v1'}));
 app.get('/:code/grammar/diagnostics',c=>c.json(parsingDiagnostics(c.req.param('code'))));
 app.get('/:code/grammar/category',c=>c.json(parsingDiagnostics(c.req.param('code'))));
 app.post('/:code/grammar/:action',c=>c.json({error:'Only automatic live parsing is supported.'},410));
 app.post('/:code/grammar-evaluations/:observationId',async c=>{
  const body=await c.req.json().catch(()=>null) as {result?:unknown}|null;
  if(typeof body?.result!=='boolean')return c.json({error:'An explicit True or False answer is required'},400);
  try{const profile=c.req.param('code');evaluate(profile,c.req.param('observationId'),body.result);ensureLaunchQueue(profile);return c.body(null,204);}
  catch(e){return c.json({error:e instanceof Error?e.message:'Evaluation failed'},409);}
 });
 return app;
}
