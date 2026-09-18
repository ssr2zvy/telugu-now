import { Fragment, type CSSProperties, type ReactNode } from 'react';
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

export function TeluguWordText({ text, runs, textures }: {
  text: string;
  runs: HighlightRun[] | null;
  textures: Array<TeluguGradientTexture | null> | null;
}) {
  const output: ReactNode[] = [];
  let word: ReactNode[] = [];
  let key = 0;
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
        output.push(<Fragment key={`space-${key++}`}>{part}</Fragment>);
      } else if (run.highlighted) {
        word.push(<TeluguGradientText key={`piece-${key++}`} text={part} texture={textures?.[runIndex] ?? null} />);
      } else {
        word.push(<Fragment key={`piece-${key++}`}>{part}</Fragment>);
      }
    }
  }
  flushWord();
  return <>{output}</>;
}