import { useState } from 'react';
import { Check, ChevronRight, RotateCcw, Upload, X } from 'lucide-react';
import { modifierEntries, modifierTitle, type ModifierGroup } from '../../../shared/modifiers';
import { settingsPageLabel } from '../settings/navigation';
import type { SettingsPage, UiLanguage } from '../settings/types';
import type { ModifierController } from './useModifierMode';
import { ModifierSwitch } from './ModifierView';

export type ModifierPage = 'modifierMode' | 'modifierExcluded' | 'modifierSeen' | 'modifierUnseen' | 'modifierOmitted' | 'modifierImport' | 'modifierReset';
const pages: {page: ModifierPage; group: ModifierGroup}[] = [
  {page:'modifierOmitted',group:'omitted'}, {page:'modifierExcluded',group:'excluded'}, {page:'modifierSeen',group:'seen'}, {page:'modifierUnseen',group:'unseen'},
];
export function ModifierSettings({ controller: mode, page, language, onNavigate }: {
  controller: ModifierController; page: ModifierPage; language: UiLanguage; onNavigate: (page: Exclude<SettingsPage,'index'>) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const group = pages.find(item => item.page === page)?.group;
  return <div className="modifier-settings" aria-busy={mode.busy}>
    {page === 'modifierMode' ? <nav className="settings-index">
      {pages.map(item => <button type="button" key={item.page} onClick={() => onNavigate(item.page)}>
        <span className="settings-entry-label">{settingsPageLabel(item.page,language)}</span>
        <span className="modifier-settings-count">{mode.groups?.[item.group].length ?? '…'}</span><ChevronRight className="settings-entry-chevron" aria-hidden="true"/>
      </button>)}
      <button type="button" onClick={() => onNavigate('modifierImport')}><span className="settings-entry-label">{settingsPageLabel('modifierImport',language)}</span><ChevronRight/></button>
      <button type="button" onClick={() => onNavigate('modifierReset')}><span className="settings-entry-label">{settingsPageLabel('modifierReset',language)}</span><ChevronRight className="settings-entry-chevron" aria-hidden="true"/></button>
    </nav> : null}
    {group && mode.groups ? <ul className="modifier-entry-list">{mode.groups[group].map(entry => <li key={entry.id}>
      <div lang="te"><div>{modifierTitle(entry)}</div><div className="modifier-entry-example">{entry.examples[0]!.base} → {entry.examples[0]!.result}</div></div>
      {group === 'omitted' ? <button type="button" disabled={mode.busy} aria-label="మళ్లీ చేర్చు" onClick={() => { void mode.setOmitted(entry.id,false); }}><RotateCcw/></button> : group !== 'unseen' ? <ModifierSwitch checked={group === 'excluded'} disabled={mode.busy} onChange={() => { void mode.setExcluded(entry.id, group !== 'excluded'); }}/> : null}
    </li>)}</ul> : null}
    {page === 'modifierImport' ? <div><label className="modifier-import"><Upload aria-hidden="true"/><input type="file" accept=".zip,application/zip" aria-label="దిగుమతి" disabled={mode.busy} onChange={event => { const file = event.target.files?.[0]; if (file) void mode.importZip(file); event.target.value = ''; }}/></label><output aria-live="polite">{mode.busy ? '…' : (mode.state?.entries ?? modifierEntries).length}</output></div> : null}
    {page === 'modifierReset'  ? <div className="modifier-reset">
      <p>{language === 'en' ? 'Return entries to the pool, keeping ??? omissions, and clear their appearance history for this profile.' : '??? అంశాలు మినహా మిగిలినవాటిని మళ్లీ చేర్చి, చూసిన చరిత్రను తొలగించు.'}</p>
      {!confirm ? <button className="secondary-action" type="button" disabled={mode.busy || !mode.state} onClick={() => setConfirm(true)}><RotateCcw aria-hidden="true"/>{language === 'en' ? 'Reset' : 'మళ్లీ ప్రారంభించు'}</button> : <div className="modifier-reset-confirm" role="group" aria-label={language === 'en' ? 'Confirm reset' : 'నిర్ధారించు'}>
        <button type="button" aria-label="రద్దు" disabled={mode.busy} onClick={() => setConfirm(false)}><X/></button>
        <button type="button" aria-label="నిర్ధారించు" disabled={mode.busy} onClick={() => { void mode.reset().then(() => setConfirm(false)); }}><Check/></button>
      </div>}
      <p>{language === 'en' ? 'Available' : 'మిగిలినవి'} · {mode.remaining ?? '…'}</p>
    </div> : null}
    {mode.error ? <><p className="settings-error">{language === 'en' ? 'Could not load or save modifier progress.' : 'పురోగతిని లోడ్ చేయలేకపోయాము లేదా సేవ్ కాలేదు.'}</p><button type="button" className="secondary-action" onClick={mode.retry}><RotateCcw aria-hidden="true"/>{language === 'en' ? 'Retry' : 'మళ్లీ ప్రయత్నించు'}</button></> : null}
  </div>;
}
