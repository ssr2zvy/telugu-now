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
  complexityClasses(): readonly SourceComplexityClass[];
  candidateAt(
    complexityValue: number,
    classIndex: number,
  ): SourceCandidate;
  prepare(
    sourceKey: string,
  ): Promise<PreparedSourceObservation>;
  info(): DataSourceInfo;
}
