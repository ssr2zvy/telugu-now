export const IMAGE_MODEL = 'microsoft/mai-image-2.5-flash';
export const SENTENCE_PLACEHOLDER = '<sentence>';
export const CORE_WORD_PLACEHOLDER = '<core word>';
export const DEFAULT_IMAGE_PROMPT = 'Drawing of the concept of <core word>. The word itself should not be in the image.';

export interface ImageSettings {
  prompt: string;
  model: string;
  keyConfigured: boolean;
  allowRegeneration: boolean;
}

export function validImagePrompt(prompt: unknown): prompt is string {
  return typeof prompt === 'string' && prompt.trim().length > 0 && prompt.length <= 2000 && prompt.includes(CORE_WORD_PLACEHOLDER);
}

export function renderImagePrompt(prompt: string, coreWord: string, sentence = ''): string {
  if (!validImagePrompt(prompt)) throw new Error('Image prompt must contain <core word> and be at most 2000 characters.');
  if (prompt.includes(SENTENCE_PLACEHOLDER) && !sentence.trim()) throw new Error('This image prompt requires the current sentence.');
  return prompt.replace(/<core word>|<sentence>/g, placeholder => placeholder === CORE_WORD_PLACEHOLDER
    ? coreWord.normalize('NFC').trim() : sentence.normalize('NFC').trim());
}