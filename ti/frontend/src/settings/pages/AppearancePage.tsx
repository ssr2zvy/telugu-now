import { appearanceSurface, DEFAULT_APPEARANCE, randomAppearanceColors, useAppearance } from '../../appearance';
import { RotateCcw, Shuffle } from 'lucide-react';
import { OBSERVATION_FONTS } from '../../presentation';
import type { CSSProperties } from 'react';
import type { UiLanguage } from '../types';

export function AppearancePage({ language }: { language: UiLanguage }) {
  const { appearance, updateAppearance } = useAppearance();
  const text = (english: string, telugu: string) => language === 'en' ? english : telugu;
  return (
    <div className="appearance-page">
      <section className="appearance-section">
        <div className="appearance-section-heading">
          <h2>{text('Background', 'నేపథ్యం')}</h2>
          <div className="appearance-color-actions">
            <button type="button" className="appearance-icon-action" title={text('Randomize colors', 'యాదృచ్ఛిక రంగులు')} aria-label={text('Randomize colors', 'యాదృచ్ఛిక రంగులు')} onClick={() => updateAppearance({ ...randomAppearanceColors(), surface: null })}><Shuffle aria-hidden="true" /></button>
            <button type="button" className="appearance-icon-action" title={text('Reset colors', 'రంగులను పునరుద్ధరించు')} aria-label={text('Reset colors', 'రంగులను పునరుద్ధరించు')} onClick={() => updateAppearance({ gradient: DEFAULT_APPEARANCE.gradient, foreground: DEFAULT_APPEARANCE.foreground, surface: null })}><RotateCcw aria-hidden="true" /></button>
          </div>
        </div>
        <div className="appearance-colors">
          {appearance.gradient.map((color, index) => (
            <label key={index}>
              <input type="color" aria-label={text(`Gradient color ${index + 1}`, `గ్రేడియంట్ రంగు ${index + 1}`)} value={color} onChange={(event) => {
                const gradient: [string, string, string] = [...appearance.gradient];
                gradient[index] = event.target.value;
                updateAppearance({ gradient });
              }} />
              <span>{text(`Gradient ${index + 1}`, `గ్రేడియంట్ ${index + 1}`)}</span>
              <output>{color.toUpperCase()}</output>
            </label>
          ))}
        </div>
        <div className="appearance-color-roles">
          <label className="appearance-color-role">
            <span>{text('Text & icons', 'అక్షరాలు & చిహ్నాలు')}</span>
            <output>{appearance.foreground.toUpperCase()}</output>
            <input type="color" aria-label={text('Text & icons color', 'అక్షరాలు & చిహ్నాల రంగు')} value={appearance.foreground} onChange={(event) => updateAppearance({ foreground: event.target.value })} />
          </label>
          <label className="appearance-color-role">
            <span>{text('Settings & popovers', 'అమరికలు & పాప్‌ఓవర్లు')}</span>
            <output>{appearanceSurface(appearance).toUpperCase()}</output>
            <input type="color" aria-label={text('Settings & popovers color', 'అమరికలు & పాప్‌ఓవర్ల రంగు')} value={appearanceSurface(appearance)} onChange={(event) => updateAppearance({ surface: event.target.value })} />
          </label>
          <label className="appearance-surface-auto">
            <span>{text('Automatic surface', 'స్వయంచాలక ఉపరితలం')}</span>
            <input type="checkbox" role="switch" checked={appearance.surface === null} onChange={(event) => updateAppearance({ surface: event.target.checked ? null : appearanceSurface(appearance) })} />
          </label>
        </div>
      </section>
      <section className="appearance-section">
        <h2>{text('Type size', 'అక్షరాల పరిమాణం')}</h2>
        <label className="appearance-scale">
          <input type="range" min={0} max={100} step={1} style={{ '--range-progress': `${appearance.fontScale}%` } as CSSProperties} aria-label={text('Font size scale', 'అక్షరాల పరిమాణ స్థాయి')} value={appearance.fontScale} onChange={(event) => updateAppearance({ fontScale: Number(event.target.value) })} />
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