import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CloudUpload, CopyPlus, Keyboard, LoaderCircle, RotateCw, X } from 'lucide-react';
import type { RepositoryFile } from '../../../shared/repository';
import { GoogleTeluguKeyboard } from '../observation/GoogleTeluguKeyboard';
import { repositoryApi, RepositoryRequestError } from './api';
import { draftKey, recoverDraft, RepositoryDraft } from './draft';

export function RepositoryFileEditor({ profile, file, fontFamily, onBack, onClose }: {
  profile: string; file: RepositoryFile; fontFamily: string; onBack: () => void; onClose: () => void;
}) {
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
  const leave = async (close: () => void) => {
    if (leaving || copying) return;
    setLeaving(true);
    if (await draft.flush()) close();
    if (alive.current) setLeaving(false);
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
  const failed = draft.state === 'error' || draft.state === 'conflict';
  return <section className="repository-document" aria-label="పత్రం">
    <header className="repository-file-toolbar">
      <span className="repository-file-name">{file.name}</span>
      {typing ? <button type="button" aria-label="కీబోర్డు మూయి" className="repository-hide-keyboard" onClick={() => setTyping(false)}><Keyboard/><span aria-hidden="true">⌄</span></button> : null}
      <button type="button" className="repository-save" aria-label={failed ? 'మళ్ళీ ప్రయత్నించు' : 'భద్రపరచు'} disabled={draft.state === 'conflict' || copying}
        onClick={() => void draft.flush()}>{draft.state === 'saving' ? <LoaderCircle className="repository-spin"/> : failed ? <RotateCw/> : draft.state === 'saved' ? <Check/> : <CloudUpload/>}</button>
      {draft.state === 'conflict' ? <button type="button" aria-label="నకలుగా భద్రపరచు" disabled={copying} onClick={() => void recoverCopy()}>{copying ? <LoaderCircle className="repository-spin"/> : <CopyPlus/>}</button> : null}
      <button type="button" className="repository-back" aria-label="వెనుక" disabled={leaving || copying} onClick={() => void leave(onBack)}><ArrowLeft/></button>
      <button type="button" className="repository-close" aria-label="మూయి" disabled={leaving || copying} onClick={() => void leave(onClose)}><X/></button>
    </header>
    <GoogleTeluguKeyboard value={draft.value} onChange={value => draft.edit(value)} onSubmit={() => {}} fontFamily={fontFamily}
      freeTyping documentMode keyboardVisible={typing} onActivate={() => setTyping(true)}/>
  </section>;
}
