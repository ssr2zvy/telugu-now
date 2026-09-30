export interface ExplorationSettings {
  explorationStartWordPercent: number;
  explorationEndWordPercent: number;
  explorationTransitionDraws: number;
}

export const DEFAULT_EXPLORATION: ExplorationSettings = {
  explorationStartWordPercent: 20,
  explorationEndWordPercent: 80,
  explorationTransitionDraws: 20,
};
export const EXPLORATION_DRAW_LIMITS = { min: 2, max: 200 } as const;

export function parseExploration(value: Partial<ExplorationSettings>): ExplorationSettings {
  const bounded = (key: keyof ExplorationSettings, min: number, max: number) => {
    const candidate = value[key];
    return typeof candidate === 'number' && Number.isFinite(candidate)
      ? Math.round(Math.max(min, Math.min(max, candidate))) : DEFAULT_EXPLORATION[key];
  };
  return {
    explorationStartWordPercent: bounded('explorationStartWordPercent', 0, 100),
    explorationEndWordPercent: bounded('explorationEndWordPercent', 0, 100),
    explorationTransitionDraws: bounded('explorationTransitionDraws', EXPLORATION_DRAW_LIMITS.min, EXPLORATION_DRAW_LIMITS.max),
  };
}

/** Zero-based draw: first uses start, Nth uses end, subsequent draws keep end. */
export function explorationWordProbability(settings: ExplorationSettings, draw: number): number {
  const progress = Math.max(0, Math.min(1, draw / (settings.explorationTransitionDraws - 1)));
  return (settings.explorationStartWordPercent
    + (settings.explorationEndWordPercent - settings.explorationStartWordPercent) * progress) / 100;
}
