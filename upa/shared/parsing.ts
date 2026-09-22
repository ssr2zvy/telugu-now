export type SelectionMode = 'weighted' | 'core' | 'random';
export interface ParsingCoreStats {
  core: number;
  observations: number;
  distinctTexts: number;
  observationsWithAudio: number;
  targets: number;
  targetsWithExamples: number;
}
export interface ParsingStatus {
  mode: SelectionMode;
  ready: boolean;
  running: boolean;
  error: string | null;
  job: { phase?: string; processed?: number; total?: number; tokens?: number; uniqueWords?: number; error?: string };
  stats: { total: number; tokens: number; uniqueWords: number; uniquePhrases: number; recognizedWords: number; parseableWords: number; coreStats: ParsingCoreStats[] } | null;
  progress: { core: number; completed: boolean; levels: Array<{ core: number; mastered: number; targets: number }> } | null;
}
