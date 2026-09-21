#!/usr/bin/env python3
"""Recompute grapheme-count complexity on an existing prepared corpus.sqlite.

Complexity is embedded data (the `grapheme_count` column on `source_rows`,
mirrored into `source_complexity_members`), not a separate artifact, so it
can be recomputed in place from the already-stored `text` column without
touching audio or re-running the full ingestion pipeline.

Local mode:
    python update_complexity.py --database /path/to/corpus.sqlite

Tigris mode (full round trip: download the current corpus.sqlite from
Tigris, recompute complexity, and publish it back to the same object key):
    python update_complexity.py --tigris

Tigris mode reads the same environment variables the server uses:
BUCKET_NAME, AWS_ENDPOINT_URL_S3, AWS_REGION (defaults to "auto"), plus
whatever AWS credential-provider variables are already configured in the
environment (no credentials are read or written by this script directly).
"""
from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "create-tigris-schema"))
from common import grapheme_count  # noqa: E402  (path must be extended first)

CORPUS_OBJECT_KEY = "corpus/corpus.sqlite"


def recompute_complexity(database_path: Path) -> dict[str, int]:
    """Recompute grapheme-count complexity in place on an existing corpus.sqlite."""
    db = sqlite3.connect(database_path)
    try:
        integrity = db.execute("PRAGMA integrity_check").fetchone()
        if integrity is None or integrity[0] != "ok":
            raise RuntimeError(f"SQLITE_INTEGRITY_FAILURE:{integrity}")

        rows = db.execute(
            "SELECT source_id, source_key, text, grapheme_count FROM source_rows "
            "ORDER BY source_id, source_key"
        ).fetchall()

        recomputed: dict[tuple[str, str], int] = {}
        changed = 0
        for source_id, source_key, text, previous_count in rows:
            new_count = grapheme_count(text)
            if new_count <= 0:
                raise RuntimeError(f"EMPTY_COMPLEXITY:{source_id}:{source_key}")
            recomputed[(source_id, source_key)] = new_count
            if new_count != previous_count:
                changed += 1

        db.execute("BEGIN")
        try:
            for (source_id, source_key), new_count in recomputed.items():
                db.execute(
                    "UPDATE source_rows SET grapheme_count = ? "
                    "WHERE source_id = ? AND source_key = ?",
                    (new_count, source_id, source_key),
                )

            db.execute("DELETE FROM source_complexity_members")
            class_counts: dict[tuple[str, int], int] = {}
            for source_id, source_key in sorted(recomputed):
                complexity = recomputed[(source_id, source_key)]
                class_index = class_counts.get((source_id, complexity), 0)
                db.execute(
                    """
                    INSERT INTO source_complexity_members (
                      source_id, grapheme_count, class_index, source_key
                    ) VALUES (?, ?, ?, ?)
                    """,
                    (source_id, complexity, class_index, source_key),
                )
                class_counts[(source_id, complexity)] = class_index + 1

            db.commit()
        except BaseException:
            db.rollback()
            raise

        post_integrity = db.execute("PRAGMA integrity_check").fetchone()
        if post_integrity is None or post_integrity[0] != "ok":
            raise RuntimeError(
                f"SQLITE_INTEGRITY_FAILURE_AFTER_UPDATE:{post_integrity}"
            )

        return {"rows": len(rows), "changed": changed}
    finally:
        db.close()


def _tigris_client():
    import boto3  # local import: only required in --tigris mode

    bucket_name = os.environ.get("BUCKET_NAME")
    if not bucket_name:
        raise RuntimeError("BUCKET_NAME is required for --tigris mode.")
    endpoint_url = os.environ.get("AWS_ENDPOINT_URL_S3")
    region = os.environ.get("AWS_REGION", "auto")
    client = boto3.client("s3", region_name=region, endpoint_url=endpoint_url or None)
    return client, bucket_name


def download_from_tigris(destination: Path) -> None:
    client, bucket_name = _tigris_client()
    client.download_file(bucket_name, CORPUS_OBJECT_KEY, str(destination))


def upload_to_tigris(source: Path) -> None:
    client, bucket_name = _tigris_client()
    client.upload_file(str(source), bucket_name, CORPUS_OBJECT_KEY)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Recompute grapheme-count complexity on an existing corpus.sqlite, "
            "either in place on a local file or as a full Tigris "
            "download/recompute/publish round trip."
        )
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--database",
        type=Path,
        help="Path to a local corpus.sqlite to update in place.",
    )
    group.add_argument(
        "--tigris",
        action="store_true",
        help=(
            "Download corpus/corpus.sqlite from Tigris (BUCKET_NAME, "
            "AWS_ENDPOINT_URL_S3, AWS_REGION), recompute complexity, and "
            "publish it back to the same object key."
        ),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.tigris:
        with tempfile.TemporaryDirectory(prefix="update-complexity-") as tmp_dir:
            staged = Path(tmp_dir) / "corpus.sqlite"
            print("Downloading corpus.sqlite from Tigris...", flush=True)
            download_from_tigris(staged)

            stats = recompute_complexity(staged)
            print(
                f"Recomputed complexity for {stats['rows']} rows "
                f"({stats['changed']} changed).",
                flush=True,
            )

            print("Publishing updated corpus.sqlite back to Tigris...", flush=True)
            upload_to_tigris(staged)
            print("Done.", flush=True)
        return

    database_path = args.database.resolve()
    if not database_path.exists():
        raise FileNotFoundError(f"No corpus.sqlite found at {database_path}")

    backup_path = database_path.with_suffix(database_path.suffix + ".bak")
    shutil.copy2(database_path, backup_path)
    try:
        stats = recompute_complexity(database_path)
    except BaseException:
        shutil.move(str(backup_path), str(database_path))
        raise
    else:
        backup_path.unlink(missing_ok=True)
        print(
            f"Recomputed complexity for {stats['rows']} rows "
            f"({stats['changed']} changed).",
            flush=True,
        )


if __name__ == "__main__":
    main()
