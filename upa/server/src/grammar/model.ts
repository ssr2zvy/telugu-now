/** Port of scheduler.py; shared-chain identity is handled separately. */
export interface Progress { position: number; streaks: number[][]; completed: boolean }
export function initialProgress(sizes: number[]): Progress {
  if (!sizes.length || sizes.some(n => !Number.isInteger(n) || n < 1)) throw new Error('Empty grammar inventory');
  return { position: 0, streaks: sizes.map(n => Array<number>(n).fill(0)), completed: false };
}
export function probabilities(sizes: number[], state: Progress): number[] {
  const base = sizes.map((_, i) => 1 / (i + 1)); const z = base.reduce((a,b)=>a+b,0);
  const b = base.map(v=>v/z); const K=b.length;
  const boundary=(k:number)=>[...b.slice(0,k+1).reverse(),...b.slice(k+1)];
  if (state.completed) return boundary(K-1);
  const x=Math.min(K-1,Math.max(0,state.position)),i=Math.floor(x),q=x-i;
  if (i===K-1) return boundary(i);
  return boundary(i).map((v,k)=>(1-q)*v+q*boundary(i+1)[k]!);
}
export function update(sizes:number[],state:Progress,j:number,t:number,result:boolean) {
  const K=sizes.length,c=Math.min(K-1,Math.floor(state.position)),before=state.position;
  const old=state.streaks[j]![t]!;state.streaks[j]![t]=result?Math.min(3,old+1):0;
  const unit=1/(3*sizes[j]!),distance=c-j,multiplier=distance<=0?1:2.5*2**(distance-1);
  // Completion is latched: review continues at the final distribution even after a False.
  if (!state.completed) {
    if (!result && j<=c) state.position=Math.max(j===c?c:0,before-old*unit*multiplier);
    else if(result && j<=c) {
      let quota=state.streaks[c]!.reduce((a,b)=>a+b,0)/(3*sizes[c]!);
      if(c===K-1)quota=Math.min(quota,state.streaks.flat().reduce((a,b)=>a+b,0)/(3*sizes.reduce((a,b)=>a+b,0)));
      let candidate=Math.min(before+unit,c+quota);
      if(Math.abs(candidate-(c+1))<1e-12 && quota===1) candidate=c+1;
      state.position=Math.max(before,candidate);
      if(state.position===K) state.completed=true;
    }
  }
  return {positionBefore:before,positionAfter:state.position,streakBefore:old,streakAfter:state.streaks[j]![t],multiplier,unit,completed:state.completed};
}
export function pick(weights:number[],random= Math.random):number {
  const sum=weights.reduce((a,b)=>a+b,0);if(!(sum>0))throw new Error('No selectable grammar candidates');
  let n=Math.min(Math.max(random(),0),1-Number.EPSILON)*sum;
  for(let i=0;i<weights.length;i++){n-=weights[i]!;if(n<0)return i;}
  return weights.length-1;
}
