export interface WordAnalysis {
  word: string;
  root: string;
  surfaceStem: string;
  suffixes: { text: string; meaning: string }[];
  confidence: 'known' | 'tentative' | 'unchanged';
}

const knownForms: Record<string, { root: string; plural?: boolean }> = {
  'చెట్ల': { root: 'చెట్టు', plural: true },
  'చెట్లు': { root: 'చెట్టు', plural: true },
  'పుస్తకాల': { root: 'పుస్తకం', plural: true },
  'పుస్తకాలు': { root: 'పుస్తకం', plural: true },
  'పుస్తకాన్ని': { root: 'పుస్తకం' },
  'పుస్తకాని': { root: 'పుస్తకం' },
  'ఇంటి': { root: 'ఇల్లు' },
  'ఇళ్ల': { root: 'ఇల్లు', plural: true },
  'ఇళ్లు': { root: 'ఇల్లు', plural: true },
  'పిల్లల': { root: 'పిల్ల', plural: true },
  'పిల్లలు': { root: 'పిల్ల', plural: true },
  'మనుషుల': { root: 'మనిషి', plural: true },
  'మనుషులు': { root: 'మనిషి', plural: true },
  'పూల': { root: 'పువ్వు', plural: true },
  'పూలు': { root: 'పువ్వు', plural: true },
  'కళ్ల': { root: 'కన్ను', plural: true },
  'కళ్ళ': { root: 'కన్ను', plural: true },
  'కళ్లు': { root: 'కన్ను', plural: true },
  'కళ్ళు': { root: 'కన్ను', plural: true },
  'చేతి': { root: 'చెయ్యి' },
  'చేతుల': { root: 'చెయ్యి', plural: true },
  'చేతులు': { root: 'చెయ్యి', plural: true },
  'బట్టల': { root: 'బట్ట', plural: true },
  'బట్టలు': { root: 'బట్ట', plural: true },
};
const knownRoots = new Set([
  ...Object.values(knownForms).map(form => form.root),
  'అమ్మ', 'నాన్న', 'ఊరు', 'బడి', 'దేవుడు', 'రాముడు', 'తెలుగు',
]);
const protectedWords = new Set([
  'అవును', 'కాదు', 'నేను', 'నీవు', 'నువ్వు', 'తాను', 'మేము', 'మనం',
  'మీరు', 'వారు', 'అతను', 'ఆమె', 'ఇది', 'అది', 'ఏది', 'ఇవి', 'అవి',
  'ఎవరు', 'ఎందుకు', 'ఎక్కడ', 'ఎప్పుడు', 'నాకు', 'నీకు', 'మీకు', 'తనకు',
  'కాని', 'కానీ', 'మరి', 'అని', 'పోనీ', 'పాలు', 'వేలు', 'చాలు', 'నీరు',
  'నీళ్లు', 'నీళ్ళు', 'కలలు', 'వద్దు', 'లో', 'తో', 'కు', 'కి', 'ను', 'ని',
]);
const caseSuffixes = [
  { text: 'నుంచి', meaning: 'from' },
  { text: 'నుండి', meaning: 'from' },
  { text: 'కోసం', meaning: 'for' },
  { text: 'లోకి', meaning: 'into' },
  { text: 'లోని', meaning: 'in / of' },
  { text: 'లో', meaning: 'in' },
  { text: 'తో', meaning: 'with' },
  { text: 'కి', meaning: 'to / for' },
  { text: 'కు', meaning: 'to / for' },
  { text: 'ను', meaning: 'object marker' },
  { text: 'ని', meaning: 'object marker' },
  { text: 'గా', meaning: 'as / manner' },
];

export function normalizeWord(word: string): string {
  return word.normalize('NFC').trim().replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, '');
}

export function analyzeWord(input: string): WordAnalysis {
  const word = normalizeWord(input);
  const unchanged: WordAnalysis = { word, root: word, surfaceStem: word, suffixes: [], confidence: 'unchanged' };
  if (!/^[\u0c00-\u0c7f]+$/u.test(word) || protectedWords.has(word)) return unchanged;
  if (knownRoots.has(word)) return { ...unchanged, confidence: 'known' };
  const direct = knownForms[word];
  if (direct) return {
    ...unchanged, root: direct.root, confidence: 'known',
    suffixes: direct.plural ? [{ text: 'లు', meaning: 'plural (stem changes)' }] : [],
  };
  const graphemes = new Intl.Segmenter('te', { granularity: 'grapheme' });
  for (const suffix of caseSuffixes) {
    if (!word.endsWith(suffix.text)) continue;
    const stem = word.slice(0, -suffix.text.length);
    const restored = knownForms[stem];
    if (!restored && !knownRoots.has(stem) && [...graphemes.segment(stem)].length < 2) continue;
    return {
      word, root: restored?.root ?? stem, surfaceStem: stem,
      suffixes: [...(restored?.plural ? [{ text: 'లు', meaning: 'plural (stem changes)' }] : []), suffix],
      confidence: restored || knownRoots.has(stem) ? 'known' : 'tentative',
    };
  }
  return unchanged;
}

export function wordDisplayParts(analysis: WordAnalysis): { core: string; ending: string } {
  if (analysis.word === analysis.root) return { core: analysis.word, ending: '' };
  const segmenter = new Intl.Segmenter('te', { granularity: 'grapheme' });
  const original = [...segmenter.segment(analysis.word)];
  const root = [...segmenter.segment(analysis.root)];
  let length = 0;
  for (const [index, segment] of original.entries()) {
    if (segment.segment !== root[index]?.segment) break;
    length += segment.segment.length;
  }
  return { core: analysis.word.slice(0, length), ending: analysis.word.slice(length) };
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