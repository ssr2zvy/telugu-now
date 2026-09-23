import { ParsingDiagnostics } from './ParsingDiagnostics';
import { SelectedWordMatch } from './SelectedWordMatch';
import type { DisplayObservation } from '../../../../shared/contracts';
import type { UiLanguage } from '../types';
export function ParserDiagnosticsPage({profileCode,observation,onDownload}:{profileCode:string;observation:DisplayObservation|null;language:UiLanguage;onDownload?:()=>void}){
 return <div><SelectedWordMatch observation={observation}/><ParsingDiagnostics profileCode={profileCode} {...(onDownload?{onDownload}:{})}/></div>;
}
