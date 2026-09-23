import { stream } from 'hono/streaming';
import { Hono } from 'hono';
import { config } from '../config/config';
import { db } from '../db/database';
import { coreProgress, graph } from './state';
import { wordStats,workerError,workerPhase } from './live-worker';
import { liveSelection } from '../services/queue-service';
import { parsingDiagnostics,diagnosticEvents,diagnosticExport } from './diagnostics';
import type { ParsingStatus } from '../../../shared/parsing';
export function parsingStatus(profile:string):ParsingStatus{
  const p=coreProgress(profile),activity=liveSelection.get(profile);
  return {mode:'core',ready:!!wordStats,running:activity?.phase==='searching'||workerPhase==='loading-parser',
    error:activity?.error??workerError,stats:null,
    job:{phase:activity?.phase??workerPhase,processed:wordStats?.checked??0,total:wordStats?.total??0},
    progress:{core:p.core,completed:p.core===4,levels:[1,2,3].map(core=>{
      const targets=Object.values(graph().nodes).filter(t=>t.core===core);
      return {core,targets:targets.length,mastered:targets.filter(t=>(p.streaks[t.id]??0)>=3).length};
    })}};
}
export function parsingRoutes(_legacyStart?:()=>void){
  const app=new Hono();
  app.use('/:code/parsing/*',async(c,next)=>{
    if(!config.profileCodes.has(c.req.param('code')??''))return c.json({error:'invalid-profile-code'},404);
    c.header('Cache-Control','no-store');await next();
  });
  app.get('/:code/parsing/status',c=>{try{return c.json(parsingStatus(c.req.param('code')));}catch(e){return c.json({error:String(e)},409);}});
  app.get('/:code/parsing/diagnostics',c=>c.json(parsingDiagnostics(c.req.param('code'))));
  app.get('/:code/parsing/diagnostics/events',c=>{
    const core=Number(c.req.query('core')??1),before=Number(c.req.query('before')??Number.MAX_SAFE_INTEGER);
    if(![1,2,3].includes(core)||!Number.isSafeInteger(before)||before<1)return c.json({error:'Invalid cursor'},400);
    const events=diagnosticEvents(c.req.param('code'),core,before);
    return c.json({events,nextBefore:events.length===50?events.at(-1)!.seq:null});
  });
  app.get('/:code/parsing/diagnostics/export',c=>{
    const result=diagnosticExport(c.req.param('code'));
    c.header('Content-Type','application/json; charset=utf-8');
    c.header('Content-Disposition',`attachment; filename="telugu-live-parsing-${Date.now()}.json"`);
    return stream(c,async output=>{try{for await(const chunk of result.chunks){if(output.aborted)break;await output.write(chunk);}}finally{result.close();}});
  });
  app.post('/:code/parsing/build',c=>c.json({error:'Full-corpus parsing is disabled; live parsing is automatic.'},410));
  app.post('/:code/parsing/mode',c=>c.json({error:'This branch supports only live parsing.'},410));
  app.get('/:code/parsing/observation/:id',c=>{
    const row=db.prepare('SELECT selection_snapshot_json FROM observation_acquisitions WHERE profile_code=? AND observation_id=?').get(c.req.param('code'),c.req.param('id')) as {selection_snapshot_json:string}|undefined;
    return row?c.json(JSON.parse(row.selection_snapshot_json)):c.json({error:'Observation not found'},404);
  });
  return app;
}
