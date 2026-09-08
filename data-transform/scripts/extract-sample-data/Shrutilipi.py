#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

DEFAULT_INPUT_ROOT = Path("data-transform/raw/Shrutilipi")
DEFAULT_OUTPUT_ROOT = Path("data-transform/sample/Shrutilipi")
DEFAULT_PARQUETS = ["train-00000-of-00012.parquet"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract sampled Shrutilipi Telugu Parquet rows."
    )
    parser.add_argument(
        "--input-root",
        type=Path,
        default=DEFAULT_INPUT_ROOT,
        help="Directory containing source Parquet shards.",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=DEFAULT_OUTPUT_ROOT,
        help="Directory where sampled Parquet is written.",
    )
    parser.add_argument(
        "--parquets",
        nargs="+",
        default=DEFAULT_PARQUETS,
        help="One or more Parquet shard filenames or paths to sample in order.",
    )
    parser.add_argument(
        "--all-parquets",
        action="store_true",
        help="Sample from every *.parquet file found under --input-root instead of an explicit --parquets list.",
    )
    parser.add_argument(
        "--rows",
        type=int,
        default=100,
        help="Total number of rows to sample across selected shards.",
    )
    parser.add_argument(
        "--all-rows",
        action="store_true",
        help="Include all rows from selected shards.",
    )
    parser.add_argument(
        "--output-name",
        default=None,
        help="Output filename override. Page ids are added when multiple files are produced.",
    )
    return parser.parse_args()


def resolve_parquet(input_root: Path, parquet: str) -> Path:
    path = Path(parquet)
    if not path.is_absolute():
        path = input_root / path
    if not path.is_file():
        raise FileNotFoundError(path)
    return path


def filename_token(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._+-]+", "-", value).strip("-")


def output_base(args: argparse.Namespace) -> str:
    if args.output_name:
        return Path(args.output_name).stem

    row_part = "allrows" if args.all_rows else f"rows{args.rows}"
    parquet_part = (
        "allparquets"
        if args.all_parquets
        else "+".join(
            filename_token(Path(parquet).stem)
            for parquet in args.parquets
        )
    )
    return f"train-{row_part}-parquets-{parquet_part}"


def output_path(
    args: argparse.Namespace,
    page_index: int | None = None,
) -> Path:
    suffix = Path(args.output_name).suffix if args.output_name else ".parquet"
    if not suffix:
        suffix = ".parquet"

    stem = output_base(args)
    if page_index is not None:
        stem = f"{stem}-page{page_index:03d}"
    return args.output_root / f"{stem}{suffix}"


def read_sample_pages(paths: list[Path], row_limit: int) -> list[pa.Table]:
    pages = []
    remaining = row_limit

    for path in paths:
        parquet_file = pq.ParquetFile(path)
        if remaining == 0:
            break

        path_tables = []

        for batch in parquet_file.iter_batches(batch_size=remaining):
            table = pa.Table.from_batches([batch])
            path_tables.append(table)
            remaining -= table.num_rows
            if remaining == 0:
                break

        if path_tables:
            pages.append(pa.concat_tables(path_tables, promote_options="default"))

    if not pages:
        raise RuntimeError("No rows were sampled")

    return pages


def copy_all_rows(args: argparse.Namespace, paths: list[Path]) -> None:
    args.output_root.mkdir(parents=True, exist_ok=True)
    paged = len(paths) > 1
    for index, path in enumerate(paths, start=1):
        destination = output_path(args, index if paged else None)
        shutil.copy2(path, destination)
        print(f"{destination}: copied")


def write_sample_pages(args: argparse.Namespace, pages: list[pa.Table]) -> None:
    args.output_root.mkdir(parents=True, exist_ok=True)
    paged = len(pages) > 1
    for index, table in enumerate(pages, start=1):
        destination = output_path(args, index if paged else None)
        pq.write_table(table, destination)
        print(f"{destination}: {table.num_rows} rows")


def main() -> None:
    args = parse_args()
    if args.rows < 1 and not args.all_rows:
        raise ValueError("--rows must be greater than 0")

    if args.all_parquets:
        parquet_paths = sorted(args.input_root.rglob("*.parquet"))
        if not parquet_paths:
            raise FileNotFoundError(f"No .parquet files found under {args.input_root}")
    else:
        parquet_paths = [resolve_parquet(args.input_root, item) for item in args.parquets]

    if args.all_rows:
        copy_all_rows(args, parquet_paths)
        return

    write_sample_pages(args, read_sample_pages(parquet_paths, args.rows))


if __name__ == "__main__":
    main()
