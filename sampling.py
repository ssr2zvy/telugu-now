mkdir -p scripts
cat > scripts/download-source-samples.py <<'PY'
from datasets import load_dataset, Audio
from pathlib import Path
import base64
import itertools
import json
import mimetypes
import os
import shutil

COUNT = 100

SOURCES = [
    {
        "name": "fleurs-te",
        "repo": "google/fleurs",
        "config": "te_in",
        "split": "train",
        "audio_column": "audio",
    },
    {
        "name": "shrutilipi-te",
        "repo": "ai4bharat/Shrutilipi",
        "config": "telugu",
        "split": "train",
        "audio_column": "audio_filepath",
    },
    {
        "name": "indicvoices-te",
        "repo": "ai4bharat/IndicVoices",
        "config": "telugu",
        "split": "train",
        "audio_column": "audio_filepath",
    },
]

ROOT = Path("data/source-samples")


def extension_for(path, data):
    if path:
        suffix = Path(path).suffix
        if suffix:
            return suffix

    if data:
        if data[:4] == b"RIFF":
            return ".wav"
        if data[:4] == b"fLaC":
            return ".flac"
        if data[:3] == b"ID3":
            return ".mp3"
        if data[:4] == b"OggS":
            return ".ogg"

    return ".audio"


def json_safe(value):
    if isinstance(value, bytes):
        return {
            "_type": "bytes",
            "length": len(value),
        }

    if isinstance(value, dict):
        return {
            key: json_safe(item)
            for key, item in value.items()
        }

    if isinstance(value, (list, tuple)):
        return [
            json_safe(item)
            for item in value
        ]

    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


def write_audio(audio, destination_without_suffix):
    if audio is None:
        return None

    if not isinstance(audio, dict):
        raise RuntimeError(
            f"Expected decode=False audio dictionary, got {type(audio)!r}"
        )

    source_path = audio.get("path")
    audio_bytes = audio.get("bytes")

    extension = extension_for(
        source_path,
        audio_bytes,
    )

    destination = destination_without_suffix.with_suffix(extension)

    if audio_bytes is not None:
        destination.write_bytes(audio_bytes)
        return destination.name

    if source_path and os.path.isfile(source_path):
        shutil.copyfile(source_path, destination)
        return destination.name

    raise RuntimeError(
        f"Audio row contained neither bytes nor a readable local path: {audio}"
    )


def download_source(source):
    source_root = ROOT / source["name"]
    audio_root = source_root / "audio"

    source_root.mkdir(
        parents=True,
        exist_ok=True,
    )
    audio_root.mkdir(
        parents=True,
        exist_ok=True,
    )

    print()
    print("=" * 72)
    print(source["name"])
    print("=" * 72)

    dataset = load_dataset(
        source["repo"],
        source["config"],
        split=source["split"],
        streaming=True,
    )

    audio_column = source["audio_column"]

    dataset = dataset.cast_column(
        audio_column,
        Audio(decode=False),
    )

    rows = []

    for index, row in enumerate(
        itertools.islice(dataset, COUNT)
    ):
        audio = row.get(audio_column)

        audio_file = write_audio(
            audio,
            audio_root / f"{index:03d}",
        )

        metadata = {
            key: json_safe(value)
            for key, value in row.items()
            if key != audio_column
        }

        metadata["_sample"] = {
            "sample_index": index,
            "source": source["name"],
            "upstream_repo": source["repo"],
            "upstream_config": source["config"],
            "upstream_split": source["split"],
            "audio_column": audio_column,
            "audio_file": f"audio/{audio_file}",
            "upstream_audio_path": (
                audio.get("path")
                if isinstance(audio, dict)
                else None
            ),
        }

        rows.append(metadata)

        print(
            f"{source['name']}: "
            f"{index + 1:03d}/{COUNT} "
            f"→ {audio_file}"
        )

    if len(rows) != COUNT:
        raise RuntimeError(
            f"{source['name']} returned only {len(rows)} rows"
        )

    metadata_path = source_root / "rows.jsonl"

    with metadata_path.open(
        "w",
        encoding="utf-8",
    ) as handle:
        for row in rows:
            handle.write(
                json.dumps(
                    row,
                    ensure_ascii=False,
                )
            )
            handle.write("\n")

    manifest = {
        "source": source["name"],
        "upstream_repo": source["repo"],
        "upstream_config": source["config"],
        "upstream_split": source["split"],
        "sample_count": len(rows),
        "audio_column": audio_column,
    }

    (
        source_root /
        "manifest.json"
    ).write_text(
        json.dumps(
            manifest,
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


ROOT.mkdir(
    parents=True,
    exist_ok=True,
)

for source in SOURCES:
    download_source(source)

print()
print("Done.")
print(f"Samples written to {ROOT}")
PY