#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path
from typing import Iterator

SPLITS = ("dev", "test", "train")
DEFAULT_INPUT_ROOT = Path(__file__).resolve().parents[3] / "data/raw/FLEURS"
DEFAULT_OUTPUT_ROOT = Path(__file__).resolve().parents[3] / "data/sample/FLEURS"


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
        "--all-splits",
        action="store_true",
        help="Discover every available dev, test, and train split under --input-root.",
    )
    output_mode = parser.add_mutually_exclusive_group()
    output_mode.add_argument(
        "--replace",
        action="store_true",
        help="Replace existing sampled split outputs before writing.",
    )
    output_mode.add_argument(
        "--append",
        action="store_true",
        help="Keep previously extracted rows and append remaining raw rows.",
    )
    parser.add_argument(
        "--batch-rows",
        type=int,
        default=20,
        help="Number of rows moved out of raw at a time.",
    )
    return parser.parse_args()


def read_all_lines(path: Path) -> list[str]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(handle)


def batched(rows: list[str], batch_size: int) -> Iterator[list[str]]:
    for start in range(0, len(rows), batch_size):
        yield rows[start : start + batch_size]


def audio_members(rows: list[str], split: str) -> list[str]:
    members = []
    for line_number, row in enumerate(rows, start=1):
        columns = row.rstrip("\n").split("\t")
        if len(columns) < 2 or not columns[1]:
            raise RuntimeError(f"Missing wav filename in row {line_number}")
        members.append(f"{split}/{columns[1]}")
    return members


def append_lines(path: Path, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="") as handle:
        handle.writelines(lines)


def replace_lines(path: Path, lines: list[str]) -> None:
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="") as handle:
        handle.writelines(lines)
    temporary.replace(path)


def extract_members(archive_path: Path, output_root: Path, members: list[str]) -> None:
    if not members:
        return

    command = [
        "tar",
        "-xzf",
        str(archive_path),
        "-C",
        str(output_root),
        "--verbatim-files-from",
        "--files-from=-",
    ]
    subprocess.run(command, input="\n".join(members) + "\n", text=True, check=True)


def move_split(args: argparse.Namespace, split: str) -> None:
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
        # Older sample preparation produced a redundant flat audio/ copy.
        # FLEURS preparation now resolves media from the actual split directory.
        if legacy_audio_dir.exists():
            shutil.rmtree(legacy_audio_dir)

    if not args.append and (output_tsv_path.exists() or output_audio_dir.exists()):
        raise RuntimeError(
            f"Output for {split!r} already exists; pass --replace to overwrite it."
        )

    all_rows = read_all_lines(tsv_path)
    target = len(all_rows) if args.all_rows else min(args.rows, len(all_rows))
    moved_rows, kept_rows = all_rows[:target], all_rows[target:]

    output_audio_dir.mkdir(parents=True, exist_ok=True)
    extract_members(archive_path, args.output_root, audio_members(moved_rows, split))
    for batch in batched(moved_rows, args.batch_rows):
        append_lines(output_tsv_path, batch)

    if kept_rows:
        replace_lines(tsv_path, kept_rows)
    else:
        # Every row referencing this split's archive has now moved out of raw.
        tsv_path.unlink()
        archive_path.unlink()

    print(f"{split}: moved {len(moved_rows)} rows -> {output_tsv_path}")
    print(f"{split}: audio -> {output_audio_dir}")


def main() -> None:
    args = parse_args()
    if args.rows < 1 and not args.all_rows:
        raise ValueError("--rows must be greater than 0")
    if args.batch_rows < 1:
        raise ValueError("--batch-rows must be greater than 0")

    if args.all_splits:
        args.splits = [split for split in SPLITS if (args.input_root / f"{split}.tsv").is_file()]
        if not args.splits:
            if args.append and any(args.output_root.glob("*.tsv")):
                print("FLEURS: no remaining raw splits; keeping existing samples")
                return
            raise FileNotFoundError(f"No FLEURS splits found under {args.input_root}")
    for split in args.splits:
        for suffix in (".tsv", ".tar.gz"):
            source = args.input_root / f"{split}{suffix}"
            if not source.is_file():
                raise FileNotFoundError(source)

    args.output_root.mkdir(parents=True, exist_ok=True)
    for split in args.splits:
        move_split(args, split)


if __name__ == "__main__":
    main()
