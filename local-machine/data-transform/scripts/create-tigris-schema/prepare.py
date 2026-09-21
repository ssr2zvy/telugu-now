#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from common import CorpusWriter
from sources import (
    read_fleurs,
    read_indicvoices,
    read_shrutilipi,
)
from sources.fleurs import (
    CATALOG_VERSION as FLEURS_VERSION,
    DISPLAY_NAME as FLEURS_NAME,
    EXPECTED_AUDIO_MIME as FLEURS_AUDIO,
    LICENSE as FLEURS_LICENSE,
    PROVIDER as FLEURS_PROVIDER,
    SOURCE_ID as FLEURS_ID,
    UPSTREAM_URL as FLEURS_URL,
)
from sources.indicvoices import (
    CATALOG_VERSION as INDIC_VERSION,
    DISPLAY_NAME as INDIC_NAME,
    EXPECTED_AUDIO_MIME as INDIC_AUDIO,
    LICENSE as INDIC_LICENSE,
    PROVIDER as INDIC_PROVIDER,
    SOURCE_ID as INDIC_ID,
    UPSTREAM_URL as INDIC_URL,
)
from sources.shrutilipi import (
    CATALOG_VERSION as SHRUTI_VERSION,
    DISPLAY_NAME as SHRUTI_NAME,
    EXPECTED_AUDIO_MIME as SHRUTI_AUDIO,
    LICENSE as SHRUTI_LICENSE,
    PROVIDER as SHRUTI_PROVIDER,
    SOURCE_ID as SHRUTI_ID,
    UPSTREAM_URL as SHRUTI_URL,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Transform upstream-shaped Telugu corpora into Telugu Now canonical storage."
    )
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--batch-rows", type=int, default=20, help="Maximum rows decoded and written per batch.")
    parser.add_argument("--consume-input", action="store_true", help="Delete consumed sample files only after successful corpus publication.")
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Atomically replace an existing prepared corpus after successful validation.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.batch_rows < 1:
        raise ValueError("--batch-rows must be greater than 0")
    input_root, output_root = args.input.resolve(), args.output.resolve()
    if input_root == output_root or input_root in output_root.parents or output_root in input_root.parents:
        raise ValueError("Input and output directories must not overlap")
    writer = CorpusWriter(args.output, replace=args.replace, batch_rows=args.batch_rows)
    on_consumed = writer.consume_after_publish if args.consume_input else None

    writer.add_source(
        source_id=FLEURS_ID,
        display_name=FLEURS_NAME,
        provider=FLEURS_PROVIDER,
        license_name=FLEURS_LICENSE,
        upstream_url=FLEURS_URL,
        catalog_version=FLEURS_VERSION,
        expected_audio_mime=FLEURS_AUDIO,
        rows=read_fleurs(args.input / "FLEURS", on_consumed=on_consumed),
    )

    writer.add_source(
        source_id=SHRUTI_ID,
        display_name=SHRUTI_NAME,
        provider=SHRUTI_PROVIDER,
        license_name=SHRUTI_LICENSE,
        upstream_url=SHRUTI_URL,
        catalog_version=SHRUTI_VERSION,
        expected_audio_mime=SHRUTI_AUDIO,
        rows=read_shrutilipi(args.input / "Shrutilipi", batch_rows=args.batch_rows, on_consumed=on_consumed),
    )

    writer.add_source(
        source_id=INDIC_ID,
        display_name=INDIC_NAME,
        provider=INDIC_PROVIDER,
        license_name=INDIC_LICENSE,
        upstream_url=INDIC_URL,
        catalog_version=INDIC_VERSION,
        expected_audio_mime=INDIC_AUDIO,
        rows=read_indicvoices(args.input / "IndicVoices", batch_rows=args.batch_rows, on_consumed=on_consumed),
    )

    writer.finalize()


if __name__ == "__main__":
    main()
