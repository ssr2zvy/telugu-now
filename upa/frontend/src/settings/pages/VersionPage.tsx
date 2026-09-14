import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { VersionInformation } from '../../../../shared/contracts';
import type { UiLanguage } from '../types';

function formatTime(value: string | number): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function formatDuration(milliseconds: number, english: boolean): string {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    days ? `${days}${english ? 'd' : 'రో'}` : '',
    hours ? `${hours}${english ? 'h' : 'గ'}` : '',
    `${minutes}${english ? 'm' : 'ని'}`,
  ].filter(Boolean);
  return parts.join(' ');
}

/** What is deployed and running right now. */
export function VersionPage({ language }: { language: UiLanguage }) {
  const english = language === 'en';
  const [version, setVersion] = useState<VersionInformation | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError('');
    void fetch('/api/version').then(async response => {
      if (!response.ok) throw new Error('failed');
      const result = await response.json() as VersionInformation;
      if (!cancelled) setVersion(result);
    }).catch(() => {
      if (!cancelled) setError(english ? 'Could not load version information.' : 'వెర్షన్ సమాచారం లోడ్ కాలేదు.');
    });
    return () => { cancelled = true; };
  }, [attempt, english]);

  const unknown = english ? 'Unknown' : 'తెలియదు';
  const rows: Array<[string, string]> = version ? [
    [english ? 'App Version' : 'యాప్ వెర్షన్', version.appVersion],
    [english ? 'Commit' : 'కమిట్', version.shortCommit],
    [english ? 'Commit Message' : 'కమిట్ సందేశం', version.commitSubject || unknown],
    [english ? 'Branch' : 'బ్రాంచ్', version.branch || unknown],
    [english ? 'Built' : 'నిర్మించిన సమయం', version.buildTime ? formatTime(version.buildTime) : unknown],
    [english ? 'Deployed App' : 'అమలైన యాప్', version.flyAppName || unknown],
    [english ? 'Region' : 'ప్రాంతం', version.flyRegion || unknown],
    [english ? 'Machine' : 'మెషీన్', version.flyMachineId || unknown],
    [english ? 'Server Started' : 'సర్వర్ ప్రారంభం', formatTime(version.serverStartedAt)],
    [english ? 'Uptime' : 'పని సమయం', formatDuration(version.serverTime - version.serverStartedAt, english)],
    [english ? 'Client Build' : 'క్లయింట్ బిల్డ్', version.frontendVersion],
    [english ? 'Server Build' : 'సర్వర్ బిల్డ్', version.backendVersion],
  ] : [];

  return (
    <div className="diagnostic-sections">
      <section>
        <table className="diagnostic-table">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      {error ? (
        <div className="settings-error" role="alert">
          {error}
          <button type="button" className="secondary-action" aria-label={english ? 'Retry' : 'మళ్లీ ప్రయత్నించు'}
            onClick={() => setAttempt(value => value + 1)}><RefreshCw size={16} aria-hidden="true" /></button>
        </div>
      ) : null}
    </div>
  );
}
