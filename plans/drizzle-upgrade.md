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

- [ ] Update every direct manifest pin from `drizzle-orm@1.0.0-rc.3` to exact `1.0.0-rc.4`.
  - Scope: `examples/commerce/package.json`, `examples/crm/package.json`, `examples/stackoverflow/package.json`, `conformance/drizzle-pin/package.json`, `packages/create-kovo/templates/package.json`, `packages/create-kovo/templates/package.sqlite.json`, and `packages/drizzle/package.json`.
- [ ] Update `packages/drizzle/package.json` peer dependency from `>=1.0.0-rc.3 <2` to `>=1.0.0-rc.4 <2`.
  - Keep the peer range future-compatible within Drizzle 1.x while making rc.4 the minimum supported blessed version.
- [ ] Update `packages/server/package.json` from `drizzle-orm@^0.45.2` to exact `1.0.0-rc.4`.
  - Resolve any rc.4 type/runtime fallout in managed DB helpers and server-side Drizzle tests rather than preserving the older line.
- [ ] Regenerate `pnpm-lock.yaml` from the updated manifests.
  - Use `pnpm install --lockfile-only` first; run a full `pnpm install` only if pnpm needs package metadata or peer resolution unavailable from the current store.
  - Inspect any remaining `drizzle-orm@0.45.2` lockfile entries. If they are only upstream Better Auth peer metadata, either remove them by moving to a compatible Better Auth release or record the residual upstream peer fact in this plan before marking the item complete.
- [ ] Update starter README text and create-kovo expectations after observing the regenerated lockfile behavior.
  - Scope: `packages/create-kovo/templates/README.md`, `packages/create-kovo/templates/README.sqlite.md`, and related assertions in `packages/create-kovo/src/index.test.ts`.
  - If Better Auth still advertises `drizzle-orm@^0.45.2`, keep the note truthful but update it to say the starter uses Drizzle `1.0.0-rc.4`.
- [ ] Fix any source or fixture incompatibilities exposed by rc.4.
  - Watch Drizzle table metadata, `getTableConfig`, `PgAsyncDatabase`, SQLite database types, Drizzle `SQL` object shape, and SQL helper exports used by `@kovojs/drizzle`, `@kovojs/server`, conformance fixtures, and starter templates.
- [ ] Prove no old direct package references remain.
  - Required command: `rg -n '"drizzle-orm": "(1\.0\.0-rc\.3|\^0\.45\.2|0\.45\.2)"|">=1\.0\.0-rc\.3 <2"' $(rg --files -g 'package*.json')`.
  - The command must return no direct Kovo-owned manifest hits before this item is checked.
- [ ] Prove the lockfile resolves the intended Drizzle version.
  - Required command: `rg -n 'drizzle-orm@1\.0\.0-rc\.3|drizzle-orm: 1\.0\.0-rc\.3|drizzle-orm: \^0\.45\.2|drizzle-orm@0\.45\.2' pnpm-lock.yaml`.
  - Expected outcome is no hits, or only documented upstream Better Auth metadata that cannot be removed without changing Better Auth itself.
- [ ] Run focused Drizzle and data-plane verification.
  - Required command: `pnpm exec vitest --run packages/drizzle/src/*.test.ts conformance/drizzle-pin/src/*.test.ts packages/server/src/managed-db.test.ts packages/server/src/guards.test.ts packages/server/src/authz-feasibility.test.ts packages/server/src/sqlite-authz.test.ts packages/test/src/pglite-harness.test.ts packages/test/src/sqlite-harness.test.ts`.
- [ ] Run starter-template verification.
  - Required command: `pnpm exec vitest --run packages/create-kovo/src/index.test.ts packages/create-kovo/src/index.build.runtime.test.ts`.
- [ ] Run package-boundary and publish-oriented gates.
  - Required commands: `pnpm run check:api-surface`, `pnpm run check:imports`, `pnpm run check:publish`, `vp run typecheck-examples`, and `git diff --check`.
- [ ] Keep this ledger compact as implementation lands.
  - Replace each checked item's evidence with the shortest proving command or authoritative file inspection. Do not paste command transcripts.
