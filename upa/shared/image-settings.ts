export const IMAGE_MODEL = 'microsoft/mai-image-2.5-flash';
export const SENTENCE_PLACEHOLDER = '<sentence>';
export const WORD_PLACEHOLDER = '<word>';
// Compatibility for saved prompts: this now means the complete selected word.
const LEGACY_WORD_PLACEHOLDER = '<core word>';
export const DEFAULT_IMAGE_PROMPT = 'Drawing of the concept of <word>. The word itself should not be in the image.';

export interface ImageSettings {
  prompt: string;
  model: string;
  keyConfigured: boolean;
  allowRegeneration: boolean;
}

export function validImagePrompt(prompt: unknown): prompt is string {
  return typeof prompt === 'string' && prompt.trim().length > 0 && prompt.length <= 2000 && (prompt.includes(WORD_PLACEHOLDER) || prompt.includes(LEGACY_WORD_PLACEHOLDER));
}

export function renderImagePrompt(prompt: string, word: string, sentence = ''): string {
  if (!validImagePrompt(prompt)) throw new Error('Image prompt must contain <word> and be at most 2000 characters.');
  if (prompt.includes(SENTENCE_PLACEHOLDER) && !sentence.trim()) throw new Error('This image prompt requires the current sentence.');
  return prompt.replace(/<word>|<core word>|<sentence>/g, placeholder => placeholder === SENTENCE_PLACEHOLDER
    ? sentence.normalize('NFC').trim() : word.normalize('NFC').trim());
}