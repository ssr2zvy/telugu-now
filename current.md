## `data-transform/scripts/prepare-corpus/common.py`

### INSERT

**Location:** In the import block, immediately after `import math`.

```python
import os
import tempfile
```

### INSERT

**Location:** In the import block, immediately after `from dataclasses import dataclass`.

```python
from datetime import datetime, timezone
```

### INSERT

**Location:** Immediately after `canonical_split()` and before `grapheme_count()`.

```python
def normalize_source_locator(value: str) -> str:
    normalized = value.replace("\\", "/").strip()
    while normalized.startswith("./"):
        normalized = normalized[2:]

    normalized = "/".join(
        part
        for part in normalized.split("/")
        if part not in ("", ".")
    )

    if (
        not normalized
        or normalized.startswith("../")
        or "/../" in f"/{normalized}/"
    ):
        raise CorpusStructuralError(
            f"INVALID_SOURCE_LOCATOR:{value}"
        )

    return normalized
```

### REPLACE

**Location:** Replace the entire existing `class CorpusWriter:` skeleton through the end of the file.

```python
class CorpusWriter:
    def __init__(self, output: Path, replace: bool = False) -> None:
        self.output = Path(output).resolve()
        self.replace = replace
        self.output.parent.mkdir(parents=True, exist_ok=True)

        if self.output.exists() and not replace:
            raise FileExistsError(
                f"Prepared corpus already exists: {self.output}; "
                "pass --replace to replace it."
            )

        temporary = tempfile.mkdtemp(
            prefix=f".{self.output.name}.prepare-",
            dir=self.output.parent,
        )
        self.temporary = Path(temporary)
        self.objects_root = self.temporary / "objects"
        self.reports_root = self.temporary / "reports"
        self.objects_root.mkdir(parents=True, exist_ok=True)
        self.reports_root.mkdir(parents=True, exist_ok=True)

        self.database_path = self.temporary / "corpus.sqlite"
        self.db = sqlite3.connect(self.database_path)
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.execute("PRAGMA journal_mode = DELETE")
        self.db.executescript(
            """
            CREATE TABLE sources (
              source_id TEXT PRIMARY KEY,
              display_name TEXT NOT NULL,
              provider TEXT NOT NULL,
              license TEXT NOT NULL,
              upstream_url TEXT,
              catalog_version INTEGER NOT NULL,
              accepted_rows INTEGER NOT NULL,
              rejected_rows INTEGER NOT NULL,
              complexity_metric TEXT NOT NULL,
              status TEXT NOT NULL
                CHECK(status IN ('ready', 'fixture', 'invalid'))
            );

            CREATE TABLE source_rows (
              source_id TEXT NOT NULL,
              source_key TEXT NOT NULL,
              canonical_split TEXT NOT NULL,
              upstream_split TEXT NOT NULL,
              text TEXT NOT NULL,
              grapheme_count INTEGER NOT NULL
                CHECK(grapheme_count > 0),
              text_sha256 TEXT NOT NULL,
              audio_sha256 TEXT NOT NULL,
              audio_object_key TEXT NOT NULL,
              audio_mime_type TEXT NOT NULL,
              duration_seconds REAL NOT NULL
                CHECK(duration_seconds > 0),
              source_metadata_json TEXT NOT NULL,
              PRIMARY KEY(source_id, source_key),
              FOREIGN KEY(source_id)
                REFERENCES sources(source_id)
            );

            CREATE TABLE source_complexity_members (
              source_id TEXT NOT NULL,
              grapheme_count INTEGER NOT NULL,
              class_index INTEGER NOT NULL,
              source_key TEXT NOT NULL,
              PRIMARY KEY(
                source_id,
                grapheme_count,
                class_index
              ),
              UNIQUE(source_id, source_key),
              FOREIGN KEY(source_id, source_key)
                REFERENCES source_rows(source_id, source_key)
            );

            CREATE INDEX idx_source_rows_complexity
              ON source_rows(source_id, grapheme_count);
            """
        )
        self.db.commit()
        self.source_manifests: list[dict[str, Any]] = []
        self.finalized = False

    def _cleanup_temporary(self) -> None:
        try:
            self.db.close()
        except Exception:
            pass
        if self.temporary.exists():
            shutil.rmtree(
                self.temporary,
                ignore_errors=True,
            )

    def _write_rejection(
        self,
        handle: Any,
        row: CanonicalInputRow,
        error: RowRejected,
    ) -> None:
        handle.write(
            json.dumps(
                {
                    "sourceId": row.source_id,
                    "sourceKey": row.source_key,
                    "upstreamSplit": row.upstream_split,
                    "errorCode": error.code,
                    "reason": str(error),
                },
                ensure_ascii=False,
            )
            + "\n"
        )

    def add_source(
        self,
        *,
        source_id: str,
        display_name: str,
        provider: str,
        license_name: str,
        upstream_url: str,
        catalog_version: int,
        expected_audio_mime: str,
        rows: Iterable[CanonicalInputRow],
    ) -> None:
        if self.finalized:
            raise RuntimeError(
                "CorpusWriter is already finalized."
            )

        if self.db.execute(
            "SELECT 1 FROM sources WHERE source_id = ?",
            (source_id,),
        ).fetchone():
            raise CorpusStructuralError(
                f"DUPLICATE_SOURCE:{source_id}"
            )

        accepted_rows = 0
        rejected_rows = 0
        class_counts: dict[int, int] = {}
        rejection_path = (
            self.reports_root
            / f"{source_id}-rejected.jsonl"
        )

        self.db.execute(
            """
            INSERT INTO sources (
              source_id,
              display_name,
              provider,
              license,
              upstream_url,
              catalog_version,
              accepted_rows,
              rejected_rows,
              complexity_metric,
              status
            ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 'invalid')
            """,
            (
                source_id,
                display_name,
                provider,
                license_name,
                upstream_url,
                catalog_version,
                COMPLEXITY_METRIC,
            ),
        )
        self.db.commit()

        try:
            with rejection_path.open(
                "w",
                encoding="utf-8",
            ) as rejection_handle:
                for row in rows:
                    if row.source_id != source_id:
                        raise CorpusStructuralError(
                            "SOURCE_ID_MISMATCH:"
                            f"{source_id}:{row.source_id}"
                        )

                    try:
                        text = validate_text(row.text)
                        duration_seconds = validate_duration(
                            float(row.duration_seconds)
                        )
                        detected_mime, detected_extension = (
                            detect_audio(row.audio_bytes)
                        )

                        if detected_mime != expected_audio_mime:
                            raise RowRejected(
                                "AUDIO_FORMAT_MISMATCH",
                                "Expected "
                                f"{expected_audio_mime}; detected "
                                f"{detected_mime}.",
                            )

                        if row.audio_mime_type != expected_audio_mime:
                            raise RowRejected(
                                "AUDIO_METADATA_MISMATCH",
                                "Reader declared "
                                f"{row.audio_mime_type}; expected "
                                f"{expected_audio_mime}.",
                            )

                        if row.audio_extension != detected_extension:
                            raise RowRejected(
                                "AUDIO_EXTENSION_MISMATCH",
                                "Reader declared "
                                f"{row.audio_extension}; detected "
                                f"{detected_extension}.",
                            )

                        text_hash = sha256_text(text)
                        audio_hash = sha256_bytes(
                            row.audio_bytes
                        )
                        complexity = grapheme_count(text)
                        object_key = (
                            f"media/{source_id}/audio/"
                            f"{audio_hash}{detected_extension}"
                        )

                        existing = self.db.execute(
                            """
                            SELECT text_sha256, audio_sha256
                            FROM source_rows
                            WHERE source_id = ?
                              AND source_key = ?
                            """,
                            (
                                source_id,
                                row.source_key,
                            ),
                        ).fetchone()

                        if existing is not None:
                            error_code = (
                                "DUPLICATE_SOURCE_ROW"
                                if existing
                                == (text_hash, audio_hash)
                                else "SOURCE_KEY_COLLISION"
                            )
                            raise CorpusStructuralError(
                                f"{error_code}:"
                                f"{source_id}:"
                                f"{row.source_key}"
                            )

                        object_path = (
                            self.objects_root / object_key
                        )
                        if not object_path.exists():
                            object_path.parent.mkdir(
                                parents=True,
                                exist_ok=True,
                            )
                            temporary_object_path = (
                                object_path.with_suffix(
                                    object_path.suffix + ".tmp"
                                )
                            )
                            temporary_object_path.write_bytes(
                                row.audio_bytes
                            )
                            os.replace(
                                temporary_object_path,
                                object_path,
                            )

                        source_metadata_json = json.dumps(
                            row.source_metadata,
                            ensure_ascii=False,
                            sort_keys=True,
                            separators=(",", ":"),
                            default=str,
                        )

                        self.db.execute(
                            """
                            INSERT INTO source_rows (
                              source_id,
                              source_key,
                              canonical_split,
                              upstream_split,
                              text,
                              grapheme_count,
                              text_sha256,
                              audio_sha256,
                              audio_object_key,
                              audio_mime_type,
                              duration_seconds,
                              source_metadata_json
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                source_id,
                                row.source_key,
                                row.canonical_split,
                                row.upstream_split,
                                text,
                                complexity,
                                text_hash,
                                audio_hash,
                                object_key,
                                detected_mime,
                                duration_seconds,
                                source_metadata_json,
                            ),
                        )

                        class_index = class_counts.get(
                            complexity,
                            0,
                        )
                        self.db.execute(
                            """
                            INSERT INTO source_complexity_members (
                              source_id,
                              grapheme_count,
                              class_index,
                              source_key
                            ) VALUES (?, ?, ?, ?)
                            """,
                            (
                                source_id,
                                complexity,
                                class_index,
                                row.source_key,
                            ),
                        )
                        class_counts[complexity] = (
                            class_index + 1
                        )
                        accepted_rows += 1

                    except RowRejected as error:
                        rejected_rows += 1
                        self._write_rejection(
                            rejection_handle,
                            row,
                            error,
                        )

            if accepted_rows <= 0:
                raise CorpusStructuralError(
                    "SOURCE_HAS_NO_ACCEPTED_ROWS:"
                    f"{source_id}"
                )

            self.db.execute(
                """
                UPDATE sources
                SET accepted_rows = ?,
                    rejected_rows = ?,
                    status = 'ready'
                WHERE source_id = ?
                """,
                (
                    accepted_rows,
                    rejected_rows,
                    source_id,
                ),
            )
            self.db.commit()

        except Exception:
            self.db.rollback()
            self._cleanup_temporary()
            raise

        self.source_manifests.append(
            {
                "sourceId": source_id,
                "displayName": display_name,
                "provider": provider,
                "license": license_name,
                "upstreamUrl": upstream_url,
                "catalogVersion": catalog_version,
                "acceptedRows": accepted_rows,
                "rejectedRows": rejected_rows,
                "complexityMetric": COMPLEXITY_METRIC,
                "status": "ready",
            }
        )

    def _verify(self) -> None:
        integrity = self.db.execute(
            "PRAGMA integrity_check"
        ).fetchone()
        if integrity is None or integrity[0] != "ok":
            raise CorpusStructuralError(
                f"SQLITE_INTEGRITY_FAILURE:{integrity}"
            )

        for source in self.source_manifests:
            source_id = source["sourceId"]
            expected = int(source["acceptedRows"])

            row_count = self.db.execute(
                """
                SELECT COUNT(*)
                FROM source_rows
                WHERE source_id = ?
                """,
                (source_id,),
            ).fetchone()[0]

            member_count = self.db.execute(
                """
                SELECT COUNT(*)
                FROM source_complexity_members
                WHERE source_id = ?
                """,
                (source_id,),
            ).fetchone()[0]

            if (
                row_count != expected
                or member_count != expected
            ):
                raise CorpusStructuralError(
                    "CORPUS_COUNT_MISMATCH:"
                    f"{source_id}:"
                    f"{expected}:"
                    f"{row_count}:"
                    f"{member_count}"
                )

    def finalize(self) -> None:
        if self.finalized:
            raise RuntimeError(
                "CorpusWriter is already finalized."
            )

        if not self.source_manifests:
            self._cleanup_temporary()
            raise CorpusStructuralError(
                "CORPUS_HAS_NO_SOURCES"
            )

        try:
            self._verify()
            self.db.commit()
            self.db.close()

            manifest = {
                "corpusFormatVersion": CORPUS_FORMAT_VERSION,
                "complexityMetric": COMPLEXITY_METRIC,
                "complexityMetricVersion": (
                    COMPLEXITY_METRIC_VERSION
                ),
                "generatedAt": datetime.now(
                    timezone.utc
                ).isoformat(),
                "sources": self.source_manifests,
            }

            manifest_path = (
                self.temporary / "manifest.json"
            )
            manifest_path.write_text(
                json.dumps(
                    manifest,
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )

            backup: Path | None = None
            if self.output.exists():
                if not self.replace:
                    raise FileExistsError(self.output)

                backup = self.output.with_name(
                    "."
                    f"{self.output.name}.backup-"
                    f"{os.getpid()}"
                )
                if backup.exists():
                    shutil.rmtree(backup)
                os.replace(self.output, backup)

            try:
                os.replace(
                    self.temporary,
                    self.output,
                )
            except Exception:
                if (
                    backup is not None
                    and backup.exists()
                    and not self.output.exists()
                ):
                    os.replace(
                        backup,
                        self.output,
                    )
                raise
            else:
                if (
                    backup is not None
                    and backup.exists()
                ):
                    shutil.rmtree(backup)

            self.finalized = True

        except Exception:
            if self.temporary.exists():
                shutil.rmtree(
                    self.temporary,
                    ignore_errors=True,
                )
            raise
```

