export interface SourceCatalogRow {
  sourceKey: string;
  wordCount: number;
}

export interface SourceCandidate {
  sourceKey: string;
}

export interface PreparedSourceObservation {
  text: string;
}

export interface DataSource {
  readonly id: string;
  readonly enabled: boolean;

  catalog(): readonly SourceCatalogRow[];
  prepare(candidate: SourceCandidate): Promise<PreparedSourceObservation>;
}
