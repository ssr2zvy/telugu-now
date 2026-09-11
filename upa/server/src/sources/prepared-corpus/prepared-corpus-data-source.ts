import type {
  DataSource,
  PreparedSourceObservation,
  SourceCandidate,
  SourceComplexityClass,
} from '../../domain/source';
import {
  preparedCorpusStore,
  type PreparedCorpusStore,
} from './prepared-corpus-store';

export class PreparedCorpusDataSource implements DataSource {
  readonly enabled = true;

  constructor(
    readonly id: string,
    private readonly store: PreparedCorpusStore = preparedCorpusStore,
  ) {}

  get generation(): string {
    return this.store.generation;
  }

  rowCount(): number {
    return this.store.rowCount(this.id);
  }

  complexityClasses(): readonly SourceComplexityClass[] {
    return this.store.complexityClasses(this.id);
  }

  candidateAt(complexityValue: number, classIndex: number): SourceCandidate {
    return {
      sourceKey: this.store.sourceKeyAt(this.id, complexityValue, classIndex),
      complexityValue,
    };
  }

  async prepare(sourceKey: string): Promise<PreparedSourceObservation> {
    const row = this.store.row(this.id, sourceKey);

    return {
      text: row.text,
      media: [
        {
          kind: 'text',
          language: 'te',
          text: row.text,
        },
        {
          kind: 'audio',
          objectKey: row.audio_object_key,
          mimeType: row.audio_mime_type,
          durationSeconds: row.duration_seconds,
          sha256: row.audio_sha256,
        },
      ],
    };
  }

  info() {
    return this.store.sourceInfo(this.id);
  }
}
