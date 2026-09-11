#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
from pathlib import Path

import pyarrow.parquet as pq

from parquet_shard import available_output_path, move_complete_shards, move_rows, row_count

DEFAULT_INPUT_ROOT = Path(__file__).resolve().parents[3] / "data/raw/Shrutilipi"
DEFAULT_OUTPUT_ROOT = Path(__file__).resolve().parents[3] / "data/sample/Shrutilipi"
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
    parser.add_argument("--batch-rows", type=int, default=20, help="Maximum rows decoded per batch.")
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


def contributing_path_count(paths: list[Path], row_limit: int | None) -> int:
    if row_limit is None:
        return len(paths)

    remaining = row_limit
    count = 0
    for path in paths:
        if remaining <= 0:
            break
        count += 1
        remaining -= row_count(path)
    return count


def move_sample_rows(args: argparse.Namespace, paths: list[Path]) -> None:
    args.output_root.mkdir(parents=True, exist_ok=True)
    row_limit = None if args.all_rows else args.rows
    paged = contributing_path_count(paths, row_limit) > 1
    remaining = row_limit
    total_moved = 0

    for index, path in enumerate(paths, start=1):
        if remaining is not None and remaining <= 0:
            break

        destination = available_output_path(output_path(args, index if paged else None))
        take_limit = None if remaining is None else remaining
        writer: pq.ParquetWriter | None = None
        moved_rows = 0

        try:
            with move_rows(path, take_limit, args.batch_rows) as tables:
                try:
                    for table in tables:
                        if writer is None:
                            writer = pq.ParquetWriter(destination, table.schema)
                        writer.write_table(table)
                        moved_rows += table.num_rows
                finally:
                    if writer is not None:
                        writer.close()
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
        if remaining is not None:
            remaining -= moved_rows
        total_moved += moved_rows
        print(f"{destination}: moved {moved_rows} rows from {path}")

    if total_moved == 0:
        raise RuntimeError("No rows were sampled")


def main() -> None:
    args = parse_args()
    if args.rows < 1 and not args.all_rows:
        raise ValueError("--rows must be greater than 0")
    if args.batch_rows < 1:
        raise ValueError("--batch-rows must be greater than 0")

    if args.all_parquets:
        parquet_paths = sorted(args.input_root.rglob("*.parquet"))
        if not parquet_paths:
            if args.all_rows and any(args.output_root.rglob("*.parquet")):
                print("Shrutilipi: no remaining raw shards; keeping existing samples")
                return
            raise FileNotFoundError(f"No .parquet files found under {args.input_root}")
    else:
        parquet_paths = [resolve_parquet(args.input_root, item) for item in args.parquets]

    if args.all_rows and args.all_parquets and not args.output_name:
        move_complete_shards(parquet_paths, args.input_root, args.output_root)
    else:
        move_sample_rows(args, parquet_paths)


if __name__ == "__main__":
    main()
