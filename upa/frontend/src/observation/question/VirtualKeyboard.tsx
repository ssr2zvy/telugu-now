import { useState } from 'react';
import { ArrowBigUp, CornerDownLeft, Delete, Space } from 'lucide-react';
import { KEYBOARD_LAYOUTS, transliterate } from './keyboards';
import type { QuestionKeyboard } from '../../../../shared/contracts';

interface VirtualKeyboardProps {
  keyboard: QuestionKeyboard;
  value: string;
  /** Latin characters still awaiting transliteration on phonetic layouts. */
  pending: string;
  onChange: (value: string, pending: string) => void;
}

/**
 * Reproduces each layout's real behaviour: key grids emit their cap directly,
 * the phonetic layout buffers Latin input and transliterates it.
 */
export function VirtualKeyboard({ keyboard, value, pending, onChange }: VirtualKeyboardProps) {
  const layout = KEYBOARD_LAYOUTS[keyboard];
  const [shift, setShift] = useState(false);
  const phonetic = layout.kind === 'phonetic';

  const emit = (character: string) => {
    if (!phonetic) {
      onChange(value + character, '');
      setShift(false);
      return;
    }
    const buffer = pending + character;
    const { text, rest } = transliterate(buffer);
    onChange(value + text, rest);
    setShift(false);
  };

  const flush = (trailing: string) => {
    const { text } = pending ? transliterate(pending) : { text: '' };
    onChange(value + text + trailing, '');
    setShift(false);
  };

  const backspace = () => {
    if (pending) {
      onChange(value, pending.slice(0, -1));
      return;
    }
    onChange([...value].slice(0, -1).join(''), '');
  };

  return (
    <div className="virtual-keyboard" role="group" aria-label={`${layout.name} keyboard`}>
      <div className="virtual-keyboard-name">{layout.name}</div>
      {layout.rows.map((keys, index) => (
        <div className="virtual-keyboard-row" key={index}>
          {index === layout.rows.length - 1 ? (
            <button
              type="button"
              className={`virtual-key virtual-key-modifier${shift ? ' virtual-key-active' : ''}`}
              aria-pressed={shift}
              aria-label="Shift"
              onClick={() => setShift(active => !active)}
            >
              <ArrowBigUp size={16} aria-hidden="true" />
            </button>
          ) : null}
          {keys.map((cap, keyIndex) => {
            const character = shift ? cap.shift : cap.base;
            return (
              <button
                type="button"
                className="virtual-key"
                key={`${index}-${keyIndex}`}
                aria-label={character}
                onClick={() => emit(character)}
              >
                {character}
              </button>
            );
          })}
          {index === layout.rows.length - 1 ? (
            <button type="button" className="virtual-key virtual-key-modifier" aria-label="Backspace" onClick={backspace}>
              <Delete size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ))}
      <div className="virtual-keyboard-row">
        <button type="button" className="virtual-key virtual-key-space" aria-label="Space" onClick={() => flush(' ')}>
          <Space size={16} aria-hidden="true" />
        </button>
        <button type="button" className="virtual-key virtual-key-modifier" aria-label="New line" onClick={() => flush('\n')}>
          <CornerDownLeft size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
