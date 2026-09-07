import type {
  DataSourceInfo,
  MediaItem,
} from '../../../shared/contracts';

export interface SourceComplexityClass {
  complexityValue: number;
  rowCount: number;
}

export interface SourceCatalogRow {
  sourceKey: string;
  wordCount?: number;
  complexityValue?: number;
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

  rowCount?(): number;
  complexityClasses?(): readonly SourceComplexityClass[];
  candidateAt?(complexityValue: number, classIndex: number): SourceCandidate;
  catalog?(): readonly SourceCatalogRow[];
  prepare(candidate: SourceCandidate): Promise<PreparedSourceObservation>;
  info?(): DataSourceInfo;
}
