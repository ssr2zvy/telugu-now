import { ParsingDiagnostics } from './ParsingDiagnostics';
import type { UiLanguage } from '../types';
export function ParserDiagnosticsPage({profileCode,selected}:{profileCode:string;selected:Record<string,unknown>|null;language:UiLanguage}){
 return <div>{selected?<section><h3>Selected word</h3><p>{String(selected.word??'Historical observation')}</p><p>Target: {String(selected.targetId??'—')}</p><p>Selection: {String(selected.parseSource??'—')}</p></section>:null}<ParsingDiagnostics profileCode={profileCode}/></div>;
}
