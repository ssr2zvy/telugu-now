import type { DisplayObservation } from '../../../../shared/contracts';
import type { SettingsPage, UiLanguage } from '../types';
import { ParserLinks } from './ParserLinks';
// Old deep links land on the same navigation as the Diagnostics page.
export function ParserDiagnosticsPage({language,onNavigate}:{profileCode:string;observation:DisplayObservation|null;language:UiLanguage;onDownload?:()=>void;onNavigate?:(page:Exclude<SettingsPage,'index'>)=>void}) {
  return onNavigate?<ParserLinks pages={['objectCoverage','searchAndParse','cycleHistory','parserEvents','parserDetails']} onNavigate={onNavigate} language={language}/>:null;
}
