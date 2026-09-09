import { randomAppearanceColors, useAppearance } from '../../appearance';
import { Shuffle } from 'lucide-react';
import { OBSERVATION_FONTS } from '../../presentation';
import type { UiLanguage } from '../types';

export function AppearancePage({ language }: { language: UiLanguage }) {
  const { appearance, updateAppearance } = useAppearance();
  const text = (english: string, telugu: string) => language === 'en' ? english : telugu;
  return (
    <div className="appearance-page">
      <section className="appearance-section">
        <h2>{text('Colors', 'రంగులు')}</h2>
        <div className="appearance-colors">
          {appearance.gradient.map((color, index) => (
            <label key={index}>
              <input type="color" aria-label={text(`Gradient color ${index + 1}`, `గ్రేడియంట్ రంగు ${index + 1}`)} value={color} onChange={(event) => {
                const gradient: [string, string, string] = [...appearance.gradient];
                gradient[index] = event.target.value;
                updateAppearance({ gradient });
              }} />
              <span>{text(`Gradient ${index + 1}`, `గ్రేడియంట్ ${index + 1}`)}</span>
            </label>
          ))}
          <label>
            <input type="color" aria-label={text('Text color', 'అక్షరాల రంగు')} value={appearance.foreground} onChange={(event) => updateAppearance({ foreground: event.target.value })} />
            <span>{text('Text', 'అక్షరాలు')}</span>
          </label>
        </div>
        <button className="secondary-action" onClick={() => updateAppearance(randomAppearanceColors())}><Shuffle aria-hidden="true" />{text('Randomize colors', 'యాదృచ్ఛిక రంగులు')}</button>
      </section>
      <section className="appearance-section">
        <h2>{text('Type size', 'అక్షరాల పరిమాణం')}</h2>
        <label className="appearance-scale">
          <input type="range" min={0} max={100} step={1} aria-label={text('Font size scale', 'అక్షరాల పరిమాణ స్థాయి')} value={appearance.fontScale} onChange={(event) => updateAppearance({ fontScale: Number(event.target.value) })} />
          <output>{appearance.fontScale}</output>
        </label>
      </section>
      <section className="appearance-section">
        <h2>{text('Fonts', 'ఫాంట్లు')}</h2>
        <div className="appearance-fonts">
          {OBSERVATION_FONTS.map((font) => (
            <label key={font}>
              <input type="checkbox" checked={appearance.fonts.includes(font)} disabled={appearance.fonts.length === 1 && appearance.fonts.includes(font)} onChange={(event) => updateAppearance({ fonts: event.target.checked ? [...appearance.fonts, font] : appearance.fonts.filter((entry) => entry !== font) })} />
              <span>{font}</span>
              <span className="font-preview" style={{ fontFamily: `"${font}"` }} lang="te">తెలుగు</span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}