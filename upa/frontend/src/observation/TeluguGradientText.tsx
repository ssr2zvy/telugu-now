import type { CSSProperties } from 'react';
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