## `data-transform/scripts/prepare-corpus/sources/fleurs.py`

### REPLACE

**Location:** Replace the import beginning with `from ..common import (`.

```python
from common import (
    CanonicalInputRow,
    CorpusStructuralError,
    canonical_split,
    normalize_source_locator,
)
```

### REPLACE

**Location:** Inside `read_fleurs()`, replace the block that directly constructs `source_key` from `audio_filename` and then parses `num_samples_raw` with the following block.

```python
                normalized_audio_filename = (
                    normalize_source_locator(
                        audio_filename
                    )
                )
                source_key = (
                    f"{split}:"
                    f"{normalized_audio_filename}"
                )
                audio_path = (
                    audio_dir
                    / normalized_audio_filename
                )

                if not audio_path.is_file():
                    audio_bytes = b""
                else:
                    audio_bytes = audio_path.read_bytes()

                try:
                    num_samples = int(num_samples_raw)
                except (TypeError, ValueError):
                    num_samples = 0
```

### REPLACE

**Location:** In the yielded `source_metadata` mapping, replace the `audioFilename` value.

```python
"audioFilename": normalized_audio_filename,
```

## `data-transform/scripts/prepare-corpus/sources/shrutilipi.py`

### REPLACE

**Location:** Replace the import beginning with `from ..common import (`.

```python
from common import (
    CanonicalInputRow,
    CorpusStructuralError,
    canonical_split,
    normalize_source_locator,
)
```

### REPLACE

**Location:** Inside `read_shrutilipi()`, replace the block beginning with `upstream_path = audio.get("path")` through construction of `source_key`.

```python
                upstream_path = audio.get("path")
                if (
                    not isinstance(upstream_path, str)
                    or not upstream_path
                ):
                    raise CorpusStructuralError(
                        "SHRUTILIPI_SCHEMA:MISSING_AUDIO_PATH"
                    )

                normalized_audio_path = (
                    normalize_source_locator(
                        upstream_path
                    )
                )
                source_key = (
                    f"{split}:"
                    f"{normalized_audio_path}"
                )

                try:
                    duration_seconds = float(
                        row["duration"]
                    )
                except (TypeError, ValueError):
                    duration_seconds = float("nan")
```

### REPLACE

**Location:** In the yielded `CanonicalInputRow`, replace the `duration_seconds` and `upstreamAudioPath` values.

```python
                    duration_seconds=duration_seconds,
```

```python
"upstreamAudioPath": normalized_audio_path,
```

## `data-transform/scripts/prepare-corpus/sources/indicvoices.py`

### REPLACE

**Location:** Replace the import beginning with `from ..common import (`.

```python
from common import (
    CanonicalInputRow,
    CorpusStructuralError,
    canonical_split,
    normalize_source_locator,
)
```

### REPLACE

**Location:** Inside `read_indicvoices()`, replace the block beginning with `upstream_path = audio.get("path")` through construction of `source_key`.

