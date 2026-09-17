import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ArrowUp, CornerDownLeft, Delete } from 'lucide-react';
import { useAppearance } from '../appearance';
import { OBSERVATION_FONTS } from '../presentation';

interface CharacterKey { code: string; output: string }

const NUMBER_ROW: CharacterKey[] = [
  { code: '`', output: 'ొ' },
  ...'౧౨౩౪౫౬౭౮౯౦'.split('').map((output, index) => ({ code: `${(index + 1) % 10}`, output })),
  { code: '-', output: '-' }, { code: '=', output: 'ృ' },
];
const TOP_ROW: CharacterKey[] = [
  { code: 'q', output: 'ౌ' }, { code: 'w', output: 'ై' }, { code: 'e', output: 'ా' },
  { code: 'r', output: 'ీ' }, { code: 't', output: 'ూ' }, { code: 'y', output: 'బ' },
  { code: 'u', output: 'హ' }, { code: 'i', output: 'గ' }, { code: 'o', output: 'ద' },
  { code: 'p', output: 'జ' }, { code: '[', output: 'డ' }, { code: ']', output: '఼' },
  // Google's own InScript tool maps this key to U+0C49, an unassigned code point.
  { code: '\\', output: '' },
];
const HOME_ROW: CharacterKey[] = [
  { code: 'a', output: 'ో' }, { code: 's', output: 'ే' }, { code: 'd', output: '్' },
  { code: 'f', output: 'ి' }, { code: 'g', output: 'ు' }, { code: 'h', output: 'ప' },
  { code: 'j', output: 'ర' }, { code: 'k', output: 'క' }, { code: 'l', output: 'త' },
  { code: ';', output: 'చ' }, { code: "'", output: 'ట' },
];
const BOTTOM_ROW: CharacterKey[] = [
  { code: 'z', output: 'ె' }, { code: 'x', output: 'ం' }, { code: 'c', output: 'మ' },
  { code: 'v', output: 'న' }, { code: 'b', output: 'వ' }, { code: 'n', output: 'ల' },
  { code: 'm', output: 'స' }, { code: ',', output: ',' }, { code: '.', output: '.' },
  { code: '/', output: 'య' },
];
// Google maps 1 and 2 here to U+0C0D and U+0C45, both unassigned code points.
const SHIFT_NUMBER_ROW: CharacterKey[] = [
  { code: '`', output: 'ఒ' }, { code: '1', output: '' },
  { code: '2', output: '' }, { code: '3', output: '్ర' },
  { code: '4', output: 'ర్' }, { code: '5', output: 'జ్ఞ' },
  { code: '6', output: 'త్ర' }, { code: '7', output: 'క్ష' },
  { code: '8', output: 'శ్ర' }, { code: '9', output: '(' },
  { code: '0', output: ')' }, { code: '-', output: 'ః' },
  { code: '=', output: 'ఋ' },
];
const SHIFT_TOP_ROW: CharacterKey[] = [
  { code: 'q', output: 'ఔ' }, { code: 'w', output: 'ఐ' }, { code: 'e', output: 'ఆ' },
  { code: 'r', output: 'ఈ' }, { code: 't', output: 'ఊ' }, { code: 'y', output: 'భ' },
  { code: 'u', output: 'ఙ' }, { code: 'i', output: 'ఘ' }, { code: 'o', output: 'ధ' },
  { code: 'p', output: 'ఝ' }, { code: '[', output: 'ఢ' }, { code: ']', output: 'ఞ' },
  // U+0C11 is unassigned in Unicode despite appearing in Google's table.
  { code: '\\', output: '' },
];
const SHIFT_HOME_ROW: CharacterKey[] = [
  { code: 'a', output: 'ఓ' }, { code: 's', output: 'ఏ' }, { code: 'd', output: 'అ' },
  { code: 'f', output: 'ఇ' }, { code: 'g', output: 'ఉ' }, { code: 'h', output: 'ఫ' },
  { code: 'j', output: 'ఱ' }, { code: 'k', output: 'ఖ' }, { code: 'l', output: 'థ' },
  { code: ';', output: 'ఛ' }, { code: "'", output: 'ఠ' },
];
// U+0C29, U+0C64, and U+0C5F are unassigned; only ణ, ళ, ష stay real letters.
const SHIFT_BOTTOM_ROW: CharacterKey[] = [
  { code: 'z', output: 'ఎ' }, { code: 'x', output: 'ఁ' }, { code: 'c', output: 'ణ' },
  { code: 'v', output: '' }, { code: 'b', output: 'ఴ' }, { code: 'n', output: 'ళ' },
  { code: 'm', output: 'శ' }, { code: ',', output: 'ష' }, { code: '.', output: '' },
  { code: '/', output: '' },
];
const CTRL_ALT_NUMBER_ROW: CharacterKey[] = [
  { code: '`', output: '' },
  ...'1234567890'.split('').map(code => ({ code, output: code })),
  { code: '-', output: '' }, { code: '=', output: 'ౄ' },
];
// U+0C5B and U+0C5C are unassigned, so P and [ are inert in this layer.
const CTRL_ALT_TOP_ROW: CharacterKey[] = [
  { code: 'q', output: '' }, { code: 'w', output: '' }, { code: 'e', output: '' },
  { code: 'r', output: 'ౣ' }, { code: 't', output: '' }, { code: 'y', output: '' },
  { code: 'u', output: '' }, { code: 'i', output: 'ౚ' }, { code: 'o', output: '' },
  { code: 'p', output: '' }, { code: '[', output: '' }, { code: ']', output: '' },
  { code: '\\', output: '' },
];
// U+0C52, U+0C53, U+0C54, U+0C70, and U+0C65 are unassigned in this layer.
const CTRL_ALT_HOME_ROW: CharacterKey[] = [
  { code: 'a', output: '' }, { code: 's', output: '' }, { code: 'd', output: '' },
  { code: 'f', output: 'ౢ' }, { code: 'g', output: '' }, { code: 'h', output: '' },
  { code: 'j', output: '' }, { code: 'k', output: 'ౘ' }, { code: 'l', output: '' },
  { code: ';', output: '' }, { code: "'", output: '' },
];
const CTRL_ALT_BOTTOM_ROW: CharacterKey[] = [
  { code: 'z', output: '' }, { code: 'x', output: '' }, { code: 'c', output: '' },
  { code: 'v', output: '' }, { code: 'b', output: '' }, { code: 'n', output: '' },
  { code: 'm', output: '' }, { code: ',', output: '' }, { code: '.', output: '' },
  { code: '/', output: '' },
];
const SHIFT_CTRL_ALT_NUMBER_ROW = NUMBER_ROW.map(key => ({ code: key.code, output: key.code === '=' ? 'ౠ' : '' }));
const SHIFT_CTRL_ALT_TOP_ROW = TOP_ROW.map(key => ({ code: key.code, output: key.code === 'r' ? 'ౡ' : key.code === '[' ? 'ౝ' : '' }));
// U+0C5E and U+0C51 are unassigned, so only ఌ and ౙ remain in this layer.
const SHIFT_CTRL_ALT_HOME_ROW = HOME_ROW.map(key => ({ code: key.code, output: key.code === 'f' ? 'ఌ' : key.code === 'k' ? 'ౙ' : '' }));
// U+0C50 is unassigned, so only ఽ remains in this layer.
const SHIFT_CTRL_ALT_BOTTOM_ROW = BOTTOM_ROW.map(key => ({ code: key.code, output: key.code === '.' ? 'ఽ' : '' }));
const KEY_OUTPUT = new Map([...NUMBER_ROW, ...TOP_ROW, ...HOME_ROW, ...BOTTOM_ROW].map(key => [key.code, key.output]));
const CARET_IDLE_DELAY_MS = 500;
const COMBINING_MARK = /^\p{M}/u;
const ANSWER_FONT_MAX_PX = 34;
const ANSWER_FONT_MIN_PX = 16;

