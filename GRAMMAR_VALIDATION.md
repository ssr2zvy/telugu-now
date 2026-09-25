# Validation of the grammar migration change

## Settings and parser diagnostics extension

- Production build passed, including type checking and packaged worker assets.
- 35 focused Node tests passed (33 grammar/appearance/eon checks and 2 updated Settings contract checks); the grammar target test includes seven passing Python behavioral cases.
- Rendered-component checks cover Observations/External grouping, side-menu migration visibility, separate export formats and parser evidence/fallback display. No browser-interaction smoke test was performed.
- The real-parser migration test verifies diagnostics before build, after build, after activation and with the temporary worker disabled; invalid profile access is rejected. Selected-word snapshots retain parser evidence.
- Parser audit: all 15 bundled parser/rules/dictionary files are byte-identical to the previous source ZIP. AST comparison confirms `initialize()` and `analyze_word()` enforcement are unchanged. Only a read-only metadata helper was added to the adapter. The audit file is included in the handoff ZIP.
- The reviewed repository has no Frequency Export implementation or menu entry. It remains absent.

Reproduce from `upa/`:

```
npm run build
node --import tsx --test tests/grammar-*.test.ts tests/appearance.test.ts tests/eons-ui.test.ts
node --import tsx --test --test-name-pattern='Settings routes import|Settings export uses' tests/repository-contract.test.ts
```

## Initial grammatical components revision (v3)

- `npm run build` passed: TypeScript, client, server and packaged Python worker.
- Six focused Node tests passed. One invokes seven Python behavioral cases, all passing. Coverage includes shared modifier identities across vocabulary bases; retained core bases; chain order/length/nesting; canonical variants; rejection of ineligible input; occurrence aggregation; resumability and incompatible-policy rejection.
- The migration test uses the real parser for `నేను చేశాను మంచానికి.`. The dative-only target has category 1 with no vocabulary base; `చేశాను` retains `verb_cheyu` and has category 3. Occurrence GI and target category agree for this sample.
- Existing scheduler parity, frozen batches, idempotent/ordered self-evaluation, profile isolation, regression and latched-completion tests still pass. Old-policy catalogs are rejected by the runtime loader.
- Remote publication/recovery is tested with a mocked Tigris client. The original corpus bytes remain unchanged. No live upload, browser test or deployment was performed for this revision.
- The reversing-curve equation, per-target streak update and batch size are unchanged. Their input target inventory is intentionally different, so v2 sample target counts and simulation results do not describe v3.

Reproduce this revision's checks from `upa/`:

```
npm ci
npm run build
node --import tsx --test tests/grammar-model.test.ts tests/grammar-integration.test.ts tests/grammar-migration.test.ts tests/grammar-target-policy.test.ts
```

## Previous version validation (v2; historical results)

Executed in the supplied development environment, without deploying or accessing the live Tigris bucket:

- Production `npm run build`: passed, including TypeScript checking, frontend build, server build and worker-asset packaging.
- Final targeted run: 14 tests passed. These cover shared frozen batches, ordered and idempotent evaluation, profile isolation, unavailable-target checks, Python/TypeScript scheduler parity, earlier-tier regression, latched completion, corpus-object download behavior and prepared-corpus compatibility.
- Migration integration uses the real Python parser with an in-memory mocked Tigris client: a failed multipart upload is aborted; a subsequent run resumes and publishes; activation is global; the permanent loader restores missing local bytes after disabling the worker. All remote keys stay under `corpus/grammar/`, and the original corpus remains byte-for-byte unchanged.
- Sample calculation: all 300 bundled transcripts processed, 1,667 distinct accepted spellings, 78 progression targets and 718 eligible occurrences. This is a small-input verification, not a timing/storage projection for the approximately 1.5 GB production corpus.
- Broad suite comparison at the integration checkpoint: modified repository 297 passed / 49 failed; untouched uploaded repository 294 passed / 49 failed. The failure-name sets matched exactly. Existing failures include obsolete empty/dummy complexity references and environment/build-harness assumptions. These were not disguised as successful checks or broadly rewritten as part of this feature.
- Subsequent final targeted tests and production build passed after the recovery/availability refinements.

Limitations: Docker itself is unavailable here, so the container was not built or deployed. Its explicit build-context allowlist and Containerfile were updated to include the parser/worker and build scripts. A Playwright browser executable is unavailable, so an interactive browser smoke test was not performed. The real Fly volume free space, Tigris write permissions and full-corpus resource usage remain to be verified in the deployment environment. No live user results or corpus files were changed.

Reproduce the focused checks from `upa/`:

```
npm ci
npm run build
node --import tsx --test tests/grammar-*.test.ts tests/corpus-object-store.test.ts tests/prepared-corpus.test.ts
```

Using `node --import tsx` avoids the tsx CLI's local IPC-socket requirement in restricted environments. Parser calculation/publish tests use temporary directories and mocked remote writes. The supplied sample data in the final ZIP is preserved from the original uploaded archive; generated development test state is excluded.
