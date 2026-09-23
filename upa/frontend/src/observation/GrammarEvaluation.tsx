import { forwardRef, useImperativeHandle, useRef, useState } from 'react';

export interface GrammarEvaluationHandle { commit:()=>Promise<boolean> }
export const GrammarEvaluation=forwardRef<GrammarEvaluationHandle,{
  profileCode:string;observationId:string;result:boolean|null;
}>(function GrammarEvaluation({profileCode,observationId,result},ref){
  const [draft,setDraft]=useState(false);
  const [saved,setSaved]=useState<boolean|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const inFlight=useRef(false);
  const committed=useRef(false);
  const value=result??saved;
  useImperativeHandle(ref,()=>({commit:async()=>{
    if(value!==null||committed.current)return true;
    if(inFlight.current)return false;
    inFlight.current=true;setBusy(true);setError('');
    try{
      const response=await fetch(`/api/profiles/${encodeURIComponent(profileCode)}/grammar-evaluations/${encodeURIComponent(observationId)}`,{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({result:draft}),
      });
      if(!response.ok){const body=await response.json().catch(()=>({})) as {error?:string};throw new Error(body.error??'Could not save evaluation');}
      committed.current=true;setSaved(draft);return true;
    }catch(caught){setError(caught instanceof Error?caught.message:'Could not save evaluation');return false;}
    finally{inFlight.current=false;setBusy(false);}
  }}),[value,draft,profileCode,observationId]);
  return <div className="grammar-evaluation" onClick={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()}>
    <button type="button" role="switch" className="evaluation-switch" aria-label="Answer correct"
      aria-checked={value??draft} aria-busy={busy} data-value={String(value??draft)} disabled={busy||value!==null}
      onClick={()=>setDraft(current=>!current)}>
      <span className="evaluation-switch-indicator" aria-hidden="true" />
    </button>
    {error?<p role="alert">{error}</p>:null}
  </div>;
});
