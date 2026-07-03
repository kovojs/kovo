# Drizzle Upgrade to 1.0.0-rc.4

**Date:** 2026-07-03
**Primary objective:** upgrade every Kovo-owned package reference to `drizzle-orm@1.0.0-rc.4`, regenerate the lockfile, and prove the blessed Drizzle data-plane path still conforms to `SPEC.md` §10.

`SPEC.md` §10 names Drizzle-backed schema and AST provenance as the blessed data-plane path. This upgrade must preserve schema/domain extraction, query/write analysis, SQL safety, managed DB runtime behavior, and starter-template installability.

Scope note: `@kovojs/drizzle` workspace references stay `workspace:*`; this plan targets external `drizzle-orm` package references and the lockfile entries they produce.

## Current Evidence

- [x] Confirm the target package version exists.
  - Evidence: `pnpm view drizzle-orm@1.0.0-rc.4 version` returned `1.0.0-rc.4`.
- [x] Inventory direct Kovo-owned package manifest references.
  - Evidence: `rg -n '"drizzle-orm"|"drizzle-kit"|"@better-auth/drizzle-adapter"' $(rg --files -g 'package*.json')` found direct `drizzle-orm` refs in `examples/commerce/package.json`, `examples/crm/package.json`, `examples/stackoverflow/package.json`, `conformance/drizzle-pin/package.json`, `packages/create-kovo/templates/package.json`, `packages/create-kovo/templates/package.sqlite.json`, `packages/drizzle/package.json`, and `packages/server/package.json`.
- [x] Inventory generated/user-facing references that may need follow-up after the manifest bump.
  - Evidence: `rg -n '0\.45\.2|1\.0\.0-rc\.3|1\.0\.0-rc\.4' packages/create-kovo/templates packages/create-kovo/src examples conformance packages/drizzle/package.json packages/server/package.json` found starter README/test text that still describes Better Auth's `drizzle-orm@^0.45.2` optional peer warning and starter use of `1.0.0-rc.3`.

## Checklist

- [x] Update every direct manifest pin from `drizzle-orm@1.0.0-rc.3` to exact `1.0.0-rc.4`.
  - Scope: `examples/commerce/package.json`, `examples/crm/package.json`, `examples/stackoverflow/package.json`, `conformance/drizzle-pin/package.json`, `packages/create-kovo/templates/package.json`, `packages/create-kovo/templates/package.sqlite.json`, and `packages/drizzle/package.json`.
  - Evidence: the required no-old-direct-refs `rg` command below returned no hits, and these manifests now pin `drizzle-orm` to `1.0.0-rc.4`.
- [x] Update `packages/drizzle/package.json` peer dependency from `>=1.0.0-rc.3 <2` to `>=1.0.0-rc.4 <2`.
  - Evidence: `packages/drizzle/package.json` now has `devDependencies.drizzle-orm` `1.0.0-rc.4` and peer range `>=1.0.0-rc.4 <2`.
- [x] Update `packages/server/package.json` from `drizzle-orm@^0.45.2` to exact `1.0.0-rc.4`.
  - Evidence: `packages/server/package.json` now pins `drizzle-orm` to `1.0.0-rc.4`; focused server/data-plane tests passed below.
- [x] Regenerate `pnpm-lock.yaml` from the updated manifests.
  - Evidence: `pnpm install --lockfile-only` regenerated `pnpm-lock.yaml`; remaining `drizzle-orm@0.45.2` hits are Better Auth / `@better-auth/drizzle-adapter` optional peer metadata, not Kovo-owned direct importers.
- [x] Update starter README text and create-kovo expectations after observing the regenerated lockfile behavior.
  - Scope: `packages/create-kovo/templates/README.md`, `packages/create-kovo/templates/README.sqlite.md`, and related assertions in `packages/create-kovo/src/index.test.ts`.
  - Evidence: starter READMEs still document Better Auth's `drizzle-orm@^0.45.2` optional peer while stating the starter uses Drizzle `1.0.0-rc.4`; `packages/create-kovo/src/index.test.ts` starter assertions passed below.
- [x] Fix any source or fixture incompatibilities exposed by rc.4.
  - Evidence: `packages/server/src/sqlite-authz.test.ts` now uses Drizzle rc.4's `drizzle({ client })` better-sqlite3 adapter form; the static SQLite receiver surface uses rc.4's `SQLiteAsyncDatabase` identity; focused server/data-plane and conformance tests passed below.
- [x] Prove no old direct package references remain.
  - Required command: `rg -n '"drizzle-orm": "(1\.0\.0-rc\.3|\^0\.45\.2|0\.45\.2)"|">=1\.0\.0-rc\.3 <2"' $(rg --files -g 'package*.json')`.
  - Evidence: required `rg` command returned no direct Kovo-owned manifest hits.
- [x] Prove the lockfile resolves the intended Drizzle version.
  - Required command: `rg -n 'drizzle-orm@1\.0\.0-rc\.3|drizzle-orm: 1\.0\.0-rc\.3|drizzle-orm: \^0\.45\.2|drizzle-orm@0\.45\.2' pnpm-lock.yaml`.
  - Evidence: required `rg` command found only Better Auth / `@better-auth/drizzle-adapter` optional peer metadata for `drizzle-orm@0.45.2`; Kovo importer entries resolve `1.0.0-rc.4`.
- [x] Run focused Drizzle and data-plane verification.
  - Required command: `pnpm exec vitest --run packages/drizzle/src/*.test.ts conformance/drizzle-pin/src/*.test.ts packages/server/src/managed-db.test.ts packages/server/src/guards.test.ts packages/server/src/authz-feasibility.test.ts packages/server/src/sqlite-authz.test.ts packages/test/src/pglite-harness.test.ts packages/test/src/sqlite-harness.test.ts`.
  - Evidence: required `pnpm exec vitest ...` command passed: 45 test files, 947 tests; `vp run conformance` passed package-context conformance, including `@kovojs/conformance-drizzle-pin` 12 files / 189 tests.
- [x] Run starter-template verification.
  - Required command: `pnpm exec vitest --run packages/create-kovo/src/index.test.ts packages/create-kovo/src/index.build.runtime.test.ts`.
  - Evidence: required `pnpm exec vitest ...` command passed: 2 test files, 30 tests.
- [x] Run package-boundary and publish-oriented gates.
  - Required commands: `pnpm run check:api-surface`, `pnpm run check:imports`, `pnpm run check:publish`, `vp run typecheck-examples`, and `git diff --check`.
  - Evidence: all required commands passed on the integration worktree.
- [x] Keep this ledger compact as implementation lands.
  - Evidence: this ledger records concise command/file evidence only.
