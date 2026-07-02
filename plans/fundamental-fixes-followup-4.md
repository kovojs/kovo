# Fundamental Fixes Followup 4 — provenance tags at the source, honest paranoid mode, enforcement in the verified TCB

Created 2026-07-02. Self-standing. Source of truth for behavior is `SPEC.md`. This plan does NOT re-architect —
`fundamental-fixes-followup-3.md`'s runtime-confinement principle is right. It fixes the three places where the
_implementation_ of followup-3 failed, proven by the round-8 dogfood (`plans/claude-bugz-29.md`,
`plans/claude-papercuts-27.md`, all reproduced under `KOVO_PARANOID=1` with served leaks). Extends followup-3's
invariants A1–A10 and decisions DEC-A…DEC-M.

## 1. Why this plan exists (round-8 diagnosis in one paragraph)

followup-3 moved enforcement to runtime chokes — correct — but the implementation failed in three compounding ways:

1. **Wrong placement.** The confidentiality choke decides secrecy by **matching the result column NAME** against the
   schema secret set (+ a literal table-name regex), not by the value's **source provenance**. So aliasing a secret
   onto a non-secret column name (`select token as company`), deriving it (`substr(token)`), or reading it through a
   view **defeats the box** — the identical SOURCE-completeness hole as the static gate it replaced (`bugz-29`
   B1/B2). The same coarse mechanism also **over-blocks** legit projections with an HTTP 500 (`papercuts-27` P3). It
   is a static classifier wearing a runtime costume.
2. **Blind acceptance.** `KOVO_PARANOID=1` downgrades only `{KV406, KV422, KV438}` — **not** `KV435`/`KV426`/`KV433`.
   So the confidentiality/injection/read runtime chokes were **never tested as sole enforcement**; static KV435 kept
   catching the simple cases and masked the box's incompleteness. Every Phase 2/3 "paranoid acceptance" was green for
   the wrong reason (`papercuts-27` P1). The plan's central proof never actually ran.
3. **Wrong location.** The real enforcement lives in the **~683-line-per-dialect generated starter adapter**
   (`app-runtime-db.{sqlite,postgres}.ts`), which is **not in the TCB manifest** and **not scanned** by
   `check:tcb-boundary`. The "few hundred verified lines" reduction (A10) is illusory (`papercuts-27` P2).

The fix is to make followup-3's three mechanisms actually hold: **tag by provenance at the source (per-dialect: SQLite
box, Postgres engine `REVOKE`), stub exactly the runtime-enforced security codes in paranoid mode (from an explicit
registry, honoring the value-vs-provenance taxonomy), and put the enforcement in the verified TCB (decision in
`@kovojs/server`, Drizzle extraction in `@kovojs/drizzle`).**

## 2. Meta-invariants (extend followup-3 A1–A10)

- **B1 — Tags are attached at the SOURCE by provenance, never by result-shape recognition.** A `secret`-classified
  value is boxed at the driver/row-mapping boundary (SQLite provenance box) or blocked at the engine (Postgres
  `REVOKE`), before any projection/alias/derivation/view/subquery can rename it. A result cell whose provenance is
  genuinely unattributable (an **opaque** raw fragment or any un-whitelisted `sql` chunk, not a proven-non-secret
  computation) **fails closed** (boxed). Name-matching the result key is forbidden as the confidentiality boundary.
- **B2 — Paranoid mode stubs exactly the RUNTIME-ENFORCED security codes, from an explicit registry — no more, no
  less.** The advisory set under `KOVO_PARANOID=1` **equals** the registry's `runtime-choke` ∪ (proven)
  `by-construction` codes (DEC-D), asserted by a test; none of those may be build-fatal under paranoid, and each must
  name a live choke. `escape-hatch-audit` / build-only codes are NOT stubbed (their property is author-time, not
  runtime — §2.1) — so stubbing never leaves a property enforced by neither layer (A7), and paranoid does not
  over-claim that author-time properties moved to runtime.
- **B3 — All security enforcement lives in the framework TCB; generated per-app code wires config only.** Every
  security decision (secret boxing, declared-write scope, read-only) is a call into a manifested, budgeted, verified
  `@kovojs/server` choke. `check:tcb-boundary` fails if a security decision appears in a generated template or anywhere
  outside the manifest.
- **B4 — The acceptance is self-catching.** Once B2 holds, the existing Phase 2/3 paranoid tests MUST fail on the
  round-8 bugs until B1/B3 are fixed. A "green paranoid acceptance" is only re-earned by making the runtime choke
  provenance-sound — never by shrinking what paranoid mode disables.

### 2.1 Two kinds of security property (the taxonomy the audit forces)

followup-3 over-claimed that **every** security property moves to a runtime choke. That is false, and pretending
otherwise is how DEC-D would have created A7 gaps. Security properties split in two, and each has its own sound
enforcement — neither of which classifies the Turing-complete authoring surface:

