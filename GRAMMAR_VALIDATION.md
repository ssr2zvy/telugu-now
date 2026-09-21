# Validation of the grammar migration change

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
