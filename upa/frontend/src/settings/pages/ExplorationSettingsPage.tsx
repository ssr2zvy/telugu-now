import type { CSSProperties } from 'react';
import { useAppearance } from '../../appearance';
import { EXPLORATION_DRAW_LIMITS } from '../../../../shared/exploration';
import type { UiLanguage } from '../types';

export function ExplorationSettingsPage({ page, language }: {
  page: 'explorationStart' | 'explorationEnd' | 'explorationDraws'; language: UiLanguage;
}) {
  const { appearance, updateAppearance } = useAppearance();
  const text = (en: string, te: string) => language === 'en' ? en : te;
  const slider = (id: string, label: string, value: number, min: number, max: number, change: (value: number) => void, unit = '%') =>
    <section className="appearance-control-page" key={id}>
      <div className="appearance-section-heading"><label htmlFor={id}>{label}</label></div>
      <div className="appearance-scale">
        <input id={id} type="range" min={min} max={max} step={1} value={value}
          style={{ '--range-progress': `${(value - min) / (max - min) * 100}%` } as CSSProperties}
          onChange={event => change(Number(event.target.value))} />
        <output htmlFor={id}>{value}{unit}</output>
      </div>
    </section>;
  const key = page === 'explorationStart' ? 'explorationStartWordPercent' : 'explorationEndWordPercent';
  return <div className="appearance-settings">
    {page === 'explorationDraws'
      ? slider('exploration-draw-count', text('Draws', 'ఎంపికలు'), appearance.explorationTransitionDraws,
        EXPLORATION_DRAW_LIMITS.min, EXPLORATION_DRAW_LIMITS.max,
        value => updateAppearance({ explorationTransitionDraws: value }), '')
      : <>
        {slider('exploration-word-percent', text('Word', 'పదం'), appearance[key], 0, 100,
          value => updateAppearance({ [key]: value }))}
        {slider('exploration-letter-percent', text('Letter', 'అక్షరం'), 100 - appearance[key], 0, 100,
          value => updateAppearance({ [key]: 100 - value }))}
      </>}
    <p className="settings-reset-queue-description">{page === 'explorationDraws'
      ? text('The first draw uses the start probabilities. This draw reaches the end probabilities; later draws keep them.', 'మొదటి ఎంపిక ప్రారంభ అవకాశాలను ఉపయోగిస్తుంది. ఈ ఎంపికకు చివరి అవకాశాలు చేరుతాయి; తరువాత అవే కొనసాగుతాయి.')
      : text('Word and letter total 100%. Changes apply on your next visit to exploration.', 'పదం, అక్షరం కలిపి 100%. మార్పులు తదుపరిసారి అన్వేషణలోకి వెళ్లినప్పుడు వర్తిస్తాయి.')}</p>
  </div>;
}