```python
                upstream_path = audio.get("path")
                if (
                    not isinstance(upstream_path, str)
                    or not upstream_path
                ):
                    raise CorpusStructuralError(
                        "INDICVOICES_SCHEMA:MISSING_AUDIO_PATH"
                    )

                normalized_audio_path = (
                    normalize_source_locator(
                        upstream_path
                    )
                )
                source_key = (
                    f"{split}:"
                    f"{normalized_audio_path}"
                )

                try:
                    duration_seconds = float(
                        row["duration"]
                    )
                except (TypeError, ValueError):
                    duration_seconds = float("nan")
```

### REPLACE

**Location:** In the yielded `CanonicalInputRow`, replace the `duration_seconds` and `upstreamAudioPath` values.

```python
                    duration_seconds=duration_seconds,
```

```python
"upstreamAudioPath": normalized_audio_path,
```

## `ti/control.sh`

### REPLACE

**Location:** Replace the existing `run_data_samples()` function.

```bash
run_data_samples() {
  python "$DATA_TRANSFORM_DIR/scripts/extract-sample-data/FLEURS.py" \
    --input-root "$RAW_DATA_DIR/FLEURS" \
    --output-root "$SAMPLE_DATA_DIR/FLEURS" \
    --replace || return $?

  python "$DATA_TRANSFORM_DIR/scripts/extract-sample-data/Shrutilipi.py" \
    --input-root "$RAW_DATA_DIR/Shrutilipi" \
    --output-root "$SAMPLE_DATA_DIR/Shrutilipi" \
    || return $?

  python "$DATA_TRANSFORM_DIR/scripts/extract-sample-data/IndicVoices.py" \
    --input-root "$RAW_DATA_DIR/IndicVoices" \
    --output-root "$SAMPLE_DATA_DIR/IndicVoices" \
    || return $?
}
```

### REPLACE

**Location:** Inside `run_data_domain()`, replace only the `all)` case.

```bash
    all)
      run_data_samples || return $?
      run_data_prepare || return $?
      ;;
```

### INSERT

**Location:** In `run_dev_foreground()`, immediately after `local status dev_pid dev_pgid lf rc=0` and before the `setsid` check.

```bash
  if ! prepared_corpus_ready; then
    printf 'ERROR: CORPUS_NOT_PREPARED\n' >&2
    printf 'Run "./%s data --option prepare" first.\n' \
      "$SCRIPT_NAME" >&2
    return 1
  fi
```

## `ti/shared/contracts.ts`

### REPLACE

**Location:** Replace the entire existing `SelectionSnapshot` interface.

```ts
export interface SelectionSnapshot {
  sourceWeights: Record<string, number>;
  sourceId: string;
  sourceRowCount: number;
  sourceWeight: number;
  sourceMass: number;
  totalSourceMass: number;
  sourceProbability: number;
  sourceKey: string;
  complexityMetric: ComplexityMetric;
  intrinsicComplexityValue: number;
  complexityReferenceVersion: number;
  complexityPercentileTarget: number;
  complexityPercentileSpread: number;
  derivedStandardDeviation: number;
  globalPercentileStart: number;
  globalPercentileEnd: number;
  globalIntervalMass: number;
  globalRowsAtComplexityValue: number;
  globalPerRowComplexityMass: number;
  selectedSourceRowsAtComplexityValue: number;
  selectedSourceNormalizationDenominator: number;
  rowProbabilityWithinSource: number;
  overallProbability: number;

  // Persisted Iteration 2 snapshots may still contain these fields.
  wordCount?: number;
  globalRowsAtWordCount?: number;
  selectedSourceRowsAtWordCount?: number;
}
```

## `ti/server/src/domain/source.ts`

### REPLACE

**Location:** Replace the entire `SourceCatalogRow` interface, `SourceComplexityClass`, `SourceCandidate`, `PreparedSourceObservation`, and `DataSource` declarations with the following declarations. Keep the existing import at the top.

```ts
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
```

## `ti/server/src/sources/dummy/dummy-data-source.ts`

### REPLACE

**Location:** Replace the domain import so it no longer imports `SourceCatalogRow`.

```ts
import type {
  DataSource,
  PreparedSourceObservation,
  SourceCandidate,
  SourceComplexityClass,
} from '../../domain/source';
```

### REPLACE

**Location:** Remove the entire `wordCount()` helper. Keep `graphemeCount()`.

**Replacement:** No code at this location.

### REPLACE

**Location:** Replace the class field declarations for `byKey`, `byComplexity`, and `selectionCatalog`.

```ts
  private readonly byKey =
    new Map<string, DummyRow>();
  private readonly byComplexity =
    new Map<number, DummyRow[]>();
```

### REPLACE

**Location:** Replace the constructor body from `this.selectionCatalog = rows.map...` through the end of that assignment.

```ts
    for (const row of rows) {
      if (this.byKey.has(row.sourceKey)) {
        throw new Error(
          `Duplicate row key in ${id}: ${row.sourceKey}`,
        );
      }

      const complexityValue = graphemeCount(
        row.text,
      );
      if (complexityValue <= 0) {
        throw new Error(
          `Empty dummy row in ${id}: ${row.sourceKey}`,
        );
      }

      this.byKey.set(row.sourceKey, row);
      const complexityRows =
        this.byComplexity.get(complexityValue) ?? [];
      complexityRows.push(row);
      this.byComplexity.set(
        complexityValue,
        complexityRows,
      );
    }
```

### REPLACE

**Location:** Remove the entire `catalog()` method.

**Replacement:** No code at this location.

### REPLACE

**Location:** In `candidateAt()`, replace the returned object.

```ts
    return {
      sourceKey: row.sourceKey,
      complexityValue,
    };
```

### REPLACE

**Location:** Replace the `prepare()` signature and its first row lookup line.

```ts
  async prepare(
    sourceKey: string,
  ): Promise<PreparedSourceObservation> {
    const row = this.byKey.get(sourceKey);
    if (!row) {
      throw new Error(
        `Unknown ${this.id} row: ${sourceKey}`,
      );
    }
```

Keep the existing delay and TextMedia return after this replacement.

## `ti/server/src/sources/mock/mock-data-source.ts`

### REPLACE

**Location:** Replace the domain import.

```ts
import type {
  DataSource,
  PreparedSourceObservation,
  SourceCandidate,
  SourceComplexityClass,
} from '../../domain/source';
```

### REPLACE

**Location:** Replace the existing `catalog()` method with these methods.

```ts
  rowCount(): number {
    return 0;
  }

  complexityClasses(): readonly SourceComplexityClass[] {
    return [];
  }

  candidateAt(
    _complexityValue: number,
    _classIndex: number,
  ): SourceCandidate {
    throw new Error(
      'Legacy Iteration 1 mock source is not selectable.',
    );
  }

  info() {
    return {
      sourceId: this.id,
      displayName: 'Legacy Iteration 1 mock',
      provider: 'Telugu Now',
      license: 'Development compatibility source',
      upstreamUrl: null,
      catalogVersion: 1,
      acceptedRows: 0,
      rejectedRows: 0,
      complexityMetric: 'word-count' as const,
      status: 'fixture' as const,
    };
  }
```

### REPLACE

**Location:** Replace the `prepare()` signature so it accepts a source key string rather than a candidate object.

```ts
  async prepare(
    _sourceKey: string,
  ): Promise<PreparedSourceObservation> {
```

Keep the existing delay body, then replace its return value with:

```ts
    const text = `${randomGrapheme()}${randomGrapheme()}`;
    return {
      text,
      media: [
        {
          kind: 'text',
          language: 'te',
          text,
        },
      ],
    };
```

## `ti/server/src/sources/prepared-corpus/prepared-corpus-store.ts`

### REPLACE

**Location:** Replace the SQL inside `hasSource()`.

```ts
      this.db.prepare(`
        SELECT 1
        FROM sources
        WHERE source_id = ?
          AND status = 'ready'
          AND complexity_metric = 'grapheme-count'
          AND accepted_rows > 0
        LIMIT 1
      `).get(sourceId),
```

### REPLACE

**Location:** Replace `sourceKeyAt()`.

