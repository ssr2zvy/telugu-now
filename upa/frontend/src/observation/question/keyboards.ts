import type { QuestionKeyboard } from '../../../../shared/contracts';

export interface KeyCap {
  /** What the key produces in the unshifted state. */
  base: string;
  /** What the key produces while Shift is held. */
  shift: string;
}

export interface KeyboardLayout {
  id: QuestionKeyboard;
  name: string;
  /** Latin keys map to Telugu output; phonetic layouts buffer and transliterate. */
  kind: 'key-grid' | 'phonetic';
  rows: KeyCap[][];
}

const row = (base: string[], shift: string[]): KeyCap[] =>
  base.map((cap, index) => ({ base: cap, shift: shift[index] ?? cap }));

/**
 * Windows Telugu InScript, as shipped by Microsoft. The number row carries the
 * Telugu digits under Shift; the letter rows follow the InScript matra-left /
 * consonant-right split, with the independent vowels and aspirates on Shift.
 */
const WINDOWS_INSCRIPT: KeyboardLayout = {
  id: 'windows-inscript',
  name: 'Windows InScript',
  kind: 'key-grid',
  rows: [
    row(
      ['ఒ', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', 'ృ'],
      ['ఓ', '౧', '౨', '౩', '౪', '౫', '౬', '౭', '౮', '౯', '౦', 'ఽ', 'ౄ'],
    ),
    row(
      ['ౌ', 'ై', 'ా', 'ీ', 'ూ', 'బ', 'హ', 'గ', 'ద', 'జ', 'డ', '్'],
      ['ఔ', 'ఐ', 'ఆ', 'ఈ', 'ఊ', 'భ', 'ఙ', 'ఘ', 'ధ', 'ఝ', 'ఢ', 'ఞ'],
    ),
    row(
      ['ో', 'ే', '్', 'ి', 'ు', 'ప', 'ర', 'క', 'త', 'చ', 'ట'],
      ['ఓ', 'ఏ', 'అ', 'ఇ', 'ఉ', 'ఫ', 'ఱ', 'ఖ', 'థ', 'ఛ', 'ఠ'],
    ),
    row(
      ['ె', 'ం', 'మ', 'న', 'వ', 'ల', 'స', ',', '.', 'య'],
      ['ఎ', 'ణ', 'ఁ', 'ళ', 'ఴ', 'శ', 'ష', 'ః', '।', 'ఞ'],
    ),
  ],
};

/**
 * macOS Telugu, the phonetic-ordered layout Apple ships: consonants and
 * independent vowels sit on the letter keys, with their long forms and matras
 * on Shift.
 */
const MAC_STANDARD: KeyboardLayout = {
  id: 'mac-standard',
  name: 'Mac Standard',
  kind: 'key-grid',
  rows: [
    row(
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'],
      ['౧', '౨', '౩', '౪', '౫', '౬', '౭', '౮', '౯', '౦', 'ఽ'],
    ),
    row(
      ['అ', 'వ', 'ఎ', 'ర', 'త', 'య', 'ఉ', 'ఇ', 'ఒ', 'ప'],
      ['ఆ', 'ఴ', 'ఏ', 'ఱ', 'థ', 'ౠ', 'ఊ', 'ఈ', 'ఓ', 'ఫ'],
    ),
    row(
      ['ా', 'స', 'ద', 'ఫ', 'గ', 'హ', 'జ', 'క', 'ల'],
      ['ఁ', 'శ', 'ధ', 'ష', 'ఘ', 'ః', 'ఝ', 'ఖ', 'ళ'],
    ),
    row(
      ['ి', 'ీ', 'చ', '్', 'బ', 'న', 'మ', ',', '.'],
      ['ు', 'ూ', 'ఛ', 'ం', 'భ', 'ణ', 'ఙ', 'ఞ', '।'],
    ),
  ],
};

/**
 * Chromebook Telugu phonetic ("dictation") input: Latin keys are buffered and
 * transliterated, so typing "ka" produces క and "kaa" produces కా.
 */
const CHROMEBOOK_DICTATION: KeyboardLayout = {
  id: 'chromebook-dictation',
  name: 'Chromebook Dictation',
  kind: 'phonetic',
  rows: [
    row('qwertyuiop'.split(''), 'QWERTYUIOP'.split('')),
    row('asdfghjkl'.split(''), 'ASDFGHJKL'.split('')),
    row('zxcvbnm'.split(''), 'ZXCVBNM'.split('')),
    row([',', '.', '-'], [';', '?', '~']),
  ],
};

export const KEYBOARD_LAYOUTS: Record<QuestionKeyboard, KeyboardLayout> = {
  'windows-inscript': WINDOWS_INSCRIPT,
  'mac-standard': MAC_STANDARD,
  'chromebook-dictation': CHROMEBOOK_DICTATION,
};

/** Vowel spellings as [latin, independent, matra], longest spellings first. */
const VOWELS: Array<[string, string, string]> = [
  ['ai', 'ఐ', 'ై'], ['au', 'ఔ', 'ౌ'], ['aa', 'ఆ', 'ా'], ['ee', 'ఈ', 'ీ'], ['ii', 'ఈ', 'ీ'],
  ['oo', 'ఊ', 'ూ'], ['uu', 'ఊ', 'ూ'], ['ru', 'ఋ', 'ృ'],
  ['a', 'అ', ''], ['i', 'ఇ', 'ి'], ['u', 'ఉ', 'ు'], ['e', 'ఎ', 'ె'], ['o', 'ఒ', 'ొ'],
];

/** Consonants, longest first so digraphs win over their prefixes. */
const CONSONANTS: Array<[string, string]> = [
  ['kh', 'ఖ'], ['gh', 'ఘ'], ['ch', 'చ'], ['jh', 'ఝ'], ['th', 'థ'], ['dh', 'ధ'],
  ['ph', 'ఫ'], ['bh', 'భ'], ['sh', 'శ'], ['ng', 'ఙ'], ['ny', 'ఞ'],
  ['k', 'క'], ['g', 'గ'], ['c', 'చ'], ['j', 'జ'], ['t', 'త'], ['d', 'ద'], ['n', 'న'],
  ['p', 'ప'], ['b', 'బ'], ['m', 'మ'], ['y', 'య'], ['r', 'ర'], ['l', 'ల'], ['v', 'వ'],
  ['w', 'వ'], ['s', 'స'], ['h', 'హ'], ['f', 'ఫ'], ['z', 'జ'], ['q', 'క'],
];

const VIRAMA = '్';

/**
 * Transliterates a buffered Latin run. Returns the committed Telugu text plus
 * the unconsumed tail, so the caller keeps buffering while a syllable could
 * still grow ("a" may yet become "aa").
 */
export function transliterate(buffer: string): { text: string; rest: string } {
  let index = 0;
  let text = '';
  let afterConsonant = false;
  while (index < buffer.length) {
    const rest = buffer.slice(index);
    const vowel = VOWELS.find(([latin]) => rest.startsWith(latin));
    if (vowel) {
      const [latin, independent, matra] = vowel;
      if (index + latin.length === buffer.length
        && VOWELS.some(([other]) => other.length > latin.length && other.startsWith(latin))) {
        return { text, rest };
      }
      text += afterConsonant ? matra : independent;
      afterConsonant = false;
      index += latin.length;
      continue;
    }
    const consonant = CONSONANTS.find(([latin]) => rest.startsWith(latin));
    if (consonant) {
      const [latin, letter] = consonant;
      if (index + latin.length === buffer.length
        && CONSONANTS.some(([other]) => other.length > latin.length && other.startsWith(latin))) {
        return { text, rest };
      }
      if (afterConsonant) text += VIRAMA;
      text += letter;
      afterConsonant = true;
      index += latin.length;
      continue;
    }
    const character = rest[0] ?? '';
    if (character === 'M' || character === '~') {
      text += 'ం';
      afterConsonant = false;
      index += 1;
      continue;
    }
    if (afterConsonant) text += VIRAMA;
    text += character;
    afterConsonant = false;
    index += 1;
  }
  // A dangling consonant is still open; keep it buffered so a following vowel
  // can attach as a matra instead of forcing a virama.
  return afterConsonant ? { text, rest: buffer.slice(index - lastConsonantLength(buffer)) } : { text, rest: '' };
}

function lastConsonantLength(buffer: string): number {
  const match = CONSONANTS.find(([latin]) => buffer.endsWith(latin));
  return match ? match[0].length : 1;
}
