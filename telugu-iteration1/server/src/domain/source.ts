export interface SourceCandidate {
  sourceKey: string;
}

export interface PreparedSourceObservation {
  text: string;
}

export interface DataSource {
  readonly id: string;
  readonly enabled: boolean;
  readonly selectionWeight: number;

  selectCandidate(): SourceCandidate;
  prepare(candidate: SourceCandidate): Promise<PreparedSourceObservation>;
}
