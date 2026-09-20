export const TOKENIZER_VERSION = 'wikipedia-token-spans-clean-word-v1';

export interface TokenSpan {
  token: string;
  start: number;
  end: number;
}

const TOKEN_CANDIDATE = /[\p{L}\p{M}\p{N}]+/gu;
const TELUGU_ONLY = /^\p{Script=Telugu}+$/u;
const HAS_LETTER = /\p{L}/u;
const HAS_NUMBER = /\p{N}/u;

function codePointOffsets(text: string): number[] {
  const offsets = new Array<number>(text.length + 1);
  let codePointOffset = 0;
  for (let utf16Offset = 0; utf16Offset < text.length;) {
    offsets[utf16Offset] = codePointOffset;
    const width = text.codePointAt(utf16Offset)! > 0xffff ? 2 : 1;
    if (width === 2) offsets[utf16Offset + 1] = codePointOffset;
    utf16Offset += width;
    codePointOffset += 1;
  }
  offsets[text.length] = codePointOffset;
  return offsets;
}

export function token_spans(text: string): TokenSpan[] {
  const offsets = codePointOffsets(text);
  return [...text.matchAll(TOKEN_CANDIDATE)].map((match) => {
    const start = match.index;
    const token = match[0];
    return {
      token,
      start: offsets[start]!,
      end: offsets[start + token.length]!,
    };
  });
}

export function clean_word(token: string): string | null {
  const normalized = token.normalize('NFC');
  if (!HAS_LETTER.test(normalized) || HAS_NUMBER.test(normalized) || !TELUGU_ONLY.test(normalized)) {
    return null;
  }
  return normalized;
}