```ts
  sourceKeyAt(
    sourceId: string,
    graphemeCount: number,
    classIndex: number,
  ): string {
    if (!this.db) {
      throw new Error(
        `CORPUS_SOURCE_MISSING:${sourceId}`,
      );
    }

    const row = this.db.prepare(`
      SELECT source_key
      FROM source_complexity_members
      WHERE source_id = ?
        AND grapheme_count = ?
        AND class_index = ?
    `).get(
      sourceId,
      graphemeCount,
      classIndex,
    ) as { source_key?: string } | undefined;

    if (!row?.source_key) {
      throw new Error(
        'CORPUS_SOURCE_KEY_MISSING:' +
        `${sourceId}/${graphemeCount}/${classIndex}`,
      );
    }

    return row.source_key;
  }
```

## `ti/server/src/sources/prepared-corpus/prepared-corpus-data-source.ts`

### REPLACE

**Location:** Replace `prepare(candidate: SourceCandidate)` with a source-key-based lookup.

```ts
  async prepare(
    sourceKey: string,
  ): Promise<PreparedSourceObservation> {
    const row = this.store.row(
      this.id,
      sourceKey,
    );

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
```

## `ti/server/src/services/source-registry.ts`

### REPLACE

**Location:** Replace the existing `sourceInfo()` method.

```ts
  sourceInfo() {
    return this.selectableSources()
      .map((source) => source.info());
  }
```

## `ti/server/src/services/selection-engine.ts`

### REPLACE

**Location:** Replace the first two imports.

```ts
import type {
  ProfileSelectionSettings,
  SelectionSnapshot,
} from '../../../shared/contracts';
import type { DataSource } from '../domain/source';
```

### REPLACE

**Location:** Replace the complexity reference constants.

```ts
export const COMPLEXITY_REFERENCE_VERSION = 2;
const SUPPORTED_REFERENCE_VERSIONS = new Set([2]);
```

### REPLACE

**Location:** Replace `ComplexityClass`.

```ts
interface ComplexityClass {
  complexityValue: number;
  globalCount: number;
  percentileStart: number;
  percentileEnd: number;
}
```

### REPLACE

**Location:** Replace `SelectionResult`.

```ts
export interface SelectionResult {
  sourceId: string;
  sourceKey: string;
  complexityValue: number;
  snapshot: SelectionSnapshot;
}
```

### REPLACE

**Location:** Replace `ComplexityReferenceDescription`.

```ts
export interface ComplexityReferenceDescription {
  version: number;
  totalRows: number;
  classes: Array<{
    complexityValue: number;
    globalCount: number;
    percentileStart: number;
    percentileEnd: number;
  }>;
}
```

### REPLACE

**Location:** Remove both `sourceCatalogRows()` and `sourceWordCountMap()` in their entirety.

**Replacement:** No code at this location.

### REPLACE

**Location:** In the `SelectionEngine` constructor, replace the block that builds `counts` by iterating `sourceCatalogRows(source)`.

```ts
    const counts = new Map<number, number>();

    for (const source of registry.selectableSources()) {
      const sourceClasses = source.complexityClasses();
      const seenValues = new Set<number>();
      let classRowCount = 0;

      for (const item of sourceClasses) {
        if (
          !Number.isInteger(item.complexityValue)
          || item.complexityValue <= 0
          || !Number.isInteger(item.rowCount)
          || item.rowCount <= 0
        ) {
          throw new Error(
            `SOURCE_COMPLEXITY_INVALID:${source.id}`,
          );
        }

        if (seenValues.has(item.complexityValue)) {
          throw new Error(
            `SOURCE_COMPLEXITY_DUPLICATE:${source.id}:` +
            `${item.complexityValue}`,
          );
        }
        seenValues.add(item.complexityValue);
        classRowCount += item.rowCount;

        counts.set(
          item.complexityValue,
          (counts.get(item.complexityValue) ?? 0)
            + item.rowCount,
        );
      }

      if (classRowCount !== source.rowCount()) {
        throw new Error(
          `SOURCE_COMPLEXITY_COUNT_MISMATCH:${source.id}:` +
          `${source.rowCount()}:${classRowCount}`,
        );
      }
    }
```

### REPLACE

**Location:** In the constructor, replace the `.map(([wordCount, globalCount]) => { ... })` block that constructs `this.classes`.

```ts
      .map(([complexityValue, globalCount]) => {
        const percentileStart =
          cumulative / this.totalRows;
        cumulative += globalCount;
        return {
          complexityValue,
          globalCount,
          percentileStart,
          percentileEnd:
            cumulative / this.totalRows,
        };
      });
```

### REPLACE

**Location:** Inside `select()`, replace the source-entry construction.

```ts
    const sourceEntries = sources.map((source) => {
      const sourceWeight =
        settings.sourceWeights[source.id];
      if (sourceWeight === undefined) {
        throw new Error(
          `Missing source weight for ${source.id}.`,
        );
      }

      const sourceRowCount = source.rowCount();
      return {
        source,
        sourceWeight,
        sourceRowCount,
        sourceMass:
          sourceRowCount * sourceWeight,
      };
    });
```

### REPLACE

**Location:** Inside `select()`, replace the complete block beginning with `const classByWordCount` and ending immediately before calculation of `rowProbabilityWithinSource`.

```ts
    const classByValue = new Map(
      classMasses.map((item) => [
        item.complexityValue,
        item,
      ]),
    );

    const sourceClasses =
      selectedSourceEntry.source
        .complexityClasses()
        .map((item) => {
          const complexity =
            classByValue.get(
              item.complexityValue,
            );
          if (!complexity) {
            throw new Error(
              'Complexity value ' +
              `${item.complexityValue} ` +
              'is absent from the global reference.',
            );
          }

          return {
            complexityValue:
              item.complexityValue,
            rowCount: item.rowCount,
            complexity,
            sourceClassMass:
              item.rowCount *
              complexity.perRowMass,
          };
        });

    const denominator = sourceClasses.reduce(
      (sum, item) =>
        sum + item.sourceClassMass,
      0,
    );
    if (!(denominator > 0)) {
      throw new Error(
        'Selected source has zero complexity mass.',
      );
    }

    const selectedClass = weightedPick(
      sourceClasses,
      (item) => item.sourceClassMass,
      this.random,
    );

    const rowIndex = Math.floor(
      Math.min(
        Math.max(this.random(), 0),
        1 - Number.EPSILON,
      ) * selectedClass.rowCount,
    );

    const selectedRow =
      selectedSourceEntry.source.candidateAt(
        selectedClass.complexityValue,
        rowIndex,
      );
```

### REPLACE

**Location:** Replace calculation of `complexityValue` and the complete `snapshot` object with the following block.

```ts
    const complexityValue =
      selectedRow.complexityValue;

    const snapshot: SelectionSnapshot = {
      sourceWeights: {
        ...settings.sourceWeights,
      },
      sourceId: selectedSourceEntry.source.id,
      sourceRowCount:
        selectedSourceEntry.sourceRowCount,
      sourceWeight:
        selectedSourceEntry.sourceWeight,
      sourceMass:
        selectedSourceEntry.sourceMass,
      totalSourceMass,
      sourceProbability,
      sourceKey: selectedRow.sourceKey,
      complexityMetric: 'grapheme-count',
      intrinsicComplexityValue:
        complexityValue,
      complexityReferenceVersion:
        settings.complexityReferenceVersion,
      complexityPercentileTarget:
        settings.complexityPercentileTarget,
      complexityPercentileSpread:
        settings.complexityPercentileSpread,
      derivedStandardDeviation: sigma,
      globalPercentileStart:
        selectedClass.complexity.percentileStart,
      globalPercentileEnd:
        selectedClass.complexity.percentileEnd,
      globalIntervalMass:
        selectedClass.complexity.intervalMass,
      globalRowsAtComplexityValue:
        selectedClass.complexity.globalCount,
      globalPerRowComplexityMass:
        selectedClass.complexity.perRowMass,
      selectedSourceRowsAtComplexityValue:
        selectedClass.rowCount,
      selectedSourceNormalizationDenominator:
        denominator,
      rowProbabilityWithinSource,
      overallProbability,
    };
```

### REPLACE

**Location:** Replace the final return from `select()`.

```ts
    return {
      sourceId: selectedSourceEntry.source.id,
      sourceKey: selectedRow.sourceKey,
      complexityValue,
      snapshot,
    };
```

## `ti/server/src/db/database.ts`

### REPLACE

**Location:** In the initial `CREATE TABLE IF NOT EXISTS source_records` statement, replace the table definition.

