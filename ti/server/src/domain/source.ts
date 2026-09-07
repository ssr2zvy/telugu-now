import type { DataSourceInfo, MediaItem } from '../../../shared/contracts';

export interface SourceCatalogRow {
  sourceKey: string;
  wordCount: number;
  complexityValue?: number;
}

export interface SourceComplexityClass {
  complexityValue: number;
  rowCount: number;
}

export interface SourceCandidate {
  sourceKey: string;
  complexityValue?: number;
}

export interface PreparedSourceObservation {
  text: string;
  media?: MediaItem[];
}

export interface DataSource {
  readonly id: string;
  readonly enabled: boolean;

  catalog?(): readonly SourceCatalogRow[];
  rowCount?(): number;
  complexityClasses?(): readonly SourceComplexityClass[];
  candidateAt?(complexityValue: number, classIndex: number): SourceCandidate;
  prepare(candidate: SourceCandidate): Promise<PreparedSourceObservation>;
  info?(): DataSourceInfo;
}
