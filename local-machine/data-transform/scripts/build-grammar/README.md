# Grammar catalog builder

This is the source location of the temporary migration calculation script, alongside the existing prepare/update-complexity scripts. It uses Python 3 standard library only and the bundled corrected parser/dictionary. It does not require lt-proc, wxconv, lemmatization or network access.

```
python3 build_grammar.py --corpus /data/corpus/corpus.sqlite \
  --availability /data/corpus/availability.sqlite \
  --output /data/corpus/grammar/job.building.sqlite
```

The server launches it as a low-priority child process. The server, not this Python script, publishes the completed file using its existing Tigris SDK credentials. JSON progress is emitted on stdout; checkpoints commit every 25 transcripts. Only availability-listed transcripts qualify when `--availability` is supplied. The original corpus is read-only. Different parser/corpus/availability snapshots cannot resume the same checkpoint.

A disk cache holds each distinct accepted surface spelling's parse once. `observations` holds source references and accepted-token lengths. `occurrences` maps eligible tokens to canonical chain targets and original code-point positions. `members` indexes target/transcript/length combinations. `vocabulary_occurrences` and the fixed reference graph provide incidental analytics with null probability for missing reference words.

Do not run this against the live corpus as its output path. Do not upload a `.building.sqlite` file before the `complete` metadata and integrity checks pass. A completed catalog's SHA-256 is the immutable Tigris object name; publication and activation are separate operations.
