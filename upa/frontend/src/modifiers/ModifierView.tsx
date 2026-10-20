import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Settings, RotateCcw } from 'lucide-react';
import { modifierTitle } from '../../../shared/modifiers';
import type { ModifierController } from './useModifierMode';
import { useReaderSettingsFade } from '../observation/useReaderSettingsFade';

export function ModifierIcon({ observation = false }: { observation?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {observation ? <><path d="M8 8a4 4 0 0 1 8 0c0 3-4 3-4 6"/><path d="M12 19h.01"/></> : <path d="M12 3.34 22 20.66H2Z"/>}
  </svg>;
}
export function ModifierSwitch({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: () => void }) {
  return <button type="button" className="evaluation-switch modifier-switch" role="switch" aria-label="ఎంపిక నుండి తీసివేయి"
    aria-checked={checked} data-value={String(checked)} disabled={disabled} onClick={onChange}>
    <span className="evaluation-switch-indicator" aria-hidden="true"/>
  </button>;
}
export function ModifierView({ controller: mode, fontFamily, onClose, onSettings, onRepository }: {
  controller: ModifierController; fontFamily: string; onClose: () => void; onSettings: () => void; onRepository: () => void;
}) {
  const screen = useRef<HTMLElement>(null);
  const idle = useReaderSettingsFade(screen);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const wheel = useRef({ distance: 0, last: 0, blockedUntil: 0 });
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [omitMenu, setOmitMenu] = useState(false);
  const cancelHold = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };
  useEffect(() => { setOmitMenu(false); cancelHold(); }, [mode.index, mode.entry?.id]);
  useEffect(() => cancelHold, []);
  const [direction, setDirection] = useState<'next' | 'back'>('next');
  const actions = useRef(mode); actions.current = mode;
  const move = (back: boolean) => {
    if (actions.current.busy || !actions.current.state) return;
    setDirection(back ? 'back' : 'next');
    if (back) actions.current.back(); else void actions.current.next();
  };
  useEffect(() => {
    if (mode.index < 0 && mode.state && !mode.busy && !mode.error) void mode.next();
  }, [mode.index, mode.state, mode.busy, mode.error]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || (event.target instanceof Element && event.target.closest('input,textarea,[contenteditable="true"]'))) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowRight'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const entry = mode.entry;
  return <main ref={screen} className="app-shell modifier-screen" style={{fontFamily}} data-settings-idle={idle} aria-busy={mode.busy}
    onContextMenu={event => event.preventDefault()}
    onPointerMove={event => { const start = pointer.current; if (start && Math.hypot(event.clientX-start.x,event.clientY-start.y)>10) cancelHold(); }}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
      pointer.current = {id:event.pointerId,x:event.clientX,y:event.clientY};
      cancelHold();
      hold.current = setTimeout(() => { pointer.current = null; setOmitMenu(true); }, 550);
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerUp={event => {
      cancelHold();
      const start = pointer.current; pointer.current = null;
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (Math.abs(dx) >= 55 && Math.abs(dx) > Math.abs(dy) * 1.4) move(dx > 0);
    }} onPointerCancel={() => { cancelHold(); pointer.current = null; }}
    onWheel={event => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      const now = performance.now(), value = wheel.current;
      if (now < value.blockedUntil) return;
      if (now - value.last > 180) value.distance = 0;
      value.last = now; value.distance += event.deltaX;
      if (Math.abs(value.distance) >= 70) { move(value.distance < 0); value.distance = 0; value.blockedUntil = now + 600; }
    }}>
    <button className="reader-settings reader-modifier" type="button" aria-label="పరిశీలన" onClick={onClose}><ModifierIcon observation/></button>
    <button className="reader-settings reader-repository" type="button" aria-label="సంచికలు" onClick={onRepository}><FolderOpen aria-hidden="true"/></button>
    <button className="reader-settings" type="button" aria-label="అమరికలు" onClick={onSettings}><Settings aria-hidden="true"/></button>
    {entry ? <article key={`${mode.index}:${entry.id}`} className="modifier-content" data-direction={direction} lang="te">
      <div className="modifier-grammar">{modifierTitle(entry)}</div>
      <div className="modifier-examples">{entry.examples.map(example => <section className="modifier-example" key={example.example_id}>
        <p className="modifier-transformation"><span>{example.base}</span>{example.modifier_surface ? <> + <span>{example.modifier_surface}</span></> : null} → <span>{example.result}</span></p>
        <p className="modifier-sentence">{example.context_sentence}</p>
      </section>)}</div>
      <ModifierSwitch checked={mode.excluded} disabled={mode.busy || mode.omitted} onChange={() => { void mode.setExcluded(entry.id, !mode.excluded); }}/>
    </article> : null}
    {omitMenu && entry ? <div className="modifier-omit-menu"><button type="button" aria-label="తదుపరి చక్రాల నుండి కూడా తీసివేయి" disabled={mode.busy} aria-pressed={mode.omitted} onClick={() => { void mode.setOmitted(entry.id, !mode.omitted); setOmitMenu(false); }}>???</button></div> : null}
    {mode.remaining === 0 ? <button className="modifier-empty-reset" type="button" aria-label="మళ్లీ ప్రారంభించు" disabled={mode.busy} onClick={() => { void mode.reset(); }}><RotateCcw/></button> : null}
    <output className="modifier-remaining" aria-label="మిగిలినవి">{mode.remaining ?? '…'}</output>
    {mode.error ? <div className="modifier-retry"><button type="button" aria-label="మళ్లీ ప్రయత్నించు" onClick={mode.retry}><RotateCcw/></button><span role="alert">సేవ్ చేయలేకపోయాము లేదా లోడ్ కాలేదు.</span></div> : null}
  </main>;
}
