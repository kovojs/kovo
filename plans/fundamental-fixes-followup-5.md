# Fundamental Fixes Followup 5 — authorization is a runtime property, not a static one

Created 2026-07-02. Self-standing. Source of truth for behavior is `SPEC.md`. Continues the runtime-confinement line
(`fundamental-fixes-followup-{3,4}.md`). Fixes the round-9 findings (`plans/claude-bugz-30.md` B1–B4,
`plans/claude-papercuts-28.md` P1–P2), all reproduced under `KOVO_PARANOID=1` with a served exploit.

## 1. Why this plan exists (round-9 diagnosis)

followup-4 moved **confidentiality** and **read-only/write-scope** to sound runtime chokes — correct — but round-9
showed a whole property class was left behind, and the new registry formalized it:

1. **Authorization (IDOR) is static-only.** KV414 "owner-table access is scoped to a session principal" is classified
   `build-only` in the registry (`packages/core/src/internal/security-markers.ts:73-77`); there is **no runtime
   owner/principal choke** (`managed-db.ts` has zero owner enforcement). The blessed `sql` primitive — a first-class,
   KV422-stamped parameterized read (NOT an escape hatch) — is invisible to the static Drizzle-shape model, so
   `db.all(sql`SELECT … FROM orders WHERE id=${id}`)` serves **another user's private row** on a green paranoid build
   (`bugz-30` B1). The same static-blindness cascades to projection/invalidation/coverage (KV439/407/408/410 —
   `bugz-30` B2).
2. **The registry has no invariant that a value/effect property must be runtime-enforced** — the drift guard checks
   "every code has an entry," not "every request-state property is runtime-choke." So mis-classifying IDOR as
   `build-only` looked like a decision, not a bug (`papercuts-28` P2).
3. **`by-construction` was asserted, not proven** — KV438 mass-assignment is stubbed under paranoid on the promise of a
   runtime floor that doesn't exist (`bugz-30` B4).
4. **The provenance box still fails both ways** — under-boxes a UNION-arm secret (`bugz-30` B3) and over-boxes plain
   aggregates over non-secret tables (`papercuts-28` P1).

The through-line: **moving a property to a runtime choke makes it sound — but only for the properties you actually
move.** Authorization was never moved. This plan moves it, adds the invariant that would have caught the omission,
proves the by-construction floor, completes the box, and narrow-waists raw SQL so the read's _table_ can never hide.

## 2. Meta-invariants (extend followup-4)

- **C1 — Authorization is a runtime value property, enforced on the PROVEN principal, channel-agnostic, for READS AND
  WRITES.** A read OR write of a `kovo({owner})` table is confined to the request principal's rows by the engine/handle
  regardless of query shape (builder, raw SQL, view, join, compound, subquery) — never by static analysis alone.
  Mirrors confidentiality (secret box / column-`REVOKE`). "Channel-agnostic" is load-bearing: it must hold for every
  principal-bearing ingress, not only the loader read.
- **C2 — A registry code whose property depends on RUNTIME REQUEST STATE (principal, row values, request input) must
  be `runtime-choke` (or `by-construction` with a proven floor, C3); `build-only` is permitted ONLY for properties
  decidable from the static build artifact alone** (e.g. "a server-only value is captured into the client bundle" —
  KV437 — a compile-time fact independent of any request). A test enforces this.
- **C3 — `by-construction` requires a PROVEN runtime floor**, not an assertion: a paranoid test that the property holds
  with static stubbed. Absent the floor, the code is `runtime-choke` and must build the floor.
- **C4 — The read's table set is statically known (builder `.from()`) or explicitly declared (escape); FROM-hiding raw
  SQL is forbidden.** Raw `sql` as an _expression_ over a known table is fine; raw SQL that _supplies_ the table is not.
- **C5 — The provenance box is complete both ways**: fail closed on compound selects; box only values that could
  derive from a secret column. No leak (UNION), no over-block (aggregate).
- **C6 — Owner-scoping covers every ingress and every owned table.** Authorization holds on the request loader read/
  write AND on endpoints, durable tasks, and webhooks (via an explicit `actAs`/`declareSystem` principal seam, DEC-G/H),
  and on transitively-owned child tables (via declared `ownerVia`, DEC-I) — not only the directly-annotated table read
  in a `query()` loader. An owner-bearing path with no principal fails closed (zero rows), loudly in dev.
- **C7 — Every request-reachable table is classified; unclassified fails closed (DEC-K).** No table with
  request-reachable data is silently un-scoped: each is `owned`/`ownedVia`/`authzPolicy`/`public`/`reference` by
  explicit declaration, checked at build AND denied at runtime if unclassified. The guarantee Kovo makes is
  **owner-scoping**; richer authz is author-supplied on the substrate (DEC-J), and the census ensures nothing falls
  through the gap.

## 3. Decisions register (made here; no deferral)

