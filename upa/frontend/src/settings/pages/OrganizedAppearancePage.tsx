import type { CSSProperties } from 'react';
import { ChevronRight, RotateCcw, Shuffle } from 'lucide-react';
import {
  APPEARANCE_OFFSET_LIMIT, AUTO_FADE_SECONDS_LIMITS, CONTROL_DARKNESS_LIMITS,
  CONTROL_SPACING_LIMITS, DEFAULT_APPEARANCE, MODIFICATION_LIGHTNESS_LIMITS,
  appearanceAudioColor, appearanceAudioHoverColor, appearanceModificationColor,
  appearanceModificationTextShiftColor, appearanceSurface, randomAppearanceColors, useAppearance,
} from '../../appearance';
import { compatibleObservationFonts, OBSERVATION_FONTS, type ObservationFontFamily } from '../../presentation';
import { appearanceGroups, appearancePageLabel, type AppearancePage } from '../appearance-navigation';
import { ParserLinks, type ParserNavigate } from './ParserLinks';
import type { UiLanguage } from '../types';

export function OrganizedAppearancePage({language,page='appearance',onNavigate,font,onFont}:{
  language:UiLanguage;page?:AppearancePage;onNavigate:ParserNavigate;
  font:ObservationFontFamily|null;onFont:(font:ObservationFontFamily)=>void;
}) {
  const {appearance,updateAppearance}=useAppearance();
  const text=(en:string,te:string)=>language==='en'?en:te;
  const title=appearancePageLabel(page,language);
  const reset=(apply:()=>void)=><button type="button" className="appearance-icon-action" aria-label={text('Reset','పునరుద్ధరించు')} onClick={apply}><RotateCcw aria-hidden="true"/></button>;
  const slider=(key:'fontScale'|'textOffset'|'audioOffset'|'controlDarkness'|'audioTimestampGap'|'timestampMagnifierGap'|'modificationLightness'|'autoFadeSeconds',min:number,max:number,unit:string,disabled=false)=>
    <section className="appearance-control-page"><div className="appearance-section-heading"><label htmlFor={`appearance-${key}`}>{title}</label>{reset(()=>updateAppearance({[key]:DEFAULT_APPEARANCE[key]}))}</div>
      <div className="appearance-scale"><input id={`appearance-${key}`} type="range" min={min} max={max} step={1} disabled={disabled} value={appearance[key]}
        style={{'--range-progress':`${(appearance[key]-min)/(max-min)*100}%`} as CSSProperties}
        onChange={event=>updateAppearance({[key]:Number(event.target.value)})}/><output htmlFor={`appearance-${key}`}>{appearance[key]}{unit}</output></div>
    </section>;
  const toggle=(key:'highlightMods'|'showAudioTimestamp'|'showMagnifierHighlight')=><label className="appearance-switch-row"><span>{title}</span><input type="checkbox" role="switch" checked={appearance[key]} onChange={event=>updateAppearance({[key]:event.target.checked})}/></label>;
  const basePage=page.endsWith('Wheel')?page.slice(0,-5):page;
  const colorSetting=basePage==='appearanceForeground'?'foreground':basePage==='appearanceModificationColor'?'modificationColor':basePage==='appearanceSurfaceColor'?'surface':null;
  const backgroundIndex=['appearanceBackground1','appearanceBackground2','appearanceBackground3'].indexOf(basePage);
  const colorPage=colorSetting!==null||backgroundIndex>=0;
  const currentColor=backgroundIndex>=0?appearance.gradient[backgroundIndex]!:colorSetting==='foreground'?appearance.foreground:colorSetting==='modificationColor'?appearanceModificationColor(appearance):appearanceSurface(appearance);
  const setColor=(color:string|null)=>{
    if(backgroundIndex>=0&&color){const gradient:[string,string,string]=[...appearance.gradient];gradient[backgroundIndex]=color;updateAppearance({gradient});}
    else if(colorSetting==='foreground'&&color)updateAppearance({foreground:color,foregroundDefaultVersion:2});
    else if(colorSetting==='modificationColor')updateAppearance({modificationColor:color});
    else if(colorSetting==='surface')updateAppearance({surface:color});
  };
  const swatch=(label:string,color:string,value:string|null,selected:boolean)=><button type="button" key={label} className="appearance-preset" aria-pressed={selected} onClick={()=>setColor(value)}>
    <span className="appearance-preset-swatch" style={{backgroundColor:color}} aria-hidden="true"/><span>{label}</span>
  </button>;
  let content;
  if(colorPage){
    if(page.endsWith('Wheel'))content=<label className="appearance-color-row"><span>{text('Color','రంగు')}</span><output>{currentColor.toUpperCase()}</output><input type="color" aria-label={text('Color wheel','రంగు చక్రం')} value={currentColor} onChange={event=>setColor(event.target.value)}/></label>;
    else {
      const presets:Array<{label:string;color:string;value:string|null}>=colorSetting==='modificationColor'?[
        {label:text('Icon color','చిహ్న రంగు'),color:appearanceAudioColor(appearance),value:null},
        {label:text('Icon hover color','చిహ్న హోవర్ రంగు'),color:appearanceAudioHoverColor(appearance),value:appearanceAudioHoverColor(appearance)},
        {label:text('Text shift color','అక్షర మార్పు రంగు'),color:appearanceModificationTextShiftColor(appearance),value:appearanceModificationTextShiftColor(appearance)},
      ]:colorSetting==='foreground'?[
        {label:text('Violet','ఊదా'),color:DEFAULT_APPEARANCE.foreground,value:DEFAULT_APPEARANCE.foreground},
        {label:text('Pine','ఆకుపచ్చ'),color:'#30483e',value:'#30483e'},
        {label:text('Plum','ప్లమ్'),color:'#513751',value:'#513751'},
        {label:text('Blue','నీలం'),color:'#30435f',value:'#30435f'},
        {label:text('Lavender','లావెండర్'),color:'#d4cedf',value:'#d4cedf'},
      ]:colorSetting==='surface'?[
        {label:text('Theme surface','థీమ్ ఉపరితలం'),color:appearanceSurface({...appearance,surface:null}),value:null},
        ...appearance.gradient.map((color,index)=>({label:text(`Background ${index+1}`,`నేపథ్యం ${index+1}`),color,value:color})),
        {label:text('Slate','స్లేట్'),color:'#323844',value:'#323844'},
        {label:text('Warm paper','వెచ్చని కాగితం'),color:'#e6ddd1',value:'#e6ddd1'},
      ]:[
        {label:text('Default','డిఫాల్ట్'),color:DEFAULT_APPEARANCE.gradient[backgroundIndex]!,value:DEFAULT_APPEARANCE.gradient[backgroundIndex]!},
        ...[['Mist','#c8d5dc'],['Sage','#acbfb4'],['Rose','#ccb3bf'],['Lavender','#b8b1d0'],['Midnight','#344a44']].map(([label,color])=>({label:label!,color:color!,value:color!})),
      ];
      const selectedValue=colorSetting==='modificationColor'?appearance.modificationColor:colorSetting==='surface'?appearance.surface:currentColor;
      content=<><div className="appearance-presets">{presets.map(preset=>swatch(preset.label,preset.color,preset.value,selectedValue===preset.value))}</div>
        <ParserLinks pages={[`${basePage}Wheel` as AppearancePage]} onNavigate={onNavigate} language={language}/></>;
    }
  }else if(page==='appearanceFonts')content=<nav className="settings-index">{compatibleObservationFonts(OBSERVATION_FONTS).map(name=><button type="button" key={name} onClick={()=>onFont(name)}><span className="appearance-font-glyph" style={{fontFamily:`"${name}"`}} lang="te" aria-hidden="true">అ</span><span>{name}</span><ChevronRight className="settings-entry-chevron" aria-hidden="true"/></button>)}</nav>;
  else if(page==='appearanceFont')content=font?<><p className="appearance-font-sample" style={{fontFamily:`"${font}"`}} lang="te">తెలుగు</p><label className="appearance-switch-row"><span>{font}</span><input type="checkbox" role="switch" checked={appearance.fonts.includes(font)} disabled={compatibleObservationFonts(appearance.fonts).length===1&&appearance.fonts.includes(font)} onChange={event=>updateAppearance({fonts:event.target.checked?[...appearance.fonts,font]:appearance.fonts.filter(name=>name!==font)})}/></label></>:<p>{text('Choose a font.','ఫాంట్‌ను ఎంచుకోండి.')}</p>;
  else if(page==='appearanceSize')content=slider('fontScale',0,100,'');
  else if(page==='appearanceTextPosition')content=slider('textOffset',-APPEARANCE_OFFSET_LIMIT,APPEARANCE_OFFSET_LIMIT,' px');
  else if(page==='appearanceAudioOffset')content=slider('audioOffset',-APPEARANCE_OFFSET_LIMIT,APPEARANCE_OFFSET_LIMIT,' px');
  else if(page==='appearanceDarkness')content=slider('controlDarkness',CONTROL_DARKNESS_LIMITS.min,CONTROL_DARKNESS_LIMITS.max,'%');
  else if(page==='appearanceBarGap')content=slider('audioTimestampGap',CONTROL_SPACING_LIMITS.min,CONTROL_SPACING_LIMITS.max,' px');
  else if(page==='appearanceMagnifierGap')content=slider('timestampMagnifierGap',CONTROL_SPACING_LIMITS.min,CONTROL_SPACING_LIMITS.max,' px',!appearance.showAudioTimestamp);
  else if(page==='appearanceModificationLightness')content=slider('modificationLightness',MODIFICATION_LIGHTNESS_LIMITS.min,MODIFICATION_LIGHTNESS_LIMITS.max,'%');
  else if(page==='appearanceFade')content=slider('autoFadeSeconds',AUTO_FADE_SECONDS_LIMITS.min,AUTO_FADE_SECONDS_LIMITS.max,' s');
  else if(page==='appearanceHighlight')content=toggle('highlightMods');
  else if(page==='appearanceTimestamp')content=toggle('showAudioTimestamp');
  else if(page==='appearanceMagnifierHighlight')content=toggle('showMagnifierHighlight');
  else if(page==='appearanceMagnifierPosition')content=<fieldset className="appearance-magnifier-position"><legend>{title}</legend><div className="appearance-position-options">{(['above','below'] as const).map(position=><label key={position}><input type="radio" name="magnifier-position" checked={appearance.magnifierPosition===position} onChange={()=>updateAppearance({magnifierPosition:position,textOffset:appearance.textOffsetOther,audioOffset:appearance.audioOffsetOther,textOffsetOther:appearance.textOffset,audioOffsetOther:appearance.audioOffset})}/><span>{position==='above'?text('Above','పైన'):text('Below','కింద')}</span></label>)}</div></fieldset>;
  else if(page==='appearanceTrigger')content=<fieldset className="appearance-magnifier-position"><legend>{title}</legend><div className="appearance-position-options">{(['scroll','tap'] as const).map(trigger=><label key={trigger}><input type="radio" name="toggle-trigger" checked={appearance.toggleTrigger===trigger} onChange={()=>updateAppearance({toggleTrigger:trigger,scrollMode:trigger==='scroll'})}/><span>{trigger==='scroll'?text('Scroll mode','స్క్రోల్ మోడ్'):text('Tap mode','టాప్ మోడ్')}</span></label>)}</div></fieldset>;
  else if(page==='appearanceRandom')content=<div className="appearance-control-page"><button type="button" className="secondary-action" onClick={()=>updateAppearance({...randomAppearanceColors(),foregroundDefaultVersion:2,surface:null})}><Shuffle size={18} aria-hidden="true"/> {title}</button>{reset(()=>updateAppearance({gradient:DEFAULT_APPEARANCE.gradient,foreground:DEFAULT_APPEARANCE.foreground,foregroundDefaultVersion:2,surface:null}))}</div>;
  else content=<ParserLinks pages={appearanceGroups[page]??[]} onNavigate={onNavigate} language={language}/>;
  return <div className="appearance-page appearance-page-organized appearance-paged">{content}</div>;
}
