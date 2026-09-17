import type { CSSProperties, ReactNode } from 'react';
import { ArrowDown, ArrowUp, RotateCcw, Shuffle } from 'lucide-react';
import { APPEARANCE_OFFSET_LIMIT, AUTO_FADE_SECONDS_LIMITS, CONTROL_DARKNESS_LIMITS, CONTROL_SPACING_LIMITS, DEFAULT_APPEARANCE, MODIFICATION_LIGHTNESS_LIMITS, appearanceAudioColor, appearanceAudioGlass, appearanceAudioHoverColor, appearanceModificationColor, appearanceModificationTextShiftColor, appearanceSurface, randomAppearanceColors, useAppearance } from '../../appearance';
import { OBSERVATION_FONTS } from '../../presentation';
import type { UiLanguage } from '../types';
import { teluguHighlightRuns } from '../../observation/telugu-highlighting';
import { CollapsibleSettingsSection } from '../CollapsibleSettingsSection';

function ElementGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <CollapsibleSettingsSection className="appearance-element" title={title} description={description}>{children}</CollapsibleSettingsSection>;
}

function Subsection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <div className="appearance-subsection"><div className="appearance-section-heading"><h3>{title}</h3>{action}</div>{children}</div>;
}

export function OrganizedAppearancePage({ language }: { language: UiLanguage }) {
  const { appearance, updateAppearance } = useAppearance();
  const glass = appearanceAudioGlass(appearance);
  const modificationColor = appearanceModificationColor(appearance);
  const text = (english: string, telugu: string) => language === 'en' ? english : telugu;
  const modificationPresets = [
    { label: text('Icon Color', 'చిహ్న రంగు'), color: appearanceAudioColor(appearance) },
    { label: text('Icon Hover Color', 'చిహ్న హోవర్ రంగు'), color: appearanceAudioHoverColor(appearance) },
    { label: text('Text Shift Color', 'అక్షర మార్పు రంగు'), color: appearanceModificationTextShiftColor(appearance) },
  ];
  const reset = (label: string, update: () => void) => <button type="button" className="appearance-icon-action" aria-label={label} onClick={update}><RotateCcw aria-hidden="true" /></button>;
  const previewText = 'తెలుగు';
  const offset = (setting: 'textOffset' | 'audioOffset', label: string) => <div className="appearance-position-field">
    <label htmlFor={`appearance-${setting}`}>{label}</label>
    <div className="appearance-scale appearance-offset"><ArrowUp size={16} aria-hidden="true" /><input id={`appearance-${setting}`} type="range" min={-APPEARANCE_OFFSET_LIMIT} max={APPEARANCE_OFFSET_LIMIT} step={1} value={appearance[setting]} style={{ '--range-progress': `${(appearance[setting] + APPEARANCE_OFFSET_LIMIT) / (APPEARANCE_OFFSET_LIMIT * 2) * 100}%` } as CSSProperties} aria-valuetext={`${appearance[setting]} px`} onChange={event => updateAppearance({ [setting]: Number(event.target.value) })} /><ArrowDown size={16} aria-hidden="true" /><output htmlFor={`appearance-${setting}`}>{appearance[setting] > 0 ? '+' : ''}{appearance[setting]} px</output></div>
  </div>;
  return <div className="appearance-page appearance-page-organized">
    <div className="appearance-preview" role="img" aria-label={text('Appearance preview', 'రూపం నమూనా')}><span lang="te" style={{ fontFamily: `"${appearance.fonts[0]}"`, fontSize: `${24 + appearance.fontScale * .24}px` }}>{appearance.highlightMods ? teluguHighlightRuns(previewText).map((run, index) => run.highlighted ? <span className="telugu-modification" key={index}>{run.text}</span> : run.text) : previewText}</span></div>

    <ElementGroup title={text('Background', 'నేపథ్యం')} description={text('Colors behind the reader and throughout the application.', 'రీడర్ మరియు అప్లికేషన్ అంతటా కనిపించే నేపథ్య రంగులు.')}>
      <Subsection title={text('Colors', 'రంగులు')} action={<div className="appearance-color-actions"><button type="button" className="appearance-icon-action" aria-label={text('Randomize colors', 'యాదృచ్ఛిక రంగులు')} onClick={() => updateAppearance({ ...randomAppearanceColors(), surface: null })}><Shuffle aria-hidden="true" /></button>{reset(text('Reset background colors', 'నేపథ్య రంగులను పునరుద్ధరించు'), () => updateAppearance({ gradient: DEFAULT_APPEARANCE.gradient, surface: null }))}</div>}>
        <div className="appearance-colors">{appearance.gradient.map((color, index) => <label key={index}><input type="color" aria-label={text(`Background color ${index + 1}`, `నేపథ్య రంగు ${index + 1}`)} value={color} onChange={event => { const gradient: [string, string, string] = [...appearance.gradient]; gradient[index] = event.target.value; updateAppearance({ gradient }); }} /><span>{text(`Color ${index + 1}`, `రంగు ${index + 1}`)}</span><output>{color.toUpperCase()}</output></label>)}</div>
      </Subsection>
    </ElementGroup>

    <ElementGroup title={text('Reading Text & Icons', 'చదివే అక్షరాలు & చిహ్నాలు')} description={text('Shared color, size, position, and typefaces for reading content and controls.', 'చదివే విషయం మరియు నియంత్రణలకు ఉమ్మడి రంగు, పరిమాణం, స్థానం మరియు ఫాంట్లు.')}>
      <Subsection title={text('Color', 'రంగు')} action={reset(text('Reset text and icon color', 'అక్షరాలు మరియు చిహ్నాల రంగును పునరుద్ధరించు'), () => updateAppearance({ foreground: DEFAULT_APPEARANCE.foreground }))}>
        <label className="appearance-color-row"><span>{text('Text & Icons', 'అక్షరాలు & చిహ్నాలు')}</span><output>{appearance.foreground.toUpperCase()}</output><input type="color" aria-label={text('Text and icons color', 'అక్షరాలు మరియు చిహ్నాల రంగు')} value={appearance.foreground} onChange={event => updateAppearance({ foreground: event.target.value })} /></label>
      </Subsection>
      <Subsection title={text('Type Size', 'అక్షరాల పరిమాణం')} action={reset(text('Reset type size', 'అక్షరాల పరిమాణాన్ని పునరుద్ధరించు'), () => updateAppearance({ fontScale: DEFAULT_APPEARANCE.fontScale }))}>
        <label className="appearance-scale"><input type="range" min={0} max={100} step={1} style={{ '--range-progress': `${appearance.fontScale}%` } as CSSProperties} aria-label={text('Font size scale', 'అక్షరాల పరిమాణ స్థాయి')} value={appearance.fontScale} onChange={event => updateAppearance({ fontScale: Number(event.target.value) })} /><output>{appearance.fontScale}</output></label>
      </Subsection>
      <Subsection title={text('Letter Modifications', 'అక్షర మార్పులు')} action={reset(text('Reset modification color', 'మార్పు రంగును పునరుద్ధరించు'), () => updateAppearance({ modificationLightness: DEFAULT_APPEARANCE.modificationLightness, modificationColor: null }))}>
        <label className="appearance-switch-row"><span>{text('Highlight Mods', 'మార్పులను హైలైట్ చేయి')}</span><input type="checkbox" role="switch" checked={appearance.highlightMods} onChange={event => updateAppearance({ highlightMods: event.target.checked })} /></label>
        <label className="appearance-switch-row"><span>{text('Automatic End Color', 'స్వయంచాలక ముగింపు రంగు')}</span><input type="checkbox" role="switch" checked={appearance.modificationColor === null} disabled={!appearance.highlightMods} onChange={event => updateAppearance({ modificationColor: event.target.checked ? null : modificationColor })} /></label>
        <div className="appearance-quick-colors">{modificationPresets.map(preset => <button type="button" key={preset.label} className="appearance-quick-color" aria-label={preset.label} aria-pressed={appearance.modificationColor === preset.color} disabled={!appearance.highlightMods} style={{ '--quick-color': preset.color } as CSSProperties} onClick={() => updateAppearance({ modificationColor: preset.color })}><span /><small>{preset.label}</small></button>)}</div>
        <label className="appearance-color-row"><span>{text('Gradient End Color', 'గ్రేడియంట్ ముగింపు రంగు')}</span><output>{modificationColor.toUpperCase()}</output><input type="color" aria-label={text('Gradient end color', 'గ్రేడియంట్ ముగింపు రంగు')} value={modificationColor} disabled={!appearance.highlightMods} onChange={event => updateAppearance({ modificationColor: event.target.value })} /></label>
        <div className="appearance-position-field"><label htmlFor="appearance-modification-lightness">{text('Modification Lightness', 'మార్పు ప్రకాశం')}</label><div className="appearance-scale"><input id="appearance-modification-lightness" type="range" min={MODIFICATION_LIGHTNESS_LIMITS.min} max={MODIFICATION_LIGHTNESS_LIMITS.max} step={1} style={{ '--range-progress': `${appearance.modificationLightness / MODIFICATION_LIGHTNESS_LIMITS.max * 100}%` } as CSSProperties} value={appearance.modificationLightness} disabled={!appearance.highlightMods} onChange={event => updateAppearance({ modificationLightness: Number(event.target.value) })} /><output htmlFor="appearance-modification-lightness">{appearance.modificationLightness}%</output></div></div>
      </Subsection>
      <Subsection title={text('Position', 'స్థానం')} action={reset(text('Reset text position', 'అక్షరాల స్థానాన్ని పునరుద్ధరించు'), () => updateAppearance({ textOffset: 0 }))}>{offset('textOffset', text('Vertical Offset', 'నిలువు స్థానం'))}</Subsection>
      <Subsection title={text('Fonts', 'ఫాంట్లు')}>
        <div className="appearance-fonts">{OBSERVATION_FONTS.map(font => <label key={font}><input type="checkbox" checked={appearance.fonts.includes(font)} disabled={appearance.fonts.length === 1 && appearance.fonts.includes(font)} onChange={event => updateAppearance({ fonts: event.target.checked ? [...appearance.fonts, font] : appearance.fonts.filter(entry => entry !== font) })} /><span>{font}</span><span className="font-preview" style={{ fontFamily: `"${font}"` }} lang="te">తెలుగు</span></label>)}</div>
      </Subsection>
    </ElementGroup>

    <ElementGroup title={text('Audio Controls', 'ఆడియో నియంత్రణలు')} description={text('Appearance, placement, spacing, and visibility behavior for the audio bar.', 'ఆడియో బార్ రూపం, స్థానం, అంతరం మరియు కనిపించే ప్రవర్తన.')}>
      <Subsection title={text('Darkness', 'ముదురు స్థాయి')} action={reset(text('Reset control darkness', 'నియంత్రణల ముదురు స్థాయిని పునరుద్ధరించు'), () => updateAppearance({ controlDarkness: DEFAULT_APPEARANCE.controlDarkness }))}>
        <label className="appearance-scale"><input type="range" min={CONTROL_DARKNESS_LIMITS.min} max={CONTROL_DARKNESS_LIMITS.max} step={1} style={{ '--range-progress': `${appearance.controlDarkness / CONTROL_DARKNESS_LIMITS.max * 100}%` } as CSSProperties} aria-label={text('Control darkness', 'నియంత్రణల ముదురు స్థాయి')} value={appearance.controlDarkness} onChange={event => updateAppearance({ controlDarkness: Number(event.target.value) })} /><output>{appearance.controlDarkness}%</output></label>
      </Subsection>
      <Subsection title={text('Position', 'స్థానం')} action={reset(text('Reset audio positions', 'ఆడియో స్థానాలను పునరుద్ధరించు'), () => updateAppearance({ audioOffset: 0, audioOffsetOther: 0, magnifierPosition: DEFAULT_APPEARANCE.magnifierPosition }))}>
        {offset('audioOffset', text('Audio Bar Vertical Offset', 'ఆడియో బార్ నిలువు స్థానం'))}
        <fieldset className="appearance-magnifier-position"><legend>{text('Magnifier Position', 'మాగ్నిఫైయర్ స్థానం')}</legend><div className="appearance-position-options">{(['above', 'below'] as const).map(position => <label key={position}><input type="radio" name="magnifier-position" value={position} checked={appearance.magnifierPosition === position} onChange={() => updateAppearance({ magnifierPosition: position, textOffset: appearance.textOffsetOther, audioOffset: appearance.audioOffsetOther, textOffsetOther: appearance.textOffset, audioOffsetOther: appearance.audioOffset })} /><span>{position === 'above' ? <ArrowUp size={16} aria-hidden="true" /> : <ArrowDown size={16} aria-hidden="true" />}{position === 'above' ? text('Above', 'పైన') : text('Below', 'కింద')}</span></label>)}</div></fieldset>
      </Subsection>
      <Subsection title={text('Spacing', 'అంతరం')} action={reset(text('Reset control spacing', 'నియంత్రణల అంతరాన్ని పునరుద్ధరించు'), () => updateAppearance({ audioTimestampGap: DEFAULT_APPEARANCE.audioTimestampGap, timestampMagnifierGap: DEFAULT_APPEARANCE.timestampMagnifierGap }))}>
        <div className="appearance-audio-preview" role="img" aria-label={text('Audio spacing preview', 'ఆడియో అంతరం నమూనా')} style={{ '--audio-glass-gradient': glass.gradient, '--audio-glass-edge': glass.edge } as CSSProperties}><div className="audio-player-bar" data-magnifier-position={appearance.magnifierPosition} aria-hidden="true"><div className="audio-scrubber-row"><div className="audio-scrubber"><div className="audio-scrubber-progress" style={{ width: '40%' }} /><div className="audio-scrubber-thumb" style={{ left: '40%' }} /></div></div><div className="audio-precision-panel">{appearance.showAudioTimestamp ? <div className="audio-magnifier-time">0:12.340</div> : null}<div className="audio-magnifier-track">{[16, 24, 40, 28, 60, 84, 48, 32, 68, 100, 72, 44, 28, 52, 80, 60, 36, 20, 44, 64, 40, 24, 16].map((height, index) => <span key={index} className="audio-magnifier-bar" style={{ height: `${height}%` }} />)}<div className="audio-magnifier-playhead" style={{ left: '50%' }} /></div></div></div></div>
        {(['audioTimestampGap', 'timestampMagnifierGap'] as const).filter(setting => appearance.showAudioTimestamp || setting === 'audioTimestampGap').map(setting => <div className="appearance-position-field" key={setting}><label htmlFor={`appearance-${setting}`}>{setting === 'audioTimestampGap' ? (appearance.showAudioTimestamp ? text('Audio Bar to Timestamp', 'ఆడియో బార్ నుండి సమయముద్ర వరకు') : text('Audio Bar to Magnifier', 'ఆడియో బార్ నుండి మాగ్నిఫైయర్ వరకు')) : text('Timestamp to Magnifier', 'సమయముద్ర నుండి మాగ్నిఫైయర్ వరకు')}</label><div className="appearance-scale appearance-gap"><input id={`appearance-${setting}`} type="range" min={CONTROL_SPACING_LIMITS.min} max={CONTROL_SPACING_LIMITS.max} step={1} style={{ '--range-progress': `${(appearance[setting] - CONTROL_SPACING_LIMITS.min) / (CONTROL_SPACING_LIMITS.max - CONTROL_SPACING_LIMITS.min) * 100}%` } as CSSProperties} value={appearance[setting]} onChange={event => updateAppearance({ [setting]: Number(event.target.value) })} /><output>{appearance[setting]} px</output></div></div>)}
      </Subsection>
      <Subsection title={text('Behavior', 'ప్రవర్తన')}>
        <div className="appearance-setting-list"><label className="appearance-switch-row"><span>{text('Show Audio Timestamp', 'ఆడియో సమయముద్రను చూపించు')}</span><input type="checkbox" role="switch" checked={appearance.showAudioTimestamp} onChange={event => updateAppearance({ showAudioTimestamp: event.target.checked })} /></label><label className="appearance-switch-row"><span>{text('Show Magnifier Highlight', 'మాగ్నిఫైయర్ హైలైట్‌ను చూపించు')}</span><input type="checkbox" role="switch" checked={appearance.showMagnifierHighlight} onChange={event => updateAppearance({ showMagnifierHighlight: event.target.checked })} /></label></div>
        <fieldset className="appearance-magnifier-position appearance-toggle-trigger"><legend>{text('Toggle Trigger', 'టాగుల్ ట్రిగ్గర్')}</legend><div className="appearance-position-options">{(['scroll', 'tap'] as const).map(trigger => <label key={trigger}><input type="radio" name="toggle-trigger" value={trigger} checked={appearance.toggleTrigger === trigger} onChange={() => updateAppearance({ toggleTrigger: trigger, scrollMode: trigger === 'scroll' })} /><span>{trigger === 'scroll' ? text('Scroll Mode', 'స్క్రోల్ మోడ్') : text('Tap Mode', 'టాప్ మోడ్')}</span></label>)}</div></fieldset>
      </Subsection>
      <Subsection title={text('Auto-Fade', 'స్వయంచాలకంగా దాచడం')} action={reset(text('Reset auto-fade delay', 'దాచే సమయాన్ని పునరుద్ధరించు'), () => updateAppearance({ autoFadeSeconds: DEFAULT_APPEARANCE.autoFadeSeconds }))}>
        <label className="appearance-scale"><input type="range" min={AUTO_FADE_SECONDS_LIMITS.min} max={AUTO_FADE_SECONDS_LIMITS.max} step={1} style={{ '--range-progress': `${(appearance.autoFadeSeconds - AUTO_FADE_SECONDS_LIMITS.min) / (AUTO_FADE_SECONDS_LIMITS.max - AUTO_FADE_SECONDS_LIMITS.min) * 100}%` } as CSSProperties} aria-label={text('Auto-fade delay', 'దాచే సమయం')} value={appearance.autoFadeSeconds} onChange={event => updateAppearance({ autoFadeSeconds: Number(event.target.value) })} /><output>{appearance.autoFadeSeconds} s</output></label>
      </Subsection>
    </ElementGroup>

    <ElementGroup title={text('Settings & Popovers', 'అమరికలు & పాప్‌ఓవర్లు')} description={text('Surface color used behind Settings pages, menus, and popovers.', 'అమరికల పేజీలు, మెనూలు మరియు పాప్‌ఓవర్ల వెనుక ఉపయోగించే ఉపరితల రంగు.')}>
      <Subsection title={text('Surface Color', 'ఉపరితల రంగు')} action={reset(text('Reset surface color', 'ఉపరితల రంగును పునరుద్ధరించు'), () => updateAppearance({ surface: null }))}>
        <label className="appearance-color-row"><span>{text('Surface', 'ఉపరితలం')}</span><output>{appearanceSurface(appearance).toUpperCase()}</output><input type="color" disabled={appearance.surface === null} aria-label={text('Settings and popovers color', 'అమరికలు మరియు పాప్‌ఓవర్ల రంగు')} value={appearanceSurface(appearance)} onChange={event => updateAppearance({ surface: event.target.value })} /></label>
        <label className="appearance-switch-row"><span><strong>{text('Automatic Surface', 'స్వయంచాలక ఉపరితలం')}</strong><small>{text('Derive a readable surface from the background. Turn this off to choose the surface color manually.', 'నేపథ్యం నుండి చదవగల ఉపరితలాన్ని రూపొందిస్తుంది. ఉపరితల రంగును స్వయంగా ఎంచుకోవడానికి దీనిని ఆపండి.')}</small></span><input type="checkbox" role="switch" checked={appearance.surface === null} onChange={event => updateAppearance({ surface: event.target.checked ? null : appearanceSurface(appearance) })} /></label>
      </Subsection>
    </ElementGroup>
  </div>;
}