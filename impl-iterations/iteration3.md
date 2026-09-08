1. `data-transform/` is the exclusive corpus acquisition/transformation boundary; ordinary Telugu Now build/start never transforms upstream data.
2. `control.sh data` explicitly dispatches `samples`, `prepare`, or `all`; `control.sh dev` only consumes an already-prepared corpus.
3. The same preparation implementation accepts sample-sized or complete source directories through input/output paths and streams Parquet rows rather than loading a full corpus into memory.
4. FLEURS canonical text is raw transcription; Shrutilipi and IndicVoices canonical text is `text`.
5. Stable row identity is canonical split plus source-native audio filename/path. `train`, `test`, `dev`, `valid`, and `validation` are normalized while the original upstream split is retained.
6. Every accepted row receives one persisted NFC extended-grapheme count, text SHA-256, audio SHA-256, duration, source metadata, and content-addressed canonical audio object key.
7. Individual invalid rows are rejected into per-source reports; unknown schemas/splits, source-key duplicates/collisions, and source-level structural incompatibilities fail preparation.
8. FLEURS expects WAV; Shrutilipi and IndicVoices expect FLAC. Actual byte signatures are checked and no audio is transcoded.
9. Prepared output contains `manifest.json`, indexed `corpus.sqlite`, immutable media objects, and rejection reports. Output replacement is transactional.
10. Iteration 3 adds `fleurs-te`, `shrutilipi-te`, and `indicvoices-te` beside `source1`, `source2`, and `source3`, for six independently weighted selectable sources.
11. Complexity reference version 2 uses grapheme counts and operates from source row counts plus complexity histograms; prepared source selection uses indexed class membership rather than materializing complete catalogs in JavaScript.
12. Runtime source preparation never calls Hugging Face and never parses upstream TSV/Parquet. Development reads the local prepared corpus; production will use the equivalent canonical release with Tigris-backed media and a locally indexed catalog.
13. The formal Media model persists both `TextMedia` and `AudioMedia`; Iteration 3 displays only Unicode text and does not yet expose the audio player.
14. The shared source-record cache persists media metadata as well as text while preserving Iteration 1/2 history, queue, acquisition, and export semantics.
15. Settings gains a Data sources page showing source attribution, upstream repository, catalog counts/version, complexity metric, and deployed source status.
16. Historical Iteration 2 word-count selection snapshots remain readable and are mapped to the generalized complexity diagnostic model without mutation.