- **Value / effect properties** (confidentiality "no secret _value_ reaches egress"; integrity "this _statement_
  writes / this _reader_ mutates"). The property is about a concrete runtime value or effect → **decidable at runtime
  by the choke or the engine**. Static is advisory; paranoid stubs it. (This is what Phases 1–3 fix, correctly.)
- **Provenance / intent properties** (XSS-trust "this HTML was _authored_-trusted, not laundered from untrusted
  input"; mass-assignment "this field was _author_-permitted for client write"). The property is about the origin or
  author-intent of data — an **author-time fact**, not a runtime value. Sound enforcement is an **unforgeable
  brand/typed constructor** at author time (a local, decidable "must go through the constructor" property — NOT a
  source classification) **+ a runtime choke that refuses UN-branded values** (so the brand can't be skipped). The
  residual — "was the brand _justly_ given?" — is neither soundly runtime- nor build-decidable (it was round-7 B2),
  and is handled by the audited-explicit hatch (§10.2/§10.3) + the narrow waist + a **stated non-goal** (§6): Kovo
  does not stop an author who _deliberately_ brands untrusted/secret data through `trustedHtml(x,{reason})` /
  `reveal(reason)` — it makes the act explicit and reviewable.

This taxonomy is what DEC-D's registry `enforcement` field encodes, and it is a more honest — and stronger —
position than "everything is runtime": it keeps the runtime-value properties fully runtime-enforced while naming
exactly where an irreducible author-time obligation remains.

## 3. Decisions register (made here; no deferral)

- **DEC-A — Confidentiality is enforced per-dialect by the mechanism that is actually sound there (SQLite = provenance
  box, Postgres = engine `REVOKE`), never by result-key name-matching.** The audit established that provenance boxing
  is fully available on SQLite but NOT on Postgres through the current API (Drizzle exposes only `{ name, dataTypeID }`;
  recovering `tableID`/`columnID` needs a new raw-protocol read path, and PG _views_ report the view column origin, not
  the base `session.token`). So:
  - **SQLite (PRIMARY = provenance box).** better-sqlite3 (`@12.11.1`, `ENABLE_COLUMN_METADATA` confirmed present)
    `Statement.columns()` gives per-column `{ table, column }` origin — audit-confirmed to preserve **aliases, views,
    and CTEs**. The managed read handle boxes a cell by WHERE IT CAME FROM. Sub-cases:
    **simple column ref** (`token AS company`, JOINed, via view/CTE) → origin `session.token` → box iff secret,
    alias/view/CTE-proof; **modeled builder expression** (`sql` template around `substr(session.token,1,4)`) →
    **serve only if EVERY chunk is proven safe**: a proven-non-secret interpolated `Column`, or an inert whitelisted
    string fragment (operators, literals, parens — NO bare identifiers, NO `select`). **Any unrecognized raw string
    chunk → treat as opaque → box** (this closes the audit's mixed-chunk hole where a hidden `select token from session`
    string chunk sits beside a non-secret column interpolation). Feasibility of chunk introspection is 2.0b; if
    unavailable, ALL `sql` expressions collapse to the opaque sub-case. **Opaque fragment** (raw secret-select SQL with
    no modeled refs, or a `null` origin) → **fail closed → box.**
  - **Postgres / PGlite (PRIMARY = engine column-`REVOKE`, DEC-B).** Because provenance metadata isn't available via
    the Drizzle result API and views don't report base origin, the sound Postgres mechanism is engine column-`REVOKE`
    plus `security_invoker` views (DEC-B) — which the audit confirmed blocks alias AND view reads at the engine.
    Provenance boxing on Postgres is OPTIONAL defense-in-depth that requires the new raw-protocol read path (2.0);
    it is not relied on for soundness.
    Result-key name-matching is forbidden as the confidentiality boundary on either dialect. Closes `bugz-29` B1
    (SQLite→box sub-case 1 / Postgres→REVOKE), B2 view (SQLite→box / Postgres→`security_invoker`+REVOKE), the derivation
    cases (→ modeled/opaque), and `papercuts-27` P3 (SQLite modeled sub-case serves a proven-non-secret computation).
    **The secret-copied-into-a-nonsecret-column case is NOT a read-provenance problem** (indistinguishable on read once
    at rest) — it is closed on the WRITE side (DEC-C.2).
- **DEC-B — Engine column-`REVOKE` is the confidentiality boundary on Postgres (SQLite has no column grants, so boxing
  is its boundary); view + role bypasses made explicit.** The default reader role has column-level `REVOKE` on secret
  columns; a secret read requires the privileged `declareSecretReadCapability` grant (audit-confirmed: PGlite role
  switching plus column `REVOKE` work). Sound for all shapes at the engine — **provided two bypasses are closed**: (a) **views
  run `security_invoker`** (PG15+) or the view owner is also revoked, else a definer-rights view reads the secret with
  the owner's privileges and bypasses the reader `REVOKE` (audit-confirmed `security_invoker` closes it); (b) the
  reader is a **genuine non-superuser role** the request runs under via `SET ROLE` — a superuser bypasses `REVOKE`, so
  on PGlite (single embedded superuser) task 2.2 confirms a non-superuser reader role is assumable. The privileged
  capability reads the secret and DEC-A boxing keeps that value boxed all the way to egress. (SQLite has no
  column-level `REVOKE`, so DEC-A provenance boxing is SQLite's sole confidentiality boundary — not a fallback.)
- **DEC-C — Declared-write scope is `tables:`, fail-closed; the mutation's OWN writes are bound; app-defined trigger/
  function side-effects are a stated non-goal.** The write scope is the mutation's declared `tables:` set; `touches:`
  (cache-invalidation) does NOT grant write access (conflating them would let a mutation write anything it invalidates
  — a soundness bug). Absent a declared `tables:`, the choke **denies all writes** (fail closed). Enforcement:
  - **SQLite:** `sqlite3_set_authorizer` on the write connection — an engine mechanism, sound for ALL write shapes
    (builder, raw SQL, and trigger-body writes) at no operational cost.
  - **Postgres/PGlite:** the framework binds the write to the Drizzle builder's known target table(s); a raw-SQL
    (`sql.unsafe`) write is the explicit narrow-waist escape and fails closed against `tables:`. **No per-mutation
    role** — provisioning a Postgres role per mutation was rejected as operationally absurd.
  - **App-defined DB triggers/functions are OUT OF SCOPE** (§6 non-goal): a trigger that writes another table as a
    side-effect is not covered by the write-scope guarantee. Catching it on Postgres would require per-mutation engine
    roles, which this plan does not require; SQLite's authorizer catches it as defense-in-depth, but the cross-dialect
    guarantee promises only the mutation's _own_ writes. Scoping trigger side-effects is an explicit, opt-in
    engine-role deployment, not a default.
    **Breaking-change migration:** today a missing `tables:` means _no_ write policy (`packages/server/src/mutation.ts:654`)
    and the starter `addContact` declares only `touches:` (`packages/create-kovo/templates/src/mutations.ts:71`); this
    plan makes absent-`tables:` fail-closed and updates the scaffold to declare `tables: ['contacts']` — existing apps
    must add `tables:` to writing mutations. Closes `bugz-29` B3. Proven by a paranoid out-of-scope-write test on the
    default mutation and by an absent-`tables:` mutation being write-denied.
  - **DEC-C.2 — A `Secret` box written into a non-secret column is refused at the DB-write boundary; raw-SQL writes
    fail closed; `reveal` is audited** (extends followup-3 DEC-C(4)). Builder writes inspect `.values()`/`.set()` args
    for `Secret` boxes and refuse (feasible). **Raw-SQL writes fail closed on any `Secret` bind parameter** — the
    boundary cannot map a bind param to its destination column, so a boxed secret as a raw-SQL write param is refused
    outright (discharge via the capability). And because `Secret.reveal()` returns a _plain, untagged_ value (so a
    reveal-then-write would be invisible), **`reveal(reason)` records an audit event** (who/why/when) — otherwise the
    "audited write" claim is unprovable. This closes the secret-copied-into-a-nonsecret-column leak on the WRITE side,
    where it is decidable (the value is still a box at write time), rather than the read side, where it is not.
- **DEC-D — An explicit `code → guarantee → enforcement` registry classifies every security code; paranoid stubs only
  the runtime-enforced ones.** The audit showed the `securityClassifier` brand records only `{ kind, name }` — not KV
  codes or choke IDs — and that NOT every security property has (or can have) a runtime choke: KV438 mass-assignment
  is static/by-construction (`packages/server/src/write-governance.ts`), and KV426 cannot recover trust-escape
  provenance at runtime. So the source of truth is a hand-maintained, tested **registry** (the DEC-M guarantee
  register), each entry `{ code, property, enforcement, chokeId? }`, where `enforcement` is one of (§2.1 taxonomy):
  - **`runtime-choke`** — a value/effect property with a live runtime choke (confidentiality `KV435`, integrity
    `KV433`/`KV406`). Static advisory; **stubbed under `KOVO_PARANOID=1`**; its choke is tested alone.
  - **`by-construction`** — enforced by an unforgeable typed helper so the runtime is transparent (mass-assignment
    `KV438`: the input parser only binds declared fields). **Stubbed under paranoid** iff a test proves the
    construction holds at runtime (the parser drops undeclared fields); otherwise not.
  - **`escape-hatch-audit`** — the residual author-time part of a provenance property (`KV426`: "was the trust brand
    justified?"). **NOT stubbed** — but the runtime injection choke independently refuses UN-branded values at sinks
    (that part IS a runtime choke), and author-misuse of the audited hatch is a stated non-goal (§6).
    Tests assert: (i) the paranoid advisory set === the registry's `runtime-choke` ∪ (proven) `by-construction` codes;
    (ii) none of those is build-fatal under paranoid; (iii) every code any security classifier emits has a registry
    entry (drift guard); (iv) every `runtime-choke` entry names a live choke. This keeps DEC-D from creating an A7
    _neither-layer_ gap (a code is either runtime-enforced-and-stubbed, or genuinely author-time-and-not-stubbed with
    its residual named) — and stops over-claiming that "everything moved to runtime." Closes `papercuts-27` P1.
- **DEC-E — Split enforcement into pure-metadata extraction (`@kovojs/drizzle`) + a verified decision (`@kovojs/server`);
  generated code wires config only.** The audit flagged a packaging gap: schema mapping needs Drizzle dialect APIs, but
  `@kovojs/server` does not own Drizzle. Resolution (audit option 3): the **Drizzle-specific extraction** (schema →
  `{ secretColumns, tableOIDs, writeScopes, expressionChunkClassifier }`) lives in **`@kovojs/drizzle`** and emits
  **pure, serialisable metadata**; the **enforcement decision** (given metadata + a concrete runtime value/write:
  box/refuse) lives in **`@kovojs/server`**, which takes no Drizzle dependency. The pure metadata is the verified
  interface between them. Both sides are in `security/TCB.md`; `check:tcb-boundary` fails on any security decision
  inside `packages/create-kovo/templates/**` or outside the manifest. The A10 ~600-line budget applies to the DECISION
  functions in `@kovojs/server`; the extraction/metadata gets its own exhaustive correctness test (a mis-mapping
  under-boxes → leak). Round-8 P2's ~683 tangled lines were mostly extraction + per-shape branching; separating the two
  packages is what makes the decision small and both verifiable. **If the decision cannot be expressed within budget,
  the mechanism is still doing per-shape name-match work and must be simplified — never a reason to raise the budget.**
  Closes `papercuts-27` P2 + the audit packaging gap.
- **DEC-F — Re-validate under real paranoid mode; re-mark only on a genuine pass.** After DEC-D, re-run every
  followup-3 Phase 2/3 paranoid acceptance; they will fail on `bugz-29` B1/B2/B3 (correctly). Re-mark those checkboxes
  `[x]` only once DEC-A/B/C make them pass with the FULL `SECURITY_KV_CODES` set stubbed. Update followup-3's ledger
  to reflect that its Phase 2/3 acceptances were unsound as originally recorded.
- **DEC-G — Honest diagnostics (A4).** KV433/KV435 name the ACTUAL enforcing layer (engine `REVOKE` / provenance box /
  read-only connection), never an overstated "the database engine rejected it" when it is a framework parse. Closes
  `papercuts-27` P4.
- **DEC-H — Inline `style={{...}}` object serializes safely (contextually escaped) or emits a diagnostic; it is not
  silently dropped.** Closes `papercuts-27` P5.

## 4. Phases (each leaf a single commit; every acceptance runs under FULL paranoid mode)

### Phase 0 — Real paranoid mode FIRST (the forcing function)

- [x] **0.1 Security-code registry + paranoid advisory set derived from it (DEC-D, B2, §2.1).** Build the
      `code → { property, enforcement, chokeId? }` registry; the three paranoid sites (`graph-output.ts:630`,
      `build-export.ts:465`, `vite.ts:568`) import the advisory set = `runtime-choke` ∪ proven `by-construction` codes.
      Tests: advisory set equals that derivation; no member is build-fatal under `KOVO_PARANOID=1`; every code a security
      classifier emits has a registry entry (drift guard); every `runtime-choke` entry names a live choke;
      `escape-hatch-audit`/build-only codes are NOT in the advisory set. (Reconciles with the brand from plan-2 DEC1, but
      the registry — not brand-inference — is the source of truth, since the brand carries no codes.)
  - Evidence: `pnpm exec vitest --run packages/core/src/internal/security-markers.test.ts packages/cli/src/index.kovo-check.test.ts packages/server/src/vite-data-plane-gate.test.ts scripts/check-tcb-boundary.test.mjs` (140 tests), plus `pnpm run check:api-surface`, `node scripts/check-tcb-boundary.mjs`, and `node scripts/check-security-guarantee.mjs`.
- [ ] **0.2 Confirm the round-8 bugs now surface (B4).** With 0.1 landed, `KOVO_PARANOID=1` builds of the `bugz-29`
      B1/B2/B3 shapes MUST reproduce the leak/write (static no longer masks them). Capture these as failing acceptance
      fixtures — they are the Phase 2/3 targets. Re-open the affected followup-3 checkboxes (DEC-F).
  - Status: left open. Red-window audit found a real post-0.1/pre-fix ancestry point at `5dd52b252`, but no preserved
    replayable B1/B2/B3 fixture: `e1adf95e0` does not build, and reconstructing the exact SQLite shapes at `5dd52b252`
    trips then-current unrelated preflight gates (`KV410`/`KV310`/`KV422`) before the runtime leak/write. Checking this
    off now would overstate the surviving evidence.

### Phase 1 — Put enforcement in the verified TCB

- [x] **1.1 Split enforcement: Drizzle extraction → pure metadata (`@kovojs/drizzle`), decision (`@kovojs/server`) (DEC-E, B3).**
      Move boxing / declared-write / read-only decisions out of the generated adapter into `@kovojs/server` (no Drizzle
      dep); the Drizzle-specific schema→metadata extraction lives in `@kovojs/drizzle` and emits pure, verified metadata;
      the generated adapter only passes that metadata + config.
  - Evidence: `pnpm exec vitest --run packages/server/src/managed-db.test.ts scripts/check-tcb-boundary.test.mjs packages/create-kovo/src/index.test.ts --reporter=dot` proves server-owned declared-write/read-only helpers, generated adapter wiring, and scaffold metadata after relocation.
- [x] **1.2 TCB manifest + boundary lint cover the relocated chokes (DEC-E, A10).** Enroll them in `security/TCB.md`;
      extend `check:tcb-boundary` to fail on any security decision inside `packages/create-kovo/templates/**` or outside
      the manifest, and to enforce the budget on the relocated chokes.
  - Evidence: `node scripts/check-tcb-boundary.mjs` passes with generated template DB-decision exceptions removed and relocated server/drizzle chokes enrolled in `security/TCB.md` within the 600-line budget.

### Phase 2 — Provenance-sound confidentiality

- [x] **2.0 Record driver column-origin availability per dialect (DEC-A).** SQLite: confirmed — better-sqlite3
      `@12.11.1` has `ENABLE_COLUMN_METADATA`, `Statement.columns()` preserves alias/view/CTE origins (audit-probed); this
      is SQLite's front line. Postgres/PGlite: the current Drizzle result API exposes only `{ name, dataTypeID }` — NOT
      `tableID`/`columnID` — and views report the view column origin, not the base table; so provenance boxing on Postgres
      needs a **new raw-protocol read path** and is only optional defense-in-depth. The Postgres confidentiality boundary
      is engine `REVOKE` (DEC-B), not boxing. Record the decision; do not assume PG provenance.
  - Evidence: `packages/create-kovo/templates/src/_kovo/app-runtime-db.sqlite.ts` wires SQLite `sqliteColumnOrigins`
    into the server read-boundary, `packages/create-kovo/templates/src/_kovo/app-runtime-db.ts` wires PGlite
    `rawSecretTableRead: 'engine'`, and the current prod-artifact security tests below prove the dialect split.
- [x] **2.0b Verify the builder exposes interpolated column refs for `sql` expressions (DEC-A sub-case 2).** Confirm
      Drizzle's SQL-template object exposes chunk metadata so the framework can enumerate interpolated `Column`
      instances in builder SQL expressions, resolve each to `table.column`, and distinguish a plain-string chunk
      carrying no `Column` such as the round-8 B1 opaque select-token fragment. Record the result. **Fallback if
      unavailable:** every SQL expression collapses to the opaque sub-case (opaque → fail-closed box), which is sound
      but re-introduces the P3 over-block for SQL-expression projections — discharged via the DEC-B capability /
      `reveal`. This is the
      expression-tree analogue of 2.0: the plan must not assume the introspection, it must verify it.
  - Evidence: `KOVO_PARANOID=1 pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t "boxes SQLite secret reads by source provenance|boxes schema-declared secret reads"` (2 tests) exercises safe `Column` chunks and hidden-select raw chunks in the deployed SQLite artifact.
- [x] **2.1 SQLite provenance boxing at the row-mapping boundary (DEC-A, B1).** Box by source across the three DEC-A
      sub-cases: (1) simple ref via `Statement.columns()` origin (alias/JOIN/view/CTE proof), (2) modeled builder
      expression — serve only if EVERY chunk is a proven-non-secret interpolated `Column` or an inert whitelisted string;
      any un-whitelisted raw chunk → box (closes the mixed-chunk hole), (3) opaque fragment → fail-closed box. (Postgres
      confidentiality is 2.2's engine `REVOKE`, not this path.)
      Acceptance (full paranoid): `bugz-29` B1 alias, B2 view, `substr()`/`||`/`coalesce()` derivations, JOIN-aliased,
      CTE/subquery all box → refused at egress; a legit non-secret projection/computation from a secret-bearing table
      serves (`papercuts-27` P3, no over-block); a raw-SQL opaque secret fragment boxes fail-closed. (The
      secret-copied-to-nonsecret-column case is 3.2, not here.)
  - Evidence: `KOVO_PARANOID=1 pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t "boxes SQLite secret reads by source provenance|boxes schema-declared secret reads"` (2 tests) covers alias, view, derivation, JOIN alias, CTE/subquery, mixed raw SQL, mixed builder SQL, safe non-secret projection, and audited reveal without served secret leakage.
- [x] **2.2 Engine column-`REVOKE` primary on Postgres + declared secret-read capability (DEC-B).** Reader role cannot
      `SELECT` secret columns (raw SQL, alias, and view included); views run `security_invoker` (or the owner is also
      revoked) so a view cannot bypass the reader grant; confirm a non-superuser reader role is assumable via `SET ROLE`
      on PGlite (else DEC-A boxing is the PGlite front line — record which). The privileged capability reads the secret
      and the value stays boxed to egress. Acceptance (full paranoid): a reader secret read that is direct, aliased, AND
      through a view is engine-rejected; the declared capability reads + the value is refused at the wire without
      `reveal(reason)`.
  - Evidence: `KOVO_PARANOID=1 pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t "boxes schema-declared secret reads"` and `KOVO_PARANOID=1 pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t "runtime Secret read through a Drizzle view"` prove direct/raw alias/view refusals, `security_invoker` view behavior, `SET LOCAL ROLE` to `kovo_reader`, and declared capability values still boxed to egress without reveal.

### Phase 3 — Integrity for the default mutation shape

- [x] **3.1 Declared-write scope = `tables:`, fail-closed (DEC-C, B3).** Scope on `tables:` only; deny all writes
      absent a declared `tables:`; `touches:` grants no write access. **SQLite:** `sqlite3_set_authorizer` (engine, all
      shapes). **Postgres:** bind the write to the Drizzle builder's known target(s); a raw-SQL (`sql.unsafe`) out-of-scope
      write fails closed. App-defined trigger side-effects are a non-goal (§6). Scaffold declares `tables:` for every
      writing mutation; **breaking change** — existing apps must add `tables:` (today absent = no policy, `mutation.ts:654`;
      starter declares only `touches:`, `mutations.ts:71`). Acceptance (full paranoid): the default mutation writing an
      out-of-scope table (auth `user`/`session`) is rejected; an in-scope `contacts` write succeeds; a raw-SQL out-of-scope
      write fails closed; an absent-`tables:` mutation is write-denied.
  - Evidence: `KOVO_PARANOID=1 pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t "starter mutation DB table scope"` proves default starter `contacts` succeeds while auth `user`, auth `session`, raw-SQL auth, and absent-`tables:` writes are rejected and leave no rows.
- [x] **3.2 A `Secret` box written into a non-secret column is refused; raw-SQL write params fail closed; `reveal` is
      audited (DEC-C.2).** Builder writes inspect `.values()`/`.set()` for boxes; a raw-SQL write with a `Secret` bind
      param is refused outright; `reveal(reason)` records an audit event so a reveal-then-write is traceable. Acceptance
      (full paranoid): a boxed secret written into a non-secret column (builder AND raw-SQL) is refused; a
      `reveal(reason)` write emits an audit record.
  - Evidence: `KOVO_PARANOID=1 pnpm exec vitest --run packages/core/src/secret.test.ts packages/server/src/managed-db.test.ts packages/server/src/mutation.test.ts packages/compiler/src/style.test.ts packages/compiler/src/output-context-security.test.ts packages/core/src/diagnostics.test.ts packages/server/src/query-endpoint.test.ts packages/server/src/response-posture.test.ts` (244 tests).

### Phase 4 — Honesty + DX cleanups

- [x] **4.1 Honest KV433/KV435 diagnostics (DEC-G).** Each names the actual enforcing layer.
  - Evidence: `KOVO_PARANOID=1 pnpm exec vitest --run packages/core/src/diagnostics.test.ts packages/server/src/query-endpoint.test.ts packages/server/src/response-posture.test.ts` in the 244-test focused full-paranoid run above.
- [x] **4.2 Inline `style` object serialized safely or diagnosed (DEC-H).**
  - Evidence: `KOVO_PARANOID=1 pnpm exec vitest --run packages/compiler/src/style.test.ts packages/compiler/src/output-context-security.test.ts` in the 244-test focused full-paranoid run above.

### Phase 5 — Prove it (round-9 acceptance)

- [x] **5.1 Full-paranoid generative dogfood (B2/B4).** Property generators vary the read SOURCE shape (alias,
      derivation, view, computed, JOIN, CTE, subquery) and the write shape (out-of-scope `tables:`, absent-`tables:`, DDL,
      raw-SQL escape, boxed-secret-into-nonsecret-column), run under `KOVO_PARANOID=1` with the runtime-enforced security
      codes stubbed. (App-defined triggers are a non-goal, not asserted; SQLite's authorizer may catch them as a bonus.)
      Acceptance: zero secret-to-egress leaks, zero out-of-scope writes, zero over-blocks; the relocated chokes are in the
      manifest and within budget.
  - Evidence: `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts -t "Phase 5.1 full-paranoid dogfood acceptance" --reporter=dot` proves alias/view/derivation/computed/JOIN/CTE/subquery reads, public projection/no-overblock cases, in-scope write success, and out-of-scope/absent-`tables:`/DDL/raw/boxed-secret write refusals under `KOVO_PARANOID=1`.

## 5. Pre-mortem — what round-9 will attack, and which item closes it

| Anticipated round-9 attack                                                                                                       | Why it would work                                                                            | Closed by                                                                                  | Proof                                            |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| A driver build without column-origin metadata (SQLite no `SQLITE_ENABLE_COLUMN_METADATA`)                                        | provenance mapping returns null → name-match creeps back                                     | DEC-A fail-closed + DEC-B `REVOKE` (2.0/2.1/2.2)                                           | 2.0 availability record + 2.1 fail-closed test   |
| A computed column derived from a secret (`substr(token)`) with null origin                                                       | origin is unattributable                                                                     | DEC-A sub-case 2 (expression tree) / sub-case 3 fail-closed (2.1)                          | 2.1 derivation acceptance                        |
| The builder does NOT expose interpolated column refs for `sql` expressions                                                       | sub-case 2 is not achievable → either name-match creeps back or every `sql` expr over-blocks | DEC-A 2.0b feasibility gate + documented fallback (all `sql` exprs → sub-case 3)           | 2.0b introspection record + fallback test        |
| A new security code added later, not in `SECURITY_KV_CODES`                                                                      | paranoid silently stops covering it                                                          | DEC-D drift guard (0.1)                                                                    | 0.1 "every emitted code ∈ set" test              |
| Enforcement re-added to the generated adapter                                                                                    | TCB shrinks back to an illusion                                                              | DEC-E `check:tcb-boundary` scans templates (1.2)                                           | 1.2 lint fails on security decision in templates |
| Provenance box over-boxes a non-secret column from a secret table                                                                | coarse dual of B1                                                                            | DEC-A per-column provenance (2.1)                                                          | 2.1 legit-projection-serves test                 |
| A legitimately-revealed secret's plaintext flows to the wire                                                                     | `reveal` cliff (followup-3 known)                                                            | audited `reveal(reason)` at egress only; capability keeps it boxed                         | 2.2 capability-still-boxed test                  |
| Paranoid acceptance re-marked `[x]` without a real pass                                                                          | the round-8 self-deception repeats                                                           | B4 + DEC-F                                                                                 | 5.1 full-paranoid generative pass                |
| A mutation writes a table it only `touches:` (invalidates)                                                                       | `touches:` mistaken for write authority                                                      | DEC-C `tables:`-only, fail-closed absent it (3.1)                                          | 3.1 out-of-scope + absent-`tables:` write-denied |
| A definer-rights view reads a secret and bypasses the reader `REVOKE`                                                            | view runs with owner privileges                                                              | DEC-B `security_invoker` / owner also revoked (2.2)                                        | 2.2 secret-through-view engine-rejected          |
| A superuser (PGlite default) bypasses column `REVOKE`                                                                            | `REVOKE` does not bind superusers                                                            | DEC-B non-superuser reader via `SET ROLE` (2.2)                                            | 2.2 role-assumable feasibility record            |
| A security code with a static gate but NO runtime choke gets stubbed                                                             | paranoid disables the only enforcer → A7 neither-layer gap                                   | DEC-D (iv) every member names a live choke                                                 | DEC-D test (iv) code↔choke register              |
| The TCB budget is raised to fit un-simplified per-shape work                                                                     | the "small verified TCB" illusion returns                                                    | DEC-E budget on the DECISION only; "simplify, don't raise"                                 | 1.2 budget check on decision funcs               |
| A secret laundered into a non-secret column then read back                                                                       | read provenance sees a genuine non-secret column                                             | DEC-C.2 boxed-secret write refused at the DB-write boundary (3.2)                          | 3.2 boxed-secret-into-nonsecret-column refused   |
| A mixed `sql` chunk hides the secret in a string while interpolating a non-secret column (`upper(${name}) \|\| (select token…)`) | interpolated-column check sees only the non-secret column                                    | DEC-A sub-case 2 chunk-level fail-closed (2.1)                                             | 2.1 mixed-chunk boxes                            |
| A Postgres secret read via alias/view (provenance unavailable in the Drizzle API)                                                | boxing can't attribute origin on PG                                                          | DEC-B engine `REVOKE` + `security_invoker` is the PG boundary, not boxing (2.2)            | 2.2 alias+view engine-rejected                   |
| A trigger fired by an in-scope write mutates an out-of-scope table                                                               | Postgres can't see trigger side-effects without per-mutation roles (rejected)                | **Stated NON-GOAL** (§6); SQLite's authorizer catches it as defense-in-depth               | §6 non-goal + `SECURITY.md` (6.2)                |
| Enforcement can't move to `@kovojs/server` because it needs Drizzle                                                              | packaging: server doesn't own Drizzle                                                        | DEC-E extraction in `@kovojs/drizzle` → pure metadata → decision in `@kovojs/server` (1.1) | 1.1 packaging + metadata correctness test        |
| `reveal()` returns a bare string, so a reveal-then-write/emit is untracked                                                       | the tag is gone after reveal                                                                 | DEC-C.2 `reveal(reason)` records an audit event                                            | 3.2 reveal-write audit record                    |
| An author deliberately brands untrusted/secret data via `trustedHtml(x,{reason})` / `reveal(reason)`                             | provenance-of-intent is not runtime- or soundly-build-decidable                              | **Stated NON-GOAL** (§2.1, §6) — hatch is explicit + reviewable, not prevented             | §6 non-goal + `SECURITY.md` (6.2)                |

## 6. Honest tradeoffs and non-goals

- **Confidentiality uses a different mechanism per dialect — by necessity, not tidiness.** SQLite has usable column
  origin (better-sqlite3 `@12.11.1`, alias/view/CTE-preserving) but no column grants → **provenance boxing**. Postgres
  has column grants but no origin metadata via the Drizzle API (and views don't report base origin) → **engine
  `REVOKE`**. Each dialect's boundary is the mechanism that is actually sound there. This is more surface than "one
  choke," and accepted (honest > tidy); the shared, verified part is the enforcement _decision_ + the pure metadata
  (DEC-E).
- **Real paranoid mode will (correctly) turn CI red first.** Landing 0.1 exposes `bugz-29` B1/B2/B3 as failing
  acceptances before the fixes land. That is the point — a red that reflects reality beats a green that hides it.
- **Enforcement in the framework core, not per-app.** Generated apps get smaller and safer; the tradeoff is that the
  chokes must be configuration-driven (schema secret-metadata, write-scope) rather than code-generated — which is also
  what makes them verifiable (A10).
- **The TCB budget is a design forcing-function, not a target to negotiate.** The round-8 enforcement was ~683
  lines/dialect; relocating it (DEC-E) does not shrink it by itself. The budget is met by splitting the tiny
  _decision_ from the _schema→secret mapping_ (a derived data structure verified separately) — and if the decision
  still won't fit, that means it is still doing per-shape name-match work and must be simplified. Raising the budget to
  fit is how the "small verified TCB" became an illusion; this plan forbids it.
- **`touches:` vs `tables:` is a real API sharp edge.** Making `tables:` the sole write authority (DEC-C) means authors
  must declare it on writing mutations; the scaffold does so, and an absent `tables:` fails closed (write-denied)
  rather than silently allowing. This is stricter than before and intentional.
- **Non-goal — author misuse of an audited escape hatch (STATED, per §2.1).** Kovo does not prevent an author who
  _deliberately_ brands untrusted data as trusted (`trustedHtml(x,{reason})`) or reveals+emits a secret
  (`reveal(reason)`). Provenance-of-intent is neither soundly runtime- nor build-decidable; Kovo's guarantee is that
  the act is **explicit, typed, and reviewable** (SPEC §10.2/§10.3) and that UN-branded values are refused at the
  runtime choke — not that a determined author cannot assert a falsehood through the hatch. `SECURITY.md` (6.2) states
  this in the threat model; it replaces any implied "prevents all XSS/leaks" claim.
- **Not every property is runtime-enforced (STATED, per §2.1).** Value/effect properties (confidentiality, integrity)
  are; provenance/intent properties (XSS-trust, mass-assignment) rest on an unforgeable brand + a runtime refuse-
  unbranded choke, with the residual above as a non-goal. followup-3's "everything moves to runtime" is corrected here.
- **Non-goal — app-defined DB trigger/function side-effects.** The write-scope guarantee binds a mutation's _own_
  writes to its declared `tables:`; a trigger/function that writes another table as a side-effect is out of scope.
  Enforcing it cross-dialect would need a Postgres role per mutation (rejected as operationally absurd). SQLite's
  authorizer catches it as defense-in-depth, but the promise is the floor. Apps needing scoped trigger effects opt into
  an engine-role deployment. `SECURITY.md` (6.2) states this.
- **Non-goal:** re-architecting again. followup-3's principle stands; this plan corrects placement, acceptance,
  location, dialect-soundness, and the property taxonomy — not the core direction.

## 7. What "done" looks like

Round-9 paranoid dogfood with the **full `SECURITY_KV_CODES` set stubbed**, generative over alias/derivation/view/
computed/JOIN/CTE read-SOURCE shapes and out-of-scope/absent-`tables:`/DDL/raw-SQL-escape/boxed-secret-into-nonsecret-column
write shapes (app-defined triggers excluded as a non-goal): **zero** secret-to-egress leaks, **zero** out-of-scope
writes, **zero** over-blocks — with the
enforcement living in the manifested, budgeted, verified TCB (decision in `@kovojs/server`, extraction in
`@kovojs/drizzle`), and the registry-derived advisory set guaranteeing paranoid mode covers exactly the
runtime-enforced codes and can never silently shrink again. At that point followup-3's §9 finish line is real for the
first time: with static fully disabled, the runtime chokes alone hold for the value/effect properties, the
provenance/intent properties rest on unforgeable brands with a named residual non-goal, and the acceptance is
self-catching rather than self-deceiving.

## Latest verification

- Grounded in first-hand round-8 evidence: `bugz-29` B1 (result-name-match box; served token under paranoid;
  `app-runtime-db.sqlite.ts` per-key `secretColumnNames.has(key)`), B2 (view regex), B3 (`touches:` write choke
  dormant); `papercuts-27` P1 (advisory set = `{KV406,KV422,KV438}` at `graph-output.ts:630`/`build-export.ts:465`/
  `vite.ts:568`; `KOVO_PARANOID=1` still KV435-fatal), P2 (`app-runtime-db.sqlite.ts` 683 lines, not in TCB/boundary lint).
- Current integrated gates: `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts -t "Phase 5.1 full-paranoid dogfood acceptance" --reporter=dot`, `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t "boxes schema-declared secret reads" --reporter=dot`, `pnpm exec vitest --run packages/server/src/managed-db.test.ts scripts/check-tcb-boundary.test.mjs packages/create-kovo/src/index.test.ts --reporter=dot`, `node scripts/check-tcb-boundary.mjs`, `pnpm run check:api-surface`, `pnpm run check:vp`, and `git diff --check`.
