# Whole words and tap-only exploration audio

Base: grammar at d4380d58559074c7d86b89c641324de0740eb9e0 (PR #92).
Apply after the private-access-and-exploration patch, already present on this base.

## Apply

From the repository root:

```sh
git apply --check /path/to/extracted/changes.patch
git apply /path/to/extracted/changes.patch
```

Use the patch, or copy `files/` over the repository and delete every path in `deleted-files.txt`. Do not use both methods. If the check fails against newer work, reconcile it instead of overwriting newer files.

## Changes

- Removes the frontend's weak noun/suffix parser and its guessed core/ending visual split. Word focus retains the complete selected word and its original alignment offsets.
- Image generation, search and gallery lookup use that complete word. Existing letter-modification highlighting is preserved; it is separate from morphological guessing.
- New image prompts use `<word>`. Existing saved `<core word>` tags remain supported as aliases for the full word, with no parsing. There is no need to reset saved prompts.
- `<sentence>` remains opt-in. Sentence text is inserted only where that tag occurs; it is not appended automatically. Placeholder expansion is not recursive.
- Exploration never autoplays, regardless of the normal profile autoplay setting. Single tap plays/pauses the current available snippet through the existing player. Audio alignment/preparation may still occur in advance. No visible audio bar, recording button or evaluation switch is added to exploration.
- Up/down progression and reverse traversal, focus, settings, normal observation audio, core parsing/progression, access gating and deployment configuration retain their existing behavior.

## Saved images

Old image files are not deleted or relabeled. An image stored under a guessed base remains associated with that base. An inflected word now looks up its own gallery, so it may initially have no images even when its former guessed base has images. No image generation is triggered automatically by this patch.

The existing API/storage field named `root` is retained for compatibility; it now receives the full word from word focus. This field name does not invoke a parser.

## Validation

- Production frontend/backend build and TypeScript checking passed.
- 37 of 38 selected tests passed. The one failure, `scroll mode defaults on for old profiles and opt-out survives unrelated preference updates`, also reproduces before this patch. It expects an opt-out that the existing branch forces on; this patch does not modify that preference behavior.
- Passing checks cover image generation routes, full modified-word prompt substitution, legacy placeholders, sentence opt-in, stored preferences other than that existing failure, exploration sequence and wheel behavior.
- Browser test expectations for whole-word galleries were updated, but browser/iPhone gesture, playback and visual tests were not run.
- Patch application and all replacement/deletion paths are verified against the exact base commit.

No deployment, secret changes, core database changes or remote commits were performed.
