# Modifier mode

Source: the supplied Telugu_Modifier_Examples(1).zip (requested Library revision 43).
Its internal schema version is 1.7: 158 grammar entries, 283 examples.
The original JSON is retained unchanged in shared/modifiers/catalog-v43.json.
Catalog SHA-256: 5596a182d508fa1bb8b32ea9ecedf558ef3d7f184dd5dd9fa8e0f4a8bf9bb820.
The archive's personal practice_progress.json is not imported.

## Reading

The equilateral triangle sits immediately left of Repository and Settings.
It becomes a question mark in Modifier mode; the question mark returns to the
normal observation. Settings and Repository return to the active mode on close.
The normal observation is marked not visible while Modifier mode is active.

Each page is one grammar entry, with all its examples. The entry's modifier
surfaces appear at the top. Examples show base + modifier → result, followed by
the supplied context sentence. Stem-only operations with no modifier surface
show base → result; their title shows the actual removal/replacement operation.
No English learning labels or invented translations are added.
Long entries scroll vertically. An unlabeled switch appears below all examples.

Swipe left / ArrowLeft draws uniformly from eligible grammar entries using
Node's crypto.randomInt. Swipe right / ArrowRight revisits session history.
Horizontal trackpad scrolling also navigates. Vertical scrolling does not.
When several entries are eligible the current one cannot immediately repeat.
When only one remains it may repeat. When none remain the count is zero and
no new entry is drawn; settings or history can restore an entry.
A forward draw after revisiting history starts a new random continuation.

Switch on excludes the whole entry, including all examples. Off restores it.
Switches remain editable on history pages. Mutations complete before further
navigation; failed requests leave the confirmed state visible and offer retry.
The bottom-right count is the number of eligible entries, including the current
entry when its switch is off.

## Settings and storage

Settings → Modifier mode has separate pages for switched-on entries, seen but
switched-off entries, unseen entries, and reset. Each entry belongs to exactly
one group. Lists use actual Telugu forms and an example to distinguish entries.
Seen/excluded lists also allow changing switches. Reset requires confirmation
and restores all entries to unseen/available for the current profile only.

modifier_progress is created automatically in the existing profile database on
the persistent volume. It stores profile code, stable catalog entry ID, excluded
status and first appearance timestamp; at most 158 rows per profile for v43.
Profile deletion cascades to this table. No access secrets or Fly configuration
changes are needed. The site-wide access gate protects the new routes, which
also validate the profile and entry IDs. Core parser progress is not modified.
Session navigation history stays in memory; exclusions and appearance status
survive reloads and deployments. Removing this patch leaves the stored rows
intact but unused.

## Validation

- TypeScript and complete client/server production build passed.
- Six focused tests cover every catalog transformation, grouping, random-draw
  eligibility, exclusion/restoration, exhausted pools, persistence, profile
  isolation, deletion, input validation and settings hierarchy.
- React DOM integration checks passed under StrictMode: all examples, icons,
  switch state, rapid input locking, history, failed-save/retry, settings lists,
  reset, both horizontal swipe directions, vertical-scroll isolation, return.
  This was a simulated DOM check, not an iPhone/Safari visual test.
- Full suite via node --import tsx --test tests/*.test.ts: 409 passed, 81 failed.
  Untouched base main: 403 passed, the same 81 test names failed. No added
  failures. Existing suite failures are outside this feature's scope.
- Browser binaries could not be downloaded in the build environment, so actual
  WebKit/iPhone layout and touch behavior still need a device smoke test.

Focused checks: cd upa && node --import tsx --test tests/modifiers.test.ts
Production build: cd upa && npm ci && npm run build
