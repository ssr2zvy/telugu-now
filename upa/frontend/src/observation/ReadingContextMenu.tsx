import { useEffect, useRef, useState } from 'react';
import { Ban, Copy } from 'lucide-react';

export interface ReadingContextMenuState {
  text: string;
  x: number;
  y: number;
}

interface ReadingContextMenuProps {
  menu: ReadingContextMenuState;
  onCopy: (text: string) => void;
  onBlacklist: (text: string) => void;
  onClose: () => void;
}

// Right-click (desktop) or long-press (mobile) on the reading text opens this menu
// instead of the browser's native context menu / native long-press selection. Copy
// always targets the entire displayed sentence, never a native selection range.
export function ReadingContextMenu({ menu, onCopy, onBlacklist, onClose }: ReadingContextMenuProps) {
  const [status, setStatus] = useState<'copied' | 'blacklisted' | null>(null);
  const root = useRef<HTMLDivElement>(null);
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
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={event => event.preventDefault()}
    >
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
      <button
        type="button"
        role="menuitem"
        className="reading-context-menu-action"
        aria-label="బ్లాక్‌లిస్ట్‌కు జోడించు"
        onClick={() => {
          onBlacklist(menu.text);
          setStatus('blacklisted');
          window.setTimeout(onClose, 400);
        }}
      >
        <Ban size={18} aria-hidden="true" />
      </button>
      <span className="reading-context-menu-status" role="status" aria-live="polite">
        {status === 'copied' ? 'కాపీ అయ్యింది' : status === 'blacklisted' ? 'బ్లాక్‌లిస్ట్ చేయబడింది' : ''}
      </span>
    </div>
  );
}
