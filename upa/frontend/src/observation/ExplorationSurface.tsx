import {useEffect,useRef,useState} from 'react';
import type {DisplayObservation,ObservationAudio} from '../../../shared/contracts';
import type {ObservationFontFamily} from '../presentation';
import {getAlignedLetterAudio,getAlignedWordAudio} from '../api';
import {useAudioPlayer} from './audio/useAudioPlayer';
import {useObservationTypography} from './useObservationTypography';
import {ReaderTaps} from './reader-taps';
import {visibleWordAtPoint,visibleGraphemeAtPoint} from './visible-glyph-hit-testing';
import {copyOriginalReaderText} from './reader-hyphenation';
import {TeluguWordText} from './TeluguGradientText';
import {teluguHighlightRuns} from './telugu-highlighting';
import {appearanceModificationColor,useAppearance} from '../appearance';
import {renderTeluguGradientTexture,type TeluguGradientTexture} from './telugu-gradient-renderer';
import type {ExplorationStep} from './exploration-steps';

export interface ExplorationFocus {word:string;start:number;end:number;grapheme?:{text:string;start:number;end:number}}
export function ExplorationSurface({observation,step,profileCode,fontFamily,playbackRate,active,onFocus}: {
  observation:DisplayObservation;step:ExplorationStep;profileCode:string;fontFamily:ObservationFontFamily;
  playbackRate:number;active:boolean;onFocus:(focus:ExplorationFocus)=>void;
}) {
  const {appearance}=useAppearance();
  const [audio,setAudio]=useState<ObservationAudio|null>(null);
  const [error,setError]=useState('');
  const [taps]=useState(()=>new ReaderTaps());
  const cache=useRef(new Map<string,ObservationAudio>());
  const stepKey=`${observation.id}:${step.kind}:${step.start}:${step.end}`;
  const [loadedKey,setLoadedKey]=useState('');
  const player=useAudioPlayer(loadedKey===stepKey?audio:null,null,null,playbackRate,stepKey,false,active);
  const typography=useObservationTypography({...observation,id:stepKey,text:step.text},fontFamily,true);
  const runs=appearance.highlightMods?teluguHighlightRuns(step.text):null;
  const endColor=appearanceModificationColor(appearance);
  const gradientKey=JSON.stringify([stepKey,fontFamily,appearance.foreground,endColor,appearance.gradientBarrier,appearance.highlightMods]);
  const [textures,setTextures]=useState<{key:string;values:Array<TeluguGradientTexture|null>}|null>(null);
  useEffect(()=>{
    let active=true;
    void Promise.all((runs??[]).map(run=>run.highlighted?renderTeluguGradientTexture(run.text,fontFamily,appearance.foreground,endColor,appearance.gradientBarrier):null))
      .then(values=>{if(active)setTextures({key:gradientKey,values});}).catch(()=>{});
    return ()=>{active=false;};
  },[gradientKey]);
  useEffect(()=>{
    const controller=new AbortController();
    taps.cancel();setError('');setAudio(null);setLoadedKey('');
    const load=async()=>{
      const cached=cache.current.get(stepKey);if(cached)return cached;
      if(step.kind==='letter')return (await getAlignedLetterAudio(profileCode,observation.id,step.wordStart,step.wordEnd,step.graphemeStart!,step.graphemeEnd!,controller.signal)).audio;
      const last=await getAlignedWordAudio(profileCode,observation.id,step.wordStart,step.wordEnd,controller.signal);
      if(step.kind==='word')return last.audio;
      const first=[...new Intl.Segmenter('te',{granularity:'word'}).segment(observation.text)].find(part=>part.isWordLike)!;
      const start=await getAlignedWordAudio(profileCode,observation.id,first.index,first.index+first.segment.length,controller.signal);
      const firstTimes=start.audio.url.split('#t=')[1]?.split(',').map(Number);
      const lastTimes=last.audio.url.split('#t=')[1]?.split(',').map(Number);
      if(!firstTimes || !lastTimes || !Number.isFinite(firstTimes[0]) || !Number.isFinite(lastTimes[1]))throw new Error('Audio interval unavailable.');
      return {...last.audio,url:`${last.audio.url.split('#')[0]}#t=${firstTimes[0]},${lastTimes[1]}`,durationSeconds:lastTimes[1]!-firstTimes[0]!};
    };
    void load().then(result=>{
      if(controller.signal.aborted)return;
      cache.current.set(stepKey,result);setAudio(result);setLoadedKey(stepKey);
    }).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Audio unavailable.');});
    return ()=>{controller.abort();taps.cancel();};
  },[stepKey,profileCode]);
  return <section ref={typography.containerRef} className="exploration-surface" onClick={event=>{
    event.stopPropagation();
    const element=typography.textRef.current;
    const hit=element?(step.kind==='letter'?visibleGraphemeAtPoint(element,step.text,event.clientX,event.clientY):visibleWordAtPoint(element,step.text,event.clientX,event.clientY)):null;
    taps.tap(hit?`focus:${hit.start}`:'audio',event.clientX,event.clientY,()=>{
      if(!hit)return;
      player.pause();
      onFocus(step.kind==='letter'?{word:step.word,start:step.wordStart,end:step.wordEnd,grapheme:{text:step.text,start:step.graphemeStart!,end:step.graphemeEnd!}}
        :{word:hit.text,start:step.start+hit.start,end:step.start+hit.end});
    },()=>player.togglePlay());
  }} onDoubleClick={event=>{event.preventDefault();event.stopPropagation();}}>
    <audio ref={player.audioRef} hidden preload="auto" />
    <div ref={typography.textRef} className="observation-text" lang="te" onCopy={copyOriginalReaderText} style={{...typography.style,opacity:typography.ready?1:0}}>
      <TeluguWordText text={step.text} runs={runs} textures={textures?.key===gradientKey?textures.values:null}/>
    </div>
    {error||player.playbackError?<p className="audio-reader-error" role="alert">{error||player.playbackError}</p>:null}
  </section>;
}
