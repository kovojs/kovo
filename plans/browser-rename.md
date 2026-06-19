# Browser Rename

**Goal:** Rename the browser-side runtime package to `@kovojs/browser` for execution-environment
clarity, pairing cleanly with `@kovojs/server`.

**Status:** Complete. Pre-release, so no back-compat alias window was kept.

**Behavior source of truth:** `SPEC.md`. The generated ABI subpath is compiler-owned and
compiler/package co-versioned (`SPEC.md` §6.6, §8), so the package specifier changed in lockstep with
compiler emit.

**Artifact rule:** Lowered IR and generated modules are artifacts (`SPEC.md` §5.2). This session did
not hand-edit tracked generated app modules; generated API/build output was regenerated as ignored
verification output.

---

## Decisions

- [x] Rename the directory to `packages/browser/` so the on-disk layout matches the package name.
  - Evidence: `git status --short packages/browser/package.json` reports the moved package file, and
    `pnpm install --force` relinked workspace dependencies to `packages/browser`.
- [x] Use `browser` / `browser-client` API reference slugs.
  - Evidence: `public-packages.json` now declares `@kovojs/browser`, `dir: "browser"`, API slug
    `browser`, and client entry slug `browser-client`; `pnpm --filter @kovojs/site run api:ref`
    passed with `api-ref/v1 packages=8 exports=478 documented=412`.
- [x] Keep unrelated historical evidence intact.
  - Evidence: dated `plans/audit-api-20260618-*.md` entries intentionally preserve their historical
    old package references and are excluded from the current-source stale-name scan.

---

## Completed Work

- [x] Package rename and workspace relink.
  - Evidence: `pnpm install --force` completed, `pnpm-lock.yaml` now links browser workspace
    dependencies, and `pnpm exec vp run browser` passed 27 files / 144 browser tests.
- [x] Compiler ABI specifier flip.
  - Evidence: `pnpm exec vitest --run packages/compiler/src/emit/bootstrap-runtime-contract.test.ts`
    passed as part of the targeted browser-rename suite, and `pnpm exec vp run build` emitted
    `dist/browser/src/{client,generated,index}.mjs` followed by `prod-emit-check/v1 OK`.
- [x] Dependent package manifests, starter templates, examples, docs, site, and package references now
      consume `@kovojs/browser`.
  - Evidence: `pnpm run check` passed, including import boundaries, no-committed-generated, formatting,
    lint/typecheck, and example typechecks.
- [x] Hand-authored imports and VM import-stripping helpers were renamed.
  - Evidence: `pnpm exec vp test` passed 420 test files / 3102 tests with 1 skipped.
- [x] Vite/conformance fixtures handle async transform output and local JSX runtime aliasing under the
      renamed package layout.
  - Evidence: `pnpm exec vitest --run packages/conformance-fixtures/src/vite-fixtures.test.ts
packages/conformance-fixtures/src/generated-module-fixtures.test.ts` passed 32 tests, and
    `pnpm exec vp run kovo-check` passed 50/50 with `kovo-check/v1 OK`.
- [x] Public API manifest and generated docs were refreshed for the browser package.
  - Evidence: `pnpm run check:api-surface` passed with
    `public-exports-needing-attention=1571 (baseline=1571, fixed-this-run=0)`, and
    `pnpm --filter @kovojs/site run api:ref` passed.
- [x] No checked-in generated app artifacts were hand-edited for this rename.
  - Evidence: `pnpm run check` passed `check:no-committed-generated` with `no-committed-generated/v1
OK`; ignored API/build outputs were regenerated for verification only.
- [x] Current source and built artifacts have no stale package/directory/client-slug references, except
      preserved historical audit reports.
  - Evidence: current-source `rg` stale-name scan excluding `node_modules`, `dist`, and dated audit
    reports returned zero matches; artifact `rg` stale-name scan over `dist` and `packages/server/dist`
    returned zero matches.

---

## Latest Verification

- [x] `pnpm run check`
  - Evidence: passed.
- [x] `pnpm exec vp test`
  - Evidence: 420 files passed; 3102 tests passed; 1 skipped.
- [x] `pnpm exec vp run browser`
  - Evidence: 27 files passed; 144 tests passed.
- [x] `pnpm exec vp run integration`
  - Evidence: 130 Playwright integration tests passed.
- [x] `pnpm exec vp run kovo-check`
  - Evidence: 50/50 tests passed; `kovo-check/v1 OK`.
- [x] `pnpm exec vp run build`
  - Evidence: build completed and `prod-emit-check/v1 OK`.
- [x] `pnpm run check:api-surface`
  - Evidence: baseline unchanged at 1571 exports needing attention.
- [x] `pnpm --filter @kovojs/site run api:ref`
  - Evidence: generated API reference reports 8 packages and 478 exports.
- [x] `git diff --check`
  - Evidence: passed with no whitespace errors.
