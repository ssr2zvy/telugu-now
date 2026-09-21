import { useEffect,useState } from 'react';
interface Status {enabled:boolean;active:boolean;job:{phase?:string;processed?:number;total?:number;uniqueWords?:number;targets?:number;uploadedBytes?:number;totalBytes?:number;error?:string}}
export function GrammarMigrationPage({profileCode}:{profileCode:string}){
 const [status,setStatus]=useState<Status|null>(null),[token,setToken]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const url=`/api/profiles/${encodeURIComponent(profileCode)}/grammar`;
 useEffect(()=>{let stopped=false;const poll=async()=>{try{const r=await fetch(url);if(!r.ok)throw new Error('Could not load migration status');const data=await r.json() as Status;if(!stopped)setStatus(data);}catch(e){if(!stopped)setError(String(e));}};void poll();const timer=setInterval(()=>void poll(),2000);return()=>{stopped=true;clearInterval(timer);};},[url]);
 const run=async(action:string)=>{setBusy(true);setError('');try{const r=await fetch(`${url}/${action}`,{method:'POST',headers:{'x-grammar-operator-token':token}});const data=await r.json() as Status&{error?:string};if(!r.ok)throw new Error(data.error??'Operation failed');setStatus(data);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 const job=status?.job;const building=!!job?.phase&&!['ready','failed'].includes(job.phase);
 return <div className="settings-form">
  <p>{status?.active?'Grammar selection is active for every profile.':'Build grammar analysis, then switch every profile to the new question batches.'}</p>
  <p role="status">{job?.phase??'Not started'}{job?.total?` — ${job.processed??0} / ${job.total} transcripts`:''}</p>
  {job?.total?<progress value={job.processed??0} max={job.total}/>:null}
  {job?.uniqueWords!==undefined?<p>{job.uniqueWords.toLocaleString()} distinct words analyzed</p>:null}
  {job?.targets!==undefined?<p>{job.targets.toLocaleString()} grammar targets</p>:null}
  {job?.totalBytes?<><p>Uploading {Math.round(100*(job.uploadedBytes??0)/job.totalBytes)}%</p><progress value={job.uploadedBytes??0} max={job.totalBytes}/></>:null}
  {status?.enabled&&!status.active?<>
   <label>Operator token<input type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)}/></label>
   <button type="button" disabled={busy||building||!token||job?.phase==='ready'} onClick={()=>void run('build')}>{job?.phase==='failed'?'Resume build':'Build grammar database'}</button>
   <button type="button" disabled={busy||job?.phase!=='ready'||!token} onClick={()=>void run('activate')}>Switch to new selection for every profile</button>
  </>:null}
  {!status?.enabled?<p>The optional migration worker is disabled.</p>:null}
  {(error||job?.error)?<p role="alert">{error||job?.error}</p>:null}
  <p>You may close this page while the worker runs.</p>
 </div>;
}
