# Round-8 Soundness Bugz 29

Created 2026-07-02. Source of truth remains `SPEC.md`. Security/soundness defects found dogfooding AFTER
`plans/fundamental-fixes-followup-3.md` (the runtime-confinement re-architecture) was implemented. Papercuts in
`plans/claude-papercuts-27.md`.

**Meta-theme — the runtime re-architecture reproduced the EXACT failure it was designed to eliminate, one layer
lower.** followup-3's thesis was: "tag the VALUE at the DB-read boundary, so the tag rides the value and raw SQL /
aliases / views stop mattering" (§2, DEC-C). The implementation instead decides secrecy by **matching the RESULT key
name against the schema's secret column set** plus a **literal-name regex for the secret table** — a static
classifier wearing a runtime costume. It has the identical SOURCE-completeness blind spot as the static gate it
replaced (`bugz-28` B1): alias `token AS company` / derive `substr(token)` / read through a view → no name match →
no box → the raw secret ships. **All three findings below reproduce under `KOVO_PARANOID=1` with a served
plaintext/executed-write on the prod artifact.** The reason they were not caught by the plan's own acceptance is in
`papercuts-27` P1 (paranoid mode never actually disabled KV435/KV426/KV433).

Baseline: fresh `--sqlite` + `--dialect postgres` starters linked to local framework, built and served with
`KOVO_PARANOID=1`. Each finding verified by an independent verifier reproducing the served leak first-hand.

## Issues

- [ ] **B1 — The runtime secret box keys on the RESULT alias name, not source-column provenance: aliasing (or deriving) a secret column onto any non-secret column name yields an UNBOXED plaintext secret served to the wire under paranoid mode.** (HIGH, framework/security, architectural; found independently by `secret-source-completeness`, `reveal-cliff`, `sole-door`; reproduced, paranoid-confirmed)
  - Observed: a public query loader selects `FROM contacts` (non-secret) with an opaque correlated subquery projection `company: sql`(select token from "session" limit 1)`` (`session.token` is `secret:['token']`), satisfied via an inline `output:` schema + `reads:[contact]`. `KOVO_PARANOID=1 pnpm run build:prod` → exit 0; served, `curl /` returns HTTP 200 SSR HTML containing the raw `ATTACKER_SECRET_TOKEN_ABC123` verbatim in a rendered Badge. The framework read handle (`secretBoxingReadDb`) ran but did NOT box the value (a box would throw on `toString` and 500 the SSR).
  - Root cause: `packages/create-kovo/templates/src/_kovo/app-runtime-db.sqlite.ts`. (1) `select` is in `isReadSurfaceMethod` but NOT `isDirectSqlReadMethod` (~l.558-568), so a builder `.select()` routes to `readBoundaryForQuery` and bypasses the `rawWholeRowSecret` whole-row backstop (l.490-512) that only guards direct `db.all/get/execute`. (2) `readBoundaryForQuery`'s regex `sqlReferencesTable` matches `session` and records `secretColumnNames={token}` — the SOURCE column. (3) `boxSecretRows` boxes per-key keyed on the RESULT key: the whole-row backstop `hasUnclassifiedReadKey` is false because every result key (`id/name/email/company`) is a real column, and the per-key branch boxes only when `secretColumnNames.has(key)` — key `company` ≠ `token` → NOT boxed. **The box keys on the destination alias, not the source column.** Static KV435 is simultaneously blind (raw-text `session` invisible to `static.ts` table extraction) — but static is not even disabled under paranoid (`papercuts-27` P1), it just doesn't see this shape either.
  - Why it matters: the KV435 confidentiality guarantee — the headline property the re-architecture was built to make sound at runtime — is defeated by a one-token alias, on a green paranoid build, with a served plaintext credential. This is `bugz-28` B1 unfixed: the SOURCE enumeration moved from static to a runtime name-match with the same hole.
  - Repro evidence: `/Users/mini/kovo-dogfood-round8/verify8alias` (framework template pristine; only an app-level seed added). `KOVO_PARANOID=1` build exit 0; `curl` returns the raw token in served HTML.
  - Acceptance: the secret tag must ride the VALUE from its SOURCE — box a value when the driver/row-mapping materializes it from a `secret`-classified column, independent of the destination alias/derivation/view. A name-match on the result shape is not provenance and must not be the boundary. (True dynamic taint at the column binding, or engine column-`REVOKE` per DEC-C(2), which is currently only a documented fallback.)

