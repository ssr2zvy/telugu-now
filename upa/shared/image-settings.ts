export const IMAGE_MODEL = 'microsoft/mai-image-2.5-flash';
export const CORE_WORD_PLACEHOLDER = '<core word>';
export const SENTENCE_PLACEHOLDER = '<sentence>';
export const DEFAULT_IMAGE_PROMPT = 'Drawing of the concept of <core word>. The word itself should not be in the image.';

export interface ImageSettings {
  prompt: string;
  model: string;
  keyConfigured: boolean;
}

// Both placeholders are optional; a prompt only has to be non-empty.
export function validImagePrompt(prompt: unknown): prompt is string {
  return typeof prompt === 'string' && prompt.trim().length > 0 && prompt.length <= 2000;
}

/** `<sentence>` is the sentence that was on screen when the word was clicked. */
export function renderImagePrompt(prompt: string, coreWord: string, sentence = ''): string {
  if (!validImagePrompt(prompt)) throw new Error('Image prompt must be non-empty and at most 2000 characters.');
  return prompt
    .replaceAll(CORE_WORD_PLACEHOLDER, coreWord.normalize('NFC').trim())
    .replaceAll(SENTENCE_PLACEHOLDER, sentence.normalize('NFC').trim());
}