- **DEC-A — Runtime authorization choke on the proven principal, for READS AND WRITES, per-dialect.** A read OR write
  of a `kovo({owner})` table is confined to the request principal's rows at runtime.
  - **The principal is `session.user.id` (the owner-column domain), NOT the session id.** `provenPrincipalFromRequest`
    returns `session.id` first (`auth-principal.ts:40`) while ownership keys on `session.user.id` (the `owns` audit
    default, `guards.ts:598`); feeding RLS the session id matches ZERO rows for the legitimate owner — fail-closed but
    _broken_, and a "cross-owner returns zero rows" test would pass while silently breaking every owner's own reads. Pin
    `kovo.principal` to the owner-column domain; the acceptance MUST verify the owner sees THEIR OWN rows, not merely
    that cross-owner returns zero. Anonymous/unproven ⇒ leave `kovo.principal` **unset** (so `current_setting('kovo.
principal', true)` is SQL NULL ⇒ no rows) — NEVER set it to `''` (an `owner_col = ''` row would leak).
  - **Postgres/PGlite (engine = RLS, reads AND writes).** On each owner table:
    `USING (<owner_col> = current_setting('kovo.principal', true)) WITH CHECK (<owner_col> = current_setting(…))` —
    `USING` filters SELECT/UPDATE/DELETE visibility; **`WITH CHECK` validates the NEW row** so a forged-owner INSERT or
    an owner-reassigning UPDATE is rejected (both verified on PGlite). `SET LOCAL kovo.principal` runs on BOTH the read
    AND the write transaction under the non-superuser `kovo_reader`/writer role (must NOT have `BYPASSRLS`).
  - **PGlite confinement invariant (load-bearing — verified):** PGlite's `session_user` is _always_ the bootstrap
    superuser, so `SET LOCAL ROLE kovo_reader` is a _reversible_ layer — `RESET ROLE` / `set_config('role','postgres',
false)` re-escalate and bypass RLS from within SQL text. Therefore every owner read/write MUST execute as a
    **single statement via the extended/prepared protocol** (`db.query`/parameterized — NEVER `db.exec`/simple-query),
    inside its own `BEGIN; SET LOCAL ROLE …; SET LOCAL kovo.principal = $p; <stmt>; COMMIT`. The extended protocol
    structurally rejects appended `; RESET ROLE` text, and role/GUC are fixed at statement start (an in-CTE
    `set_config` does NOT retro-bypass — verified). Anti-escalation regression tests: `set_config('role','postgres',…)`
    then a read must not widen; an appended `; RESET ROLE; SELECT …` is rejected; `set_config('kovo.principal','B',…)`
    cannot re-scope. Use `SET LOCAL` only — a non-`LOCAL` `SET` leaks across pooled transactions (verified).
  - **SQLite (framework = predicate binding, reads AND writes).** No RLS; the managed handle scopes the builder path
    (which DEC-C makes the only path that supplies an owner table):
    - Inject `<owner_col> = <principal>` via **`config.where = and(existingWhere, pred)`** — NEVER the public `.where()`
      (it REPLACES the user's predicate and would widen results — verified).
    - Resolve owner-table identity via **`Symbol.for('drizzle:OriginalName')`/`BaseName`, NOT `getTableConfig().name`**
      (which returns the ALIAS — an aliased owner table would silently escape scoping = IDOR).
    - **Recurse** at every nesting level — `config.table` (recurse if a `Subquery`), every `config.joins[].table`, and
      every `config.setOperators[].rightSelect` (compound arms). The base `config.where` does NOT reach nested arms /
      subqueries; an un-recursed compound or subquery-in-FROM read of an owner table ships **UNSCOPED**. Any level the
      handle cannot introspect ⇒ **fail closed**. (Post-read row-drop is defense-in-depth only when the owner column is
      in the result — it cannot scope aggregates or projections that omit the owner column — never the primary.)
    - **Writes:** the declared-write authorizer injects/validates the owner predicate on a builder write and **fails
      closed** on a raw-SQL write it cannot owner-check.
    - **Pin `drizzle-orm`** (`config.*` is an unstable internal contract) + an **emitted-SQL conformance test** across
      flat/join/alias/compound/subquery-from shapes, so a Drizzle upgrade that drops the predicate fails loudly, not
      silently (silent = IDOR).
  - **Escape — SCOPED, audited, distinct from `trustedSql` (DEC-F).** `declarePublicRead({ reason, rows?, columns? })`:
    `rows` narrows to a public predicate (e.g. published-only) instead of a whole-table de-scope; `columns` limits
    exposure (partial public profile). The bypass path (PG: a policy-exemption role; SQLite: injection skipped) is
    **read-only, column-`REVOKE`-bound, has NO `BYPASSRLS`**, is `SET LOCAL ROLE`-scoped to the single read and reset
    after, and is audited per use. Author-misuse is a stated non-goal (§6).
  - **The principal is only as proven as the app's `SessionProvider`** (Kovo delegates verification to it — Better
    Auth) — a stated trust-boundary non-goal (§6); source `kovo.principal` from a framework-owned normalization, not
    raw app session shape.
  - **Declaration vs enforcement (coherence with the existing `owns` guard).** The `kovo({owner})` annotation is the
    single DECLARATION; the RLS policy / predicate injection is the ENFORCEMENT. Kovo's existing `owns` guard
    (`guards.ts:598`) is **subsumed**: the same annotation generates both the (now-advisory, build-time) static owns
    check AND the runtime policy from one source, so they cannot diverge and there is no double-enforcement. The
    reclassification of KV414 → runtime-choke means the `owns` static check becomes advisory; the RLS/predicate is the
    boundary.
  - Reclassify **KV414 → `runtime-choke`** (DEC-B).
