import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, CircleAlert, CopyPlus, LoaderCircle, RotateCw, X } from 'lucide-react';
import { useAppearance } from '../appearance';
import type { RepositoryFile } from '../../../shared/repository';
import { GoogleTeluguKeyboard } from '../observation/GoogleTeluguKeyboard';
import { repositoryApi, RepositoryRequestError } from './api';
import { draftKey, recoverDraft, RepositoryDraft } from './draft';

export function RepositoryFileEditor({ profile, file, fontFamily, onBack }: {
  profile: string; file: RepositoryFile; fontFamily: string; onBack: () => void;
}) {
  const {appearance} = useAppearance();
  const panel = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirm,setConfirm] = useState(false);
  const [late,setLate] = useState(false);
  const [slide,setSlide] = useState(0);
  const [dragging,setDragging] = useState(false);
  const swipe = useRef<{id:number;x:number;y:number;time:number;claimed:boolean;target:EventTarget} | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [,render] = useState(0);
  const [typing,setTyping] = useState(false);
  const [leaving,setLeaving] = useState(false);
  const [copying,setCopying] = useState(false);
  const alive = useRef(true);
  const key = draftKey(profile,file.id);
  const [draft] = useState(() => new RepositoryDraft(file,
    saved => repositoryApi.update(profile,file.id,saved),
    saved => { try { if (saved) localStorage.setItem(key,JSON.stringify(saved)); else localStorage.removeItem(key); } catch { /* saving to the server still works without local storage */ } },
    () => { if (alive.current) render(n => n + 1); },recoverDraft(key)));
  useEffect(() => {
    alive.current = true;
    if (draft.state === 'dirty') void draft.flush();
    const flush = () => { void draft.flush(); };
    document.addEventListener('visibilitychange',flush); window.addEventListener('pagehide',flush);
    return () => { alive.current = false; draft.dispose(); document.removeEventListener('visibilitychange',flush); window.removeEventListener('pagehide',flush); };
  },[draft]);
  const unsaved = draft.state !== 'saved';
  useEffect(() => {
    if (!unsaved) { setLate(false); return; }
    const timer = setTimeout(() => setLate(true),5000);
    return () => clearTimeout(timer);
  },[unsaved]);
  useEffect(() => { if (confirm) dialog.current?.showModal(); else dialog.current?.close(); },[confirm]);
  useEffect(() => () => clearTimeout(exitTimer.current),[]);
  const completeBack = () => {
    if (leaving) return;
    setLeaving(true); setSlide(window.innerWidth);
    exitTimer.current = setTimeout(onBack, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260);
  };
  const requestBack = () => {
    setDragging(false);
    if (draft.state === 'saved') completeBack();
    else { setSlide(0); setConfirm(true); void draft.flush(); }
  };
  const recoverCopy = async () => {
    if (copying || leaving) return;
    setCopying(true);
    try {
      const suffix = new Date().toISOString().replace(/[:.]/g,'-');
      const name = `${file.name.slice(0,160)} · ${suffix}`;
      const copy = await repositoryApi.create(profile,file.parentId,'file',name).catch(error => {
        if (file.parentId && error instanceof RepositoryRequestError && error.code === 'not-found') return repositoryApi.create(profile,null,'file',name);
        throw error;
      });
      await repositoryApi.update(profile,copy.id,{revision:copy.revision,content:draft.value});
      try { localStorage.removeItem(key); } catch { /* no local storage */ }
      onBack();
    } catch { if (alive.current) setCopying(false); }
  };
  return <section ref={panel} className="repository-document" inert={leaving} aria-label="పత్రం" data-dragging={dragging}
    style={{transform:`translateX(${slide}px)`, '--file-title-size':`${appearance.fileTitleSize}px`, '--file-text-size':`${appearance.fileTextSize}px`} as CSSProperties}
    onPointerDownCapture={event => {
      if (confirm || leaving || !event.isPrimary || event.button !== 0 || (event.target as Element).closest('button,.question-keyboard,dialog')) return;
      swipe.current = {id:event.pointerId,x:event.clientX,y:event.clientY,time:performance.now(),claimed:false,target:event.target};
    }}
    onPointerMoveCapture={event => {
      const point = swipe.current;
      if (!point || point.id !== event.pointerId) return;
      const dx = event.clientX-point.x, dy = event.clientY-point.y;
      if (!point.claimed) {
        if (performance.now()-point.time > 400 || Math.abs(dy)>12 || dx < -12) { swipe.current = null; return; }
        if (dx<16 || dx<Math.abs(dy)*1.5) return;
        point.claimed = true;
        (point.target as Element).dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:event.pointerId}));
        swipe.current = point;
        event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
      }
      event.preventDefault(); event.stopPropagation(); setSlide(Math.max(0,dx));
    }}
    onPointerUpCapture={event => {
      const point = swipe.current; swipe.current = null;
      if (!point?.claimed) return;
      event.preventDefault(); event.stopPropagation(); setDragging(false);
      if (event.clientX-point.x > Math.min(100,window.innerWidth*.23)) requestBack(); else setSlide(0);
    }}
    onPointerCancelCapture={() => { swipe.current = null; setDragging(false); setSlide(0); }}>
    <header className="repository-file-toolbar"><span className="repository-file-name">{file.name}</span></header>
    <GoogleTeluguKeyboard value={draft.value} onChange={value => draft.edit(value)} onSubmit={() => {}} fontFamily={fontFamily}
      freeTyping documentMode keyboardVisible={typing} onActivate={() => setTyping(true)} onHide={() => setTyping(false)}/>
    {late && !confirm ? <div className="repository-save-warning" role="alert"><CircleAlert/><span>ఇంకా భద్రపడలేదు.</span><button type="button" aria-label="మళ్ళీ ప్రయత్నించు" onClick={() => { setConfirm(true); void draft.flush(); }}><RotateCw/></button><button type="button" aria-label="మూయి" onClick={() => setLate(false)}><X/></button></div> : null}
    {confirm ? <dialog ref={dialog} className="repository-delete-dialog repository-save-dialog" aria-label="భద్రపరచు" onCancel={event => {event.preventDefault();setConfirm(false);}}>
      <div className="repository-save-status" role="status" aria-label={draft.state === 'saved' ? 'భద్రపడింది' : 'భద్రపరచు'}>
        {draft.state === 'saved' ? <Check/> : draft.state === 'error' || draft.state === 'conflict' ? <CircleAlert/> : <LoaderCircle className="repository-spin"/>}
      </div>
      <div className="repository-delete-actions">
        <button type="button" aria-label="రద్దు" disabled={copying} onClick={() => setConfirm(false)}><X/></button>
        {draft.state === 'conflict' ? <button type="button" aria-label="నకలుగా భద్రపరచు" disabled={copying} onClick={() => void recoverCopy()}>{copying ? <LoaderCircle className="repository-spin"/> : <CopyPlus/>}</button> : draft.state === 'error' ? <button type="button" aria-label="మళ్ళీ ప్రయత్నించు" onClick={() => void draft.flush()}><RotateCw/></button> : null}
        <button type="button" aria-label="వెనుక" disabled={draft.state !== 'saved' || leaving} onClick={() => {setConfirm(false);completeBack();}}><Check/></button>
      </div>
    </dialog> : null}
  </section>;
}
