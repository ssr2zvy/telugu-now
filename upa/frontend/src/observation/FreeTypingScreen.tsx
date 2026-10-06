import { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { GradientBackdrop } from '../GradientBackdrop';
import { GoogleTeluguKeyboard } from './GoogleTeluguKeyboard';

export function FreeTypingScreen({ value, onChange, fontFamily, onBack }: {
  value: string; onChange: (text: string) => void; fontFamily: string; onBack: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    element?.querySelector('textarea')?.focus({ preventScroll: true });
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="free-typing-screen" aria-label="Free typing"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onBack(); }}
    onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
    <GradientBackdrop className="gradient-field"/>
    <button className="word-profile-back" type="button" aria-label="Back to reading" onClick={onBack}><ArrowLeft size={20} aria-hidden="true"/></button>
    <div className="free-typing-content"><GoogleTeluguKeyboard value={value} onChange={onChange} onSubmit={() => {}} fontFamily={fontFamily} freeTyping/></div>
  </dialog>;
}