- [ ] **B2 — A secret column read through a DB VIEW leaks to the wire under paranoid mode: the runtime secret-table detector is a literal-name regex, so the view's name evades it.** (HIGH, framework/security, architectural; found by `paranoid-and-tcb-honesty`; reproduced, paranoid-confirmed)
  - Observed: define a view (or read via a view relation) that surfaces `session.token`; read the view from a public loader. The runtime `sqlReferencesTable` regex looks for the base secret table name (`session`), which does not appear in the query text (the view name does), so `builderSecretTableRead` stays false and nothing is boxed. `KOVO_PARANOID=1` build+serve → the token ships.
  - Root cause: same file — `sqlReferencesTable` is a literal-name regex over the query text keyed to the base secret table; it does not resolve view→base-table provenance. (The Drizzle static analyzer resolves views to base tables — followup-3 5.2 — but the RUNTIME box does not, and the runtime is now the boundary.)
  - Why it matters: views are standard SQL; the same class as B1 through a different SOURCE the name-match can't see.
  - Repro evidence: reproduced under `KOVO_PARANOID=1` with a served secret through a view (verifier CONFIRMED, paranoidConfirmed).
  - Acceptance: provenance-based tagging (B1 acceptance) covers views by construction — the value materialized from a secret base column is boxed regardless of the surfacing view/alias.

- [ ] **B3 — The DEC-B declared-table write choke is DORMANT for `touches:`-only mutations — the exact shape the scaffold emits — so an out-of-scope write to the auth `user`/`session` tables executes under paranoid mode.** (HIGH, framework/security, architectural; found by `engine-vs-fallback-integrity`; reproduced, paranoid-confirmed)
  - Observed: the default generated mutation declares invalidation via `touches:` (not `tables:`); the declared-table write enforcement only engages for the `tables:` shape, so it never runs for the scaffold's own mutations. A mutation handler writing a table outside its scope (e.g. the auth `user`/`session` tables) executes and persists under `KOVO_PARANOID=1`.
  - Root cause: the managed declared-write handle's scope check is gated on the `tables:` declaration; the scaffold emits `touches:`-only mutations, leaving the write choke inert for the common path. (Engine enforcement — SQLite authorizer / Postgres role — is only wired for the `tables:` handle.)
  - Why it matters: the §11.2 `observed ⊆ declared` write-integrity contract is void for the default mutation shape; a mutation can write auth/session state it never declared, on a green paranoid build.
  - Repro evidence: reproduced under `KOVO_PARANOID=1`; an out-of-scope write to auth tables persisted (verifier CONFIRMED, paranoidConfirmed).
  - Acceptance: declared-write enforcement engages for the `touches:` shape (and every shape the scaffold emits), or the scaffold declares `tables:`; the runtime write choke must be live for the default mutation, proven by a paranoid-mode out-of-scope-write test on the generated app.

## Refuted / Not Carried Forward

- **Raw-endpoint `new Response(secret)` (SDE-2) — refuted:** the endpoint response path scans through the egress choke / a `Secret` box throws on coercion, so a *boxed* secret does not escape there. (An *unboxed* secret from B1 does — but that is B1's root, not a separate egress hole.)
- **Renderer multi-child `<script>`/array-text (R8-F1) and URL scheme+name policy (R8-F2) — refuted / not reproduced** as served executable payloads under paranoid mode; the renderer neutralized them. The renderer's default-deny generalized adequately for the tested novel positions (contrast `bugz-28` B2 meta-refresh, which is fixed).
- **`sql.unsafe` escape has no execution surface (OB2) — refuted** as a security issue (it is a DX/expressiveness note, see `papercuts-27`).

## Latest Verification

- B1 self-verified: boxing keys on result alias (`app-runtime-db.sqlite.ts` per-key `secretColumnNames.has(key)`); served plaintext token under `KOVO_PARANOID=1`. B2 (views) + B3 (touches-only write choke dormant) reproduced under paranoid by independent verifiers.
- Context: these shipped undetected because paranoid mode never disabled KV435/KV426/KV433 (`papercuts-27` P1) and the real enforcement lives outside the verified TCB (`papercuts-27` P2).
- Throwaway apps under `/Users/mini/kovo-dogfood-round8/` — safe to delete. No framework source or `SPEC.md` changed; no servers left running.
