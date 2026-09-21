import { useEffect, useId, useState } from 'react';
import type { GrammarCategoryDiagnostics } from '../../../../shared/contracts';

export function CategoryPage({ profileCode }: { profileCode: string }) {
  const [data,setData]=useState<GrammarCategoryDiagnostics|null>(null);
  const [error,setError]=useState('');const [refresh,setRefresh]=useState(0);
  const gradient=useId();
  useEffect(()=>{
    const abort=new AbortController();setError('');
    void fetch(`/api/profiles/${encodeURIComponent(profileCode)}/grammar/category`,{signal:abort.signal})
      .then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||'Category unavailable');return body as GrammarCategoryDiagnostics;})
      .then(setData).catch((e:Error)=>{if(e.name!=='AbortError')setError(e.message);});
    return ()=>abort.abort();
  },[profileCode,refresh]);
  const list=(title:string,items:GrammarCategoryDiagnostics['coreBases'])=><section><h3>{title} ({items.length})</h3>
    {!items.length?<p>No eligible targets in the active corpus.</p>:<table className="diagnostic-table"><thead><tr><th>Form / target</th><th>Examples</th><th>Streak</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td><span lang="te">{item.forms.join(' / ')||item.id}</span><br/><small>{item.forms.length?item.id:'Form labels require a catalog rebuild.'}</small></td><td lang="te">{item.examples.join(', ')}</td><td>{item.streak}/3</td></tr>)}</tbody></table>}</section>;
  const rows=data?.categories??[];
  const x=(i:number)=>50+(rows.length===1?260:i*520/(rows.length-1));
  const max=Math.max(.01,...rows.map(row=>Math.max(row.probability,row.initialProbability)));
  const y=(p:number)=>220-180*p/max;
  const points=(initial:boolean)=>rows.map((row,i)=>`${x(i)},${y(initial?row.initialProbability:row.probability)}`).join(' ');
  return <div className="diagnostic-page">
    <button type="button" onClick={()=>setRefresh(n=>n+1)}>Refresh</button>
    {error&&<p role="alert">{error}</p>}
    {!data&&!error&&<p role="status">Loading categories…</p>}
    {data&&!data.available&&<p>Build and activate the grammar catalog to view your categories.</p>}
    {data?.available&&<>
      <p>{data.completed?'All categories completed.':`Progress position: ${data.position.toFixed(2)}`} {data.stateSource==='batch'?'These are the probabilities used by the current batch of 10.':'These are the current saved probabilities.'}</p>
      <svg viewBox="0 0 620 270" role="img" aria-label="Category selection probabilities: dashed original curve, colored current curve, shaded reversed region" style={{width:'100%',height:'auto',color:'var(--foreground)'}}>
        <defs><linearGradient id={gradient}><stop offset="0%" stopColor="var(--foreground)"/><stop offset="100%" stopColor="var(--corner-control-color, currentColor)"/></linearGradient></defs>
        {rows.map((row,i)=>row.reversal>0&&<rect key={row.level} x={i===0?35:(x(i-1)+x(i))/2} y="25" width={(i===rows.length-1?595:(x(i)+x(i+1))/2)-(i===0?35:(x(i-1)+x(i))/2)} height="195" fill={`url(#${gradient})`} opacity={.06+.12*row.reversal}/>)}
        <path d="M35 25V220H595" fill="none" stroke="currentColor" opacity=".3"/>
        <polyline points={points(true)} fill="none" stroke="currentColor" opacity=".35" strokeDasharray="6 5" strokeWidth="2"/>
        <polyline points={points(false)} fill="none" stroke={`url(#${gradient})`} strokeWidth="3"/>
        {rows.map((row,i)=><g key={row.level}><circle cx={x(i)} cy={y(row.probability)} r="4" fill="currentColor"/><text x={x(i)} y="244" textAnchor="middle" fill="currentColor" fontSize="12">{row.level}</text></g>)}
        <text x="30" y="30" textAnchor="end" fill="currentColor" fontSize="10">{(max*100).toFixed(0)}%</text><text x="30" y="223" textAnchor="end" fill="currentColor" fontSize="10">0%</text>
        <text x="310" y="265" textAnchor="middle" fill="currentColor" fontSize="12">Grammar level</text>
      </svg>
      <p>Dashed: initial. Solid: current. Shading shows the region participating in reversal; lighter shading indicates a partial transition. It does not indicate mastery of every target.</p>
      <table className="diagnostic-table"><thead><tr><th>Level</th><th>Probability</th><th>Targets</th></tr></thead><tbody>{rows.map(row=><tr key={row.level}><td>{row.level}</td><td>{(100*row.probability).toFixed(2)}%</td><td>{row.targetCount}</td></tr>)}</tbody></table>
      {list('Core base words',data.coreBases)}{list('Single-modifier targets (GI 1)',data.singleModifiers)}
    </>}
  </div>;
}
