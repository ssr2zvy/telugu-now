from __future__ import annotations

import importlib
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import pyarrow as pa
import pyarrow.parquet as pq

REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO / "data-transform" / "scripts"
sys.path.insert(0, str(SCRIPTS / "create-tigris-schema"))
sys.path.insert(0, str(SCRIPTS / "extract-sample-data"))

from common import CanonicalInputRow, CorpusWriter
from parquet_shard import move_rows


def parquet_count(root: Path) -> int:
    total = 0
    for path in root.rglob("*.parquet"):
        with pq.ParquetFile(path) as parquet:
            total += parquet.metadata.num_rows
    return total


class PipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="telugu-pipeline-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        shutil.copy2(REPO / "control.sh", self.root / "control.sh")
        shutil.copytree(SCRIPTS, self.root / "data-transform" / "scripts", ignore=shutil.ignore_patterns("__pycache__"))
        (self.root / "ti").mkdir()
        self.raw = self.root / "data-transform" / "raw"
        self.sample = self.root / "data-transform" / "sample"
        self.output = self.root / "data" / "corpus"
        fleurs = self.raw / "FLEURS"
        fleurs.mkdir(parents=True)
        for split, count in [("dev", 106), ("test", 3), ("train", 4)]:
            lines = []
            with tarfile.open(fleurs / f"{split}.tar.gz", "w:gz") as archive:
                for index in range(count):
                    filename = f"{split}-{index}.wav"
                    audio = b"RIFF\x00\x00\x00\x00WAVE" + filename.encode()
                    member = tarfile.TarInfo(f"{split}/{filename}")
                    member.size = len(audio)
                    archive.addfile(member, io.BytesIO(audio))
                    lines.append(f"{index}\t{filename}\tfixture {index}\tnormalized\tcharacters\t16000\tfemale\n")
            (fleurs / f"{split}.tsv").write_text("".join(lines), encoding="utf-8")
        for source in ["Shrutilipi", "IndicVoices"]:
            directory = self.raw / source / "train"
            directory.mkdir(parents=True)
            for shard, count in [(0, 64), (1, 63)]:
                rows = []
                for index in range(count):
                    filename = f"{source}-{shard}-{index}.flac"
                    rows.append({
                        "audio_filepath": {"path": filename, "bytes": b"fLaC" + filename.encode()},
                        "text": f"fixture {index}", "duration": 1.0, "lang": "te",
                        "verbatim": "fixture", "normalized": "fixture",
                    })
                pq.write_table(pa.Table.from_pylist(rows), directory / f"train-{shard:05d}.parquet")

    def control(self, *arguments: str, success: bool = True, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            ["bash", str(self.root / "control.sh"), "data", *arguments],
            env={**os.environ, "PYTHON": sys.executable},
            input=input_text, capture_output=True, text=True, timeout=90,
        )
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
        return result

    def test_default_then_all_preserves_samples_and_prepares_every_available_row(self) -> None:
        for source in ["Shrutilipi", "IndicVoices"]:
            training = next((self.raw / source).rglob("*.parquet"))
            validation = self.raw / source / "validation" / "validation-00000.parquet"
            validation.parent.mkdir()
            pq.write_table(pq.read_table(training).slice(0, 2), validation)
        self.control("--option", "samples")
        self.assertEqual(len((self.sample / "FLEURS/dev.tsv").read_text().splitlines()), 100)
        for source in ["Shrutilipi", "IndicVoices"]:
            self.assertEqual(parquet_count(self.sample / source), 100)
            self.assertEqual(parquet_count(self.raw / source), 29)
        result = self.control("--option", "all", "--rows", "all", "--batch-rows", "7")
        self.assertIn("processed 14 rows", result.stdout)
        manifest = json.loads((self.output / "manifest.json").read_text())
        counts = {source["sourceId"]: source["acceptedRows"] for source in manifest["sources"]}
        self.assertEqual(counts, {"fleurs-te": 113, "shrutilipi-te": 129, "indicvoices-te": 129})
        self.assertFalse(any(path.is_file() for path in self.raw.rglob("*")))
        self.assertFalse(any(path.is_file() for path in self.sample.rglob("*")))
        with sqlite3.connect(self.output / "corpus.sqlite") as database:
            self.assertEqual(database.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(database.execute("SELECT COUNT(*) FROM source_rows").fetchone()[0], 371)
            self.assertEqual(database.execute("SELECT COUNT(*) FROM source_complexity_members").fetchone()[0], 371)
            self.assertEqual(dict(database.execute("SELECT canonical_split, COUNT(*) FROM source_rows WHERE source_id = 'fleurs-te' GROUP BY canonical_split")), {"validation": 106, "test": 3, "train": 4})
            self.assertEqual(database.execute("SELECT COUNT(*) FROM source_rows WHERE source_id = 'indicvoices-te' AND canonical_split = 'validation'").fetchone()[0], 2)
            for (object_key,) in database.execute("SELECT audio_object_key FROM source_rows"):
                self.assertTrue((self.output / "objects" / object_key).is_file())

    def test_custom_counts_and_interactive_all_keep_previous_extractions(self) -> None:
        for _ in range(2):
            self.control("--option", "samples", "--rows", "3", "--batch-rows", "2")
        self.assertEqual(len((self.sample / "FLEURS/dev.tsv").read_text().splitlines()), 6)
        for source in ["Shrutilipi", "IndicVoices"]:
            self.assertEqual(parquet_count(self.sample / source), 6)
            self.assertEqual(parquet_count(self.raw / source), 121)
        self.control(input_text="1\nall\n")
        self.assertEqual(parquet_count(self.sample / "IndicVoices"), 127)
        self.control("--option", "samples", "--rows", "all")
        self.assertEqual(parquet_count(self.sample / "IndicVoices"), 127)

    def test_failed_preparation_keeps_all_inputs_and_existing_corpus(self) -> None:
        self.control("--option", "samples", "--rows", "5")
        shard = next((self.sample / "IndicVoices").rglob("*.parquet"))
        original = shard.read_bytes()
        pq.write_table(pa.table({"text": ["missing schema"]}), shard)
        before = {path: path.read_bytes() for path in self.sample.rglob("*") if path.is_file()}
        self.output.mkdir(parents=True)
        marker = self.output / "existing-corpus"
        marker.write_text("keep")
        result = self.control("--option", "prepare", "--batch-rows", "2", success=False)
        self.assertIn("INDICVOICES_SCHEMA:MISSING_COLUMNS", result.stderr)
        self.assertEqual(marker.read_text(), "keep")
        self.assertEqual(before, {path: path.read_bytes() for path in self.sample.rglob("*") if path.is_file()})
        self.assertFalse(list(self.output.parent.glob(".corpus.prepare-*")))
        shard.write_bytes(original)
        self.control("--option", "prepare", "--batch-rows", "2")
        self.assertFalse(any(path.is_file() for path in self.sample.rglob("*")))

    def test_partial_shard_is_bounded_and_not_consumed_until_output_succeeds(self) -> None:
        shard = next((self.raw / "IndicVoices").rglob("*.parquet"))
        original = shard.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "write failed"):
            with move_rows(shard, 9, batch_rows=3) as tables:
                chunks = list(tables)
                self.assertEqual(sum(table.num_rows for table in chunks), 9)
                self.assertTrue(all(table.num_rows <= 3 for table in chunks))
                raise RuntimeError("write failed")
        self.assertEqual(shard.read_bytes(), original)
        self.assertFalse(shard.with_name(shard.name + ".remainder.tmp").exists())
        with move_rows(shard, 9, batch_rows=3) as tables:
            self.assertEqual(sum(table.num_rows for table in tables), 9)
        self.assertEqual(pq.read_metadata(shard).num_rows, 55)

    def test_preparation_readers_bound_batches_without_deleting_inputs(self) -> None:
        for source, module_name, reader_name in [
            ("Shrutilipi", "sources.shrutilipi", "read_shrutilipi"),
            ("IndicVoices", "sources.indicvoices", "read_indicvoices"),
        ]:
            module = importlib.import_module(module_name)
            original_factory = pq.ParquetFile
            requested = []

            def tracked_file(*arguments, **keywords):
                parquet = original_factory(*arguments, **keywords)
                original_batches = parquet.iter_batches

                def batches(*batch_arguments, **batch_keywords):
                    requested.append(batch_keywords.get("batch_size"))
                    return original_batches(*batch_arguments, **batch_keywords)

                parquet.iter_batches = batches
                return parquet

            with patch.object(module.pq, "ParquetFile", side_effect=tracked_file):
                self.assertEqual(sum(1 for _ in getattr(module, reader_name)(self.raw / source, batch_rows=3)), 127)
            self.assertEqual(requested, [3, 3])
            self.assertEqual(parquet_count(self.raw / source), 127)

    def test_all_shard_collisions_fail_without_overwriting_or_consuming_raw(self) -> None:
        source = self.raw / "IndicVoices" / "train" / "train-00000.parquet"
        destination = self.sample / "IndicVoices" / "train" / source.name
        destination.parent.mkdir(parents=True)
        destination.write_bytes(b"existing output")
        original = source.read_bytes()
        result = subprocess.run([
            sys.executable, str(SCRIPTS / "extract-sample-data" / "IndicVoices.py"),
            "--input-root", str(self.raw / "IndicVoices"), "--output-root", str(self.sample / "IndicVoices"),
            "--all-rows", "--all-parquets",
        ], capture_output=True, text=True, timeout=30)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(source.read_bytes(), original)
        self.assertEqual(destination.read_bytes(), b"existing output")

    def test_database_writes_are_batched_and_cleanup_waits_for_publication(self) -> None:
        writer = CorpusWriter(self.output, batch_rows=2)
        self.addCleanup(writer._cleanup_temporary)
        statements = []
        writer.db.set_trace_callback(statements.append)
        input_path = self.root / "input.wav"
        input_path.write_bytes(b"RIFF\x00\x00\x00\x00WAVEfixture")

        def rows():
            for index in range(5):
                yield CanonicalInputRow("fixture", str(index), "train", "train", "text", input_path.read_bytes(), "audio/wav", ".wav", 1, {})
            writer.consume_after_publish(input_path)

        writer.add_source(source_id="fixture", display_name="fixture", provider="fixture", license_name="fixture", upstream_url="fixture", catalog_version=1, expected_audio_mime="audio/wav", rows=rows())
        self.assertGreaterEqual(statements.count("COMMIT"), 4)
        self.assertTrue(input_path.exists())
        writer.finalize()
        self.assertFalse(input_path.exists())
        self.assertTrue((self.output / "manifest.json").exists())

    def test_invalid_options_do_not_consume_raw(self) -> None:
        before = sorted(path.relative_to(self.raw) for path in self.raw.rglob("*") if path.is_file())
        for arguments in [
            ["--option", "samples", "--rows", "0"],
            ["--option", "samples", "--rows", "invalid"],
            ["--option", "samples", "--rows"],
            ["--option", "samples", "--batch-rows", "0"],
            ["--option", "prepare", "--rows", "all"],
        ]:
            self.assertEqual(self.control(*arguments, success=False).returncode, 2)
        self.assertEqual(before, sorted(path.relative_to(self.raw) for path in self.raw.rglob("*") if path.is_file()))


if __name__ == "__main__":
    unittest.main()