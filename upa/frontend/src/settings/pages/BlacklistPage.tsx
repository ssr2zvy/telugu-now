import { useEffect, useRef, useState } from 'react';
import { RotateCw, Trash2 } from 'lucide-react';
import type { BlacklistEntry } from '../../../../shared/contracts';
import { getBlacklist, removeBlacklistEntry } from '../../api';
import type { UiLanguage } from '../types';

/** Sentences the profile has blocked; they are never selected again. */
export function BlacklistPage({ profileCode, language }: { profileCode: string; language: UiLanguage }) {
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<'load' | 'change' | null>(null);
  const [reload, setReload] = useState(0);
  const mounted = useRef(false);
  const text = (en: string, te: string) => (language === 'en' ? en : te);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void getBlacklist(profileCode, controller.signal).then(result => {
      if (!controller.signal.aborted) setEntries(result.entries);
    }).catch(() => {
      if (!controller.signal.aborted) setError('load');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [profileCode, reload]);

  const remove = (entry: BlacklistEntry) => {
    const key = `${entry.sourceId}\u0000${entry.sourceKey}`;
    setBusyKey(key);
    setError(null);
    void removeBlacklistEntry(profileCode, { sourceId: entry.sourceId, sourceKey: entry.sourceKey })
      .then(result => { if (mounted.current) setEntries(result.entries); })
      .catch(() => { if (mounted.current) setError('change'); })
      .finally(() => { if (mounted.current) setBusyKey(null); });
  };

  return (
    <div className="blacklist-page" aria-busy={loading}>
      <p className="settings-description">{text(
        'Sentences blocked from appearing again. Blacklisting applies to whole sentences, not to words inside them.',
        'మళ్లీ కనిపించకుండా నిరోధించిన వాక్యాలు. బ్లాక్‌లిస్ట్ పూర్తి వాక్యాలకే వర్తిస్తుంది, వాటిలోని పదాలకు కాదు.',
      )}</p>
      {error ? (
        <p className="settings-error" role="alert">
          {error === 'load' ? text('Could not load the blacklist.', 'బ్లాక్‌లిస్ట్ లోడ్ కాలేదు.') : text('Could not update the blacklist.', 'బ్లాక్‌లిస్ట్ నవీకరించలేదు.')}
          <button type="button" className="settings-inline-button" aria-label={text('Retry', 'మళ్లీ ప్రయత్నించండి')} onClick={() => setReload(value => value + 1)}>
            <RotateCw size={16} aria-hidden="true" />
          </button>
        </p>
      ) : null}
      {!loading && entries.length === 0 ? (
        <p className="settings-empty">{text('No blacklisted sentences.', 'బ్లాక్‌లిస్ట్ చేసిన వాక్యాలు లేవు.')}</p>
      ) : null}
      <ul className="blacklist-entries">
        {entries.map(entry => {
          const key = `${entry.sourceId}\u0000${entry.sourceKey}`;
          return (
            <li key={key} className="blacklist-entry">
              <span className="blacklist-entry-text">{entry.text}</span>
              <button
                type="button"
                className="settings-inline-button"
                aria-label={text('Remove from blacklist', 'బ్లాక్‌లిస్ట్ నుండి తొలగించండి')}
                title={text('Remove from blacklist', 'బ్లాక్‌లిస్ట్ నుండి తొలగించండి')}
                disabled={busyKey !== null}
                onClick={() => remove(entry)}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
