# Modifier mode

Bundled source: Telugu_Modifier_Examples(2).zip, schema 1.10, 173 entries and
321 examples. The original JSON is preserved in catalog-v43.json (the existing
filename is retained for compatibility). Every entry displays all examples.

Triangle opens Modifier mode; ? returns to observations. Horizontal swipes or
arrow keys navigate. Vertical scrolling reads long entries. Back/forward replays
session history without new draws, including the former latest entry; only moving
beyond that entry draws randomly. This history stays in memory while switching
modes/settings; a reload starts fresh. Normal observation navigation is unchanged.

Switch on removes an entry from the current round. Switch off restores it.
Long press on the page opens an icon-only ??? action. Activating it omits that
entry from the count and random draws across all future rounds. Settings →
Modifier mode → ??? lists omitted entries and offers a restore icon. Restoring
also clears an ordinary switched-on exclusion so the entry is eligible again.
Historical pages remain accessible even if their entry was subsequently omitted.

At zero remaining, an inline reset icon starts a fresh round. Settings also has
a confirmed reset. Both reset ordinary switches and seen status, clear navigation
history, and preserve ??? omissions. If every entry is omitted the count stays
zero until something is restored through the ??? settings page.

Settings → Modifier mode → Import accepts the same ZIP format. The upload icon
opens the device file picker; the adjacent number shows the loaded entry count.
Import validates a single telugu_modifiers.json anywhere in the archive, without
extracting files to disk or executing scripts. Compressed and expanded catalog
size limits are 8 MiB. Malformed/duplicate entries and ambiguous archives fail
without replacing the previous catalog. An error/retry control is shown.

Import starts a new round using only the imported entries. ??? omissions match
stable entry IDs and survive import/reset; IDs absent from an imported catalog
are retained in storage and take effect if subsequently reimported. Existing
ordinary progress remains on upgrade; import explicitly resets it. Archive
practice progress is never imported.

Catalogs, omissions and ordinary progress are per profile in the existing SQLite
volume database. Profile deletion cascades to all three tables. Other profiles
keep their own catalog/progress. No deployment or startup configuration changes.

Validation: production build and eight focused API/storage/catalog tests pass.
React DOM integration covers back/forward reuse and latest-boundary random draw,
rapid input, long press, persistent omissions, reset, failed saves, switches and
horizontal/vertical gesture isolation. Actual iPhone touch testing remains needed.

Commands: cd upa && npm ci && npm run build
node --import tsx --test tests/modifiers.test.ts
