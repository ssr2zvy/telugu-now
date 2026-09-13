import { APPEARANCE_OFFSET_LIMIT, AUTO_FADE_SECONDS_LIMITS, CONTROL_SPACING_LIMITS, appearanceSurface, DEFAULT_APPEARANCE, randomAppearanceColors, useAppearance } from '../../appearance';
import { ArrowDown, ArrowUp, RotateCcw, Shuffle } from 'lucide-react';
import { OBSERVATION_FONTS } from '../../presentation';
import type { CSSProperties } from 'react';
import type { UiLanguage } from '../types';

export function AppearancePage({ language }: { language: UiLanguage }) {
  const { appearance, updateAppearance } = useAppearance();
  const text = (english: string, telugu: string) => language === 'en' ? english : telugu;
  return (
    <div className="appearance-page">
      <div className="appearance-preview" role="img" aria-label={text('Appearance preview', 'రూపం నమూనా')}>
        <span lang="te" style={{ fontFamily: `"${appearance.fonts[0]}"`, fontSize: `${24 + appearance.fontScale * .24}px` }}>తెలుగు</span>
      </div>
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
        <div className="appearance-section-heading">
          <h2>{text('Position', 'స్థానం')}</h2>
          <button type="button" className="appearance-icon-action" title={text('Reset positions', 'స్థానాలను పునరుద్ధరించు')} aria-label={text('Reset positions', 'స్థానాలను పునరుద్ధరించు')} onClick={() => updateAppearance({ textOffset: 0, audioOffset: 0, textOffsetOther: 0, audioOffsetOther: 0, magnifierPosition: DEFAULT_APPEARANCE.magnifierPosition })}><RotateCcw aria-hidden="true" /></button>
        </div>
        {(['textOffset', 'audioOffset'] as const).map(setting => (
          <div className="appearance-position-field" key={setting}>
            <label htmlFor={`appearance-${setting}`}>{setting === 'textOffset' ? text('Text vertical offset', 'అక్షరాల నిలువు స్థానం') : text('Audio bar vertical offset', 'ఆడియో బార్ నిలువు స్థానం')}</label>
            <div className="appearance-scale appearance-offset">
              <ArrowUp size={16} aria-hidden="true" />
              <input id={`appearance-${setting}`} type="range" min={-APPEARANCE_OFFSET_LIMIT} max={APPEARANCE_OFFSET_LIMIT} step={1} value={appearance[setting]} style={{ '--range-progress': `${(appearance[setting] + APPEARANCE_OFFSET_LIMIT) / (APPEARANCE_OFFSET_LIMIT * 2) * 100}%` } as CSSProperties} aria-valuetext={`${appearance[setting]} px`} onChange={event => updateAppearance({ [setting]: Number(event.target.value) })} />
              <ArrowDown size={16} aria-hidden="true" />
              <output htmlFor={`appearance-${setting}`}>{appearance[setting] > 0 ? '+' : ''}{appearance[setting]} px</output>
            </div>
          </div>
        ))}
        <fieldset className="appearance-magnifier-position">
          <legend>{text('Audio control order', 'ఆడియో నియంత్రణల క్రమం')}</legend>
          <div className="appearance-position-options">
            {(['above', 'below'] as const).map(position => (
              <label key={position}>
                <input type="radio" name="magnifier-position" value={position} checked={appearance.magnifierPosition === position} onChange={() => updateAppearance({
                  magnifierPosition: position,
                  textOffset: appearance.textOffsetOther,
                  audioOffset: appearance.audioOffsetOther,
                  textOffsetOther: appearance.textOffset,
                  audioOffsetOther: appearance.audioOffset,
                })} />
                <span>{position === 'below' ? <ArrowUp size={16} aria-hidden="true" /> : <ArrowDown size={16} aria-hidden="true" />}{position === 'below' ? text('Bar above / magnifier below', 'బార్ పైన / మాగ్నిఫైయర్ కింద') : text('Bar below / magnifier above', 'బార్ కింద / మాగ్నిఫైయర్ పైన')}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>
      <section className="appearance-section">
        <div className="appearance-section-heading">
          <h2>{text('Control spacing', 'నియంత్రణల అంతరం')}</h2>
          <button type="button" className="appearance-icon-action" title={text('Reset control spacing', 'నియంత్రణల అంతరాన్ని పునరుద్ధరించు')} aria-label={text('Reset control spacing', 'నియంత్రణల అంతరాన్ని పునరుద్ధరించు')} onClick={() => updateAppearance({ controlSpacing: DEFAULT_APPEARANCE.controlSpacing })}><RotateCcw aria-hidden="true" /></button>
        </div>
        <label className="appearance-scale">
          <input type="range" min={CONTROL_SPACING_LIMITS.min} max={CONTROL_SPACING_LIMITS.max} step={1} style={{ '--range-progress': `${(appearance.controlSpacing - CONTROL_SPACING_LIMITS.min) / (CONTROL_SPACING_LIMITS.max - CONTROL_SPACING_LIMITS.min) * 100}%` } as CSSProperties} aria-label={text('Spacing between waveform, timestamp, and audio bar', 'తరంగరూపం, సమయముద్ర, ఆడియో బార్ మధ్య అంతరం')} aria-valuetext={`${appearance.controlSpacing} px`} value={appearance.controlSpacing} onChange={event => updateAppearance({ controlSpacing: Number(event.target.value) })} />
          <output>{appearance.controlSpacing} px</output>
        </label>
        <p>{text('Adjusts the distance between the waveform, the timestamp, and the audio bar.',
          'తరంగరూపం, సమయముద్ర, మరియు ఆడియో బార్ మధ్య దూరాన్ని సర్దుబాటు చేస్తుంది.')}</p>
      </section>
      <section className="appearance-section">
        <h2>{text('Audio controls', 'ఆడియో నియంత్రణలు')}</h2>
        <label className="appearance-surface-auto">
          <span>{text('Scroll mode', 'స్క్రోల్ మోడ్')}</span>
          <input type="checkbox" role="switch" checked={appearance.scrollMode} onChange={event => updateAppearance({ scrollMode: event.target.checked })} />
        </label>
        <p>{text('Swipe left or right to reveal the audio bar; reverse direction to hide it. Tap anywhere to play or pause. An outside tap dismisses an open magnifier first. Double-tap controls stay the same.',
          'ఆడియో బార్ కోసం ఎడమకు లేదా కుడికి స్వైప్ చేయండి; దాచడానికి వ్యతిరేక దిశలో స్వైప్ చేయండి. ప్లే లేదా పాజ్ కోసం ఎక్కడైనా తాకండి. మాగ్నిఫైయర్ తెరిచి ఉంటే బయట తాకడం ముందు దానిని మూసివేస్తుంది. రెండుసార్లు తాకే నియంత్రణలు మారవు.')}</p>
      </section>
      <section className="appearance-section">
        <div className="appearance-section-heading">
          <h2>{text('Auto-fade', 'స్వయంచాలకంగా దాచడం')}</h2>
          <button type="button" className="appearance-icon-action" title={text('Reset auto-fade delay', 'దాచే సమయాన్ని పునరుద్ధరించు')} aria-label={text('Reset auto-fade delay', 'దాచే సమయాన్ని పునరుద్ధరించు')} onClick={() => updateAppearance({ autoFadeSeconds: DEFAULT_APPEARANCE.autoFadeSeconds })}><RotateCcw aria-hidden="true" /></button>
        </div>
        <label className="appearance-scale">
          <input type="range" min={AUTO_FADE_SECONDS_LIMITS.min} max={AUTO_FADE_SECONDS_LIMITS.max} step={1} style={{ '--range-progress': `${(appearance.autoFadeSeconds - AUTO_FADE_SECONDS_LIMITS.min) / (AUTO_FADE_SECONDS_LIMITS.max - AUTO_FADE_SECONDS_LIMITS.min) * 100}%` } as CSSProperties} aria-label={text('Auto-fade delay', 'దాచే సమయం')} aria-valuetext={text(`${appearance.autoFadeSeconds} seconds`, `${appearance.autoFadeSeconds} సెకన్లు`)} value={appearance.autoFadeSeconds} onChange={event => updateAppearance({ autoFadeSeconds: Number(event.target.value) })} />
          <output>{appearance.autoFadeSeconds} s</output>
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