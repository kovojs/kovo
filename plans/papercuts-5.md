# Papercuts 5

Created 2026-06-28. Source of truth remains `SPEC.md`; this ledger captures
confirmed framework/template/dev-tooling papercuts found during exhaustive Kovo
dogfooding on `main` at `f5c0b0a36`.

## Scope

Dogfooded linked local apps under `/Users/mini/kovo-dogfood-20260628`:
`base-pristine`, `prod-browser`, `static-export`, `security-egress`,
`schema-forms`, `ui-components`, and `copyin-verify`. The baseline scaffold now
passes format/lint/type checks and Vitest startup on current `HEAD`, but
production build fails. Static export and UI copy-in findings were verified
independently after the `f5c0b0a36` follow-up commit landed.

Security egress bypass is filed separately in `plans/bugz-7.md`.

## Issues

### A. Production Build

- [ ] **Fresh linked starter `pnpm run check` fails at `build:prod` because the virtual undici runtime cannot resolve `undici`.** (high, framework/tooling; found by baseline)
  - Observed behavior: `vp check`, endpoint posture, and `vp test` pass, but `kovo build ./src/app.tsx` fails with `Rolldown failed to resolve import "undici" from "\0kovo-bundled-undici-runtime"`.
  - Root cause direction: `packages/cli/src/commands/build-export.ts:1417` injects `bundledUndiciRuntimeVitePlugin()`, whose virtual module at `packages/cli/src/commands/build-export.ts:1472` imports bare `undici`. The app does not declare `undici` directly, and the virtual module is not resolved from `@kovojs/server`'s package context.
  - Why it matters: the generated starter's main `pnpm run check` gate now fails at production build, so a first-run app cannot reach the deployable Node preset path.
  - Evidence: `pnpm run check` in `/Users/mini/kovo-dogfood-20260628/base-pristine` passes endpoint posture, then fails at `build:prod` with the virtual-module `undici` resolution error; `pnpm run test` in the same app passes 2 files / 5 tests.
  - Acceptance: a fresh linked starter can run `pnpm run check`, including `build:prod`, without adding an app-local `undici` dependency.

### B. Static Export

- [ ] **Manifest-backed static export omits Vite `public/` assets referenced by exported HTML.** (med, framework/tooling; found by `static-export`)
  - Observed behavior: exported `/export/index.html` references `/kovo-static-mark.svg` and `/static-note.txt`, but `dist/export-verify` contains only route HTML, `/assets/styles.css`, `/c/__v/...`, and `_headers`; both public files are missing and return 404 from a static host.
  - Root cause direction: `packages/server/src/static-export.ts:37` only materializes assets supplied in `options.assets`; the manifest-backed asset plan used by `packages/server/src/vite-static-export-options.ts:179` covers manifest entries such as CSS, but Vite `public/` files are not manifest chunks.
  - Why it matters: app authors expect public assets that worked in Vite/prod builds to survive a documented static export. The generated HTML can contain broken asset URLs.
  - Evidence: `pnpm exec kovo export ./src/app.tsx --out dist/export-verify --manifest dist/.kovo-client/.vite/manifest.json --dist dist/.kovo-client --origin https://static-export.test --skip-non-exportable` in `/Users/mini/kovo-dogfood-20260628/static-export` wrote route HTML and CSS; `rg "kovo-static-mark|static-note" dist/export-verify/export/index.html` found both URLs, while `test -f dist/export-verify/kovo-static-mark.svg` and `test -f dist/export-verify/static-note.txt` failed.
  - Acceptance: manifest-backed static export copies Vite public assets reachable from exported documents, or rejects the export with a diagnostic that names the missing public asset path.

- [ ] **`kovo export --skip-non-exportable` writes partial output but still exits 1 for skipped-route warnings.** (low, CLI; found by `static-export`)
  - Observed behavior: `--skip-non-exportable` writes 3 HTML files, 1 client module, 1 CSS asset, and `_headers`, prints `WARN KV229` diagnostics for skipped guarded/server-only routes, then exits `1`.
  - Root cause direction: `packages/server/src/static-export-replay.ts:39` treats `onNonExportable: 'skip'` as non-blocking, but `packages/cli/src/commands/build-export.ts:1762` returns exit code 1 whenever `result.diagnostics.length > 0`.
  - Why it matters: a CI job cannot distinguish an intentional partial export from a failed export, even though the CLI labels the diagnostics as warnings and writes the requested output.
  - Evidence: the same `kovo export --skip-non-exportable` verifier command in `/Users/mini/kovo-dogfood-20260628/static-export` printed `SUMMARY html=3 clientModules=1 assets=1 diagnostics=2 outDir="dist/export-verify"` and exited `1`.
  - Acceptance: `--skip-non-exportable` exits `0` when all diagnostics are skip-mode warnings and all selected export artifacts are written successfully.

### C. UI Copy-In

- [ ] **`kovo add dialog` copies a component that imports `@kovojs/headless-ui/dialog` without adding or declaring the required app dependency.** (med, CLI/UI; found by `ui-components`)
  - Observed behavior: copying `dialog` into a fresh linked starter succeeds, but immediate `tsc --noEmit` fails with `TS2307 Cannot find module '@kovojs/headless-ui/dialog'`.
  - Root cause direction: the copied dialog source imports the headless package, while the scaffold depends on `@kovojs/ui` but not `@kovojs/headless-ui`; `kovo add` writes files only and does not update `package.json` or print a dependency instruction.
  - Why it matters: the documented copy-in path leaves the app in a broken type-checking state after a successful CLI command.
  - Evidence: in `/Users/mini/kovo-dogfood-20260628/copyin-verify`, `pnpm exec kovo add dialog --out src/components/ui-copied && pnpm exec tsc --noEmit` fails at `src/components/ui-copied/dialog.tsx(8,8)` with missing `@kovojs/headless-ui/dialog`.
  - Acceptance: `kovo add` either updates the app manifest/lockfile with required Kovo package dependencies or prints a fail-loud post-add instruction before returning success.

## Refuted / Not Carried Forward

- The earlier `@kovojs/ui/badge` TS2307 symptom did not reproduce on current `HEAD`; `vp check` and plain `tsc --noEmit` resolve UI package subpaths.
- The earlier Vitest/endpoint-posture `undici` crash is fixed on current `HEAD`; `pnpm run test` in `base-pristine` passes.
- The production enhanced-mutation stale-DOM candidate from `prod-browser` was not carried because current `HEAD` cannot rebuild the production app until the baseline `build:prod` failure above is fixed.
- Schema/forms found promising lower-priority ergonomics candidates around repeated array controls and generic enhanced 422 output, but they need a fresh minimal verifier after the production-build blocker is fixed.

## Latest Verification

- `pnpm run check` in `/Users/mini/kovo-dogfood-20260628/base-pristine` (fails only at `build:prod` with the virtual `undici` resolution error).
- `pnpm run test` in `/Users/mini/kovo-dogfood-20260628/base-pristine`.
- `pnpm exec kovo export ./src/app.tsx --out dist/export-verify --manifest dist/.kovo-client/.vite/manifest.json --dist dist/.kovo-client --origin https://static-export.test --skip-non-exportable` in `/Users/mini/kovo-dogfood-20260628/static-export`.
- `pnpm exec kovo add dialog --out src/components/ui-copied && pnpm exec tsc --noEmit` in `/Users/mini/kovo-dogfood-20260628/copyin-verify`.
