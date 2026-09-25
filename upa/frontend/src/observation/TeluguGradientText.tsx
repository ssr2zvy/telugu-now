import { DISPLAY_HYPHEN, readerGraphemes } from './reader-hyphenation';
import { type CSSProperties, type ReactNode } from 'react';
import type { HighlightRun } from './telugu-highlighting';
import type { TeluguGradientTexture } from './telugu-gradient-renderer';

export function TeluguGradientText({ text, texture }: { text: string; texture: TeluguGradientTexture | null }) {
  const style = texture ? {
    '--telugu-gradient-image': `url(${texture.url})`,
    '--telugu-gradient-width': `${texture.widthEm}em`,
    '--telugu-gradient-height': `${texture.heightEm}em`,
    '--telugu-gradient-left': `${texture.leftEm}em`,
    '--telugu-gradient-top': `${texture.topEm}em`,
  } as CSSProperties : undefined;
  return <span className={texture ? 'telugu-gradient-text is-ready' : 'telugu-gradient-text'} style={style}>{text}</span>;
}

export function TeluguWordText({ text, runs, textures, visibleRange }: {
  text: string;
  visibleRange?: { start: number; end: number } | undefined;
  runs: HighlightRun[] | null;
  textures: Array<TeluguGradientTexture | null> | null;
}) {
  const output: ReactNode[] = [];
  let word: ReactNode[] = [];
  let key = 0;
  let offset = 0;
  const concealed = (start: number, end: number) => Boolean(visibleRange && (start < visibleRange.start || end > visibleRange.end));
  // Always use the same inline structure. Exploration only changes visibility,
  // never text, word widths, soft breaks, font fitting or balanced line layout.

  const flushWord = () => {
    if (!word.length) return;
    output.push(<span className="telugu-word" key={`word-${key++}`}>{word}</span>);
    word = [];
  };
  for (const [runIndex, run] of (runs ?? [{ text, highlighted: false }]).entries()) {
    for (const part of run.text.split(/(\s+)/u)) {
      if (!part) continue;
      if (/^\s+$/u.test(part)) {
        flushWord();
        output.push(<span key={`space-${key++}`} data-reader-concealed={concealed(offset, offset + part.length) || undefined} aria-hidden={concealed(offset, offset + part.length) || undefined}>{part}</span>);
        offset += part.length;
      } else {
        // Highlight runs are already complete graphemes; plain runs may contain many.
        for (const grapheme of readerGraphemes(part)) {
          if (word.length) word.push(<span key={`break-${key++}`} className="reader-discretionary-hyphen" data-reader-concealed={Boolean(visibleRange && (offset <= visibleRange.start || offset >= visibleRange.end)) || undefined} data-reader-display-only="true" aria-hidden="true">{DISPLAY_HYPHEN}</span>);
          const hidden = concealed(offset, offset + grapheme.length);
          word.push(<span key={`piece-${key++}`} data-reader-concealed={hidden || undefined} aria-hidden={hidden || undefined}>
            {run.highlighted ? <TeluguGradientText text={grapheme} texture={textures?.[runIndex] ?? null} /> : grapheme}
          </span>);
          offset += grapheme.length;
        }
      }
    }
  }
  flushWord();
  return <>{output}</>;
}