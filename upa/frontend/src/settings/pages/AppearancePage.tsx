import { APPEARANCE_OFFSET_LIMIT, AUTO_FADE_SECONDS_LIMITS, CONTROL_SPACING_LIMITS, CONTROL_DARKNESS_LIMITS, appearanceAudioGlass, appearanceSurface, DEFAULT_APPEARANCE, randomAppearanceColors, useAppearance } from '../../appearance';
import { ArrowDown, ArrowUp, RotateCcw, Shuffle } from 'lucide-react';
import { OBSERVATION_FONTS } from '../../presentation';
import type { CSSProperties, ReactNode } from 'react';
import type { UiLanguage } from '../types';

export function AppearancePage({ language }: { language: UiLanguage }) {
  const { appearance, updateAppearance } = useAppearance();
  const glass = appearanceAudioGlass(appearance);
  const text = (english: string, telugu: string) => language === 'en' ? english : telugu;
  const resetAction = (label: string, onReset: () => void) => (
    <button type="button" className="appearance-icon-action" title={label} aria-label={label} onClick={onReset}><RotateCcw aria-hidden="true" /></button>
  );
  // Every element is described the same way: one element section, then Color,
  // Position and Other subsections in that fixed order.
  const subsection = (title: string, children: ReactNode, action?: ReactNode, note?: string) => (
    <div className="appearance-subsection">
      <div className="appearance-subsection-heading">
        <h3>{title}</h3>
        {action ?? null}
      </div>
      {children}
      {note ? <p className="appearance-note">{note}</p> : null}
    </div>
  );
  const colorSwatch = (label: string, value: string, onChange: (color: string) => void, disabled = false) => (
    <label>
      <input type="color" aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />
      <span>{label}</span>
      <output>{value.toUpperCase()}</output>
    </label>
  );
  const offsetField = (setting: 'textOffset' | 'audioOffset', label: string) => (
    <div className="appearance-position-field" key={setting}>
      <label htmlFor={`appearance-${setting}`}>{label}</label>
      <div className="appearance-scale appearance-offset">
        <ArrowUp size={16} aria-hidden="true" />
        <input id={`appearance-${setting}`} type="range" min={-APPEARANCE_OFFSET_LIMIT} max={APPEARANCE_OFFSET_LIMIT} step={1} value={appearance[setting]} style={{ '--range-progress': `${(appearance[setting] + APPEARANCE_OFFSET_LIMIT) / (APPEARANCE_OFFSET_LIMIT * 2) * 100}%` } as CSSProperties} aria-valuetext={`${appearance[setting]} px`} onChange={event => updateAppearance({ [setting]: Number(event.target.value) })} />
        <ArrowDown size={16} aria-hidden="true" />
        <output htmlFor={`appearance-${setting}`}>{appearance[setting] > 0 ? '+' : ''}{appearance[setting]} px</output>
      </div>
    </div>
  );
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
            {resetAction(text('Reset colors', 'రంగులను పునరుద్ధరించు'), () => updateAppearance({ gradient: DEFAULT_APPEARANCE.gradient, foreground: DEFAULT_APPEARANCE.foreground, surface: null }))}
          </div>
        </div>
        {subsection(text('Color', 'రంగు'), (
          <div className="appearance-colors">
            {appearance.gradient.map((color, index) => colorSwatch(
              text(`Gradient ${index + 1}`, `గ్రేడియంట్ ${index + 1}`),
              color,
              (value) => {
                const gradient: [string, string, string] = [...appearance.gradient];
                gradient[index] = value;
                updateAppearance({ gradient });
              },
            ))}
          </div>
        ), undefined, text('Three stops blend from the top-left to the bottom-right of the reading surface.',
          'మూడు రంగులు చదివే ఉపరితలం ఎడమ పై నుండి కుడి కింది వరకు కలిసిపోతాయి.'))}
      </section>

      <section className="appearance-section">
        <div className="appearance-section-heading">
          <h2>{text('Text & Icons', 'అక్షరాలు & చిహ్నాలు')}</h2>
          {resetAction(text('Reset text settings', 'అక్షరాల అమరికలను పునరుద్ధరించు'), () => updateAppearance({
            foreground: DEFAULT_APPEARANCE.foreground,
            fontScale: DEFAULT_APPEARANCE.fontScale,
            textOffset: 0,
            textOffsetOther: 0,
            fonts: [...DEFAULT_APPEARANCE.fonts],
          }))}
        </div>
        {subsection(text('Color', 'రంగు'), (
          <div className="appearance-colors">
            {colorSwatch(text('Text & icons', 'అక్షరాలు & చిహ్నాలు'), appearance.foreground, (value) => updateAppearance({ foreground: value }))}
          </div>
        ), undefined, text('Used for reading text, reader icons, and every control drawn over the background.',
          'చదివే అక్షరాలు, రీడర్ చిహ్నాలు మరియు నేపథ్యంపై గీసిన ప్రతి నియంత్రణకు ఇది వర్తిస్తుంది.'))}
        {subsection(text('Position', 'స్థానం'), offsetField('textOffset', text('Vertical offset', 'నిలువు స్థానం')), undefined,
          text('Moves the reading text up or down without moving the audio controls.',
            'ఆడియో నియంత్రణలను కదపకుండా చదివే అక్షరాలను పైకి లేదా కిందికి కదుపుతుంది.'))}
        {subsection(text('Other', 'ఇతరాలు'), (
          <>
            <div className="appearance-position-field">
              <label htmlFor="appearance-fontScale">{text('Type size', 'అక్షరాల పరిమాణం')}</label>
              <div className="appearance-scale">
                <input id="appearance-fontScale" type="range" min={0} max={100} step={1} style={{ '--range-progress': `${appearance.fontScale}%` } as CSSProperties} value={appearance.fontScale} onChange={(event) => updateAppearance({ fontScale: Number(event.target.value) })} />
                <output htmlFor="appearance-fontScale">{appearance.fontScale}</output>
              </div>
            </div>
            <div className="appearance-position-field">
              <span className="appearance-field-label">{text('Fonts', 'ఫాంట్లు')}</span>
              <div className="appearance-fonts">
                {OBSERVATION_FONTS.map((font) => (
                  <label key={font}>
                    <input type="checkbox" checked={appearance.fonts.includes(font)} disabled={appearance.fonts.length === 1 && appearance.fonts.includes(font)} onChange={(event) => updateAppearance({ fonts: event.target.checked ? [...appearance.fonts, font] : appearance.fonts.filter((entry) => entry !== font) })} />
                    <span>{font}</span>
                    <span className="font-preview" style={{ fontFamily: `"${font}"` }} lang="te">తెలుగు</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        ), undefined, text('At least one font stays selected; observations rotate through the chosen fonts.',
          'కనీసం ఒక ఫాంట్ ఎంపికలో ఉండాలి; పరిశీలనలు ఎంచుకున్న ఫాంట్ల మధ్య మారుతూ ఉంటాయి.'))}
      </section>

      <section className="appearance-section">
        <div className="appearance-section-heading">
          <h2>{text('Audio Controls', 'ఆడియో నియంత్రణలు')}</h2>
          {resetAction(text('Reset audio control settings', 'ఆడియో నియంత్రణల అమరికలను పునరుద్ధరించు'), () => updateAppearance({
            controlDarkness: DEFAULT_APPEARANCE.controlDarkness,
            showMagnifierHighlight: DEFAULT_APPEARANCE.showMagnifierHighlight,
            showAudioTimestamp: DEFAULT_APPEARANCE.showAudioTimestamp,
            audioOffset: 0,
            audioOffsetOther: 0,
            magnifierPosition: DEFAULT_APPEARANCE.magnifierPosition,
            audioTimestampGap: DEFAULT_APPEARANCE.audioTimestampGap,
            timestampMagnifierGap: DEFAULT_APPEARANCE.timestampMagnifierGap,
          }))}
        </div>
        <div className="appearance-audio-preview" role="img" aria-label={text('Audio controls preview', 'ఆడియో నియంత్రణల నమూనా')} style={{ '--audio-glass-gradient': glass.gradient, '--audio-glass-edge': glass.edge } as CSSProperties}>
          <div className="audio-player-bar" data-magnifier-position={appearance.magnifierPosition} aria-hidden="true">
            <div className="audio-scrubber-row">
              <div className="audio-scrubber">
                <div className="audio-scrubber-progress" style={{ width: '40%' }} />
                {appearance.showMagnifierHighlight ? <div className="audio-scrubber-window" style={{ left: '28%', width: '24%' }} /> : null}
                <div className="audio-scrubber-thumb" style={{ left: '40%' }} />
              </div>
            </div>
            <div className="audio-precision-panel">
              {appearance.showAudioTimestamp ? <div className="audio-magnifier-time">0:12.340</div> : null}
              <div className="audio-magnifier-track">
                {[16, 24, 40, 28, 60, 84, 48, 32, 68, 100, 72, 44, 28, 52, 80, 60, 36, 20, 44, 64, 40, 24, 16].map((height, index) => (
                  <span key={index} className="audio-magnifier-bar" style={{ height: `${height}%` }} />
                ))}
                <div className="audio-magnifier-playhead" style={{ left: '50%' }} />
              </div>
            </div>
          </div>
        </div>
        {subsection(text('Color', 'రంగు'), (
          <div className="appearance-position-field">
            <label htmlFor="appearance-controlDarkness">{text('Control darkness', 'నియంత్రణల ముదురు స్థాయి')}</label>
            <div className="appearance-scale">
              <input id="appearance-controlDarkness" type="range" min={CONTROL_DARKNESS_LIMITS.min} max={CONTROL_DARKNESS_LIMITS.max} step={1} style={{ '--range-progress': `${appearance.controlDarkness / CONTROL_DARKNESS_LIMITS.max * 100}%` } as CSSProperties} aria-valuetext={text(`${appearance.controlDarkness}% darker`, `${appearance.controlDarkness}% ముదురు`)} value={appearance.controlDarkness} onChange={event => updateAppearance({ controlDarkness: Number(event.target.value) })} />
              <output htmlFor="appearance-controlDarkness">{appearance.controlDarkness}%</output>
            </div>
          </div>
        ), undefined, text('Darkens audio controls, reader buttons, and Settings controls together without changing the background or reading text. 0% restores their original brightness.',
          'నేపథ్యం లేదా చదివే అక్షరాలను మార్చకుండా ఆడియో నియంత్రణలు, రీడర్ బటన్లు మరియు అమరికల నియంత్రణలను కలిపి ముదురు చేస్తుంది. 0% వాటి అసలు ప్రకాశాన్ని పునరుద్ధరిస్తుంది.'))}
        {subsection(text('Position', 'స్థానం'), (
          <>
            {offsetField('audioOffset', text('Vertical offset', 'నిలువు స్థానం'))}
            <fieldset className="appearance-magnifier-position">
              <legend>{text('Magnifier position', 'మాగ్నిఫైయర్ స్థానం')}</legend>
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
                    <span>{position === 'above' ? <ArrowUp size={16} aria-hidden="true" /> : <ArrowDown size={16} aria-hidden="true" />}{position === 'above' ? text('Above', 'పైన') : text('Below', 'కింద')}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {(['audioTimestampGap', 'timestampMagnifierGap'] as const).filter(setting => appearance.showAudioTimestamp || setting === 'audioTimestampGap').map(setting => (
              <div className="appearance-position-field" key={setting}>
                <label htmlFor={`appearance-${setting}`}>{setting === 'audioTimestampGap'
                  ? appearance.showAudioTimestamp
                    ? text('Audio bar to timestamp', 'ఆడియో బార్ నుండి సమయముద్ర వరకు')
                    : text('Audio bar to magnifier', 'ఆడియో బార్ నుండి మాగ్నిఫైయర్ వరకు')
                  : text('Timestamp to magnifier', 'సమయముద్ర నుండి మాగ్నిఫైయర్ వరకు')}</label>
                <div className="appearance-scale appearance-gap">
                  <input id={`appearance-${setting}`} type="range" min={CONTROL_SPACING_LIMITS.min} max={CONTROL_SPACING_LIMITS.max} step={1} style={{ '--range-progress': `${(appearance[setting] - CONTROL_SPACING_LIMITS.min) / (CONTROL_SPACING_LIMITS.max - CONTROL_SPACING_LIMITS.min) * 100}%` } as CSSProperties} aria-valuetext={`${appearance[setting]} px`} value={appearance[setting]} onChange={event => updateAppearance({ [setting]: Number(event.target.value) })} />
                  <output htmlFor={`appearance-${setting}`}>{appearance[setting]} px</output>
                </div>
              </div>
            ))}
          </>
        ), undefined, text('Offsets move the whole audio stack; spacing controls the gaps inside it.',
          'నిలువు స్థానం మొత్తం ఆడియో నియంత్రణలను కదుపుతుంది; అంతరం వాటి మధ్య ఖాళీని నిర్ణయిస్తుంది.'))}
        {subsection(text('Other', 'ఇతరాలు'), (
          <>
            <label className="settings-toggle-field">
              <span>{text('Show audio timestamp', 'ఆడియో సమయముద్రను చూపించు')}</span>
              <input type="checkbox" role="switch" checked={appearance.showAudioTimestamp} onChange={event => updateAppearance({ showAudioTimestamp: event.target.checked })} />
            </label>
            <label className="settings-toggle-field">
              <span>{text('Show magnifier highlight', 'మాగ్నిఫైయర్ ప్రాంతాన్ని చూపించు')}</span>
              <input type="checkbox" role="switch" checked={appearance.showMagnifierHighlight} onChange={event => updateAppearance({ showMagnifierHighlight: event.target.checked })} />
            </label>
          </>
        ), undefined, text('The magnifier highlight shades the part of the main bar the magnifier is showing.',
          'మాగ్నిఫైయర్ చూపిస్తున్న భాగాన్ని ప్రధాన బార్‌పై ఈ ఛాయ గుర్తిస్తుంది.'))}
      </section>

      <section className="appearance-section">
        <div className="appearance-section-heading">
          <h2>{text('Settings & Popovers', 'అమరికలు & పాప్‌ఓవర్లు')}</h2>
          {resetAction(text('Reset surface color', 'ఉపరితల రంగును పునరుద్ధరించు'), () => updateAppearance({ surface: null }))}
        </div>
        {subsection(text('Color', 'రంగు'), (
          <>
            <div className="appearance-colors">
              {colorSwatch(text('Surface', 'ఉపరితలం'), appearanceSurface(appearance), (value) => updateAppearance({ surface: value }), appearance.surface === null)}
            </div>
            <label className="settings-toggle-field">
              <span>{text('Derive from background', 'నేపథ్యం నుండి తీసుకో')}</span>
              <input type="checkbox" role="switch" checked={appearance.surface === null} onChange={(event) => updateAppearance({ surface: event.target.checked ? null : appearanceSurface(appearance) })} />
            </label>
          </>
        ), undefined, text('While derived, the surface follows the background colors and the swatch is read-only. Turn it off to pick a fixed color.',
          'నేపథ్యం నుండి తీసుకుంటున్నప్పుడు ఉపరితలం నేపథ్య రంగులను అనుసరిస్తుంది, రంగు ఎంపిక మార్చలేరు. స్థిర రంగు కోసం దీన్ని ఆపండి.'))}
      </section>

      <section className="appearance-section">
        <div className="appearance-section-heading">
          <h2>{text('Reader Gestures', 'రీడర్ సంజ్ఞలు')}</h2>
          {resetAction(text('Reset gesture settings', 'సంజ్ఞల అమరికలను పునరుద్ధరించు'), () => updateAppearance({
            scrollMode: DEFAULT_APPEARANCE.scrollMode,
            autoFadeSeconds: DEFAULT_APPEARANCE.autoFadeSeconds,
          }))}
        </div>
        {subsection(text('Other', 'ఇతరాలు'), (
          <>
            <label className="settings-toggle-field">
              <span>{text('Scroll mode', 'స్క్రోల్ మోడ్')}</span>
              <input type="checkbox" role="switch" checked={appearance.scrollMode} onChange={event => updateAppearance({ scrollMode: event.target.checked })} />
            </label>
            <div className="appearance-position-field">
              <label htmlFor="appearance-autoFade">{text('Auto-fade delay', 'దాచే సమయం')}</label>
              <div className="appearance-scale">
                <input id="appearance-autoFade" type="range" min={AUTO_FADE_SECONDS_LIMITS.min} max={AUTO_FADE_SECONDS_LIMITS.max} step={1} style={{ '--range-progress': `${(appearance.autoFadeSeconds - AUTO_FADE_SECONDS_LIMITS.min) / (AUTO_FADE_SECONDS_LIMITS.max - AUTO_FADE_SECONDS_LIMITS.min) * 100}%` } as CSSProperties} aria-valuetext={text(`${appearance.autoFadeSeconds} seconds`, `${appearance.autoFadeSeconds} సెకన్లు`)} value={appearance.autoFadeSeconds} onChange={event => updateAppearance({ autoFadeSeconds: Number(event.target.value) })} />
                <output htmlFor="appearance-autoFade">{appearance.autoFadeSeconds} s</output>
              </div>
            </div>
          </>
        ), undefined, text('Swipe left or right to reveal the audio bar; reverse direction to hide it. Tap anywhere to play or pause. An outside tap dismisses an open magnifier first. Auto-fade hides idle controls after the chosen delay.',
          'ఆడియో బార్ కోసం ఎడమకు లేదా కుడికి స్వైప్ చేయండి; దాచడానికి వ్యతిరేక దిశలో స్వైప్ చేయండి. ప్లే లేదా పాజ్ కోసం ఎక్కడైనా తాకండి. మాగ్నిఫైయర్ తెరిచి ఉంటే బయట తాకడం ముందు దానిని మూసివేస్తుంది. ఎంచుకున్న సమయం తర్వాత ఖాళీగా ఉన్న నియంత్రణలు దాగిపోతాయి.'))}
      </section>
    </div>
  );
}
