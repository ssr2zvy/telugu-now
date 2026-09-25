import {useEffect,useRef,useState,useImperativeHandle, type Ref, type RefObject} from 'react';
import type {DisplayObservation,ObservationAudio} from '../../../shared/contracts';
import {getAlignedLetterAudio,getAlignedWordAudio} from '../api';
import {useAudioPlayer} from './audio/useAudioPlayer';
import {ReaderTaps} from './reader-taps';
import {visibleWordAtPoint,visibleGraphemeAtPoint} from './visible-glyph-hit-testing';
import type {ExplorationStep} from './exploration-steps';

export interface ExplorationFocus {word:string;start:number;end:number;grapheme?:{text:string;start:number;end:number}}
export interface ExplorationHandle { tap(clientX: number, clientY: number): void }
export function ExplorationSurface({observation,step,profileCode,textRef,ref,playbackRate,active,onFocus}: {
  observation:DisplayObservation;step:ExplorationStep;profileCode:string; textRef:RefObject<HTMLDivElement|null>; ref:Ref<ExplorationHandle>;
  playbackRate:number;active:boolean;onFocus:(focus:ExplorationFocus)=>void;
}) {
  const [audio,setAudio]=useState<ObservationAudio|null>(null);
  const [error,setError]=useState('');
  const [taps]=useState(()=>new ReaderTaps());
  const cache=useRef(new Map<string,ObservationAudio>());
  const stepKey=`${observation.id}:${step.kind}:${step.start}:${step.end}`;
  const [loadedKey,setLoadedKey]=useState('');
  const player=useAudioPlayer(loadedKey===stepKey?audio:null,null,null,playbackRate,stepKey,false,active);
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
  useImperativeHandle(ref, () => ({tap(clientX, clientY) {
    if (!active) return;
    const element=textRef.current;
    const candidate=element?(step.kind==='letter'?visibleGraphemeAtPoint(element,observation.text,clientX,clientY):visibleWordAtPoint(element,observation.text,clientX,clientY)):null;
    const hit=candidate && candidate.start>=step.start && candidate.end<=step.end ? candidate : null;
    const region=hit?`focus:${hit.start}`:'audio';
    if (!window.getSelection()?.isCollapsed && !taps.matches(region,clientX,clientY)) {taps.cancel();return;}
    taps.tap(region,clientX,clientY,()=>{
      if(!hit)return;
      player.pause();
      window.getSelection()?.removeAllRanges();
      onFocus(step.kind==='letter'?{word:step.word,start:step.wordStart,end:step.wordEnd,grapheme:{text:step.text,start:step.graphemeStart!,end:step.graphemeEnd!}}
        :{word:hit.text,start:hit.start,end:hit.end});
    },()=>player.togglePlay());
  }}));
  return <>
    <audio ref={player.audioRef} hidden preload="auto" />
    {error||player.playbackError?<p className="audio-reader-error" role="alert">{error||player.playbackError}</p>:null}
  </>;
}
