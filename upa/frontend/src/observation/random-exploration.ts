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

/** One visit to exploration. The reverse gesture exits immediately; no history is retained. */
export class RandomExploration {
  private readonly settings: ExplorationSettings;
  private readonly choices: ReturnType<typeof explorationChoices>;
  private readonly seenLetters = new Set<string>();
  private draws = 0;
  private closed = false;

  constructor(text: string, settings: ExplorationSettings, private readonly random = Math.random) {
    this.settings = parseExploration(settings);
    this.choices = explorationChoices(text);
  }

  get drawCount() { return this.draws; }

  move(direction: 'up' | 'down'): ExplorationStep | null {
    if (this.closed) return null;
    if (direction === 'down') { this.closed = true; this.draws = 0; this.seenLetters.clear(); return null; }
    if (!this.choices.letters.length && !this.choices.words.length) { this.closed = true; return null; }
    const word = this.random() < explorationWordProbability(this.settings, this.drawCount);
    let pool = word ? this.choices.words : this.choices.letters;
    if (!pool.length) pool = word ? this.choices.letters : this.choices.words;
    if (pool === this.choices.letters) {
      const unseen = pool.filter(letter => !this.seenLetters.has(letter.text.normalize('NFC')));
      // Exhaust distinct letters once per visit, then allow unrestricted repeats.
      if (unseen.length) pool = unseen;
    }
    const choice = pool[Math.min(pool.length - 1, Math.max(0, Math.floor(this.random() * pool.length)))]!;
    if (choice.kind === 'letter') this.seenLetters.add(choice.text.normalize('NFC'));
    this.draws++;
    return choice;
  }
}