```sql
  CREATE TABLE IF NOT EXISTS source_records (
    source_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    text TEXT NOT NULL,
    media_json TEXT NOT NULL DEFAULT '[]',
    prepared_at INTEGER NOT NULL,
    PRIMARY KEY (source_id, source_key)
  );
```

### INSERT

**Location:** Immediately after the migration that adds `selection_snapshot_json` to `observation_acquisitions` and before the index-creation `db.exec()` block.

```ts
if (!columnExists('source_records', 'media_json')) {
  db.exec(`
    ALTER TABLE source_records
    ADD COLUMN media_json TEXT NOT NULL DEFAULT '[]';
  `);
}
```

### REPLACE

**Location:** Replace the existing Iteration 1 source-record backfill statement.

```ts
db.exec(`
  INSERT OR IGNORE INTO source_records (
    source_id,
    source_key,
    text,
    media_json,
    prepared_at
  )
  SELECT
    source_id,
    source_key,
    text,
    '[]',
    COALESCE(prepared_at, selected_at)
  FROM observations
  WHERE status = 'ready'
    AND text IS NOT NULL;
`);
```

## `ti/server/src/services/source-record-service.ts`

### INSERT

**Location:** Immediately before the existing local service imports.

```ts
import type {
  MediaItem,
} from '../../../shared/contracts';
```

### REPLACE

**Location:** Replace `ResolvedSourceRecord`.

```ts
export interface ResolvedSourceRecord {
  sourceId: string;
  sourceKey: string;
  text: string;
  media: MediaItem[];
  cacheHit: boolean;
  requestStartedAt: number | null;
  requestCompletedAt: number | null;
  requestDurationMs: number | null;
}
```

### REPLACE

**Location:** Replace `CachedRow` and `FreshResolution`.

```ts
interface CachedRow {
  text: string;
  media_json: string;
}

interface FreshResolution {
  text: string;
  media: MediaItem[];
  requestStartedAt: number;
  requestCompletedAt: number;
  requestDurationMs: number;
}
```

### REPLACE

**Location:** Inside `cached()`, replace the SELECT list.

```sql
      SELECT text, media_json
```

### REPLACE

**Location:** Inside the cache-hit branch of `resolve()`, replace the returned object with this block.

```ts
      const parsed = JSON.parse(
        existing.media_json,
      ) as MediaItem[];
      const media = parsed.length > 0
        ? parsed
        : [
            {
              kind: 'text' as const,
              language: 'te' as const,
              text: existing.text,
            },
          ];

      return {
        sourceId,
        sourceKey,
        text: existing.text,
        media,
        cacheHit: true,
        requestStartedAt: null,
        requestCompletedAt: null,
        requestDurationMs: null,
      };
```

### INSERT

**Location:** In the fresh-resolution return from `resolve()`, immediately after `text: fresh.text,`.

```ts
      media: fresh.media,
```

### REPLACE

**Location:** In `fetchAndCache()`, replace the source preparation call.

```ts
    const prepared = await source.prepare(
      sourceKey,
    );
```

### REPLACE

**Location:** In `fetchAndCache()`, replace the source-record INSERT/UPSERT.

```ts
    db.prepare(`
      INSERT INTO source_records (
        source_id,
        source_key,
        text,
        media_json,
        prepared_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_id, source_key)
      DO UPDATE SET
        text = excluded.text,
        media_json = excluded.media_json,
        prepared_at = excluded.prepared_at
    `).run(
      sourceId,
      sourceKey,
      prepared.text,
      JSON.stringify(prepared.media),
      requestCompletedAt,
    );
```

### INSERT

**Location:** In the final return from `fetchAndCache()`, immediately after `text: prepared.text,`.

```ts
      media: prepared.media,
```

## `ti/server/src/services/profile-service.ts`

### REPLACE

**Location:** Replace `parseSelectionSnapshot()`.

```ts
function parseSelectionSnapshot(
  raw: string,
): SelectionSnapshot | null {
  try {
    const value = JSON.parse(raw) as
      Partial<SelectionSnapshot> & {
        wordCount?: number;
        globalRowsAtWordCount?: number;
        selectedSourceRowsAtWordCount?: number;
      };

    if (
      typeof value.sourceId !== 'string'
      || typeof value.sourceKey !== 'string'
    ) {
      return null;
    }

    if (
      value.complexityMetric === undefined
      && typeof value.wordCount === 'number'
    ) {
      return {
        ...value,
        complexityMetric: 'word-count',
        intrinsicComplexityValue:
          value.wordCount,
        globalRowsAtComplexityValue:
          value.globalRowsAtWordCount ?? 0,
        selectedSourceRowsAtComplexityValue:
          value.selectedSourceRowsAtWordCount ?? 0,
      } as SelectionSnapshot;
    }

    return value as SelectionSnapshot;
  } catch {
    return null;
  }
}
```

## `ti/server/src/index.ts`

### INSERT

**Location:** With the existing service imports.

```ts
import { sourceRegistry } from './services/source-registry';
```

### REPLACE

**Location:** Replace the existing shared-contract import with the same import plus `DataSourcesResponse`.

```ts
import type {
  DataSourcesResponse,
  ExportRequest,
  LoadProfileRequest,
  NavigationRequest,
  UpdateSelectionSettingsRequest,
  VisibilityRequest,
} from '../../shared/contracts';
```

### INSERT

**Location:** Immediately after `const app = new Hono();` and before any routes are registered.

```ts
sourceRegistry.assertPreparedSourcesPresent();
```

### INSERT

**Location:** Immediately after the health route.

```ts
app.get('/api/data-sources', (c) =>
  c.json<DataSourcesResponse>({
    sources: sourceRegistry.sourceInfo(),
  }),
);
```

## `ti/frontend/src/api.ts`

### INSERT

**Location:** In the shared-contract type import.

```ts
  DataSourcesResponse,
```

### INSERT

**Location:** Immediately after `parseJson()`.

```ts
export async function getDataSources():
Promise<DataSourcesResponse> {
  return parseJson<DataSourcesResponse>(
    await fetch('/api/data-sources'),
  );
}
```

## `ti/frontend/src/settings/types.ts`

### REPLACE

**Location:** Replace the `SettingsPage` union.

```ts
export type SettingsPage =
  | 'index'
  | 'complexity'
  | 'sources'
  | 'diagnostic'
  | 'export'
  | 'dataSources';
```

## `ti/frontend/src/settings/settings-utils.ts`

### REPLACE

**Location:** Replace `sourceDisplayName()`.

```ts
export function sourceDisplayName(
  sourceId: string,
): string {
  const preparedNames:
    Record<string, string> = {
      'fleurs-te': 'FLEURS',
      'shrutilipi-te': 'Shrutilipi',
      'indicvoices-te': 'IndicVoices',
    };

  if (preparedNames[sourceId]) {
    return preparedNames[sourceId];
  }

  const match =
    /^source(\d+)$/.exec(
      sourceId,
    );
  return match?.[1] ?? sourceId;
}
```

## `ti/frontend/src/settings/language.ts`

### INSERT

**Location:** In the English `COPY.en` object, immediately after `export: 'Export',`.

```ts
    dataSources: 'Data sources',
    provider: 'Provider',
    license: 'License',
    sourceRepository: 'Source repository',
    catalogVersion: 'Catalog version',
    acceptedRows: 'Accepted rows',
    rejectedRows: 'Rejected rows',
    sourceStatus: 'Status',
    complexityMetric: 'Complexity metric',
    sourceReady: 'Ready',
    sourceFixture: 'Development fixture',
    sourceInvalid: 'Invalid',
```

### INSERT

**Location:** In the Telugu `COPY.te` object, immediately after `export: 'ఎగుమతి',`.

```ts
    dataSources: 'డేటా మూలాలు',
    provider: 'ప్రదాత',
    license: 'లైసెన్స్',
    sourceRepository: 'మూల రిపోజిటరీ',
    catalogVersion: 'క్యాటలాగ్ సంచిక',
    acceptedRows: 'ఆమోదించిన వరుసలు',
    rejectedRows: 'తిరస్కరించిన వరుసలు',
    sourceStatus: 'స్థితి',
    complexityMetric: 'సంక్లిష్టత ప్రమాణం',
    sourceReady: 'సిద్ధం',
    sourceFixture: 'అభివృద్ధి నమూనా',
    sourceInvalid: 'చెల్లదు',
```

