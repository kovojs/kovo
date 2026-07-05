# Bugz 24

Created 2026-07-04. Source of truth remains `SPEC.md`; this ledger captures confirmed
security/soundness defects from `plans/codex-pg-1.md` Postgres + security dogfooding.

## Issues

### A. System/SQL Chokes

- [ ] **A1 - The generated Better Auth system DB handle can be routed through app code to read secret auth columns as plain strings.** (high, template/framework security; found by `track-secret-egress-postgres`, independently verified)
  - Observed behavior: `KOVO_PARANOID=1` blocks runtime `Secret` coercion and the app-facing `appRuntimeReadonlyDb.rawRead(sql\`select token from "session"\`, { reads: ['session'] })`, but `appRuntimeAuthDb.select({ token: session.token }).from(session)`returns the Better Auth session token as an ordinary string. A throwaway endpoint routed through allowlisted`src/auth.ts`passed`build:prod`and`check:sound-subset`; the remaining `check` failure was only endpoint-posture coverage for the newly added endpoint.
  - Root cause: `packages/create-kovo/templates/src/_kovo/app-runtime-db.ts:78` exports `appRuntimeAuthDb` as an ordinary `AppDb` backed by `getAppDatabase().systemDb(...)`; `packages/server/src/postgres-runtime.ts:479` returns a full request DB for a declared system principal; `packages/server/src/postgres-runtime.ts:1596` wraps only the readonly path in `createSecretBoxingReadDb`, not the system DB path. `src/auth.ts` is intentionally allowlisted by `packages/create-kovo/templates/scripts/check-sound-subset.mjs:25-29`, so a helper exported from `auth.ts` can hide the privileged handle from direct `_kovo` import checks.
  - Why it matters: Better Auth `session.token` and `account.password` are credential-bearing secret columns. The current public guarantee work covers boxed `Secret` / readonly query-wire chokes, but this path bypasses boxing entirely by exposing the auth adapter's system-principal DB handle from generated app source.
  - Repro evidence: `KOVO_PARANOID=1 pnpm exec vitest run src/secret-egress-probe.test.ts --reporter=verbose` in `/Users/mini/kovo-dogfood-codex-pg-20260704/track-secret-egress-postgres` passed and asserted `JSON.stringify({ token, password })` contains both markers. After moving that direct test aside, the throwaway endpoint path passed `pnpm run check:sound-subset` and `pnpm run build:prod`.
  - Acceptance: the auth adapter DB capability is not importable or re-exportable by app-authored request code, or system reads of secret-classified columns are boxed/refused like readonly reads. A focused test should prove an endpoint/helper in `src/auth.ts` cannot serialize `session.token` or `account.password` under `KOVO_PARANOID=1`.

- [ ] **A2 - Mutable separated SQL carriers can pass managed write validation with one SQL text and execute another.** (high, framework security/soundness; found by `track-raw-sql-runtime`, independently verified)
  - Observed behavior: a `{ values, get text() { ... } }` carrier returned `update contacts ...` while the managed SQL guard and table allowlist inspected it, then returned `update verification ...` when the fake driver executed it. `managedDb(..., 'write', { sqlWritePolicy: { tables: ['contacts'] } }).execute(carrier)` did not throw and the driver saw the undeclared statement.
  - Root cause: `packages/core/src/internal/sql-safety.ts:251` accepts separated `{ text|sql, values }` carriers by reading mutable properties; `packages/server/src/sql-safe-handle.ts:320-322` validates the original object and then passes that same object to the driver; `packages/server/src/sql-safe-handle.ts:712` / `:816` re-read SQL text from the same object rather than snapshotting/canonicalizing it before enforcement and execution.
  - Why it matters: SPEC §10.3/§11.2 require runtime parsing of the executed statement against declared `tables:`. Postgres RLS may still deny the worst cross-owner/unclassified writes, but the framework's managed write allowlist and `observed ⊆ declared` runtime contract are bypassable for any accepted object carrier whose text is mutable between check and use.
  - Repro evidence: `pnpm exec vitest run probes/managed-carrier.probe.test.ts --reporter=verbose` in `/Users/mini/kovo-dogfood-codex-pg-20260704/track-raw-sql-runtime` passed and logged execution of `update verification ...` after validation allowed `update contacts ...`. Existing framework tests confirm lifecycle `request.db.execute({ text, values })` is an accepted public shape at `packages/server/src/guards.test.ts:161-165`.
  - Acceptance: managed SQL enforcement snapshots/freeze-normalizes separated carriers exactly once and sends the same canonical statement to the driver; a mutable getter carrier must be rejected or execute the validated text. Add a focused regression test around `managedDb`/request DB execution with a getter-backed `{ text, values }`.

## Refuted / Not Carried Forward

- Direct app imports of `@kovojs/server/internal/managed-db` fail with KV235; the SQL-carrier issue is carried because the public lifecycle request DB already accepts separated `{ text, values }` carriers.
- App-facing readonly auth-table raw reads failed closed in the secret-egress track; the carried issue is the generated system DB export, not the ordinary readonly DB.

## Latest Verification

- `KOVO_PARANOID=1 pnpm exec vitest run src/secret-egress-probe.test.ts --reporter=verbose` in `track-secret-egress-postgres`: reproduced A1.
- `pnpm run check:sound-subset` and `pnpm run build:prod` in `track-secret-egress-postgres` after routing the read through `src/auth.ts`: the endpoint path was not blocked by those gates.
- `pnpm exec vitest run probes/managed-carrier.probe.test.ts --reporter=verbose` in `track-raw-sql-runtime`: reproduced A2.
- `pnpm exec vitest --run packages/core/src/sql-safety.test.ts packages/server/src/guards.test.ts --testNamePattern "separated|raw SQL strings before driver" --reporter=dot`: existing separated-carrier/public request DB tests passed.