function fitAnswerEditor(element: HTMLTextAreaElement): void {
  let low = ANSWER_FONT_MIN_PX;
  let high = ANSWER_FONT_MAX_PX;
  let best = low;
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const candidate = (low + high) / 2;
    element.style.fontSize = `${candidate}px`;
    element.style.lineHeight = `${Math.ceil(candidate * 1.3)}px`;
    if (element.scrollHeight <= element.clientHeight + 1) {
      best = candidate;
      low = candidate;
    } else {
      high = candidate;
    }
  }
  element.style.fontSize = `${best}px`;
  element.style.lineHeight = `${Math.ceil(best * 1.3)}px`;
}

export function keyboardKeyDisplay(output: string): string {
  return COMBINING_MARK.test(output) ? `\u25cc${output}` : output;
}

function removeLastGrapheme(value: string): string {
  const segments = [...new Intl.Segmenter('te', { granularity: 'grapheme' }).segment(value)];
  return value.slice(0, segments.at(-1)?.index ?? 0);
}

export function GoogleTeluguKeyboard({ value, onChange, onSubmit }: { value: string; onChange: (value: string) => void; onSubmit: () => void }) {
  const { appearance } = useAppearance();
  const [keyFontFamily] = useState(() => {
    const pool = appearance.fonts.length ? appearance.fonts : OBSERVATION_FONTS;
    return pool[Math.floor(Math.random() * pool.length)]!;
  });
  const editor = useRef<HTMLTextAreaElement>(null);
  const latestPropValue = useRef(value);
  const draftValue = useRef(value);
  const selection = useRef({ start: value.length, end: value.length });
  const [shifted, setShifted] = useState(false);
  const [controlAlt, setControlAlt] = useState(false);
  const [scrolledUp, setScrolledUp] = useState(false);
  // Set when an edit lands at the end of the text; onSelect can overwrite
  // selection.current with a stale browser selection before the effect runs,
  // so the snap decision cannot be derived from live selection state.
  const snapToEndPending = useRef(false);
  const [caretIdle, setCaretIdle] = useState(true);
  const caretIdleTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Hides the caret on every keystroke (virtual or hardware) and lets it
  // reappear once typing has paused for CARET_IDLE_DELAY_MS.
  const noteTyping = () => {
    setCaretIdle(false);
    clearTimeout(caretIdleTimeout.current);
    caretIdleTimeout.current = setTimeout(() => setCaretIdle(true), CARET_IDLE_DELAY_MS);
  };
  useEffect(() => () => clearTimeout(caretIdleTimeout.current), []);
  const syncScrolledUp = () => {
    const element = editor.current;
    if (element) setScrolledUp(element.scrollTop > 1);
  };
  const snapIfAtEnd = () => {
    const element = editor.current;
    if (element && selection.current.start >= draftValue.current.length) element.scrollTop = element.scrollHeight;
    syncScrolledUp();
  };
  useEffect(() => {
    if (snapToEndPending.current) {
      snapToEndPending.current = false;
      snapIfAtEnd();
      // Snap again after the rAF that refocuses the editor, so no later
      // native caret-reveal can leave the last line clipped.
      requestAnimationFrame(snapIfAtEnd);
    }
    syncScrolledUp();
  }, [value]);
  useLayoutEffect(() => {
    const element = editor.current;
    if (element) fitAnswerEditor(element);
  }, [value]);
  useEffect(() => {
    // The Telugu webfont swaps in with font-display: swap well after mount,
    // silently changing line metrics without any value change to re-trigger
    // the snap above -- this is what "settles after a bit of typing" was:
    // the box looked fine on the fallback font, then clipped once it swapped.
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      if (editor.current) fitAnswerEditor(editor.current);
      snapIfAtEnd();
    });
    return () => { cancelled = true; };
  }, []);
  if (value !== latestPropValue.current) {
    latestPropValue.current = value;
    draftValue.current = value;
    selection.current = {
      start: Math.min(selection.current.start, value.length),
      end: Math.min(selection.current.end, value.length),
    };
  }
  const select = (start: number, end = start) => {
    selection.current = { start, end };
  };
  const restoreEditorSelection = (start: number, end = start) => {
    const element = editor.current;
    if (!element) return;
    // Re-setting an already-correct selection flips caret affinity upstream,
    // drawing the caret at the end of the previous soft-wrapped line.
    if (element.selectionStart !== start || element.selectionEnd !== end) element.setSelectionRange(start, end);
    if (!window.matchMedia('(pointer: coarse)').matches) element.focus({ preventScroll: true });
    snapIfAtEnd();
  };
  const edit = (output: string) => {
    const currentValue = draftValue.current;
    const start = Math.min(selection.current.start, currentValue.length);
    const end = Math.min(selection.current.end, currentValue.length);
    const next = currentValue.slice(0, start) + output + currentValue.slice(end);
    const caret = start + output.length;
    draftValue.current = next;
    select(caret);
    snapToEndPending.current = caret >= next.length;
    noteTyping();
    onChange(next);
    requestAnimationFrame(() => restoreEditorSelection(caret));
  };
  const backspace = () => {
    const currentValue = draftValue.current;
    const start = Math.min(selection.current.start, currentValue.length);
    const end = Math.min(selection.current.end, currentValue.length);
    const before = currentValue.slice(0, start);
    const shortened = start === end ? removeLastGrapheme(before) : before;
    const next = shortened + currentValue.slice(end);
    draftValue.current = next;
    select(shortened.length);
    snapToEndPending.current = shortened.length >= next.length;
    noteTyping();
    onChange(next);
    requestAnimationFrame(() => restoreEditorSelection(shortened.length));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.key === 'Enter') { event.preventDefault(); if (!event.repeat) onSubmit(); return; }
    if (event.key === 'Backspace') { event.preventDefault(); backspace(); return; }
    if (event.key === ' ') { event.preventDefault(); edit(' '); return; }
    const output = KEY_OUTPUT.get(event.key.toLowerCase());
    if (output) { event.preventDefault(); edit(output); }
  };
  const characterKey = (key: CharacterKey) => <button type="button" key={key.code} aria-label={key.output ? `${key.code}: ${key.output}` : `${key.code}: unavailable`} aria-disabled={!key.output} onClick={() => { if (key.output) edit(key.output); }}><span>{key.output ? keyboardKeyDisplay(key.output) : '\u00a0'}</span></button>;
  const shiftKey = <button type="button" className="question-shift-key" aria-label={shifted ? 'Show unshifted keys' : 'Show shifted keys'} aria-pressed={shifted} onClick={() => setShifted(current => !current)}><ArrowUp aria-hidden="true" strokeWidth={1.5} /></button>;
  const controlKey = <button type="button" className="question-control-key" aria-label={controlAlt ? 'Disable Control Alt' : 'Enable Control Alt'} aria-pressed={controlAlt} onClick={() => setControlAlt(current => !current)}>కంట్రోల్ + ఆల్ట్</button>;
  const enterKey = <button type="button" className="question-enter-key" aria-label="Show answer" onClick={onSubmit}><CornerDownLeft aria-hidden="true" strokeWidth={1.5} /></button>;
  const numberRow = shifted && controlAlt ? SHIFT_CTRL_ALT_NUMBER_ROW : shifted ? SHIFT_NUMBER_ROW : controlAlt ? CTRL_ALT_NUMBER_ROW : NUMBER_ROW;
  const topRow = shifted && controlAlt ? SHIFT_CTRL_ALT_TOP_ROW : shifted ? SHIFT_TOP_ROW : controlAlt ? CTRL_ALT_TOP_ROW : TOP_ROW;
  const homeRow = shifted && controlAlt ? SHIFT_CTRL_ALT_HOME_ROW : shifted ? SHIFT_HOME_ROW : controlAlt ? CTRL_ALT_HOME_ROW : HOME_ROW;
  const bottomRow = shifted && controlAlt ? SHIFT_CTRL_ALT_BOTTOM_ROW : shifted ? SHIFT_BOTTOM_ROW : controlAlt ? CTRL_ALT_BOTTOM_ROW : BOTTOM_ROW;
  return <div className="google-telugu-input">
    {scrolledUp ? <div className="question-answer-more" aria-hidden="true">&hellip;</div> : null}
    <textarea ref={editor} className="question-answer-editor" style={{ caretColor: caretIdle ? 'var(--keyboard-accent)' : 'transparent' }} lang="te" aria-label="Typed answer" value={value} inputMode="none" onScroll={syncScrolledUp} onChange={event => { draftValue.current = event.target.value; select(event.target.selectionStart, event.target.selectionEnd); snapToEndPending.current = event.target.selectionStart >= event.target.value.length; noteTyping(); onChange(event.target.value); }} onSelect={event => select(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)} onKeyDown={onKeyDown} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
    <div className="question-keyboard" aria-label="Telugu InScript keyboard" style={{ '--question-keyboard-font': `"${keyFontFamily}"` } as CSSProperties}>
      <div className="question-keyboard-row question-number-row">{numberRow.map(characterKey)}<button type="button" className="question-backspace-key" aria-label="Backspace" onClick={backspace}><Delete aria-hidden="true" strokeWidth={1.5} /></button></div>
      <div className="question-keyboard-row question-top-row">{topRow.map(characterKey)}</div>
      <div className="question-keyboard-row question-home-row">{homeRow.map(characterKey)}</div>
      <div className="question-keyboard-row question-bottom-row">{shiftKey}{bottomRow.map(characterKey)}{shiftKey}</div>
      <div className="question-keyboard-row question-keyboard-actions">{controlKey}<button type="button" className="question-space-key" aria-label="Space" onClick={() => edit(' ')} />{controlKey}{enterKey}</div>
    </div>
  </div>;
}