import type { QuestionMode } from '../../../../shared/contracts';
export function GrammarQuestionTypePage({selected,mode}:{selected:Record<string,unknown>;mode:QuestionMode|null}){
 const q=selected.questionType as Record<string,unknown>|undefined;
 return <table className="diagnostic-table"><tbody>{[
  ['Selected question type',mode],['Policy',q?.policy],['Audio-given probability',q?.audioGiven],
  ['Text-given probability',q?.textGiven],['Random draw',q?.draw],['Update timing','Settings apply when each new question is selected'],
 ].map(([label,value])=><tr key={String(label)}><th>{String(label)}</th><td>{String(value??'—')}</td></tr>)}</tbody></table>;
}
