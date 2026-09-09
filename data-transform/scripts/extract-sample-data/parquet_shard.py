#!/usr/bin/env python3
"""Streams rows out of a raw Parquet shard while shrinking the shard on disk.

Rows are decoded in bounded batches in file order. Untaken rows are written
to a temporary remainder. The source is replaced or removed only after the
caller exits the context successfully, including closing its output writer.
"""
from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import shutil
from typing import Iterator

import pyarrow as pa
import pyarrow.parquet as pq


def move_complete_shards(paths: list[Path], input_root: Path, output_root: Path) -> None:
    destinations = [output_root / path.relative_to(input_root) for path in paths]
    for destination in destinations:
        if destination.exists():
            raise FileExistsError(f"Refusing to overwrite extracted shard: {destination}")
    for path, destination in zip(paths, destinations):
        count = row_count(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), str(destination))
        print(f"{destination}: moved {count} rows from {path}")


def available_output_path(destination: Path) -> Path:
    candidate = destination
    part = 1
    while candidate.exists():
        candidate = destination.with_stem(f"{destination.stem}-part{part:03d}")
        part += 1
    return candidate


@contextmanager
def move_rows(path: Path, row_limit: int | None, batch_rows: int = 20) -> Iterator[Iterator[pa.Table]]:
    if batch_rows < 1:
        raise ValueError("batch_rows must be greater than 0")
    parquet_file = pq.ParquetFile(path)
    schema = parquet_file.schema_arrow
    remainder_path = path.with_name(path.name + ".remainder.tmp")
    remainder_writer: pq.ParquetWriter | None = None
    remaining = row_limit
    complete = False

    def spill(table: pa.Table) -> None:
        nonlocal remainder_writer
        if table.num_rows == 0:
            return
        if remainder_writer is None:
            remainder_writer = pq.ParquetWriter(remainder_path, schema)
        remainder_writer.write_table(table)

    def tables() -> Iterator[pa.Table]:
        nonlocal remaining, complete
        for batch in parquet_file.iter_batches(batch_size=batch_rows):
            table = pa.Table.from_batches([batch])
            if remaining is None or remaining > 0:
                take = table.num_rows if remaining is None else min(remaining, table.num_rows)
                if remaining is not None:
                    remaining -= take
                yield table.slice(0, take)
                if take < table.num_rows:
                    spill(table.slice(take))
            else:
                spill(table)
        complete = True

    try:
        yield tables()
        if not complete:
            raise RuntimeError("Extraction did not consume the selected rows")
        if remainder_writer is not None:
            remainder_writer.close()
        parquet_file.close()
        if remainder_writer is None:
            path.unlink()
        else:
            remainder_path.replace(path)
    except BaseException:
        if remainder_writer is not None:
            remainder_writer.close()
        remainder_path.unlink(missing_ok=True)
        raise
    finally:
        parquet_file.close()


def row_count(path: Path) -> int:
    with pq.ParquetFile(path) as parquet:
        return parquet.metadata.num_rows
