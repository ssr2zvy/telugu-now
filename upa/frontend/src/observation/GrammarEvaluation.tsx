import {useState} from 'react';
import {Check,X} from 'lucide-react';
export function GrammarEvaluation({profileCode,observationId,result,target}:{profileCode:string;observationId:string;result:boolean|null;target:Record<string,unknown>}){
 const [busy,setBusy]=useState(false),[saved,setSaved]=useState<boolean|null>(null),[error,setError]=useState('');
 const value=result??saved;
 const submit=async(correct:boolean)=>{if(busy||value!==null)return;setBusy(true);setError('');try{const r=await fetch(`/api/profiles/${encodeURIComponent(profileCode)}/grammar-evaluations/${encodeURIComponent(observationId)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({result:correct})});if(!r.ok){const data=await r.json() as {error:string};throw new Error(data.error);}setSaved(correct);}catch(e){setError(e instanceof Error?e.message:'Could not save evaluation');}finally{setBusy(false);}};
 const word=String((target.occurrence as {word?:string}|undefined)?.word??'');
 return <div className="grammar-evaluation" onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} onPointerDown={e=>e.stopPropagation()}>
  <p>How did you do? <span lang="te">{word}</span></p>
  <div><button type="button" aria-label="Correct" disabled={busy||value!==null} onClick={()=>void submit(true)}><Check/> Correct</button>
  <button type="button" aria-label="Incorrect" disabled={busy||value!==null} onClick={()=>void submit(false)}><X/> Incorrect</button></div>
  {value!==null?<p role="status">{value?'Marked correct':'Marked incorrect'}. Continue when ready.</p>:null}
  {error?<p role="alert">{error}</p>:null}
 </div>;
}
