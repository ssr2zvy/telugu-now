import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Sparkles, X } from 'lucide-react';
import { analyzeWord, wordDisplayParts } from './word-analysis';
import { existingWordImage, generateWordImage, wordImageError } from './word-images';

function WordImage({ root }: { root: string }) {
  const [image, setImage] = useState<Blob | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'generating' | 'saved' | 'error'>('loading');
  const [error, setError] = useState('');
  const active = useRef(true);
  const running = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError('');
    void existingWordImage(root).then(saved => {
      if (cancelled) return;
      if (saved) { setImage(saved); setStatus('saved'); return; }
      setStatus('ready');
    }).catch(reason => {
      if (!cancelled) { setError(wordImageError(reason)); setStatus('error'); }
    });
    return () => { cancelled = true; };
  }, [root]);
  useEffect(() => {
    if (!image) return;
    const url = URL.createObjectURL(image);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  const generate = async () => {
    if (running.current) return;
    running.current = true;
    setStatus('generating');
    setError('');
    try {
      const saved = await generateWordImage(root);
      if (active.current) { setImage(saved); setStatus('saved'); }
    } catch (reason) {
      if (active.current) { setError(wordImageError(reason)); setStatus('error'); }
    } finally {
      running.current = false;
    }
  };
  const busy = status === 'loading' || status === 'generating';
  return (
    <section className="word-image-section" aria-label="Concept image">
      <div className="word-image-preview" aria-busy={busy}>
        {source ? <img src={source} alt={`Drawing of the concept of ${root}`} /> : (
          <button className="word-profile-action" type="button" disabled={busy} onClick={() => void generate()}>
            {busy ? <LoaderCircle className="word-image-spinner" size={16} aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
            {status === 'loading' ? 'Loading' : status === 'generating' ? 'Generating' : status === 'error' ? 'Retry' : 'Generate'}
          </button>
        )}
      </div>
      <div className="word-image-status" role="status" aria-live="polite">
        {status === 'loading' ? 'Checking saved image' : status === 'generating' ? 'Generating image' : status === 'saved' ? 'Image ready' : ''}
      </div>
      {error ? <p className="word-profile-error" role="alert">{error}</p> : null}
    </section>
  );
}

export function WordProfile({ word, onClose }: { word: string; onClose: () => void }) {
  const analysis = analyzeWord(word);
  const parts = wordDisplayParts(analysis);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  return (
    <dialog ref={dialog} className="word-profile" aria-labelledby="word-profile-title"
      onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
      onDoubleClick={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation();
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <header className="word-profile-header">
        <h2 id="word-profile-title" lang="te" aria-label={analysis.word} title={analysis.root}>
          <span>{parts.core}</span><span className="word-profile-ending">{parts.ending}</span>
        </h2>
        <button type="button" className="word-profile-close" aria-label="Close word profile" title="Close word profile" onClick={onClose}><X size={20} aria-hidden="true" /></button>
      </header>
      <WordImage key={analysis.root} root={analysis.root} />
    </dialog>
  );
}