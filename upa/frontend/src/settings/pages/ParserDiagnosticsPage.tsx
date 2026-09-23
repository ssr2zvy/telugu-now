import type { DisplayObservation } from '../../../../shared/contracts';
import type { SettingsPage, UiLanguage } from '../types';
import { ParsingDiagnostics } from './ParsingDiagnostics';
import { SelectedWordMatch } from './SelectedWordMatch';
import { ParserSection } from './ParserSection';
import { settingsPageIcons, settingsPageLabel } from '../navigation';
import { ChevronRight } from 'lucide-react';
export function ParserDiagnosticsPage({profileCode,observation,language,onDownload,onNavigate}:{profileCode:string;observation:DisplayObservation|null;language:UiLanguage;onDownload?:()=>void;onNavigate?:(page:Exclude<SettingsPage,'index'>)=>void}) {
  return <ParsingDiagnostics key={profileCode} profileCode={profileCode} observation={observation} {...(onDownload ? {onDownload} : {})}/>;
}