## `ti/frontend/src/settings/pages/SettingsIndex.tsx`

### REPLACE

**Location:** Replace the `label` union in the local `entries` type.

```ts
      label:
        | 'complexity'
        | 'sourceWeights'
        | 'diagnostic'
        | 'export'
        | 'dataSources';
```

### INSERT

**Location:** In the `entries` array, immediately after the `sources` entry and before `diagnostic`.

```ts
      {
        page: 'dataSources',
        label: 'dataSources',
      },
```

## `ti/frontend/src/settings/pages/DataSourcesPage.tsx`

### INSERT — NEW FILE

**Location:** Create this file.

```tsx
import {
  useEffect,
  useState,
} from 'react';
import type {
  DataSourceInfo,
} from '../../../../shared/contracts';
import {
  getDataSources,
} from '../../api';
import {
  t,
} from '../language';
import type {
  UiLanguage,
} from '../types';

function statusLabel(
  language: UiLanguage,
  status: DataSourceInfo['status'],
): string {
  if (status === 'ready') {
    return t(language, 'sourceReady');
  }
  if (status === 'fixture') {
    return t(language, 'sourceFixture');
  }
  return t(language, 'sourceInvalid');
}

export function DataSourcesPage({
  language,
}: {
  language: UiLanguage;
}) {
  const [sources, setSources] =
    useState<DataSourceInfo[] | null>(null);
  const [failed, setFailed] =
    useState(false);

  useEffect(() => {
    let active = true;

    void getDataSources()
      .then((response) => {
        if (!active) return;
        setSources(response.sources);
        setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, []);

  if (failed) {
    return (
      <div className="diagnostic-empty">
        {t(language, 'unavailable')}
      </div>
    );
  }

  if (!sources) {
    return (
      <div className="diagnostic-empty">
        ...
      </div>
    );
  }

  return (
    <div className="data-source-list">
      {sources.map((source) => (
        <section
          className="data-source-card"
          key={source.sourceId}
        >
          <h2>{source.displayName}</h2>
          <dl>
            <dt>{t(language, 'provider')}</dt>
            <dd>{source.provider}</dd>

            <dt>{t(language, 'license')}</dt>
            <dd>{source.license}</dd>

            <dt>
              {t(language, 'catalogVersion')}
            </dt>
            <dd>{source.catalogVersion}</dd>

            <dt>{t(language, 'acceptedRows')}</dt>
            <dd>{source.acceptedRows}</dd>

            <dt>{t(language, 'rejectedRows')}</dt>
            <dd>{source.rejectedRows}</dd>

            <dt>{t(language, 'complexityMetric')}</dt>
            <dd>{source.complexityMetric}</dd>

            <dt>{t(language, 'sourceStatus')}</dt>
            <dd>
              {statusLabel(
                language,
                source.status,
              )}
            </dd>
          </dl>

          {source.upstreamUrl ? (
            <a
              href={source.upstreamUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t(language, 'sourceRepository')}
            </a>
          ) : null}
        </section>
      ))}
    </div>
  );
}
```

## `ti/frontend/src/settings/SettingsView.tsx`

### INSERT

**Location:** With the other settings-page imports.

```ts
import { DataSourcesPage } from './pages/DataSourcesPage';
```

### INSERT

**Location:** Immediately after the `page === 'index'` block and before `if (!draft) { return null; }`.

```tsx
  if (page === 'dataSources') {
    return (
      <SettingsShell
        {...shellProps}
        title={t(language, 'dataSources')}
        onBack={controller.backToIndex}
      >
        <DataSourcesPage
          language={language}
        />
      </SettingsShell>
    );
  }
```

## `ti/frontend/src/settings/diagnostic.ts`

### REPLACE

**Location:** Replace the `wordCount` label entry.

```ts
  complexityMetric: {
    en: 'Complexity metric',
    te: 'సంక్లిష్టత ప్రమాణం',
  },
  intrinsicComplexityValue: {
    en: 'Complexity value',
    te: 'సంక్లిష్టత విలువ',
  },
```

### REPLACE

**Location:** Replace the `globalRowsAtWordCount` label entry.

```ts
  globalRowsAtComplexityValue: {
    en: 'Global rows at complexity value',
    te: 'ఆ సంక్లిష్టత విలువలో ప్రపంచ వరుసలు',
  },
```

### REPLACE

**Location:** Replace the `selectedSourceRowsAtWordCount` label entry.

```ts
  selectedSourceRowsAtComplexityValue: {
    en: 'Source rows at complexity value',
    te: 'ఆ సంక్లిష్టత విలువలో మూల వరుసలు',
  },
```

### REPLACE

**Location:** In `selectionRows()`, replace the row whose key is `wordCount`.

```ts
    {
      key: 'complexityMetric',
      value: selection.complexityMetric,
    },
    {
      key: 'intrinsicComplexityValue',
      value: String(
        selection.intrinsicComplexityValue,
      ),
    },
```

### REPLACE

**Location:** In `selectionRows()`, replace the row whose key is `globalRowsAtWordCount`.

```ts
    {
      key: 'globalRowsAtComplexityValue',
      value: String(
        selection.globalRowsAtComplexityValue,
      ),
    },
```

### REPLACE

**Location:** In `selectionRows()`, replace the row whose key is `selectedSourceRowsAtWordCount`.

```ts
    {
      key: 'selectedSourceRowsAtComplexityValue',
      value: String(
        selection.selectedSourceRowsAtComplexityValue,
      ),
    },
```

## `ti/frontend/src/export-viewer.ts`

### REPLACE

**Location:** Inside the generated standalone viewer's `rowsFor(entry)` array, replace the `Word count` row.

```js
    ['Complexity metric',selection.complexityMetric],
    ['Complexity value',selection.intrinsicComplexityValue],
```

### REPLACE

**Location:** Replace the `Global rows at word count` row.

```js
    ['Global rows at complexity value',selection.globalRowsAtComplexityValue],
```

### REPLACE

**Location:** Replace the `Source rows at word count` row.

```js
    ['Source rows at complexity value',selection.selectedSourceRowsAtComplexityValue],
```

## `ti/frontend/src/styles/settings.css`

### INSERT

**Location:** Immediately after the `.diagnostic-table td` rule and before the first `@media` block.

```css
.data-source-list {
  display: grid;
  gap: 1rem;
}

.data-source-card {
  padding: 1rem;
  border:
    1px solid
    rgba(30, 30, 30, 0.11);
  border-radius: 0.9rem;
  background:
    rgba(255, 255, 255, 0.13);
}

.data-source-card h2 {
  margin: 0 0 0.8rem;
  color: rgba(20, 20, 20, 0.86);
}

.data-source-card dl {
  display: grid;
  grid-template-columns:
    minmax(8rem, 1fr)
    minmax(0, 2fr);
  gap: 0.45rem 1rem;
  margin: 0 0 0.8rem;
}

.data-source-card dt {
  color: rgba(20, 20, 20, 0.58);
}

.data-source-card dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.data-source-card a {
  color: rgba(20, 20, 20, 0.7);
}
```

## `ti/tests/selection-math.test.ts`

### REPLACE

**Location:** Replace the import of `SourceCatalogRow` so only `DataSource` and `SourceComplexityClass` are imported from the source domain.

```ts
import type {
  DataSource,
  SourceComplexityClass,
} from '../server/src/domain/source';
```

### REPLACE

**Location:** In `actualSettings()`, replace the reference version.

```ts
    complexityReferenceVersion: 2,
```

### REPLACE

**Location:** Replace `oneRowPerComplexityRegistry()` with a source that implements `rowCount()`, `complexityClasses()`, `candidateAt()`, `prepare()`, and `info()` rather than `catalog()`. Use complexity values `1` through `6`, one row in each class.

```ts
function oneRowPerComplexityRegistry(): SourceRegistry {
  const classes: SourceComplexityClass[] =
    Array.from(
      { length: 6 },
      (_, index) => ({
        complexityValue: index + 1,
        rowCount: 1,
      }),
    );

  const source: DataSource = {
    id: 'only',
    enabled: true,
    rowCount: () => 6,
    complexityClasses: () => classes,
    candidateAt: (complexityValue) => ({
      sourceKey: `row-${complexityValue}`,
      complexityValue,
    }),
    prepare: async (sourceKey) => ({
      text: sourceKey,
      media: [
        {
          kind: 'text',
          language: 'te',
          text: sourceKey,
        },
      ],
    }),
    info: () => ({
      sourceId: 'only',
      displayName: 'only',
      provider: 'test',
      license: 'test',
      upstreamUrl: null,
      catalogVersion: 2,
      acceptedRows: 6,
      rejectedRows: 0,
      complexityMetric: 'grapheme-count',
      status: 'fixture',
    }),
  };

  return {
    selectableSources: () => [source],
  } as unknown as SourceRegistry;
}
```

