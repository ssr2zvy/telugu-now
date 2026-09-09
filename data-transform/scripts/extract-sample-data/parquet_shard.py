#!/usr/bin/env python3
"""Streams rows out of a raw Parquet shard while shrinking the shard on disk.

Row groups are read from `path` in file order. Groups entirely within the
requested row count are yielded whole; a group straddling the requested count
is split so its untaken tail is preserved; groups beyond the requested count
are preserved untouched. Whatever was not yielded is rewritten back to `path`
in a single pass once the caller finishes consuming the generator, or `path`
is deleted outright if every row was requested.
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterator

import pyarrow as pa
import pyarrow.parquet as pq


def move_rows(path: Path, row_limit: int | None) -> Iterator[pa.Table]:
    parquet_file = pq.ParquetFile(path)
    schema = parquet_file.schema_arrow
    remainder_path = path.with_name(path.name + ".remainder.tmp")
    remainder_writer: pq.ParquetWriter | None = None
    remaining = row_limit

    def spill(table: pa.Table) -> None:
        nonlocal remainder_writer
        if table.num_rows == 0:
            return
        if remainder_writer is None:
            remainder_writer = pq.ParquetWriter(remainder_path, schema)
        remainder_writer.write_table(table)

    try:
        for index in range(parquet_file.num_row_groups):
            table = parquet_file.read_row_group(index)
            if remaining is None or remaining > 0:
                take = table.num_rows if remaining is None else min(remaining, table.num_rows)
                if remaining is not None:
                    remaining -= take
                yield table.slice(0, take)
                if take < table.num_rows:
                    spill(table.slice(take))
            else:
                spill(table)
    except BaseException:
        if remainder_writer is not None:
            remainder_writer.close()
        remainder_path.unlink(missing_ok=True)
        raise
    else:
        if remainder_writer is not None:
            remainder_writer.close()
        if remainder_writer is None:
            path.unlink()
        else:
            remainder_path.replace(path)


def row_count(path: Path) -> int:
    return pq.ParquetFile(path).metadata.num_rows
