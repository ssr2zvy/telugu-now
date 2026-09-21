export interface TextRange {
  start: number;
  end: number;
}

const TELUGU_VIRAMA = 0x0c4d;
const isJoinControl = (codePoint: number) => codePoint === 0x200c || codePoint === 0x200d;
const isTeluguConsonant = (codePoint: number) => codePoint >= 0x0c15 && codePoint <= 0x0c39;
const isTeluguMark = (codePoint: number) => codePoint >= 0x0c00 && codePoint <= 0x0c03
  || codePoint >= 0x0c3e && codePoint <= 0x0c44
  || codePoint >= 0x0c46 && codePoint <= 0x0c48
  || codePoint >= 0x0c4a && codePoint <= 0x0c4c
  || codePoint >= 0x0c55 && codePoint <= 0x0c56;

export function teluguModificationRanges(text: string): TextRange[] {
  let offset = 0;
  const characters = [...text].map(value => {
    const character = { value, codePoint: value.codePointAt(0)!, start: offset };
    offset += value.length;
    return character;
  });
  const ranges: TextRange[] = [];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    if (isTeluguMark(character.codePoint)) {
      ranges.push({ start: character.start, end: character.start + character.value.length });
      continue;
    }
    if (character.codePoint !== TELUGU_VIRAMA) continue;
    let endIndex = index + 1;
    while (endIndex < characters.length && isJoinControl(characters[endIndex]!.codePoint)) endIndex += 1;
    const dependent = characters[endIndex];
    if (dependent && isTeluguConsonant(dependent.codePoint)) {
      ranges.push({ start: character.start, end: dependent.start + dependent.value.length });
    }
  }
  return ranges;
}

export interface HighlightRun {
  text: string;
  highlighted: boolean;
}

export function teluguHighlightRuns(text: string): HighlightRun[] {
  const ranges = teluguModificationRanges(text);
  if (!ranges.length) return [{ text, highlighted: false }];
  const graphemes = [...new Intl.Segmenter('te', { granularity: 'grapheme' }).segment(text)];
  return graphemes.reduce<HighlightRun[]>((runs, grapheme) => {
    const end = grapheme.index + grapheme.segment.length;
    const highlighted = ranges.some(range => range.start < end && range.end > grapheme.index);
    const previous = runs.at(-1);
    if (!highlighted && previous && !previous.highlighted) previous.text += grapheme.segment;
    else runs.push({ text: grapheme.segment, highlighted });
    return runs;
  }, []);
}