### REPLACE

**Location:** Everywhere this test identifies the selected class using `selected.wordCount`, replace it with `selected.complexityValue`.

### REPLACE

**Location:** Replace the test named `global complexity reference v1 is pinned...` so it verifies reference version `2`, total row count `72`, strictly increasing `complexityValue` classes, total class counts of `72`, and exact cumulative percentile intervals derived from those class counts. Do not keep the old hard-coded word-count distribution.

### REPLACE

**Location:** In the mismatched-reference test, use `complexityReferenceVersion: 1` as the rejected value.

### REPLACE

**Location:** Everywhere this file reads `snapshot.globalRowsAtWordCount`, replace it with `snapshot.globalRowsAtComplexityValue`.

## `ti/tests/selection-oracle.test.ts`

### REPLACE

**Location:** Replace every word-count-specific oracle concept with grapheme complexity:

```text
independentWordCount          -> independentGraphemeCount
wordCount                     -> complexityValue
globalCountByWordCount        -> globalCountByComplexity
sourceCountsByWordCount       -> sourceCountsByComplexity
globalRowsAtWordCount         -> globalRowsAtComplexityValue
selectedSourceRowsAtWordCount -> selectedSourceRowsAtComplexityValue
```

### REPLACE

**Location:** Replace the old independent word counter with this helper.

```ts
function independentGraphemeCount(
  text: string,
): number {
  return [
    ...new Intl.Segmenter(
      'te',
      { granularity: 'grapheme' },
    ).segment(text.normalize('NFC')),
  ].length;
}
```

### REPLACE

**Location:** Every `ProfileSelectionSettings` fixture in this file must use:

```ts
complexityReferenceVersion: 2,
```

### REPLACE

**Location:** In `assertSnapshotMatchesIndependentOracle()`, replace the old word-count assertions with:

```ts
  assert.equal(
    snapshot.complexityMetric,
    'grapheme-count',
  );
  assert.equal(
    snapshot.intrinsicComplexityValue,
    expected.complexityValue,
  );
  assert.equal(
    snapshot.complexityReferenceVersion,
    2,
  );
  assert.equal(
    snapshot.globalRowsAtComplexityValue,
    expected.globalRowsAtComplexityValue,
  );
  assert.equal(
    snapshot.selectedSourceRowsAtComplexityValue,
    expected.selectedSourceRowsAtComplexityValue,
  );
```

### REPLACE

**Location:** Replace any custom test `DataSource` that still implements `catalog()` with the strict `rowCount()`, `complexityClasses()`, `candidateAt()`, `prepare()`, and `info()` contract.

## `ti/tests/preparation-service.test.ts`

### REPLACE

**Location:** In the test `live preparation is sequential, respects queue order, and reuses the shared cache`, replace the temporary override of `source.prepare`.

```ts
  source.prepare = async (sourceKey) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    sourceCallOrder.push(sourceKey);
    try {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, 4),
      );
      return await originalPrepare(sourceKey);
    } finally {
      active -= 1;
    }
  };
```

## `ti/tests/core-implementation.test.ts`

### INSERT

**Location:** In the test-suite setup, before importing any module that imports `source-registry.ts`, create a temporary prepared-corpus SQLite fixture and set `process.env.CORPUS_DATABASE_PATH` to that file.

The fixture must contain all three real source IDs:

```text
fleurs-te
shrutilipi-te
indicvoices-te
```

For each source insert:

```text
one sources row with status=ready and complexity_metric=grapheme-count
one source_rows row
one source_complexity_members row with class_index=0
```

### REPLACE

**Location:** Replace the dummy-source catalog assertions around the current `source.catalog()` checks.

```ts
    const sources =
      sourceRegistryModule.sourceRegistry
        .selectableSources();

    assert.equal(sources.length, 6);

    for (const source of sources) {
      assert.ok(source.rowCount() > 0);
      assert.ok(
        source.complexityClasses().every(
          (item) =>
            item.complexityValue > 0
            && item.rowCount > 0,
        ),
      );
    }
```

### INSERT

**Location:** Immediately after the six-source count assertion.

```ts
    assert.deepEqual(
      sourceRegistryModule.sourceRegistry
        .selectableSourceIds()
        .sort(),
      [
        'fleurs-te',
        'indicvoices-te',
        'shrutilipi-te',
        'source1',
        'source2',
        'source3',
      ].sort(),
    );
```

### REPLACE

**Location:** Replace every assertion expecting `complexityReferenceVersion === 1` for newly-created settings or acquisitions with `2`.

### REPLACE

**Location:** Replace any explicit test request that deliberately supplies a valid reference version of `1` with `2`. Keep `1` only where the test is explicitly validating historical snapshot compatibility or rejection of an obsolete version.

### REPLACE

**Location:** In each of the three test blocks that temporarily assign `source.prepare = async (candidate) => ...`, change the override parameter to `sourceKey`, pass `sourceKey` to `originalPrepare`, and use `sourceKey` anywhere the old block read `candidate.sourceKey`.

The resulting override pattern is:

```ts
    source.prepare = async (sourceKey) => {
      // Keep the existing test-specific timing/counting body.
      return originalPrepare(sourceKey);
    };
```

Apply this to all three existing overrides in this file; do not leave any `originalPrepare(candidate)` call.

## `ti/tests/export-html.test.ts`

### REPLACE

**Location:** In the `selection()` fixture, remove the required-current use of `wordCount` and replace the complexity fields with:

```ts
    complexityMetric: 'grapheme-count',
    intrinsicComplexityValue: 2,
    complexityReferenceVersion: 2,
```

### REPLACE

**Location:** In the same fixture, replace:

```text
globalRowsAtWordCount
selectedSourceRowsAtWordCount
```

with:

```ts
    globalRowsAtComplexityValue: 1,
    selectedSourceRowsAtComplexityValue: 1,
```

### REPLACE

**Location:** Replace the `ExportResponse.settings.complexityReferenceVersion` fixture value with `2`.

## `ti/tests/export-epub.test.ts`

### REPLACE

**Location:** In the helper that constructs a `SelectionSnapshot`, remove the required-current use of `wordCount` and provide:

```ts
    complexityMetric: 'grapheme-count',
    intrinsicComplexityValue: 2,
    complexityReferenceVersion: 2,
```

### REPLACE

**Location:** In that helper, replace:

```text
globalRowsAtWordCount
selectedSourceRowsAtWordCount
```

with:

```ts
    globalRowsAtComplexityValue: 1,
    selectedSourceRowsAtComplexityValue: 1,
```

### REPLACE

**Location:** Replace every `ExportResponse.settings.complexityReferenceVersion` fixture value with `2`.

## `ti/tests/migration-iteration1.test.ts`

### REPLACE

**Location:** In the query that reads the migrated cached row from `source_records`, add `media_json` to the selected columns and to the TypeScript row type.

```ts
  const cached = db.prepare(`
    SELECT text, media_json, prepared_at
    FROM source_records
    WHERE source_id = 'mock'
      AND source_key = 'ready-key'
  `).get() as {
    text: string;
    media_json: string;
    prepared_at: number;
  };
```

### INSERT

**Location:** Immediately after the existing assertions for that migrated cached row.

```ts
  assert.equal(cached.media_json, '[]');
```

## `ti/tests/prepared-corpus.test.ts`

### INSERT — NEW FILE

**Location:** Create an executable Node test file, not a comment-only test specification.

The file must create a temporary `corpus.sqlite` using `better-sqlite3` with the exact production prepared-corpus schema and test all of the following behaviors:

