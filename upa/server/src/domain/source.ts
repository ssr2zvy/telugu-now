import type { DataSourceInfo, MediaItem } from '../../../shared/contracts';

export interface SourceComplexityClass {
  complexityValue: number;
  rowCount: number;
}

export interface SourceCandidate {
  sourceKey: string;
  complexityValue: number;
}

export interface PreparedSourceObservation {
  text: string;
  media: MediaItem[];
}

export interface DataSource {
  readonly id: string;
  readonly enabled: boolean;
  readonly generation?: string;

  rowCount(): number;
  /** `commonWordReduction` selects the Common Word Inclusion strength (0 disables it). */
  complexityClasses(commonWordReduction?: number): readonly SourceComplexityClass[];
  candidateAt(
    complexityValue: number,
    classIndex: number,
    commonWordReduction?: number,
  ): SourceCandidate;
  prepare(
    sourceKey: string,
  ): Promise<PreparedSourceObservation>;
  info(): DataSourceInfo;
}
