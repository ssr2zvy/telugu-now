#!/usr/bin/env python3
from __future__ import annotations

import argparse
import itertools
import shutil
import subprocess
from pathlib import Path

SPLITS = ("dev", "test", "train")
DEFAULT_INPUT_ROOT = Path("data-transform/raw/FLEURS")
DEFAULT_OUTPUT_ROOT = Path("data-transform/sample/FLEURS")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract sampled FLEURS Telugu TSV rows and matching wav files."
    )
    parser.add_argument(
        "--input-root",
        type=Path,
        default=DEFAULT_INPUT_ROOT,
        help="Directory containing <split>.tsv and <split>.tar.gz files.",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=DEFAULT_OUTPUT_ROOT,
        help="Directory where sampled rows and extracted wav folders are written.",
    )
    parser.add_argument(
        "--splits",
        nargs="+",
        choices=SPLITS,
        default=["dev"],
        help="One or more FLEURS splits to sample.",
    )
    parser.add_argument(
        "--rows",
        type=int,
        default=100,
        help="Number of rows to sample from each selected split.",
    )
    parser.add_argument(
        "--all-rows",
        action="store_true",
        help="Include all rows from each selected split.",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Replace existing sampled split outputs before writing.",
    )
    return parser.parse_args()


def selected_rows(tsv_path: Path, count: int | None) -> list[str]:
    with tsv_path.open("r", encoding="utf-8", newline="") as handle:
        if count is None:
            return list(handle)
        return list(itertools.islice(handle, count))


def audio_members(rows: list[str], split: str) -> list[str]:
    members = []
    for line_number, row in enumerate(rows, start=1):
        columns = row.rstrip("\n").split("\t")
        if len(columns) < 2 or not columns[1]:
            raise RuntimeError(f"Missing wav filename in row {line_number}")
        members.append(f"{split}/{columns[1]}")
    return members


def write_lines(path: Path, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.writelines(lines)


def extract_members(archive_path: Path, output_root: Path, members: list[str]) -> None:
    if not members:
        return

    command = [
        "tar",
        "-xzf",
        str(archive_path),
        "-C",
        str(output_root),
        *members,
    ]
    subprocess.run(command, check=True)


def sample_split(args: argparse.Namespace, split: str) -> None:
    tsv_path = args.input_root / f"{split}.tsv"
    archive_path = args.input_root / f"{split}.tar.gz"
    output_tsv_path = args.output_root / f"{split}.tsv"
    output_audio_dir = args.output_root / split
    legacy_audio_dir = args.output_root / "audio"

    if not tsv_path.is_file():
        raise FileNotFoundError(tsv_path)
    if not archive_path.is_file():
        raise FileNotFoundError(archive_path)

    if args.replace:
        if output_tsv_path.exists():
            output_tsv_path.unlink()
        if output_audio_dir.exists():
            shutil.rmtree(output_audio_dir)
        if legacy_audio_dir.exists():
            shutil.rmtree(legacy_audio_dir)

    if output_tsv_path.exists() or output_audio_dir.exists():
        raise RuntimeError(
            f"Output for {split!r} already exists; pass --replace to overwrite it."
        )

    rows = selected_rows(tsv_path, None if args.all_rows else args.rows)
    write_lines(output_tsv_path, rows)
    extract_members(archive_path, args.output_root, audio_members(rows, split))
    print(f"{split}: {len(rows)} rows -> {output_tsv_path}")
    print(f"{split}: audio -> {output_audio_dir}")


def main() -> None:
    args = parse_args()
    if args.rows < 1 and not args.all_rows:
        raise ValueError("--rows must be greater than 0")

    args.output_root.mkdir(parents=True, exist_ok=True)
    for split in args.splits:
        sample_split(args, split)


if __name__ == "__main__":
    main()