- **DEC-B — Registry invariant, with a SOUND mechanical half + an honestly-labeled reviewed half (C2).** Two axes the
  registry conflates must be separated: **enforcement-timing** (`enforcement`) vs **property-decidability** — KV429 is
  decided at build (did the mutation call `compareAndSet`) but _guaranteed_ at runtime, so they differ. Add a field
  `propertyDependsOn: 'build-artifact' | 'request-state' | 'concurrency'` distinct from `enforcement`.
  - **Sound, mechanical, no new judgment — add now:** any entry with a `chokeId` MUST be `runtime-choke` (or
    `by-construction` with a named floor). A chokeId names a live runtime decision, so a `build-only` entry carrying one
    is a contradiction. This is the converse of the existing `security-markers.test.ts:77-100` forward check and
    **catches KV415 today** — `build-only` yet carrying `chokeId: 'server.response.emit-to-wire'` (the same choke KV435
    uses; header names/values derive from request input at `response-posture.ts:239`). **Resolve KV415 → runtime-choke.**
  - **Reviewed, NOT derivable — admit it:** `propertyDependsOn !== 'build-artifact' ⇒ enforcement !== 'build-only'` is a
    real invariant, but "depends on request state" cannot be derived from prose/structure — it is a **reviewed
    hand-label** that prevents _drift_, not _mislabeling_. State this honestly (do not sell C2 as a soundness proof it
    can't be). Require a machine-checked **rationale string** on every `build-only` entry ("why decidable from the build
    artifact alone"), greppable and reviewable.
  - **Re-audit EVERY `build-only` code** (not the eight below): resolve **KV431** ("request/response protocol trust
    boundaries" — request-state-flavored, `build-only`, with **zero enforcement sites**) → give it a real enforcement
    site + honest class, or delete it. KV418/KV419 are session-adjacent and need an explicit rationale.
  - Confirmed classifications: `KV414` → **runtime-choke** (DEC-A); `KV429` → `concurrency`/`by-construction` (a real CAS
    floor exists, `drizzle/src/cas.ts` `StaleVersionError`); `KV430`/`KV437` → `build-artifact` (`build-only` correct).
    `KV407`/`KV408`/`KV410`/`KV439` stay `build-artifact` **but conditionally on DEC-C** — reference a self-guard test
    asserting DEC-C's read-set-visibility holds, so if the narrow-waist regresses their soundness fails loudly.
    Tests: the `chokeId ⇒ runtime-choke` converse; `propertyDependsOn !== 'build-artifact' ⇒ enforcement !== 'build-only'`;
    every `build-only` entry has a rationale; every classifier-emitted code has an entry (drift guard).
- **DEC-C — Raw-SQL narrow-waist: the read's table set must be statically known or explicitly declared; no FROM-hiding
  raw SQL** (completes followup-4 DEC-L, which the blessed `.all(sql)` path evaded — `managed-db.ts:129`
  `PARSED_READ_SQL_METHODS`). Three tiers:
  1. **Builder owns the FROM/table binding (default, unrestricted).** A read's table(s) come from `.from()`/`.join()`.
     Raw `sql` is allowed as an **expression inside** such a query (projection / WHERE fragment) — the table provenance
     is the builder's and the projection is boxed (confidentiality). **BUT a raw expression must NOT contain a
     sub-`SELECT`/`FROM`** (lexically reject `select`/`from` inside expression chunks — extends `sqlStringChunkIsInert`,
     `secret-read-boundary.ts:514`): a subquery smuggles a FROM the static read-set can't see and the SQLite predicate
     injection can't scope (`db.select({x: sql\`(SELECT balance FROM accounts WHERE owner*id=${id})\`}).from(orders)`→`accounts` unscoped → cross-owner leak through the \_allowed* channel). On Postgres RLS still confines the subquery
     (storage-layer, blind to text); on SQLite it does NOT, so SQLite additionally **rejects FROM-bearing raw
     expressions** (or fails closed). Covers the ~95% common case with no new friction.
  2. **FROM-source raw SQL is removed via a STRICT READ ALLOWLIST — not by deleting names.** The read-handle proxy
     currently fails OPEN: `managed-db.ts:543` binds any function that is `prop in target`, so removing the raw-read
     methods from `PARSED_READ_SQL_METHODS` is insufficient (`all/get/values/run/exec/execute/sql/prepare` still bind
     because they are `in target`). Flip it to a strict enumerated allowlist — expose ONLY the known builder entries
     (`select`, `selectDistinct`, `with`, `$with`, `$count`, and the relational `query` _namespace_) and deny
     everything else (the sole-door principle: a FROM-source raw read is unrepresentable through the handle). Builder
     terminals (`select().from().all()`) are unaffected — they live on the returned builder, a different receiver.
     **`query` is overloaded** — relational `db.query.users.findMany` (safe) vs raw `db.query(text)` FROM-source on pg
     (`guards.test.ts:270`); wrap it to expose only the namespace and reject the raw-callable form. Bigger breaking
     radius than "delete 8 names," and it makes `rawRead` (tier 3) the sole raw path. Closes `bugz-30` B1/B2.
  3. **Genuine complex queries use a DECLARED escape** — `rawRead(sql`WITH RECURSIVE …`, { reads: ['orders'] })`. Static
     uses the _declaration_ for authz/coverage. The runtime mechanism is per-dialect:
     - **SQLite: a `SQLITE_READ` authorizer** (the infra already exists for write-deny at `managed-db.ts:265`). It fires
       per column-access for EVERY table (WHERE/subquery/CTE/view/trigger), giving a **complete** observed set → sound
       `observed ⊆ declared` (fixes the coverage cross-check — `.columns()` is dropped as the mechanism; it under-reports
       WHERE/subquery reads and would make the check vacuous), AND it **denies an owner-table read inside a `rawRead`**
       unless the rawRead carries an `actAs`/`declarePublicRead` scope (resolving the DEC-C↔DEC-A contradiction — a
       SQLite rawRead over an owner table has no injection path, so it fails closed at the authorizer).
     - **Postgres: RLS confines the `rawRead` regardless of declaration** (storage-layer authz — sound). But PG has NO
       per-statement read-table observation, so **`observed ⊆ declared` is a build-time-only best effort**; an
       under-declared `reads:` causes _invalidation staleness_, not a leak, and is a stated author-responsibility
       non-goal (§6).

  **"Builder owns the FROM" does NOT flatten the table set** — the builder itself nests owner tables via subquery-in-FROM
  and compound `setOperators` arms that the top-level analysis and SQLite injection can't reach; DEC-A recurses into
  them or fails closed, and tier-1 forbids a sub-`SELECT` inside a raw expression. Together these close the
  smuggled-FROM channel; without them the narrow-waist's "the table can never hide" claim is false.

- **DEC-D — KV438 gets a PROVEN runtime floor before it may be `by-construction`+stubbed (C3).** The write path refuses
  (or drops) a governed-column write sourced from a client-supplied field, at runtime, independent of the static
  KV438 check. Only with that floor proven (a paranoid test that a client field cannot write a governed column with
  static stubbed) may KV438 remain `by-construction` + `paranoidAdvisory`; otherwise it is `runtime-choke`.
- **DEC-E — Provenance-box completeness (C5). Verified empirically on better-sqlite3 12.11.1.**
  - **Compound selects: fail closed, and detect BEFORE trusting per-column origin.** `UNION`/`UNION ALL` report
    **left-arm origin only** — a secret in a later arm is falsely attributed to a benign table (`users.id`) → **leak**;
    `INTERSECT`/`EXCEPT` **null all origin** (already fall into the opaque path). Both must fail closed, for different
    reasons — document the asymmetry. The current bug is ORDERING: `secret-read-boundary.ts:234-247` does `continue` on
    any concrete origin _before_ the secret-table/opaque check, so UNION's benign left-arm origin skips boxing. **Gate
    compound detection ahead of that `continue`** — builder: `config.setOperators.length > 0`; raw text: a
    token-boundary `UNION|INTERSECT|EXCEPT` scan — and box the whole compound unless every arm's origin is proven
    non-secret (which origin can never prove for UNION).
  - **Over-box fix (`secret-read-boundary.ts:244-245`).** Every aggregate/expression nulls origin (verified:
    `count(*)`, `group_concat`, `max`, `CAST`, `CASE`, `||`), so origin can never serve them — the decision must rest on
    **`referencesSecretTable` + proven-non-secret inputs**. Box an opaque expression only when its query references a
    secret-bearing table; `count(*)` / `sum(<non-secret>)` over a non-secret table serves. (Views/CTEs/aliases/scalar
    subqueries ARE origin-transparent — verified — so the common boxable reads stay correct.)
- **DEC-F — Three orthogonal axes; do not conflate.** `trustedSql` = SQL-injection safety (KV422). `declarePublicRead` /
  admin capability = authorization (KV414). `reveal` / `declareSecretReadCapability` = confidentiality (KV435). A read
  may need zero, one, or several; each is its own explicit, audited act. Narrow-waisting raw SQL (DEC-C) is about
  analyzability of the _table_, not about any of these audits.
- **DEC-G — Non-request contexts get an explicit `actAs` / `declareSystem` principal seam (B6).** A durable task or
  webhook has no request principal → `kovo.principal` is unset → owner reads return zero rows (`task-runtime.ts:213`,
  runQuery on the managed handle `:117-138`; webhook session-free `webhook.ts:450`, managed write `:885`). Ambient
  system authority (a BYPASSRLS role) is rejected — one task bug would read/write all owners. Instead:
  - `ctx.actAs(principalId).runQuery/​runMutation(…)` sets `SET LOCAL kovo.principal = principalId` for that scoped op,
    so background work is still owner-scoped to an explicitly chosen, **audited** principal. A `principal` field is
    added to the task/webhook hook options (absent today, `task-runtime.ts:100-130`).
  - `ctx.declareSystemRead/Write(reason, fn)` — the audited cross-owner escape for genuine system work (enumerate
    users, analytics), read-only where possible, using the locked (no-BYPASSRLS-escalation) bypass role.
  - **Default fail-closed with a LOUD dev diagnostic:** an owner-table access in a task/webhook with neither `actAs`
    nor `declareSystem` errors in dev ("owner-table access without `actAs`/`declareSystem`") so authors add the seam
    rather than silently ship a no-op. A **webhook owner MUST be derived + validated** (look up the customer → the
    user), never taken raw from the payload into an unscoped write.
- **DEC-H — Every principal-bearing ingress is scoped, not just the loader read (B7).** `endpoint()` handlers get no
  framework db (`endpoint.ts:87`, db forbidden on the endpoint surface `response-posture.ts:513`), so an author who
  imports a raw handle bypasses RLS/predicate/secret-box (on SQLite = direct read+write IDOR). Three layers:
  - **Connection-level RLS is the default on Postgres** — the non-`BYPASSRLS` role is the ONLY DB role the whole app
    ever uses (loaders, endpoints, tasks), and `kovo.principal` is set at the dispatch boundary for every surface. RLS
    then binds even a raw-imported handle (defense in depth); an endpoint that sets no principal reads zero rows.
  - **Endpoints opt into a principal-carrying managed handle** (`endpoint({ db: true }, (req, { db, actAs }) => …)`)
    and use `actAs` with their own derived principal (endpoints do their own auth; there is no session to inherit).
  - **A sole-door lint** (followup-3 DEC-J) flags app code importing the raw driver/connection outside the framework —
    the only defense on SQLite, which has no connection-level enforcement. The residual (an endpoint that imports a raw
    SQLite connection anyway) is "author's own server code," but the lint makes it loud.
- **DEC-I — Transitive ownership via a declared `ownerVia` FK path (B8).** Ownership is one annotated column per table
  (`derivation.ts:1089-1092`); a child owned via FK (`order_items → orders`) with no own owner column gets no RLS
  policy and no injectable predicate → direct cross-owner read. Declare the path —
  `kovo({ ownerVia: { parent: orders, fk: 'orderId', parentKey: 'id' } })` — generating an EXISTS policy on Postgres
  (`USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.user_id = current_setting('kovo.
principal', true)))`) and an IN-subquery predicate on SQLite (framework-generated, so exempt from the tier-1
  no-sub-`SELECT` rule). Plus an **advisory build detector** for the forgotten annotation ("FK-reachable from an owner
  table but declares no scope"). Documented residual: a new child table without `ownerVia` is unscoped until annotated
  (default-deny on ALL tables is wrong — most tables are reference/config data); perf: EXISTS/IN adds a correlated
  subquery per owner check, compounding on deep FK chains.
- **DEC-J — Kovo GUARANTEES owner-scoping; richer authorization (sharing/roles/teams) is author-supplied on Kovo's
  substrate (scope decision — option 1a).** Kovo auto-generates and guarantees the single-owner pattern from
  `kovo({owner})`/`ownerVia` (reads+writes, all shapes/ingress, runtime-enforced). It does NOT infer sharing/role/team
  semantics from the schema. Those are author-supplied AGAINST the sound substrate Kovo already provides (the proven
  `current_setting('kovo.principal')` + the engine boundary):
  - **Postgres:** a custom RLS policy the author writes (e.g. `owner_id = current_setting('kovo.principal') OR EXISTS
(SELECT 1 FROM document_shares s WHERE s.document_id = documents.id AND s.user_id = current_setting('kovo.
principal'))`). It runs at the SAME engine boundary with the SAME principal → sound and channel-agnostic, like
    owner-scoping. Declared via `kovo({ authzPolicy: sql\`…\` })` so the census (DEC-K) sees the table as classified.
  - **SQLite:** no RLS, so richer authz is an app **guard** (`guard: ({ principal }) => canAccess(principal, row)`) —
    runtime guard code with the honest caveat that a guard has the raw-SQL static-blindness we've fought all arc, so
    SQLite complex authz is weaker than PG's engine-enforced form. The default (owner column present or table
    classified) still fails closed via the `SQLITE_READ` authorizer, so a forgotten custom check fails closed, not open.
  - **Boundary statement (goes in `SECURITY.md`):** "Kovo guarantees owner-scoping; relationship/role/team
    authorization is author-supplied (custom RLS on Postgres, guards elsewhere). Kovo provides the proven principal and
    the engine enforcement layer; it does not infer sharing semantics." An incorrect author policy (too permissive) is
    the author's responsibility — reviewable, like a wrong `WHERE` (a stated non-goal, §6). (A first-class declarative
    `authz` DSL — option 1b — is explicitly future work, not this plan.)
- **DEC-K — The authorization census: EVERY request-reachable table is explicitly classified, or the build fails AND
  the runtime denies it (#2 — the round-9 lesson applied to the author's config).** Forgetting to annotate a table is a
  silent IDOR. A build gate requires every table reachable from a request surface (loader / endpoint / mutation / task /
  webhook read/write) to carry exactly one classification: `owned` (`kovo({owner})`), `ownedVia` (transitive, DEC-I),
  `authzPolicy` (author custom, DEC-J), `public` (an explicit public-read policy/predicate), or `reference` (no
  request-writable/user data; world-readable — declared, not inferred). An **unclassified** request-reachable table
  fails the build; and at RUNTIME the managed handle **denies** a read/write of an unclassified table (fail-closed), so
  a census gap cannot leak even if the build gate is bypassed (paranoid mode). This is the authorization analogue of the
  confidentiality census; its denominator is derived from the schema × the reachable-table graph (source-derived, per
  followup-4 DEC-D discipline — not a hand-list).

## 4. Phases (each leaf a single commit; every acceptance runs under FULL paranoid mode)

### Phase 0 — Registry invariant FIRST (the forcing function)

- [x] **0.1 Registry invariant + re-audit (DEC-B, C2).** Add: the mechanical `chokeId ⇒ runtime-choke` converse test
      (immediately flags **KV415 → runtime-choke**); the `propertyDependsOn` field + `!== 'build-artifact' ⇒ !== build-only`
      test; a required rationale string on every `build-only` entry. Reclassify KV414 → `runtime-choke`, KV429 →
      concurrency/by-construction, KV415 → runtime-choke; resolve **KV431** (enforce or delete); document KV407/408/410/439
      as build-artifact _with a DEC-C self-guard reference_, KV430/437 as build-artifact. Re-audit ALL build-only codes.
      Landing this makes the paranoid acceptance RED on `bugz-30` B1/B4 until DEC-A/D exist — the forcing function.
  - Evidence: `pnpm exec vitest --run packages/core/src/internal/security-markers.test.ts` and `pnpm run check:vp` passed
    after merging `agent/ff5-phase-0-1-registry-20260703`; `SECURITY_CODE_REGISTRY` now carries `propertyDependsOn`,
    build-only rationales, KV414/KV415 runtime-choke, KV429 concurrency/by-construction, and the drift tests.
- [ ] **0.2 Authorization census gate (DEC-K, C7).** A build gate (source-derived denominator = schema ×
      reachable-table graph) that fails unless EVERY request-reachable table is classified
      `owned`/`ownedVia`/`authzPolicy`/`public`/`reference`; plus a runtime deny of an unclassified table on the managed
      handle. Landing this makes the build RED on every currently-unannotated request-reachable table — the second forcing
      function (nothing ships until every table's authorization is a declared decision). A planted unclassified-table
      canary must fail the gate.
  - [x] Static/build census gate: `pnpm vitest --run packages/drizzle/src/authz-census-static.test.ts packages/server/src/vite-data-plane-gate.test.ts packages/drizzle/src/static-analysis-context.test.ts packages/server/src/internal/data-plane-static-analysis.test.ts` passed; the Drizzle aggregate now derives request-reachable tables from schema facts plus query/write graph facts and fails KV414 unless each reachable table has exactly one DEC-K classification.
  - [ ] Runtime managed-handle deny remains open beyond SQLite: `pnpm exec vitest --run packages/server/src/sqlite-authz.test.ts` proves the SQLite managed handle returns zero rows for an unclassified table; a precise Postgres/PGlite runtime denominator that does not over-deny internal/auth tables is still under implementation.

### Phase 1 — Runtime authorization choke

- [x] **1.0 Remaining feasibility gates (DEC-A) — the platform basics are VERIFIED (PGlite RLS incl. `WITH CHECK`
      writes/joins; SQLite flat-read `config.where` injection).** Confirm the load-bearing residuals: the single-statement
      extended-protocol read/write path is enforceable; SQLite injection recursion into compound/subquery + alias
      resolution via `drizzle:OriginalName`; the pinned-Drizzle emitted-SQL conformance harness. **The principal is set via
      parameterized `SELECT set_config('kovo.principal', $1, true)`, NEVER `SET LOCAL kovo.principal = <interpolated>`**
      (`SET` takes no bind params, so string-building is a SQL-injection vector into the SET statement; `set_config` is a
      parameterizable function and its separate extended-protocol call is compatible with the confinement invariant).
  - Evidence: `pnpm exec vitest --run packages/server/src/authz-feasibility.test.ts` exercises real PGlite RLS with
    parameterized `set_config`, prepared-statement rejection of appended `RESET ROLE`, blocked in-statement
    `set_config('role', ...)` / `set_config('kovo.principal', 'B', ...)`, `WITH CHECK` write rejection, and pinned
    Drizzle emitted SQL for flat/join/alias/compound SQLite predicate injection. The probe also records the required PG
    hardening: set `kovo.principal` before `SET LOCAL ROLE` and revoke `pg_catalog.set_config(text,text,boolean)` from
    the app role; role-then-principal while the app role can call `set_config` is unsafe. Drizzle subquery-FROM exposes
    owner tables through `Subquery._.usedTables`/SQL chunks but not a mutable inner select config, so the feasible
    behavior is fail-closed unless the runtime retains the inner builder.
- [x] **1.0b Feasibility probe (throwaway worktree, before committing DEC-H/DEC-I).** Empirically confirm, on real
      PGlite + better-sqlite3: (a) **DEC-H** — setting the default connection to the non-`BYPASSRLS` role + `kovo.principal`
      at dispatch actually binds RLS for a handle imported OUTSIDE the managed wrapper (connection-level default), or it
      doesn't and the fallback is force-the-managed-handle + lint; (b) **DEC-I** — a generated `ownerVia` `EXISTS` policy
      filters a direct child-table read on PG, and the SQLite `IN`-subquery predicate composes with the DEC-A
      compound/subquery recursion without a hole; (c) the `EXISTS`/`IN` overhead on a seeded dataset is bounded with an
      owner-column index. Record; if a mechanism is infeasible, its documented fallback is used. (Every prior "obvious"
      assumption this round had a footgun — session.id, `SET ROLE` reversibility, `.where()` replacing — so probe before code.)
  - Evidence: `pnpm exec vitest --run packages/server/src/authz-feasibility.test.ts` uses the raw PGlite handle inside
    the dispatch-scoped role/principal transaction to prove connection-level RLS, filters direct `order_items` reads via
    a PG `EXISTS` ownerVia policy, filters SQLite direct/compound/subquery child reads via the generated `IN` predicate,
    and asserts PG/SQLite explain plans use the seeded owner-path indexes (`orders_user_id_id_idx`,
    `order_items_order_id_idx`).
- [x] **1.1 Postgres RLS owner-scoping, reads AND writes (DEC-A).** Per owner table `USING(…) WITH CHECK(…)`;
      `SET LOCAL kovo.principal = <session.user.id>` on the read AND write transaction under the non-BYPASSRLS role, each as
      a single extended-protocol statement. Acceptance (full paranoid): `bugz-30` B1's raw-SQL cross-owner read returns
      **zero rows**; **the owner sees THEIR OWN rows** (principal = user.id, not session.id); a cross-owner UPDATE/DELETE
      touches zero rows and a forged-owner/owner-reassigning INSERT/UPDATE is rejected (`WITH CHECK`); anonymous ⇒ zero
      rows (unset, not empty); the **anti-escalation** cases (`set_config('role',…)`, appended `; RESET ROLE`,
      `set_config('kovo.principal','B')`) do not widen.
  - Evidence: `pnpm exec vitest --run packages/server/src/postgres-authz.test.ts` passed; it proves owner sees own rows, cross-owner and anonymous reads return zero, update/delete are confined, forged insert/owner reassignment fail `WITH CHECK`, SQL text cannot widen principal/role, ownerVia child RLS works, and declared `rawRead` remains RLS-scoped.
- [x] **1.2 SQLite predicate binding, reads AND writes (DEC-A).** Inject via `config.where = and(…)` (never `.where()`);
      resolve owner tables via `drizzle:OriginalName`; **recurse** into `setOperators`/subquery-FROM or fail closed; writes
      fail closed when un-owner-checkable; row-drop backstop only when the owner col is present. Acceptance (full paranoid):
      cross-owner read/UPDATE/DELETE return/touch zero rows; owner sees own rows; an **aliased** owner table is scoped; a
      **compound/subquery-FROM** owner read is scoped or fail-closed; the emitted-SQL conformance test passes.
  - Evidence: `pnpm exec vitest --run packages/server/src/sqlite-authz.test.ts` passed; it proves owner and anonymous read scoping, alias/original-name scoping, compound recursion, subquery-FROM fail-closed behavior, owner update/delete confinement, owner-column reassignment denial, owner-table insert denial, ownerVia `IN` scoping, raw owner SQL denial, and unclassified-table zero rows.
- [ ] **1.3 Scoped `declarePublicRead({reason, rows?, columns?})` + KV414 → runtime-choke (DEC-A/F).** `rows`/`columns`
      scope partial exposure (not whole-table de-scope); the bypass path is read-only, column-`REVOKE`-bound, no
      `BYPASSRLS`, `SET LOCAL ROLE`-scoped + reset, audited. Reclassify KV414. Acceptance: a scoped public read serves only
      the declared rows/columns; the escape emits an audit record; without it, owner-scoping holds; the bypass role cannot
      write or read secret columns.
  - Partial evidence: `pnpm exec vitest --run packages/server/src/managed-db.test.ts packages/server/src/api/app.test.ts` passed in the integrated focus run; `declarePublicRead` validates non-empty reason/rows/columns metadata, allows SQLite owner rawRead only with an explicit public-read declaration, records `drainPublicReadAuditFacts()`, and is exported with API-surface baseline unchanged.
  - Remaining gap: the current implementation is audit-grade and matches SPEC.md §10.3's recorded-public-read suppression, but the plan's stronger row/column SQL-enforcement and bypass-role/secret-column acceptance is not proven.
- [x] **1.4 `actAs` / `declareSystem` principal seam for tasks + webhooks (DEC-G).** Add the `principal` field to the
      task/webhook hooks; `actAs(id)` sets `kovo.principal` for a scoped op; `declareSystemRead/Write(reason)` is the
      audited cross-owner escape; owner access without either fails closed with a loud dev diagnostic. Acceptance (full
      paranoid): a task reading an owner table without `actAs` reads zero rows + dev-errors; `actAs(u)` scopes to `u`; a
      webhook write with a payload-supplied owner (no derive+validate) is refused/unscoped-denied.
  - Evidence: `pnpm exec vitest --run packages/server/src/auth-principal.test.ts packages/server/src/task.test.ts packages/server/src/task-runner.test.ts packages/server/src/task-runtime.test.ts packages/server/src/webhook.test.ts` passed; it proves branded non-request principal postures, task fail-closed/dev diagnostic without `actAs`, task `actAs`/system posture threading, webhook `actAs`, payload-owner refusal, and direct tx denial without posture.
- [x] **1.5 Every ingress scoped: connection-level RLS default + endpoint handle + sole-door lint (DEC-H).** PG: the
      non-`BYPASSRLS` role is the default connection, principal set at dispatch for all surfaces. Endpoints opt into a
      principal-carrying managed handle + `actAs`. A sole-door lint flags raw driver imports. Acceptance (full paranoid):
      a raw-import endpoint read of an owner table is scoped (PG connection RLS) or lint-flagged (SQLite); an opt-in
      endpoint handle is `actAs`-scoped.
  - Evidence: `pnpm exec vitest --run packages/server/src/app-dispatch.test.ts packages/server/src/endpoint.test.ts packages/drizzle/src/sql-safety-static.test.ts` passed; endpoint handlers stay session-free by default, `endpoint({ db: true })` exposes only `ctx.actAs(id)` managed read/write handles, the provider receives a framework-minted endpoint principal posture, and endpoint modules importing raw DB drivers emit KV414.
- [x] **1.6 Transitive ownership via `ownerVia` (DEC-I).** Generate EXISTS policies (PG) / IN-subquery predicates
      (SQLite) for FK-owned child tables; advisory detector for unscoped FK-reachable tables. Acceptance (full paranoid):
      a direct cross-owner read of `order_items` (owned via `orders`) returns zero rows; the detector flags an unannotated
      FK-reachable table.
  - Evidence: `pnpm exec vitest --run packages/server/src/postgres-authz.test.ts packages/server/src/sqlite-authz.test.ts packages/drizzle/src/authz-census-static.test.ts` passed; Postgres `EXISTS` ownerVia policy and SQLite `IN` predicate both confine direct child reads, and the static census flags a request-reachable FK child table missing `ownerVia`.

### Phase 2 — Raw-SQL narrow-waist

- [x] **2.1 Strict read allowlist; builder owns the table binding; tier-1 sub-`SELECT` reject (DEC-C, C4).** Flip the
      read-handle proxy (`managed-db.ts:543`) from `prop in target` fail-open to a strict enumerated builder allowlist
      (deny `all/get/values/run/exec/execute/sql/prepare`; expose only `select`/`with`/`$count`/relational `query`
      namespace, deny raw `query(text)`); reject a sub-`SELECT`/`FROM` inside a raw expression chunk. Acceptance (full
      paranoid): `db.all(sql`…FROM orders…`)`, `db.query('select …')`, and `sql\`(SELECT … FROM accounts)\``in a
projection are all rejected;`db.select({x: sql`upper(name)`}).from(orders)` builds, owner-scoped + boxed.
  - Evidence: `pnpm exec vitest --run packages/server/src/managed-db.test.ts packages/server/src/secret-read-boundary.test.ts packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts` passed; covers the strict read allowlist/raw `query(text)` denial, focused `SELECT`/`FROM` raw-expression refusal, and served `/api/sqlite-secret-hidden-builder-expression` rejection plus `/api/sqlite-secret-safe-builder-expression` success. `git diff --check` and `pnpm run check:vp` passed.
- [x] **2.2 Declared `rawRead(sql, { reads })`: SQLite `SQLITE_READ` authorizer; PG RLS + coverage non-goal (DEC-C).**
      SQLite installs a read authorizer for a complete observed set (`observed ⊆ declared`) AND denies an owner-table read
      in a `rawRead` lacking `actAs`/`declarePublicRead`; drop `.columns()` as the cross-check. PG: RLS confines the
      `rawRead` (authz); coverage is build-time best-effort + a stated non-goal. Acceptance: a SQLite `rawRead` over an
      owner table without scope is denied; an under-declared `rawRead` on SQLite fails the observed-set check; on PG the
      same `rawRead` is RLS-scoped regardless of declaration.
  - Evidence: `pnpm exec vitest --run packages/server/src/managed-db.test.ts packages/server/src/postgres-authz.test.ts` passed; covers SQLite observed-set `observed ⊆ declared`, owner-table rawRead denial without `actAs`/`declarePublicRead`, declared public rawRead audit facts, and Postgres declared rawRead remaining RLS-scoped regardless of declaration breadth.

### Phase 3 — KV438 runtime floor

- [x] **3.1 Governed-column write floor at runtime (DEC-D, C3).** A client-field-sourced write to a governed column is
      refused/dropped at runtime with static KV438 stubbed. Acceptance (full paranoid): `bugz-30` B4's governed-column
      mass-assignment is refused; a legit declared write succeeds. Only then keep KV438 `by-construction`+stubbed.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/runtime-metadata.test.ts packages/server/src/request-input-provenance.test.ts packages/server/src/managed-db.test.ts packages/create-kovo/src/index.test.ts packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts` passed; covers schema-derived governed metadata, exact parsed-input rejection for managed Drizzle `insert().values`, `update().set`, and `onConflictDoUpdate({ set })`, `adminAssign` but not `serverValue(input.x)`, served paranoid `phase5-write-boundary/governed-mass-assignment` refusal, and the legit starter contact write success. `pnpm run check:vp`, `pnpm run check:api-surface`, and `git diff --check` passed.

### Phase 4 — Provenance-box completeness

- [x] **4.1 Compound-select fail-closed, detected BEFORE the concrete-origin `continue` (DEC-E).** Gate on
      `config.setOperators.length > 0` / a raw `UNION|INTERSECT|EXCEPT` scan ahead of `secret-read-boundary.ts:234`'s
      origin-`continue`. Acceptance (full paranoid): `bugz-30` B3's `… UNION SELECT token …` is refused (left-arm false
      attribution); an `INTERSECT`/`EXCEPT` with a secret arm is refused (null-origin opaque).
  - Evidence: `pnpm exec vitest --run packages/server/src/secret-read-boundary.test.ts packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts` passed; covers focused UNION/aggregate provenance cases and served paranoid artifact `sqlite-secret-union-egress` / `sqlite-secret-aggregate-egress`.
- [x] **4.2 Aggregate over-box fix (DEC-E).** An opaque expression over a non-secret table serves. Acceptance:
      `papercuts-28` P1's `count(*)`/`sum(<non-secret>)` over `contacts` serves (no 500); a `sum(<secret>)` still boxes.
  - Evidence: `pnpm exec vitest --run packages/server/src/secret-read-boundary.test.ts packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts` passed; covers unboxed non-secret aggregate and boxed secret aggregate in the focused boundary test plus served endpoint `/api/sqlite-secret-nonsecret-aggregate`.

### Phase 5 — Prove it (round-10 acceptance)

- [ ] **5.1 Full-paranoid generative dogfood (C1–C6).** Generators vary: IDOR **read AND write** shapes (raw SQL,
      builder, dynamic where, helper, join, view, aliased, compound, subquery-FROM, cross-owner id, forged-owner INSERT,
      owner-reassign UPDATE); every **ingress** (loader, endpoint, task, webhook — with/without `actAs`); **child-table**
      (`ownerVia`) reads; compound selects; aggregates over secret/non-secret tables; governed-column mass-assignment; the
      declared-escape mis-declaration; the anti-escalation payloads. Run under `KOVO_PARANOID=1`. Acceptance: zero
      cross-owner reads/writes on any ingress or owned table, zero secret leaks, zero mass-assignment, zero over-blocks;
      the registry invariant is green; the authz choke holds with static stubbed.

## 5. Pre-mortem — what round-10 will attack, and which item closes it

| Anticipated attack                                                                            | Why it would work                                                              | Closed by                                                                                                         | Proof                                                       |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Raw-SQL cross-owner read (round-9 IDOR)                                                       | authorization was static-only                                                  | DEC-A RLS (PG) / predicate binding (SQLite) (1.1/1.2)                                                             | 1.1/1.2 cross-owner returns zero rows                       |
| A new value/request-state property left `build-only`                                          | registry has no property-type invariant                                        | DEC-B C2 test (0.1)                                                                                               | 0.1 request-state-not-build-only test                       |
| Write IDOR: A updates/deletes/re-owns B's row, or inserts a forged-owner row                  | DEC-A was read-only; write path checks only the table set                      | DEC-A RLS `USING`+`WITH CHECK` + principal on the write tx (PG) / write predicate (SQLite) (1.1/1.2)              | 1.1/1.2 cross-owner write rejected + `WITH CHECK`           |
| Principal fed to RLS is `session.id`, not `session.user.id`                                   | `provenPrincipalFromRequest` is session-id-first                               | DEC-A pins principal to the owner-column domain (1.1)                                                             | 1.1 owner-sees-own-rows test                                |
| RLS bypass from SQL text (`RESET ROLE`/`set_config('role',…)`)                                | PGlite is always-superuser; `SET ROLE` is reversible                           | DEC-A single-statement extended-protocol confinement (1.1)                                                        | 1.1 anti-escalation regression tests                        |
| A raw `sql` _expression_ smuggles a sub-`SELECT`/`FROM` (`sql\`(SELECT … FROM accounts …)\``) | tier-1 carve-out; static read-set + SQLite injection can't see it              | DEC-C tier-1 forbids sub-`SELECT` in expression chunks; PG RLS confines it; SQLite rejects FROM-bearing raw exprs | tier-1 lexical reject test                                  |
| Aliased / compound-arm / subquery-FROM owner table escapes SQLite injection                   | base `config.where` can't reach nested tables; `getTableConfig().name` = alias | DEC-A recurse + `drizzle:OriginalName` resolution or fail-closed (1.2)                                            | 1.2 alias/compound/subquery scoped-or-closed                |
| A `build-only` code actually sits on a live runtime choke (KV415)                             | forward-only choke test                                                        | DEC-B `chokeId ⇒ runtime-choke` converse (0.1)                                                                    | 0.1 KV415 flagged → runtime-choke                           |
| A `rawRead` escape under-declares its reads                                                   | declaration diverges from reality                                              | DEC-C runtime cross-check observed ⊆ declared (2.2)                                                               | 2.2 mis-declaration fails closed                            |
| A FROM-hiding raw read via a new method                                                       | narrow-waist incomplete                                                        | DEC-C close FROM-source raw across read methods (2.1)                                                             | 2.1 `.all(sql FROM)` rejected                               |
| KV438 stubbed with no runtime floor                                                           | by-construction asserted, not proven                                           | DEC-D runtime floor + C3 (3.1)                                                                                    | 3.1 governed-column write refused, static stubbed           |
| Compound-select secret leak                                                                   | left-arm-only origin                                                           | DEC-E fail-closed on compound (4.1)                                                                               | 4.1 UNION-secret refused                                    |
| Aggregate over-block (500)                                                                    | box ignores secret-table reference                                             | DEC-E over-box fix (4.2)                                                                                          | 4.2 count(\*) over non-secret serves                        |
| Author uses `declarePublicRead` on genuinely-private data                                     | authz-of-intent not decidable                                                  | **Stated NON-GOAL** (§6) — explicit + audited                                                                     | §6 non-goal + `SECURITY.md`                                 |
| Task/webhook reads owner data (fail-closed no-op) or writes a payload-supplied owner unscoped | no request principal                                                           | DEC-G `actAs`/`declareSystem` seam + loud fail-closed (1.4)                                                       | 1.4 task-without-actAs zero rows; webhook-derive-owner      |
| Raw `endpoint()` imports a raw handle → read/write IDOR (SQLite)                              | endpoints bypass the managed handle                                            | DEC-H connection-level RLS default (PG) + endpoint handle + sole-door lint (1.5)                                  | 1.5 raw-import scoped or lint-flagged                       |
| Direct read of an FK-owned child table (`order_items`)                                        | child has no owner column → no policy/predicate                                | DEC-I `ownerVia` EXISTS/IN scoping (1.6)                                                                          | 1.6 cross-owner child read zero rows                        |
| A new Drizzle read method binds through the fail-open proxy                                   | `prop in target` allow-unless-denied                                           | DEC-C strict enumerated read allowlist (2.1)                                                                      | 2.1 non-allowlisted read method denied                      |
| A SQLite `rawRead` over an owner table (no RLS, opaque text)                                  | injection can't reach raw text                                                 | DEC-C SQLite `SQLITE_READ` authorizer denies unscoped owner reads (2.2)                                           | 2.2 SQLite owner rawRead denied                             |
| A newly-added table with user data is never annotated → cross-owner read                      | no completeness check on the author's config                                   | DEC-K authorization census (build gate + runtime deny) (0.2)                                                      | 0.2 unclassified-table canary fails build + runtime-denied  |
| A shared-doc / team / role feature assumed "authorized" but no policy written                 | plan guarantees owner-scoping only                                             | DEC-J boundary statement + census forces a classification (author writes `authzPolicy` / guard)                   | DEC-K forces `authzPolicy` decision; `SECURITY.md` boundary |
| An author's custom `authzPolicy` is too permissive                                            | authz-of-intent, not framework-decidable                                       | **Stated NON-GOAL** (§6) — reviewable, like a wrong `WHERE`                                                       | §6 non-goal + `SECURITY.md`                                 |

## 6. Honest tradeoffs and non-goals

- **Authorization uses a different mechanism per dialect — by necessity** (the confidentiality/write pattern again):
  Postgres has the engine mechanism (RLS `USING`+`WITH CHECK`), SQLite needs the framework mechanism (predicate
  binding, reads + writes). Each is the sound boundary for its dialect. The narrow-waist (DEC-C) makes the builder own
  the FROM, but does NOT flatten the table set — subquery-FROM and compound arms nest tables the SQLite handle must
  recurse into or fail closed (DEC-A).
- **RLS _filtering_ is blind to query text; RLS _confinement_ is NOT.** A single executed statement is row-filtered
  regardless of its text, but the role/principal can be reset at a statement boundary (`RESET ROLE`,
  `set_config('role',…)`) — so the guarantee is precisely "one owner statement per extended-protocol round-trip under
  `SET LOCAL ROLE`/`SET LOCAL kovo.principal`," never "sound for arbitrary text." `SET LOCAL kovo.principal` is
  transaction-scoped and must be set every request; a non-`LOCAL` `SET` and any simple-query multi-statement path are
  forbidden (both proven to break confinement). Rides the followup-4 dedicated read-only pool.
- **SQLite injection depends on pinned Drizzle internals.** `config.{where,table,joins,setOperators}` is an unstable
  contract; a Drizzle upgrade that changes it must fail the emitted-SQL conformance test loudly — a silent shape
  regression is silent IDOR. This is real coupling accepted for the SQLite dialect (which has no engine RLS).
- **Non-goal — the principal is only as proven as the app's `SessionProvider`.** Kovo delegates identity verification to
  the provider (Better Auth verifies cryptographically); a hand-rolled provider that trusts an unverified value feeds a
  spoofed `kovo.principal`. Kovo sources the principal from a framework-owned normalization and states the provider
  trust boundary in `SECURITY.md`; it does not re-verify the provider's claim.
- **This is a HARD BREAK — no compatibility mode, no migration path (tech-preview: no one is on Kovo yet).** Every
  change here (RLS policies + `kovo_reader`/writer roles on all owner tables, per-request principal, the strict-allowlist
  killing `db.all/get/values/run/exec/sql(text)`/`query(text)`, mandatory table classification, `ownerVia` on child
  tables) lands unconditionally. The **scaffold generates the RLS DDL + roles + classifications fresh**; there is no
  warn→enforce staging, no `db.all(sql)` shim, no legacy fallback. Consistent with CLAUDE.md's technical-preview bias
  (do not preserve legacy compatibility at the expense of a stronger default).
- **Non-goal — a `rawRead`'s invalidation coverage on Postgres.** PG has no per-statement read-table observation, so
  `observed ⊆ declared` is build-time best-effort only; an under-declared `reads:` causes cache _staleness_, not a leak
  (RLS still confines authz). The author's `reads:` declaration owns coverage; SQLite verifies it at runtime via the
  `SQLITE_READ` authorizer, Postgres does not. `SECURITY.md` states this.
- **Residual — an endpoint that imports a raw SQLite connection.** DEC-H's connection-level RLS covers Postgres and the
  sole-door lint flags the import, but SQLite has no engine enforcement, so a determined author's raw-imported endpoint
  DB access is "author's own server code" (the `fs`/`child_process` line) — loud (lint), not prevented.
- **Non-goal — ambient system authority.** Tasks/webhooks are owner-scoped via explicit `actAs`/`declareSystem`
  (DEC-G); there is no implicit all-owners system role. Forgetting the seam fails closed (zero rows), not open.
- **Scope + non-goal — Kovo guarantees OWNER-scoping; richer authz is author-supplied (DEC-J).** Relationship/role/team
  authorization is a custom RLS policy (Postgres, engine-enforced against Kovo's principal) or an app guard (SQLite/
  cross-dialect) — Kovo provides the proven principal + the engine boundary but does not infer sharing semantics from
  the schema. An incorrect author-supplied policy (too permissive) is the author's responsibility, reviewable like a
  wrong `WHERE`. A first-class declarative `authz` DSL (option 1b) is future work. `SECURITY.md` states the boundary.
- **Non-goal — author misuse of `declarePublicRead` / the admin capability.** Whether a public-read is _justified_ is
  authorization-of-intent, not runtime-decidable; Kovo makes the act explicit, typed, audited, and reviewable — it does
  not stop an author who deliberately declares private data public. `SECURITY.md` states this (alongside the
  `reveal`/`trustedHtml` non-goals).
- **Non-goal:** re-architecting again. The runtime-confinement principle stands; this plan extends it to authorization
  and closes the box/registry/by-construction gaps round-9 exposed.

## 7. What "done" looks like

A round-10 paranoid dogfood, generative over IDOR read+write shapes across **every ingress** (loader, endpoint, task,
webhook), transitively-owned child tables, compound-select / aggregate / mass-assignment / declared-escape shapes with
the runtime-enforced security codes stubbed, finds **zero** cross-owner reads or writes, secret leaks, mass-assignment,
or over-blocks — with authorization enforced at the engine/handle on the proven principal (channel- AND ingress-agnostic,
reads AND writes, direct AND transitive), the registry invariant guaranteeing no request-state property can sit on the
static-only side again, `by-construction` codes carrying proven floors, and the provenance box complete both ways. At
that point every value/effect property — confidentiality, integrity, AND (owner-scoped) authorization — is
runtime-enforced across every principal-bearing path, the authorization census (DEC-K) proves no request-reachable
table is silently un-scoped, the owner-scoping boundary is stated honestly (richer authz is author-supplied on the
substrate, DEC-J), and static is advisory across the board.

## Latest verification

- Grounded in first-hand round-9 evidence: `bugz-30` B1 (`security-markers.ts:73-77` KV414 `build-only`; `managed-db.ts`
  owner mentions = 0; served cross-owner rows under paranoid), B3 (`secret-read-boundary.ts:226-247` left-arm-only
  origin), B4 (`security-markers.ts:192-197` KV438 stubbed, no floor); `papercuts-28` P1 (`secret-read-boundary.ts:244-245`
  opaque-branch over-box). No framework source or `SPEC.md` changed by this document.
- 2026-07-02 adversarial worktree probes (empirical, throwaway git worktrees): PGlite `@0.5.1` RLS verified live for a
  non-superuser reader (filtering, `WITH CHECK` writes, joins, fail-closed) — DEC-A PG path is RLS, plus the
  always-superuser reversibility ⇒ single-statement/extended-protocol confinement invariant; better-sqlite3 `12.11.1`
  `.columns()` origin behavior verified per shape (UNION left-arm-only leak; INTERSECT/EXCEPT null; views/CTEs/aliases
  transparent); Drizzle `config.where` injection verified for flat reads with the alias/compound/subquery-FROM
  footguns. The Tier-A + Tier-B + Tier-C probe findings are now folded in: write authorization (DEC-A), principal
  identity + PGlite confinement + injection recursion (DEC-A), `chokeId ⇒ runtime-choke` + KV415/KV431 (DEC-B), tier-1
  hole + strict-allowlist proxy + `SQLITE_READ`-authorizer tier-3 (DEC-C), compound/aggregate box (DEC-E), the `actAs`
  seam (DEC-G), ingress/endpoint scoping (DEC-H), and transitive `ownerVia` ownership (DEC-I).
