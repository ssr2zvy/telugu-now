from __future__ import annotations

import shutil
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO / "data-transform" / "scripts"
sys.path.insert(0, str(SCRIPTS / "create-tigris-schema"))
sys.path.insert(0, str(SCRIPTS / "update-complexity"))

from common import CanonicalInputRow, CorpusWriter  # noqa: E402
from update_complexity import recompute_complexity  # noqa: E402


def _row(source_key: str, text: str) -> CanonicalInputRow:
    return CanonicalInputRow(
        source_id="fixture-source",
        source_key=source_key,
        canonical_split="train",
        upstream_split="train",
        text=text,
        audio_bytes=b"RIFF\x00\x00\x00\x00WAVE" + source_key.encode(),
        audio_mime_type="audio/wav",
        audio_extension=".wav",
        duration_seconds=1.0,
        source_metadata={},
    )


class UpdateComplexityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="update-complexity-test-")
        self.addCleanup(self.temporary.cleanup)
        self.corpus_root = Path(self.temporary.name) / "corpus"
        self.database_path = self.corpus_root / "corpus.sqlite"

        writer = CorpusWriter(self.corpus_root)
        writer.add_source(
            source_id="fixture-source",
            display_name="Fixture",
            provider="fixture-provider",
            license_name="fixture-license",
            upstream_url="https://example.invalid/fixture",
            catalog_version=1,
            expected_audio_mime="audio/wav",
            rows=[
                _row("row-1", "short"),
                _row("row-2", "a little longer here"),
                _row("row-3", "short"),
            ],
        )
        writer.finalize()

    def _grapheme_counts(self) -> dict[str, int]:
        with sqlite3.connect(self.database_path) as database:
            rows = database.execute(
                "SELECT source_key, grapheme_count FROM source_rows ORDER BY source_key"
            ).fetchall()
            return dict(rows)

    def _member_counts(self) -> dict[str, int]:
        with sqlite3.connect(self.database_path) as database:
            rows = database.execute(
                "SELECT source_key, grapheme_count FROM source_complexity_members "
                "ORDER BY source_key"
            ).fetchall()
            return dict(rows)

    def test_recompute_is_a_no_op_when_complexity_is_already_correct(self) -> None:
        before = self._grapheme_counts()
        stats = recompute_complexity(self.database_path)
        self.assertEqual(stats, {"rows": 3, "changed": 0})
        self.assertEqual(self._grapheme_counts(), before)
        self.assertEqual(self._member_counts(), before)
        with sqlite3.connect(self.database_path) as database:
            self.assertEqual(database.execute("PRAGMA integrity_check").fetchone()[0], "ok")

    def test_recompute_repairs_stale_or_tampered_complexity_values(self) -> None:
        with sqlite3.connect(self.database_path) as database:
            database.execute(
                "UPDATE source_rows SET grapheme_count = 999 WHERE source_key = 'row-1'"
            )
            database.execute(
                "UPDATE source_complexity_members SET grapheme_count = 999 "
                "WHERE source_key = 'row-1'"
            )
            database.commit()

        stats = recompute_complexity(self.database_path)
        self.assertEqual(stats, {"rows": 3, "changed": 1})

        counts = self._grapheme_counts()
        self.assertEqual(counts["row-1"], len("short"))
        self.assertEqual(counts["row-3"], len("short"))
        self.assertEqual(counts["row-1"], counts["row-3"])
        self.assertEqual(self._member_counts(), counts)

    def test_recompute_keeps_class_indexes_unique_per_source_and_complexity(self) -> None:
        recompute_complexity(self.database_path)
        with sqlite3.connect(self.database_path) as database:
            class_indexes = [
                row[0]
                for row in database.execute(
                    "SELECT class_index FROM source_complexity_members "
                    "WHERE grapheme_count = ? ORDER BY class_index",
                    (len("short"),),
                ).fetchall()
            ]
        self.assertEqual(class_indexes, [0, 1])


if __name__ == "__main__":
    unittest.main()
