import { explorationWordProbability, parseExploration, type ExplorationSettings } from '../../../shared/exploration';
import { explorationSteps, type ExplorationStep } from './exploration-steps';

/** Occurrences, not distinct spellings: every position is eligible equally. */
export function explorationChoices(text: string) {
  const letters = explorationSteps(text).filter(step => step.kind === 'letter');
  const words: ExplorationStep[] = [...new Intl.Segmenter('te', { granularity: 'word' }).segment(text)]
    .filter(part => part.isWordLike)
    .map(part => ({ kind: 'word', text: part.segment, start: part.index, end: part.index + part.segment.length,
      word: part.segment, wordStart: part.index, wordEnd: part.index + part.segment.length }));
  return { letters, words };
}

/** One visit to exploration. Reverse navigation replays history without new draws. */
export class RandomExploration {
  private readonly settings: ExplorationSettings;
  private readonly choices: ReturnType<typeof explorationChoices>;
  private readonly history: ExplorationStep[] = [];
  private index = -1;
  private closed = false;

  constructor(text: string, settings: ExplorationSettings, private readonly random = Math.random) {
    this.settings = parseExploration(settings);
    this.choices = explorationChoices(text);
  }

  get drawCount() { return this.history.length; }

  move(direction: 'up' | 'down'): ExplorationStep | null {
    if (this.closed) return null;
    if (direction === 'down') {
      if (this.index <= 0) { this.closed = true; return null; }
      return this.history[--this.index]!;
    }
    if (this.index + 1 < this.history.length) return this.history[++this.index]!;
    if (!this.choices.letters.length && !this.choices.words.length) { this.closed = true; return null; }
    const word = this.random() < explorationWordProbability(this.settings, this.drawCount);
    let pool = word ? this.choices.words : this.choices.letters;
    if (!pool.length) pool = word ? this.choices.letters : this.choices.words;
    const choice = pool[Math.min(pool.length - 1, Math.max(0, Math.floor(this.random() * pool.length)))]!;
    this.history.push(choice);
    this.index++;
    return choice;
  }
}
