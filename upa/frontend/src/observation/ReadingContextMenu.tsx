import { useEffect, useRef, useState } from 'react';
import { Ban, Copy } from 'lucide-react';
import { SettingsIcon } from '../components/icons';

export type ReadingContextMenuState =
  | { kind: 'word'; text: string; x: number; y: number }
  | { kind: 'settings'; x: number; y: number };

export function readingContextMenuState(x: number, y: number, word: string | null): ReadingContextMenuState {
  return word ? { kind: 'word', text: word, x, y } : { kind: 'settings', x, y };
}

interface ReadingContextMenuProps {
  menu: ReadingContextMenuState;
  onCopy: (text: string) => void;
  onBlacklistTranscript?: () => void;
  onOpenSettings?: () => void;
  onClose: () => void;
}

// Word menus contain word actions only; the rest of the reader opens Settings only.
export function ReadingContextMenu({ menu, onCopy, onBlacklistTranscript, onOpenSettings, onClose }: ReadingContextMenuProps) {
  const [status, setStatus] = useState<'copied' | 'blacklisted' | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const placement = menu.y < 60 ? 'below' : 'above';
  useEffect(() => {
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') onClose();
        return;
      }
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) onClose();
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', dismiss, true);
    };
  }, [onClose]);
  return (
    <div
      ref={root}
      className="reading-context-menu"
      role="menu"
      data-placement={placement}
      style={{ left: `clamp(28px, ${menu.x}px, calc(100vw - 28px))`, top: menu.y }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
    >
      {menu.kind === 'word' ? <>
        <button
          type="button"
          role="menuitem"
          className="reading-context-menu-action"
          aria-label="కాపీ చేయి"
          onClick={() => {
            onCopy(menu.text);
            setStatus('copied');
            window.setTimeout(onClose, 400);
          }}
        >
          <Copy size={18} aria-hidden="true" />
        </button>
        {onBlacklistTranscript ? <button
          type="button"
          role="menuitem"
          className="reading-context-menu-action"
          aria-label="ట్రాన్స్‌క్రిప్ట్‌ను బ్లాక్‌లిస్ట్‌కు జోడించు"
          onClick={() => {
            onBlacklistTranscript();
            setStatus('blacklisted');
            window.setTimeout(onClose, 400);
          }}
        >
          <Ban size={18} aria-hidden="true" />
        </button> : null}
      </> : <button
          type="button"
          role="menuitem"
          className="reading-context-menu-action"
          aria-label="అమరికలు"
          onClick={() => {
            onClose();
            onOpenSettings?.();
          }}
        >
          <SettingsIcon />
        </button>}
      <span className="reading-context-menu-status" role="status" aria-live="polite">
        {status === 'copied' ? 'కాపీ అయ్యింది' : status === 'blacklisted' ? 'బ్లాక్‌లిస్ట్ చేయబడింది' : ''}
      </span>
    </div>
  );
}
