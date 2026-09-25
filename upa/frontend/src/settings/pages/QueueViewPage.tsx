import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import type { QueuePreparationPhase, QueueViewResponse, QueueViewSlot } from '../../../../shared/contracts';
import { getQueueView, resetQueue } from '../../api';
import { LoadingSlit } from '../../components/LoadingSlit';
import { getTeluguGradientCacheSnapshot } from '../../observation/telugu-gradient-renderer';
import type { UiLanguage } from '../types';

export function QueueViewPage({ profileCode, language, grammarActive }: { profileCode: string; language: UiLanguage; grammarActive?: boolean }) {
  const [data, setData] = useState<QueueViewResponse | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const text = (en: string, te: string) => language === 'en' ? en : te;
  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    const load = async () => {
      try {
        const result = await getQueueView(profileCode, controller.signal);
        if (!controller.signal.aborted) { setData(result); setError(false); }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(load, 1_000);
      }
    };
    void load();
    return () => { controller.abort(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [profileCode, reload]);
  const selected = selectedSlot === null ? null : data?.slots.find(slot => slot.slot === selectedSlot) ?? null;
  const renderer = getTeluguGradientCacheSnapshot();
  const phaseLabel = (phase: QueuePreparationPhase) => ({
    empty: text('Empty', 'ఖాళీ'), pending: text('Pending', 'పెండింగ్'),
    'retry-waiting': text('Waiting to retry', 'మళ్లీ ప్రయత్నించడానికి వేచి ఉంది'),
    preparing: text('Preparing', 'సిద్ధమవుతోంది'), ready: text('Ready', 'సిద్ధం'), failed: text('Failed', 'విఫలమైంది'),
  })[phase];
  const date = (value: number | null) => value === null ? 'None' : new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' }).format(value);
  const value = (entry: unknown) => entry === null || entry === '' ? 'None' : typeof entry === 'boolean' ? (entry ? 'Yes' : 'No') : String(entry);
  const details = (slot: QueueViewSlot): Array<[string, string]> => [
    ['Slot', String(slot.slot)], ['Phase', phaseLabel(slot.phase)], ['Queue position', value(slot.queuePosition)],
    ['Observation ID', value(slot.observationId)], ['Source ID', value(slot.sourceId)], ['Source key', value(slot.sourceKey)],
    ['Text', value(slot.text)], ['Selected', date(slot.selectedAt)], ['Prepared', date(slot.preparedAt)],
    ['Request started', date(slot.requestStartedAt)], ['Request completed', date(slot.requestCompletedAt)],
    ['Request duration', slot.requestDurationMs === null ? 'None' : `${slot.requestDurationMs} ms`],
    ['Source cache hit', value(slot.cacheHit)], ['Preparation attempts', String(slot.preparationAttempts)],
    ['Retry at', date(slot.preparationRetryAt)], ['Preparation error', value(slot.preparationError)],
    ['Acquisition number', value(slot.acquisitionNumber)], ['Acquisition trigger', value(slot.triggerKind)],
    ['Observation kind', value(slot.observationKind)], ['Question mode', value(slot.questionMode)],
    ['Audio available', value(slot.hasAudio)], ['Font render', text('Not scheduled until display', 'ప్రదర్శించే వరకు షెడ్యూల్ కాలేదు')],
  ];
  if (!data && !error) return <LoadingSlit label={text('Loading queue', 'క్యూ లోడ్ అవుతోంది')} />;
  return (
    <div className="queue-view-page">
      <div className="queue-view-heading">
        <p>{text('Live preparation state for all ten queue slots. Select a slot to inspect it.', 'పది క్యూ స్థానాల ప్రత్యక్ష సిద్ధీకరణ స్థితి. వివరాలకు ఒక స్థానాన్ని ఎంచుకోండి.')}</p>
        <button className="appearance-icon-action" type="button" aria-label={text('Reload queue', 'క్యూను రీలోడ్ చేయండి')} onClick={() => setReload(count => count + 1)}>
          <RotateCw aria-hidden="true" />
        </button>
      </div>
      {grammarActive?<button type="button" onClick={()=>void resetQueue(profileCode,{visible:false}).then(()=>setReload(n=>n+1)).catch(()=>setError(true))}>Retry unavailable questions</button>:null}
      {error ? <p className="settings-error" role="alert">{text('The queue snapshot could not be loaded.', 'క్యూ స్థితిని లోడ్ చేయలేకపోయాము.')}</p> : null}
      {data ? <>
        <ol className="queue-slots" aria-label={text('Queue slots', 'క్యూ స్థానాలు')}>
          {data.slots.map(slot => <li key={slot.slot}>
            <button type="button" className={`queue-slot queue-phase-${slot.phase}`} aria-pressed={selectedSlot === slot.slot} onClick={() => setSelectedSlot(slot.slot)}>
              <span className="queue-slot-number">{slot.slot}</span>
              <span className="queue-slot-summary"><strong>{phaseLabel(slot.phase)}</strong><small>{slot.text ?? slot.sourceKey ?? text('No observation', 'పరిశీలన లేదు')}</small></span>
              <span className="queue-phase-mark" aria-hidden="true" />
            </button>
          </li>)}
        </ol>
        {selected ? <section className="queue-inspector" aria-live="polite">
          <h2>{text(`Slot ${selected.slot} details`, `స్థానం ${selected.slot} వివరాలు`)}</h2>
          <dl>{details(selected).map(([label, entry]) => <div key={label}><dt>{label}</dt><dd>{entry}</dd></div>)}</dl>
        </section> : null}
        <section className="queue-renderer-status">
          <div><h2>{text('Font render memory', 'ఫాంట్ రెండర్ మెమరీ')}</h2><small>{text('Client cache in this browser tab', 'ఈ బ్రౌజర్ ట్యాబ్‌లోని క్లయింట్ క్యాష్')}</small></div>
          <dl className="queue-texture-totals">
            <div><dt>{text('Textures', 'టెక్స్చర్లు')}</dt><dd>{renderer.textures.total}</dd></div>
            <div><dt>{text('Pending', 'పెండింగ్')}</dt><dd>{renderer.textures.pending}</dd></div>
            <div><dt>{text('Loaded', 'లోడ్ అయ్యాయి')}</dt><dd>{renderer.textures.loaded}</dd></div>
            <div><dt>{text('Failed', 'విఫలమయ్యాయి')}</dt><dd>{renderer.textures.failed}</dd></div>
          </dl>
          <ul>{renderer.models.map(model => <li key={model.fontFamily}><span>{model.fontFamily}</span><strong data-state={model.state}>{model.state}</strong></li>)}</ul>
        </section>
        <p className="queue-snapshot-time">{text('Snapshot', 'స్థితి సమయం')}: {date(data.generatedAt)}</p>
      </> : null}
    </div>
  );
}