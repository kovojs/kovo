# Round-9 Soundness Bugz 30

Created 2026-07-02. Source of truth remains `SPEC.md`. Security/soundness defects found dogfooding AFTER
`plans/fundamental-fixes-followup-4.md` (per-dialect confidentiality + registry-driven paranoid mode + TCB split)
was implemented. All reproduced under `KOVO_PARANOID=1` with a served leak/exploit. Papercuts in
`plans/claude-papercuts-28.md`.

**Meta-theme — the re-architecture moved CONFIDENTIALITY and READ-ONLY/WRITE-SCOPE to runtime chokes, but left a
whole property class — AUTHORIZATION — on the unsound static-only side, and the new registry formalized that as an
intentional `build-only` classification.** followup-4's own taxonomy (§2.1) says value/effect properties must be
runtime-enforced because static classification of a Turing-complete authoring surface is incomplete. But the
security-code registry (`packages/core/src/internal/security-markers.ts`) marks **KV414 owner-scoping (IDOR),
KV439 projection-to-wire, KV407/KV408 invalidation, KV410 output-coverage** as `build-only` — static is their sole
enforcement, with NO runtime choke. The blessed `sql` raw-SQL primitive (a first-class, KV422-stamped parameterized
read, NOT an escape hatch) is invisible to the static Drizzle-shape model, so it evades ALL of them at once. Plus:
the `by-construction` KV438 is stubbed under paranoid on an **unverified** claim (no runtime floor → mass-assignment
ships), and the runtime provenance box itself still under-attributes a compound-SELECT secret. The registry is the
new enumerate-and-classify surface, and it has no invariant that a value property must be `runtime-choke`.

Baseline: fresh `--sqlite` + `--dialect postgres` starters linked to local framework, built + served with
`KOVO_PARANOID=1`. Each verified by an independent verifier reproducing the served exploit first-hand.

## Issues

- [ ] **B1 — Owner-scoping (IDOR, KV414) is `build-only`/static-only with NO runtime choke: a blessed parameterized raw-SQL read serves cross-owner private rows on a green `KOVO_PARANOID=1` build.** (HIGH, framework/security, architectural; reproduced, paranoid-confirmed)
  - Observed: a session-guarded query loader reads an owner-scoped table `orders` (`kovo({owner:'ownerId'})`) by a client-supplied `id`. The structured Drizzle `.where(eq(orders.id,input.id))` is correctly a **KV414 build error** (IDOR — no owner predicate). Rewriting the identical read as `db.all(sql`SELECT id, ownerId, secretNote FROM orders WHERE id = ${input.id} LIMIT 1`)` (the blessed `sql` tag from `@kovojs/drizzle`) builds GREEN under paranoid. Served, an authenticated user who is neither owner fetched `/_q/queries/order-by-id-query?id=order-B` and received `{"order":{"id":"order-B","ownerId":"user-B","secretNote":"BOB PRIVATE: bank account 222-B"}}` (HTTP 200). Unauthenticated → 303 to `/login` — so **authentication is enforced but per-row owner authorization is not**.
  - Root cause (self-verified): `security-markers.ts:73-77` classifies KV414 `enforcement:'build-only'` — static is the sole enforcement. **There is no runtime owner/principal choke:** `grep owner|principal` in `packages/server/src/managed-db.ts` = 0; the managed read handle enforces only KV422 (SQL-safe) and KV433 (read-only), not ownership. The static gate (`packages/drizzle/src/static.ts:361` `scopeAuditsFromQueryFacts`) consumes `fact.readProvenance` built from Drizzle builder table symbols; a raw-SQL statement to the blessed `.all` (`PARSED_READ_SQL_METHODS`, `managed-db.ts:129`) carries the table only as opaque text → no owner-read fact → the fail-closed branch never fires. `graph.json` confirms `queries/order-by-id-query.domains: []`. The `sql` tag is a first-class KV422-stamped parameterized primitive (no KV426 audit, no `trustedSql`, no cast of the SQL) — this is not an escape hatch.
  - Why it matters: **cross-tenant/cross-owner data access — the classic IDOR — ships on a green paranoid build.** Authorization is fundamentally a runtime value property ("does THIS principal own THIS row?") and must be enforced at the runtime choke exactly as confidentiality was; leaving it `build-only` inherits static's incompleteness on the Turing-complete raw-SQL surface (the round-1..8 pattern, now on authorization).
  - Repro evidence: `/Users/mini/kovo-dogfood-round9/idorapp`; `KOVO_PARANOID=1 build:prod` exit 0; served BOB/ALICE private rows to a third principal; `eq()` baseline correctly KV414-fails (gate is real, raw-SQL evades it).
  - Acceptance: authorization gets a RUNTIME choke — the managed read handle enforces owner-scoping on the concrete request principal for any read of a `kovo({owner})` table, **regardless of builder vs raw SQL** (inject the owner predicate, or fail closed when a raw-SQL read of an owner table carries no proven principal predicate). Reclassify KV414 as `runtime-choke`; add the check under paranoid.

