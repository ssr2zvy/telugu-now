export interface ExplorationStep {
  kind: 'letter' | 'word' | 'phrase';
  text: string;
  start: number;
  end: number;
  word: string;
  wordStart: number;
  wordEnd: number;
  graphemeStart?: number;
  graphemeEnd?: number;
}
export function explorationSteps(text: string): ExplorationStep[] {
  const words = [...new Intl.Segmenter('te',{granularity:'word'}).segment(text)].filter(part=>part.isWordLike);
  const steps: ExplorationStep[] = [];
  words.forEach((word,index)=>{
    const base={word:word.segment,wordStart:word.index,wordEnd:word.index+word.segment.length};
    for(const unit of new Intl.Segmenter('te',{granularity:'grapheme'}).segment(word.segment)) {
      steps.push({...base,kind:'letter',text:unit.segment,start:word.index+unit.index,end:word.index+unit.index+unit.segment.length,
        graphemeStart:unit.index,graphemeEnd:unit.index+unit.segment.length});
    }
    // The complete one-word sentence is the original observation view.
    if(words.length>1) steps.push({...base,kind:'word',text:word.segment,start:word.index,end:base.wordEnd});
    if(index>0 && index<words.length-1) steps.push({...base,kind:'phrase',text:text.slice(0,base.wordEnd),start:0,end:base.wordEnd});
  });
  return steps;
}
export function explorationIndex(index: number | null, direction: 'up'|'down', count: number): number | null {
  if(!count)return null;
  if(index===null)return direction==='up'?0:null;
  const next=index+(direction==='up'?1:-1);
  return next<0 || next>=count ? null : next;
}
