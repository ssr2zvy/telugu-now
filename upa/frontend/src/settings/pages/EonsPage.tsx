import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Play, Square } from 'lucide-react';
import type { ProfileEon, ProfileEonsResponse } from '../../../../shared/contracts';
import { getProfileEons, startProfileEon, stopProfileEon } from '../../api';
import type { UiLanguage } from '../types';
import { CollapsibleSettingsSection } from '../CollapsibleSettingsSection';

export function EonsPage({ profileCode, language }: { profileCode: string; language: UiLanguage }) {
  const [data, setData] = useState<ProfileEonsResponse | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'load' | 'change' | 'conflict' | null>(null);
  const mounted = useRef(false);
  const text = (en: string, te: string) => language === 'en' ? en : te;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void getProfileEons(profileCode, controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(() => {
      if (!controller.signal.aborted) setError('load');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [profileCode]);

  const change = async (active: ProfileEon | null) => {
    setSaving(true);
    setError(null);
    try {
      const result = active ? await stopProfileEon(profileCode, active.id) : await startProfileEon(profileCode, name.trim());
      if (!mounted.current) return;
      setData(result);
      if (!active) setName('');
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error && failure.message === '409' ? 'conflict' : 'change');
    } finally {
      if (mounted.current) setSaving(false);
    }
  };
  const start = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading || saving || error || !name.trim() || data?.activeEon) return;
    void change(null);
  };
  const date = (value: number) => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
  const active = data?.activeEon;
  const completed = data?.eons.filter(eon => eon.stoppedAt !== null) ?? [];
  const count = (value: number) => `${new Intl.NumberFormat(language).format(value)} ${value === 1 ? text('observation', 'పరిశీలన') : text('observations', 'పరిశీలనలు')}`;
  return (
    <div className="eons-page" aria-busy={loading || saving}>
      <p className="eon-description">{text(
        'Name a period of use. Starting includes your current observation and every observation you view until you stop, including queued audio and revisits. Original generation diagnostics stay unchanged.',
        'వినియోగ కాలానికి పేరు పెట్టండి. ప్రారంభించినప్పుడు ప్రస్తుత పరిశీలనతో పాటు ఆపే వరకు చూసే ప్రతి పరిశీలన చేర్చబడుతుంది; ముందే సిద్ధమైన ఆడియో, మళ్లీ చూసిన పరిశీలనలు కూడా చేరతాయి. అసలు సేకరణ నిర్ధారణ సమాచారం మారదు.',
      )}</p>
      {loading ? <p role="status">{text('Loading eons...', 'యుగాలను లోడ్ చేస్తోంది...')}</p> : null}
      {error ? <div className="settings-error" role="alert">
        <span>{error === 'load' ? text('Could not load eons.', 'యుగాలను లోడ్ చేయలేకపోయాము.')
          : error === 'conflict' ? text('The active eon changed. Reload before trying again.', 'క్రియాశీల యుగం మారింది. మళ్లీ ప్రయత్నించే ముందు రీలోడ్ చేయండి.')
            : text('Could not update the eon. Reload to check its current state.', 'యుగాన్ని నవీకరించలేకపోయాము. ప్రస్తుత స్థితి కోసం రీలోడ్ చేయండి.')}</span>
      </div> : null}
      {!loading && data ? <>
        <CollapsibleSettingsSection
          className={active ? 'eon-active' : 'eon-current'}
          ariaLabel={active ? text('Active eon', 'క్రియాశీల యుగం') : text('Start eon', 'యుగాన్ని ప్రారంభించు')}
          title={active ? active.name : text('Start eon', 'యుగాన్ని ప్రారంభించు')}
          description={active ? text('Active eon', 'క్రియాశీల యుగం') : undefined}
        >
        {active ? <>
          <p className="eon-meta">
            <time dateTime={new Date(active.startedAt).toISOString()}>{date(active.startedAt)}</time>
            <span>{count(active.observationCount)}</span>
          </p>
          <button className="secondary-action" type="button" disabled={saving || Boolean(error)} onClick={() => void change(active)}>
            <Square size={16} aria-hidden="true" />{saving ? text('Stopping...', 'ఆపుతోంది...') : text('Stop eon', 'యుగాన్ని ఆపు')}
          </button>
        </> : <form className="eon-start" onSubmit={start}>
          <label htmlFor="eon-name">{text('Eon name', 'యుగం పేరు')}</label>
          <input id="eon-name" type="text" required pattern={'.*\\S.*'} maxLength={80} value={name} disabled={saving || Boolean(error)}
            onChange={event => setName(event.target.value)} autoComplete="off" enterKeyHint="done" />
          <button className="primary-action" type="submit" disabled={saving || Boolean(error) || !name.trim()}>
            <Play size={16} aria-hidden="true" />{saving ? text('Starting...', 'ప్రారంభిస్తోంది...') : text('Start eon', 'యుగాన్ని ప్రారంభించు')}
          </button>
        </form>}
        </CollapsibleSettingsSection>
        <CollapsibleSettingsSection className="eon-history" ariaLabel={text('Past eons', 'గత యుగాలు')} title={text('Past eons', 'గత యుగాలు')}>
          {completed.length ? <ol>{completed.map(eon => <li key={eon.id}>
            <h3>{eon.name}</h3>
            <p className="eon-meta">
              <span><time dateTime={new Date(eon.startedAt).toISOString()}>{date(eon.startedAt)}</time>
                {' - '}<time dateTime={new Date(eon.stoppedAt!).toISOString()}>{date(eon.stoppedAt!)}</time></span>
              <span>{count(eon.observationCount)}</span>
            </p>
          </li>)}</ol> : <p className="eon-description">{text('No completed eons yet.', 'ఇంకా పూర్తయిన యుగాలు లేవు.')}</p>}
        </CollapsibleSettingsSection>
      </> : null}
    </div>
  );
}