1. `PreparedCorpusStore.hasSource()` returns true only for a ready grapheme-count source with at least one accepted row.
2. `sourceInfo()` returns source name, provider, license, upstream URL, catalog version, accepted/rejected counts, complexity metric, and status.
3. `rowCount()` returns `accepted_rows`.
4. `complexityClasses()` returns grouped grapheme counts and row counts.
5. `sourceKeyAt(sourceId, complexityValue, classIndex)` resolves the exact indexed row and throws for an invalid class index.
6. `row()` returns text and audio metadata for the requested canonical row.
7. `PreparedCorpusDataSource.candidateAt()` returns the stable source key plus the requested complexity value.
8. `PreparedCorpusDataSource.prepare()` returns exactly one `TextMedia` and one `AudioMedia`, without reading or decoding the media object itself.
9. A missing source throws a stable `CORPUS_SOURCE_MISSING` error.
10. A missing complexity member throws a stable `CORPUS_SOURCE_KEY_MISSING` error.

Use temporary paths only and delete the temporary test directory in test teardown.

## `ti/tests/repository-contract.test.ts`

### INSERT

**Location:** In the controller-contract assertions.

```ts
    assert.ok(
      read('control.sh').includes(
        'run_data_domain',
      ),
    );
    assert.ok(
      read('control.sh').includes(
        'CORPUS_NOT_PREPARED',
      ),
    );
```

### INSERT

**Location:** In the required-source-file assertions.

```ts
      'frontend/src/settings/pages/DataSourcesPage.tsx',
      'server/src/sources/prepared-corpus/prepared-corpus-store.ts',
      'server/src/sources/prepared-corpus/prepared-corpus-data-source.ts',
```

### INSERT

**Location:** Add repository-root assertions using `path.resolve(root, '..')`.

```ts
    assert.equal(
      fs.existsSync(
        path.join(
          root,
          '..',
          'data-transform',
          'scripts',
          'prepare-corpus',
          'prepare.py',
        ),
      ),
      true,
    );

    assert.equal(
      fs.existsSync(
        path.join(
          root,
          '..',
          'data-transform',
          'requirements.txt',
        ),
      ),
      true,
    );
```

### INSERT

**Location:** Add source-registry contract assertions.

```ts
    const registry = read(
      'server/src/services/source-registry.ts',
    );
    assert.ok(registry.includes("'fleurs-te'"));
    assert.ok(registry.includes("'shrutilipi-te'"));
    assert.ok(registry.includes("'indicvoices-te'"));
```

## `ti/README.md`

### REPLACE

**Location:** Replace the title and opening Iteration 2 description.

```markdown
# Implementation Iteration 3

This repository contains Implementation Iteration 3 of the Telugu observation app. Iterations 1 and 2 remain the persistence, queue, selection, settings, typography, diagnostic, and export foundation. Iteration 3 adds an offline corpus-transformation boundary, three prepared real Telugu speech sources, persisted grapheme complexity, formal text/audio media metadata, and six-source selection.
```

### INSERT

**Location:** Immediately after the existing `## Project controller` section.

```markdown
## Prepared corpus prerequisite

Corpus acquisition and transformation are offline data-engineering operations under `../data-transform/`. Telugu Now does not parse FLEURS TSV/tar files or AI4Bharat Parquet files at runtime.

The explicit controller operations are:

```bash
./control.sh data --option samples
./control.sh data --option prepare
./control.sh data --option all
```

`samples` transforms `../data-transform/raw/` into the source-shaped development input under `../data-transform/sample/`.

`prepare` transforms the current source-shaped input into:

```text
data/corpus/
├── manifest.json
├── corpus.sqlite
├── objects/
└── reports/
```

`all` runs `samples` and then `prepare`, stopping immediately if either stage fails.

`./control.sh dev` never performs a data transformation. It requires the prepared corpus to already exist and returns `CORPUS_NOT_PREPARED` otherwise.

The preparation scripts accept explicit input/output paths. The committed development workflow uses sample-sized inputs, while the same preparation implementation is intended to process the complete downloaded corpora before production publication to Tigris.
```

### REPLACE

**Location:** Replace the `## Deterministic dummy sources` opening paragraph and source list.

```markdown
## Selectable sources

Iteration 3 has six selectable sources with independent persisted weights:

1. `source1`: 12 development-fixture rows
2. `source2`: 24 development-fixture rows
3. `source3`: 36 development-fixture rows
4. `fleurs-te`: prepared FLEURS Telugu rows
5. `shrutilipi-te`: prepared Shrutilipi Telugu rows
6. `indicvoices-te`: prepared IndicVoices Telugu rows

The three prepared real-source row counts come from `corpus.sqlite`; they are never hardcoded into the application.
```

### REPLACE

**Location:** Replace the opening paragraph of `## Global complexity reference` that currently says Iteration 2 uses word count.

```markdown
Iteration 3 uses NFC Unicode extended grapheme-cluster count as the intrinsic complexity measurement for all six selectable sources. Prepared real-source rows have their grapheme count calculated once during corpus preparation and persisted in `corpus.sqlite`; dummy rows use the same metric in memory. The application constructs complexity reference version 2 from source-level complexity histograms rather than loading every prepared row into JavaScript memory.
```

### INSERT

**Location:** In the Settings section, add `Data sources` as a child page and document that it shows source provider, CC BY 4.0 attribution for FLEURS/Shrutilipi/IndicVoices, upstream Hugging Face repository, catalog version, accepted/rejected rows, complexity metric, and source status.

### INSERT

**Location:** Before the persistence/migration section.

```markdown
## Prepared media model

Canonical prepared rows retain source identity, canonical/upstream split, canonical Telugu text, grapheme count, text/audio SHA-256, duration, source metadata, and a content-addressed audio object key.

FLEURS uses its raw transcription as canonical text and WAV audio. Shrutilipi and IndicVoices use `text` as canonical text and FLAC audio. IndicVoices verbatim, normalized, unsanitized, speaker, scenario, task, demographic, and verification metadata are retained as source metadata.

The runtime `SourceRecord` cache persists both `TextMedia` and `AudioMedia`. Iteration 3 renders only the Unicode text; audio playback remains deferred to the later Point 11 media UI.
```

## `impl-iterations/iteration3.md`

### REPLACE

**Location:** Replace the entire current two-item draft.

```markdown
1. `data-transform/` is the exclusive corpus acquisition/transformation boundary; ordinary Telugu Now build/start never transforms upstream data.
2. `control.sh data` explicitly dispatches `samples`, `prepare`, or `all`; `control.sh dev` only consumes an already-prepared corpus.
3. The same preparation implementation accepts sample-sized or complete source directories through input/output paths and streams Parquet rows rather than loading a full corpus into memory.
4. FLEURS canonical text is raw transcription; Shrutilipi and IndicVoices canonical text is `text`.
5. Stable row identity is canonical split plus source-native audio filename/path. `train`, `test`, `dev`, `valid`, and `validation` are normalized while the original upstream split is retained.
6. Every accepted row receives one persisted NFC extended-grapheme count, text SHA-256, audio SHA-256, duration, source metadata, and content-addressed canonical audio object key.
7. Individual invalid rows are rejected into per-source reports; unknown schemas/splits, source-key duplicates/collisions, and source-level structural incompatibilities fail preparation.
8. FLEURS expects WAV; Shrutilipi and IndicVoices expect FLAC. Actual byte signatures are checked and no audio is transcoded.
9. Prepared output contains `manifest.json`, indexed `corpus.sqlite`, immutable media objects, and rejection reports. Output replacement is transactional.
10. Iteration 3 adds `fleurs-te`, `shrutilipi-te`, and `indicvoices-te` beside `source1`, `source2`, and `source3`, for six independently weighted selectable sources.
11. Complexity reference version 2 uses grapheme counts and operates from source row counts plus complexity histograms; prepared source selection uses indexed class membership rather than materializing complete catalogs in JavaScript.
12. Runtime source preparation never calls Hugging Face and never parses upstream TSV/Parquet. Development reads the local prepared corpus; production will use the equivalent canonical release with Tigris-backed media and a locally indexed catalog.
13. The formal Media model persists both `TextMedia` and `AudioMedia`; Iteration 3 displays only Unicode text and does not yet expose the audio player.
14. The shared source-record cache persists media metadata as well as text while preserving Iteration 1/2 history, queue, acquisition, and export semantics.
15. Settings gains a Data sources page showing source attribution, upstream repository, catalog counts/version, complexity metric, and deployed source status.
16. Historical Iteration 2 word-count selection snapshots remain readable and are mapped to the generalized complexity diagnostic model without mutation.
```
