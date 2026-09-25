export function normalizeWord(word: string): string {
  return word.normalize('NFC').trim().replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, '');
}

export function wordAtOffset(text: string, offset: number): string | null {
  const words = new Intl.Segmenter('te', { granularity: 'word' });
  for (const word of words.segment(text)) {
    if (word.isWordLike && offset >= word.index && offset < word.index + word.segment.length) {
      return normalizeWord(word.segment) || null;
    }
  }
  return null;
}
