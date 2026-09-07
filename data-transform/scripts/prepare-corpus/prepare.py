#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from common import CorpusWriter
from sources import read_fleurs, read_indicvoices, read_shrutilipi
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
    parser = argparse.ArgumentParser(description="Transform upstream-shaped Telugu corpora into Telugu Now canonical storage.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--replace", action="store_true", help="Atomically replace an existing prepared corpus after successful validation.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    writer = CorpusWriter(args.output, replace=args.replace)
    writer.add_source(
        source_id=FLEURS_ID,
        display_name=FLEURS_NAME,
        provider=FLEURS_PROVIDER,
        license_name=FLEURS_LICENSE,
        upstream_url=FLEURS_URL,
        catalog_version=FLEURS_VERSION,
        expected_audio_mime=FLEURS_AUDIO,
        rows=read_fleurs(args.input / "FLEURS"),
    )
    writer.add_source(
        source_id=SHRUTI_ID,
        display_name=SHRUTI_NAME,
        provider=SHRUTI_PROVIDER,
        license_name=SHRUTI_LICENSE,
        upstream_url=SHRUTI_URL,
        catalog_version=SHRUTI_VERSION,
        expected_audio_mime=SHRUTI_AUDIO,
        rows=read_shrutilipi(args.input / "Shrutilipi"),
    )
    writer.add_source(
        source_id=INDIC_ID,
        display_name=INDIC_NAME,
        provider=INDIC_PROVIDER,
        license_name=INDIC_LICENSE,
        upstream_url=INDIC_URL,
        catalog_version=INDIC_VERSION,
        expected_audio_mime=INDIC_AUDIO,
        rows=read_indicvoices(args.input / "IndicVoices"),
    )
    writer.finalize()


if __name__ == "__main__":
    main()
