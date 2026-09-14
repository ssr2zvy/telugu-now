import { useEffect, useRef, useState } from 'react';
import { RotateCw, Trash2 } from 'lucide-react';
import type { BlacklistEntry, ProfileBlacklistResponse } from '../../../../shared/contracts';
import { getProfileBlacklist, removeBlacklistEntry } from '../../api';
import type { UiLanguage } from '../types';

export function BlacklistPage({ profileCode, language }: { profileCode: string; language: UiLanguage }) {
  const [data, setData] = useState<ProfileBlacklistResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'load' | 'change' | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
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
    void getProfileBlacklist(profileCode, controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(() => {
      if (!controller.signal.aborted) setError('load');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [profileCode, reload]);
  const remove = async (entry: BlacklistEntry) => {
    setRemoving(entry.text);
    setError(null);
    try {
      const result = await removeBlacklistEntry(profileCode, entry.text);
      if (mounted.current) setData(result);
    } catch {
      if (mounted.current) setError('change');
    } finally {
      if (mounted.current) setRemoving(null);
    }
  };
  const date = (value: number) => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
  return (
    <div className="blacklist-page" aria-busy={loading}>
      <p className="eon-description">{text(
        'Sentences blacklisted here, including from the reading menu, are never shown again. Blacklisting applies to the entire sentence, not to individual words within it.',
        'ఇక్కడ, రీడింగ్ మెను నుండి కూడా, బ్లాక్‌లిస్ట్ చేసిన వాక్యాలు మళ్లీ కనిపించవు. బ్లాక్‌లిస్ట్ చేయడం మొత్తం వాక్యానికి వర్తిస్తుంది, దానిలోని విడి పదాలకు కాదు.',
      )}</p>
      {loading ? <p role="status">{text('Loading blacklist...', 'బ్లాక్‌లిస్ట్ లోడ్ అవుతోంది...')}</p> : null}
      {error ? <div className="settings-error" role="alert">
        <span>{error === 'load' ? text('Could not load the blacklist.', 'బ్లాక్‌లిస్ట్ లోడ్ చేయలేకపోయాము.')
          : text('Could not remove that sentence. Reload to check its current state.', 'ఆ వాక్యాన్ని తొలగించలేకపోయాము. ప్రస్తుత స్థితి కోసం రీలోడ్ చేయండి.')}</span>
        <button type="button" className="secondary-action" disabled={loading} onClick={() => setReload(value => value + 1)}>
          <RotateCw size={16} aria-hidden="true" />{text('Reload', 'రీలోడ్')}
        </button>
      </div> : null}
      {!loading && data ? (
        data.entries.length ? (
          <ol className="blacklist-entries">
            {data.entries.map(entry => (
              <li key={entry.text} className="blacklist-entry">
                <span lang="te" className="blacklist-entry-text">{entry.text}</span>
                <time dateTime={new Date(entry.createdAt).toISOString()} className="blacklist-entry-date">{date(entry.createdAt)}</time>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={removing === entry.text}
                  aria-label={text(`Remove "${entry.text}" from the blacklist`, `"${entry.text}"ను బ్లాక్‌లిస్ట్ నుండి తొలగించు`)}
                  onClick={() => void remove(entry)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {removing === entry.text ? text('Removing...', 'తొలగిస్తోంది...') : text('Remove', 'తొలగించు')}
                </button>
              </li>
            ))}
          </ol>
        ) : <p className="eon-description">{text('No blacklisted sentences yet.', 'ఇంకా బ్లాక్‌లిస్ట్ చేసిన వాక్యాలు లేవు.')}</p>
      ) : null}
    </div>
  );
}