- [ ] **B2 — The same blessed raw-SQL read makes the query's read-set and wire projection invisible to the static model, collaterally evading KV439 (whole-row/owner column → wire) and KV407/KV408/KV410 (invalidation + output coverage).** (HIGH, framework/security, architectural; self-verified, paranoid-confirmed)
  - Observed: for the green raw-SQL loader, `graph.json` records `domains: []` — the model believes the query reads nothing and vetted no projection. The served wire nonetheless shipped the internal `ownerId` column (`"ownerId":"user-B"`) + `secretNote` directly to the client — a projection no KV439/KV410 check inspected. A mutation touching `order` would also not invalidate this query (KV407/KV408).
  - Root cause: KV439 (`security-markers.ts:198-202`), KV407/KV408/KV410 are all `build-only` and share KV414's substrate — Drizzle-shape-derived read/projection facts. A blessed raw-SQL read produces no facts, so every one silently sees an empty model instead of failing closed.
  - Why it matters: one static-blind channel (blessed raw SQL) evades an entire family of value/coverage properties at once, because they all consume the same Drizzle-shape facts with no runtime backstop.
  - Acceptance: these properties either move to a runtime choke or the raw-SQL read path fails closed for owner/secret-bearing tables (see B1). At minimum, a raw-SQL read whose facts are empty must not be treated as "reads nothing / projects nothing."

- [ ] **B3 — The SQLite provenance box under-attributes a compound SELECT (UNION): a secret column projected via a non-left UNION arm is served to the wire under `KOVO_PARANOID=1`.** (HIGH, framework/security, architectural; reproduced, paranoid-confirmed)
  - Observed: `SELECT id AS x FROM users UNION SELECT token FROM session` (secret `token` in the right arm, aliased into the same output column `x`) is served plaintext; the box does not fire.
  - Root cause: `packages/server/src/secret-read-boundary.ts:226-247` `sqliteSecretReadBoundaryForStatement` trusts the driver origin from `client.prepare(sql).columns()` (`:422-435`). For compound SELECTs (`UNION`/`INTERSECT`/`EXCEPT`), SQLite's `sqlite3_column_origin_name` reports ONLY the left-most arm's origin (verified on better-sqlite3 12.11.1), ignoring a secret column projected by another arm → mis-attributed → not boxed.
  - Why it matters: the round-8 provenance-box fix (the "sound" confidentiality mechanism) still has an origin-metadata blind spot; a one-line `UNION` leaks a secret on a green paranoid build.
  - Acceptance: a compound SELECT fails closed (box the whole compound result) unless EVERY arm's origin for the output column is proven non-secret; do not trust left-arm-only origin.

- [ ] **B4 — `by-construction` KV438 (mass-assignment) is stubbed under paranoid on an UNVERIFIED claim: a declared input field bound to a governed column has no runtime floor, so governed-column mass-assignment ships on a green `KOVO_PARANOID=1` build.** (HIGH, framework/security, architectural; reproduced, paranoid-confirmed)
  - Observed: a mutation whose declared input includes a field that writes a governed column (e.g. an ownership/role/privilege column) builds GREEN under paranoid and the write persists — the KV438 static error is stubbed and no runtime check drops/rejects it.
  - Root cause: `security-markers.ts:192-197` marks KV438 `by-construction` with `paranoidAdvisory:true`; `:206-217` folds it into the paranoid advisory set; `:26-27` asserts `paranoidAdvisory` is "accepted only for proven `by-construction` entries." But the "construction" is NOT proven at runtime for the declared-field→governed-column case: `build-export.ts:465-474` lets the build proceed when every ERROR is a paranoid-advisory code, so a KV438-only failure builds green, and there is no runtime governed-column floor to catch it.
  - Why it matters: this is the round-8 P1 failure recurring in the `by-construction` bucket — a code is stubbed under paranoid on the promise its property holds at runtime, but the runtime floor doesn't exist, so stubbing static leaves nothing (mass-assignment / privilege-escalation ships).
  - Acceptance: KV438 is only `by-construction`+`paranoidAdvisory` if a RUNTIME floor provably rejects/drops a governed-column write from a client-supplied field (a paranoid test that the write is refused with static stubbed); otherwise reclassify to `runtime-choke` and build the floor.

## Refuted / Not Carried Forward

- **PG app-defined definer-rights view / `SECURITY DEFINER` function bypass — refuted:** the reader-role `REVOKE` + `security_invoker` setup held; the definer-view and definer-function reads did not leak on a fresh artifact.
- **Egress-choke completeness (object recursion, coercions) & reveal-audit — refuted:** the non-coercible box held across the tested channels; the reported gaps were a stale-`dist` test-harness artifact (EG9-3) and a non-exploitable audit-ledger note, not served leaks.
- **`SELECT … FOR UPDATE` on a reader — refuted/LOW:** did not reproduce as an out-of-scope write.

## Latest Verification

- B1 self-verified: `security-markers.ts:73-77` KV414 `build-only`; `managed-db.ts` owner/principal mentions = 0 (no runtime authorization choke); served cross-owner rows on a green paranoid build. B2/B3/B4 reproduced by independent verifiers under paranoid.
- Throwaway apps under `/Users/mini/kovo-dogfood-round9/` — safe to delete. No framework source or `SPEC.md` changed; no servers left running.
