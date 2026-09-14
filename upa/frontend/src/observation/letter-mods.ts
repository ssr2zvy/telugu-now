/**
 * Splits Telugu text into base letters and the modifications applied to them.
 *
 * The user's tentative terminology for these is "gunintahly hacchlau and
 * vathulu"; the precise linguistic scope is not treated as settled here. What
 * is highlighted is the mechanical set: within each grapheme cluster the first
 * independent letter stays a base, and everything attached to it — vowel signs
 * (gunintalu), the virama and any consonant it subjoins (vattulu), and the
 * anusvara / visarga / candrabindu — counts as a modification.
 */
export interface LetterSpan {
  text: string;
  kind: 'base' | 'mod';
}

const VIRAMA = 0x0c4d;

function isTeluguCodePoint(code: number): boolean {
  return code >= 0x0c00 && code <= 0x0c7f;
}

/** Marks that modify the letter they follow rather than standing on their own. */
function isModifier(code: number): boolean {
  if (code === VIRAMA) return true;
  // Candrabindu, anusvara, visarga.
  if (code >= 0x0c00 && code <= 0x0c04) return true;
  // Dependent vowel signs, length marks and the ai/au length marks.
  if (code >= 0x0c3e && code <= 0x0c56) return true;
  // Avagraha and the vowel-sign extensions.
  if (code === 0x0c62 || code === 0x0c63) return true;
  return false;
}

export function splitLetterMods(text: string): LetterSpan[] {
  const spans: LetterSpan[] = [];
  const push = (character: string, kind: LetterSpan['kind']) => {
    const last = spans[spans.length - 1];
    if (last && last.kind === kind) last.text += character;
    else spans.push({ text: character, kind });
  };
  const clusters = [...new Intl.Segmenter('te', { granularity: 'grapheme' }).segment(text)];
  for (const cluster of clusters) {
    const characters = [...cluster.segment];
    let seenBase = false;
    let subjoining = false;
    for (const character of characters) {
      const code = character.codePointAt(0) ?? 0;
      if (!isTeluguCodePoint(code)) {
        push(character, 'base');
        continue;
      }
      if (isModifier(code)) {
        push(character, 'mod');
        // A virama pulls the following consonant into the modification as a vattu.
        subjoining = code === VIRAMA;
        continue;
      }
      if (subjoining) {
        push(character, 'mod');
        subjoining = false;
        continue;
      }
      push(character, seenBase ? 'mod' : 'base');
      seenBase = true;
    }
  }
  return spans;
}
