# Fundamental Fixes Followup 3 — stop classifying the source; confine at runtime chokes

Created 2026-07-01. Self-standing. Source of truth for behavior is `SPEC.md` (§10.2/§10.3 audited escapes,
§11.1 type-identity, §11.2 `observed ⊆ declared`). This plan is a **re-architecture**, not another gate. It
answers, from first principles, why seven rounds of dogfooding keep surfacing the same class of defect, what
structurally prevents it, and — critically — how to do so **without loosening any real enforcement**. Evidence base:
`claude-bugz-{26,27,28}.md`, `claude-papercuts-{24,25,26}.md`, `fundamental-fixes*.md`,
`fundamental-hardening-and-refactor{,-2}.md`.

## 1. First principles: why the same class keeps recurring

**Observation across 7 rounds.** Every defect has the same shape: a security property is decided by a **static
classifier over the authoring surface** (TS/JSX source, SQL text), and the classifier fails on some authoring shape
it did not account for. We fixed recognition (r1–4), then statement TYPE / expression FORM / gate SCOPE (r5), then
inverted the classifiers to fail-closed on `unproven` (r6→plan-2). Round 7 proved the inversion was necessary but
insufficient: the fail-opens **moved to the enumeration boundaries the classifier still depends on** — the
taint/secret **SOURCE** set (a secret read in raw SQL is invisible: `bugz-28` B1), the dangerous **SINK** set
(`meta http-equiv=refresh`, spread attributes, `FOR UPDATE`: `bugz-28` B2/B3), and the proven-safe **allowlist**
(over-blocks legitimate reads: `papercuts-26` P2), plus a regress in the completeness _proofs_ themselves
(`papercuts-26` P4/P5).

**The theorem underneath.** The authoring surface is Turing-complete (arbitrary TS; raw SQL is arbitrary text). By
Rice's theorem, no static classifier over it can be simultaneously **sound** and **complete**. Plan-2 correctly chose
_sound-by-default_, but that only **relocates** the problem onto three enumerations that must each be complete:

1. the **SOURCE** enumeration (what is untrusted/secret) — _provably un-closable statically_: raw SQL, dynamic
   dispatch, reflection are blind channels the AST cannot see into (SPEC §5.2 #10 forbids `getText`-based facts for
   exactly this reason). `bugz-28` B1 is a _category_, not a bug.
2. the **SINK** enumeration (what positions are dangerous) — a denylist always one position behind. `bugz-28` B2.
3. the **proven-safe allowlist** — incomplete, so it fails the _other_ way and over-blocks (`papercuts-26` P2), or is
   inert entirely (`papercuts-26` P1: the SQLite parser doesn't even load).

**Conclusion.** As long as static classification of the authoring surface _is_ the security boundary, this class
recurs forever. The fix is not a better classifier — it is to stop making static classification the boundary.

## 2. The architectural principle

> **For each security property, place enforcement at the one RUNTIME choke where the property is DECIDABLE, make the
> dangerous value UNREPRESENTABLE except through that choke (type + module boundary), and use the platform's own
> enforcement where it exists. Static analysis is advisory DX and a performance optimization — never the proof.**

A property undecidable over the _source_ is very often trivially decidable at _runtime_ on the concrete value or via
the platform:

| Property                                        | Undecidable over source because…                               | Decidable RUNTIME choke                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Integrity (read-only / declared-table)          | raw SQL, volatile funcs, `FOR UPDATE`, DDL are open-ended text | the **database engine**: read-only transaction / authorizer / role GRANTs                              |
| Confidentiality (no secret to any egress)       | a secret can be read via raw SQL / view / computed column      | **tag the value** at the DB-read boundary; the tag is **non-coercible**; every egress choke refuses it |
| Injection/XSS (no untrusted to executable sink) | the sink set + delivery shapes (spread) are open-ended         | **contextual auto-escaping renderer**, default-deny unless a proven-unforgeable trusted brand          |

At the choke the incompleteness that plagued static analysis **disappears**, because the choke operates on the
concrete value / the platform's own model, not the syntactic shape. Raw SQL, subqueries, views, spreads, `as any`
casts — none matter to a read-only transaction, a non-coercible secret tag, or a default-escaping renderer.

## 3. This plan does NOT loosen enforcement — it makes the real boundary sound

This is the crux, because "downgrade static to advisory" can be misread as _weakening_. It is not, **provided** two
invariants (A7/A8 below) hold. The reasoning:

**Static never actually enforced these properties.** It failed open for seven straight rounds — KV433/KV426/KV435
were all shippable-around. A gate that fails open is not the security it advertises; downgrading an _unsound_ gate to
advisory removes no real security, it stops the gate from claiming to be load-bearing. The runtime choke enforces a
**superset**: everything static caught, plus everything it missed (raw SQL, casts, spreads, novel shapes). Net
enforcement goes **up**. On the other axis it also _tightens usability_: a sound-by-default blocking static gate must
(by Rice) over-block legitimate code (`papercuts-26` P2); moving enforcement to the engine means the static allowlist
need not be complete, so legit code stops breaking. **More sound and less over-blocking simultaneously.**

### 3.1 Worked example — "incompleteness degrades to _runtime enforces_"

The author writes a query with a raw-SQL projection static cannot see into (`bugz-28` B1):

```ts
// session.token is secret: kovo({ secret: ['token'] })
const q = query(
  async ({ db }) =>
    db
      .select({
        name: user.name, // static CAN see this
        detail: sql<string>`(select token from session
                         where "userId" = ${user.id} limit 1)`, // opaque SQL text — static is BLIND
      })
      .from(user), // .from() = 'user' (non-secret)
);
```

Static cannot classify the `detail` projection. Three ways to handle "static can't classify":

| The raw SQL actually returns…    | **A: degrade to UNSAFE** (today) | **B: degrade to BLOCK** (plan-2)      | **C: degrade to RUNTIME** (this plan) |
| -------------------------------- | -------------------------------- | ------------------------------------- | ------------------------------------- |
| a secret (`session.token`)       | ships (unsafe ✗) — round-7 B1    | build RED ✓                           | **runtime throws ✓**                  |
| nothing secret (a public column) | ships ✓                          | build RED (over-block ✗) — round-7 P2 | **ships ✓**                           |

In **World C**, static emits no verdict (a soft hint at most) — it neither blocks nor asserts safe. The **runtime
choke** decides on the concrete value: the managed read handle boxes `session.token` as a non-coercible `Secret` at
execution time (runtime schema knows it is secret), and every egress choke refuses the box — so a real secret is
always caught, and a legitimate read is never rejected. Static's _gap_ became a _runtime decision_, not a build
guess. That is the whole invariant: **when static can't prove, it may hint but must not be the thing that passes it
safe OR fails the build — the runtime choke calls it on the actual value.**

Same pattern on read-only SQL, which also fixes the round-7 P2 over-block:
`readonlyDb.execute(sql_select_some_fn_call)` — static doesn't know `some_fn`. Plan-2 → KV433 even for a pure
`group_concat` (false block). This plan → static abstains; the reader runs in a DB **read-only transaction**; if
`some_fn` actually writes (`setval`) the _engine_ rejects it, if it's pure it runs. The incomplete allowlist stops
mattering.

## 4. Meta-invariants (the contract this plan establishes)

- **A1 — One decidable runtime choke per property.** Confidentiality, integrity, and injection each have exactly one
  runtime enforcement point that is sound and complete on the concrete value/platform, independent of authoring shape.
- **A2 — The dangerous value is unrepresentable except through the choke.** A `Response`/wire body, a DB write, and an
  unescaped-at-executable-position value can only be produced by their choke (branded constructor + module-private
  `unique symbol` + validating type; no public structural brand, no `Symbol.for`). Completeness becomes "one typed
  door," checked by reachability/type-totality — not shape recognition. (CLAUDE.md type-level ergonomics; SPEC §11.1.)
- **A3 — Use the platform's own enforcement where it exists.** Prefer DB read-only / authorizer / GRANTs over a
  re-implemented SQL parser; prefer the renderer's contextual escaping over a dangerous-attribute denylist.
- **A4 — Static is advisory, never the boundary.** No security invariant's soundness may depend on a static gate
  being complete. Every static security diagnostic (KV406/KV433/KV426/KV435) is reworded to name its runtime choke.
- **A5 — Fail-closed defaults ship only with a COMPLETE proven-safe set, else they degrade to the runtime choke.** An
  allowlist (pure SQL functions, inert attributes) may exist as an optimization; its incompleteness must degrade to
  "the runtime choke decides," never to "block legitimate code" (`papercuts-26` P2) or "boundary inert"
  (`papercuts-26` P1).
- **A6 — Completeness proofs derive from totality.** Reachability over the real call/data-flow graph or type
  exhaustiveness; fuzzers are property-based generators over the shape grammar seeded deterministically — never curated
  lists (`papercuts-26` P4/P5).
- **A7 — No property is ever enforced by NEITHER layer.** Enforcement may only _transfer_ static→runtime, never be
  dropped in between. A static gate goes advisory **only after** its runtime choke is proven live in paranoid mode
  (A9). This is the invariant that makes §3 a strengthening rather than a loosening; it is the single thing the
  round-8 acceptance explicitly checks.
- **A8 — "Advisory" ≠ "removed."** Static keeps blocking at build time on the cases it _can_ prove (fast author
  feedback, defense-in-depth), but its **incompleteness degrades to "runtime enforces," never to "unsafe,"** and its
  **false-positives degrade to "runtime decides," never to "block legit code."** The security invariant no longer
  _depends_ on static soundness; static does not stop existing.
- **A9 — Paranoid mode is the proof, and tags are non-coercible.** (a) `KOVO_PARANOID=1` forces every static security
  classifier to return `proven-safe` (static contributes zero enforcement); a CI job runs the full app suite + the
  adversarial corpus in it and asserts BOTH: unsafe cases still throw at the runtime choke, and legitimate apps still
  build/serve green. A phase is "done" only when it passes paranoid mode. (b) A `Secret` value is **non-coercible**:
  `toString`/`valueOf`/`Symbol.toPrimitive`/`toJSON` throw a KV, so string/JSON coercion (`` `${s}` ``, `s + ''`,
  `JSON.stringify(obj)`) cannot silently launder the tag off — the tag can only be removed by audited `reveal(reason)`.

## 5. Decisions register (made here; no deferral)

- **DEC-A — Integrity: DB-native read-only readers, on a dedicated read-only pool.** Reader handles execute inside a
  database-enforced read-only context — Postgres/PGlite: a **dedicated read-only pool** whose sessions set
  `default_transaction_read_only = on` (never a per-request toggle on a shared connection, which leaks state to a
  later writer); SQLite/better-sqlite3: a separate connection opened `readonly: true` **and** `PRAGMA query_only=ON`.
  Writers use the read-write pool. This rejects INSERT/UPDATE/DELETE/DDL/`setval`/`nextval`/write-`pragma` and
  (Postgres) `FOR UPDATE`/`FOR SHARE` at the engine, for ALL statement shapes incl. raw SQL. Closes round-6 B1,
  `bugz-28` B3, all DDL-on-reader. Static read classifier → advisory.
- **DEC-B — Integrity: declared-table writes enforced by the engine.** SQLite: `sqlite3_set_authorizer` on the managed
  write connection DENIES writes to any non-declared table/column and DENIES DDL/pragma. Postgres (committed primary):
  the write transaction runs under a **request-scoped role whose GRANTs match the mutation's `tables:`** (revoke-all
  default; grant only the declared tables, schema-qualified); an out-of-scope write is rejected by the engine and
  mapped to KV406. Committed fallback if per-request roles are operationally infeasible: run the write and capture
  touched tables via `pg_stat_xact_user_tables` deltas within the transaction, ROLLBACK + KV406 on any out-of-declared
  table — **named residual:** a write producing no stat delta is not caught (documented limit). Static write-table
  extraction → advisory. Closes `bugz-27` B4 (schema-qualifier) by construction (the engine reports the real,
  schema-qualified object).
- **DEC-C — Confidentiality: non-coercible tag + engine column-lockdown + all-egress refusal.** (1) The managed DB
  handle boxes values from `secret`-classified columns as a **non-coercible `Secret<T>`** (A9b) at read time, using
  runtime schema metadata. (2) **Engine column-lockdown (strongest form):** the reader role has column-level `REVOKE`
  on secret columns, so it _cannot_ `SELECT` them without a declared capability — engine-enforced, no SQL parsing,
  sound for raw SQL. (3) **Fallback for app-server reads that legitimately need the secret:** a raw-SQL read whose
  text references a secret table tags its whole result `Secret` fail-closed (parse-fail → tag secret, so it never
  depends on the parser being present/complete). (4) **Every egress choke refuses `Secret`** — `emitToWire`/wire-JSON,
  headers/cookies, redirect `Location`, static export, logs, `reportServerError`, durable-task `lastError`/status, and
  DB writes of a foreign secret (the choke inventory, DEC-J). The `Secret` box additionally redacts under
  `util.inspect.custom` so `console.log` cannot print the field. Discharge only via audited `secret.reveal(reason)`.
  Static KV435 → advisory. Closes `bugz-28` B1 + the whole SOURCE class; the non-coercible tag closes the
  laundering-off-the-tag class (`` `${s}` ``, `JSON.stringify`, logs) uniformly.
- **DEC-D — Injection: contextual default-deny renderer; untrusted tags are DX-only.** The SSR renderer contextually
  escapes every dynamic value by the position it is emitted into, computed from the FINAL runtime attribute set (so
  spread attributes are covered — `bugz-28` B2 root). At any position not **proven inert**, a value is emitted only if
  it carries a **proven-unforgeable trusted brand** (`trustedHtml`/`trustedUrl` with audited provenance); otherwise it
  is escaped (text contexts) or refused (executable contexts: script/style/event-handler/URL-scheme/`meta-refresh`/
  `iframe srcdoc`/…). Unknown attribute/element → escape (safe); recognized-executable → refuse. **Soundness note
  (the asymmetry):** DEC-D's soundness rests on "default-deny unless a proven-unforgeable trusted brand," **NOT** on
  the completeness of an untrusted-SOURCE enumeration. `request.*` accessors return `Untrusted<string>` tags **only to
  produce better error messages**, not as a soundness dependency — so no future round should burn effort "completing"
  the request-accessor set (contrast DEC-C, where the tag IS load-bearing). Static KV426 → advisory. Closes
  `bugz-28` B2 + the SINK class.
- **DEC-E — Unrepresentability (A2).** Brand `Response`/wire body, DB exec, and `Secret`/`Untrusted`/`Trusted*` with
  module-private `unique symbol`s + validating constructors. The completeness gate becomes reachability to the single
  choke, not shape recognition.
- **DEC-F — Static re-scoped to advisory (A4/A7/A8).** Static gates remain build-time signals and the sound-subset
  perf optimization (a value the static gate proves safe skips its runtime tag/escape/read-only wrap). They go advisory
  **only after** their runtime choke passes paranoid mode; diagnostics name the runtime choke. No CI gate treats a
  static-only pass as a security proof.
- **DEC-G — Proofs from totality (A6).** Reachability / type exhaustiveness; the DEC8 corpora become seeded
  property-based generators over the read-SOURCE, SINK-position, and wrapping grammars (`papercuts-26` P5). Scanned
  source roots are derived from "packages importing the security markers," fixing the compiler/browser omission
  (`papercuts-26` P4).
- **DEC-H — Paranoid mode as a shipped CI configuration (A9a).** `KOVO_PARANOID=1` is a real, tested mode that stubs
  every static security classifier to `proven-safe`; a CI job runs the app + adversarial suites in it and asserts
  (i) every unsafe case throws at a runtime choke, (ii) every legitimate app stays green. It is each phase's blocking
  acceptance, not only the final round-8.
- **DEC-I — Ergonomics & runtime diagnostics are a soundness property.** A painful choke gets disabled or
  routed-around by real authors — that is how the class returns. So: (a) every runtime-choke throw carries a KV code +
  source provenance (which column/query/attribute) and surfaces at **first request in dev**, not as an opaque prod
  500; (b) `Secret`/`Untrusted` define the safe server-side operations that need **no** `reveal` — constant-time
  compare, hashing, re-boxing into another managed sink, passing to `emitToWire` under an audited `reveal(reason)` —
  so the common non-leaking path is friction-free.
- **DEC-J — A choke inventory is a blocking deliverable (A1/A2/A7).** Enumerate EVERY external-egress sink (wire
  `/_q`/SSR/delta/stream, headers, cookies, redirect `Location`, static export, logs, error reporter, task status, DB
  write of a foreign secret) and every DB-exec path (query/mutation/webhook Tx/storage/durable-task executor/
  `.transaction`/`.batch`/`.query`), assign each to its choke, and prove via type-unrepresentability + reachability
  that nothing reaches egress/exec except through a choke. "One choke per property" is only sound once "one" is proven.

## 6. Phases (each independently ships and collapses a class; every phase gated by paranoid mode)

### Phase 0 — Substrate (land FIRST; forces the rest, like plan-2's Phase 0)

- [x] **0.1 Non-coercible `Secret<T>` + `Untrusted<T>` (A9b, DEC-C/DEC-I).** Module-private brands; coercion throws;
      `util.inspect.custom` redacts; audited `reveal(reason)`; the allowed server-side ops (DEC-I). Unit tests: `` `${s}` ``,
      `s+''`, `String(s)`, `JSON.stringify({s})`, `console.log(s)` all throw/redact; `reveal('reason')` returns the value.
      Evidence: focused Vitest batch over `packages/core/src/secret.test.ts`, `wire-json`, `logging`, and
      `task-observability` tests proves non-coercion, audited reveal, unforgeable `Secret`/`Untrusted`, wire refusal, and
      log/status redaction.
- [x] **0.2 Paranoid mode harness (A9a, DEC-H).** `KOVO_PARANOID=1` stubs all static security classifiers to
      `proven-safe`; a CI job scaffolds the app + adversarial suites and asserts (i) unsafe→runtime-throw, (ii) legit→green.
      Evidence: `pnpm run check:paranoid-classifiers` proves the static classifier harness is advisory under
      `KOVO_PARANOID=1`; `pnpm run check:paranoid-runtime` builds/serves the starter production artifact under
      `KOVO_PARANOID=1`, verifies a legitimate route is green, and verifies an unsafe CRLF response-header attempt fails
      closed at the runtime choke. `.github/workflows/ci.yml` runs both checks via `vp exec pnpm ...`.
- [x] **0.3 Choke inventory + sole-door reachability gate (DEC-J/DEC-E).** The enumerated egress/exec sinks, each
      mapped to a choke, with a reachability test that nothing bypasses. This gate must be GREEN before any static gate is
      downgraded in later phases (A7).
      Evidence: `pnpm run check:single-choke && pnpm run check:security-brands && pnpm run check:fundamental-fixes-census`
      proves the current DEC-J egress/DB exec denominator and classified sole-door gates are green.

### Phase 1 — Integrity via the engine (biggest win, smallest change)

- [ ] **1.1 DB read-only readers on a dedicated read-only pool (DEC-A).** Acceptance (paranoid mode): both dialects,
      a reader running `setval`/`nextval`/`DROP`/`FOR UPDATE`/raw-SQL-write throws at the engine (KV433 wrapper); a
      legitimate read incl. `group_concat`/`string_agg`/`date_trunc`/raw-SQL read succeeds with the static allowlist
      stubbed off. Connection-lifecycle test: a reader connection returned to the pool never leaks read-only state to a
      writer.
  - [x] **SQLite file-backed reader enforcement.** Separate `readonly`/`query_only` connection rejects write/DDL/lock
        attempts and allows legitimate read functions.
        Evidence: `vp exec vitest --run packages/server/src/managed-db.test.ts`.
  - [x] **PGlite read transaction enforcement.** Serialized `BEGIN READ ONLY` transactions reject write/DDL/lock
        attempts and allow legitimate read functions.
        Evidence: `vp exec vitest --run packages/server/src/managed-db.test.ts`.
  - [ ] **Dedicated Postgres/PGlite read-only pool.** Sessions set `default_transaction_read_only = on` on a dedicated
        reader pool rather than relying on a per-request toggle on a shared writer-capable connection.
  - [x] **Reader/writer lifecycle no-leak proof.** A reader connection returned to the pool must not leak read-only state
        to a later writer, and writers must remain write-capable.
        Evidence: `KOVO_PARANOID=1 pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts -t "rolls back default mutation transactions"`.
- [ ] **1.2 Engine-enforced declared-table writes (DEC-B).** SQLite authorizer; Postgres request-scoped role
      (primary) or stat-delta rollback (fallback, residual documented). Acceptance (paranoid mode): a mutation
      `tables:['contacts']` writing `userx` / `otherschema.contacts` / via DDL is engine-rejected (schema-qualified); an
      in-scope write succeeds.
  - [x] **Managed write runtime choke and policy threading.** The current runtime choke rejects undeclared `userx`,
        `otherschema.contacts`, DDL/pragma-style writes, and unproven SQL-function side effects before driver execution;
        framework-owned managed write handles thread declared-table policy to engine-capable adapters before
        parser-blind builders run.
        Evidence: `vp exec vitest --run packages/server/src/managed-db.test.ts`.
  - [ ] **SQLite authorizer enforcement.** `sqlite3_set_authorizer` denies writes to non-declared tables/columns and
        denies DDL/pragma at the engine, not only at the parser/choke layer.
  - [ ] **Postgres declared-table engine enforcement.** Request-scoped role GRANTs, or the documented stat-delta
        fallback, reject schema-qualified out-of-scope writes and allow in-scope writes.
- [ ] **1.3 Static SQL classifier → advisory (DEC-F, gated by A7).** Only after 1.1/1.2 pass paranoid mode. A
      runtime-twin deletion test proves the round-6/7 SQL corpus is enforced with the static classifier stubbed.
  - [ ] **Runtime SQL chokes live under paranoid mode.** 1.1 and 1.2 must pass their paranoid-mode acceptance before
        static SQL diagnostics stop being treated as load-bearing proof.
  - [ ] **Runtime-twin deletion proof.** The round-6/7 SQL corpus must still fail at runtime with the static classifier
        stubbed to `proven-safe`.

### Phase 2 — Confidentiality via non-coercible tags + engine lockdown

- [ ] **2.1 Tag secret values at the DB-read boundary (DEC-C 1/3).** Query-builder + view + computed + raw-SQL reads
      all produce `Secret` (raw-SQL fail-closed by table reference; parse-fail → tag).
  - [x] **Starter `readonlyAppDb` secret boxing for declared auth projections.** The starter read boundary boxes
        declared auth secret-key projections and refuses a Drizzle-view-surfaced `Secret` at query-wire egress.
        Evidence: `KOVO_PARANOID=1 vp exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t 'Drizzle view'`.
  - [x] **Scaffold-declared custom secret columns and raw-SQL aliases.** Generated PGlite and SQLite runtime DB
        templates derive `kovo({ secret })` metadata, attach the Kovo-owned read-boundary hook for query-loader
        `context.db`, box custom secret columns, and fail closed when raw SQL against a secret table returns an
        unclassified alias to query wire.
        Evidence: `pnpm exec vitest run packages/create-kovo/src/index.build.prod-artifact.security.test.ts --testNamePattern "boxes schema-declared secret reads"`.
  - [ ] **General `kovo({ secret })` runtime metadata extraction.** Every `context.db` query-builder, view, and computed
        read path must box secret-classified columns as `Secret` at the DB-read boundary.
  - [ ] **Raw-SQL secret fail-closed tagging.** Raw SQL that references a secret table tags the whole result `Secret`;
        parse-fail must also tag rather than depend on parser completeness.
- [ ] **2.2 Engine column-lockdown for the reader role (DEC-C 2).** Reader role `REVOKE` on secret columns; reading a
      secret column requires a declared capability. Acceptance: the reader role cannot `SELECT` a secret column via raw SQL.
  - [ ] **Reader role column-level `REVOKE`.** Default reader role cannot `SELECT` secret columns, including through raw
        SQL.
  - [ ] **Declared secret-read capability.** Legitimate server-side reads that need the secret use a declared capability
        and still route egress through `Secret`/`reveal` policy.
- [ ] **2.3 Every egress choke refuses `Secret` (DEC-C 4, DEC-J).** Wire, headers, redirect, static export, logs,
      error reporter, task status. Acceptance (paranoid mode): `bugz-28` B1 raw-SQL leak throws at the wire with static
      KV435 stubbed; `reveal('reason')` passes; a secret in a log/error/status is refused/redacted (`papercuts-25` O.1).
  - [x] **Current external-egress choke inventory refuses or redacts runtime `Secret`.** Wire JSON, framework headers,
        redirect `Location`, static export headers, logs, error reporting, and task status are covered at their runtime
        egress sinks.
        Evidence: `packages/server/src/secret-egress.ts` plus the focused `query-endpoint`, `response-posture`,
        `static-export-headers`, `logging`, `diagnostics`, and `task-observability` tests.
  - [ ] **Raw-SQL/view/computed leak acceptance.** `bugz-28` B1-style raw-SQL leaks must throw at wire egress with
        static KV435 stubbed; blocked on 2.1 DB-read boundary boxing.
  - [ ] **Audited reveal acceptance.** `reveal('reason')` must pass through the relevant egress choke with audit-grade
        provenance.
- [ ] **2.4 Static KV435 → advisory (DEC-F, gated by A7).**
  - [ ] **Confidentiality runtime chokes live under paranoid mode.** 2.1/2.2/2.3 must prove no property is enforced by
        neither layer before KV435 incompleteness degrades to runtime.
  - [ ] **KV435 runtime-twin deletion proof.** The confidentiality corpus must still fail at runtime with static KV435
        stubbed to `proven-safe`.

### Phase 3 — Injection via a contextual default-deny renderer

- [x] **3.1 `Untrusted` request tags (DEC-D, DX-only).** Accessors return tags; used for error messages, not soundness.
  - [x] **Body, route, and query request values are tagged and revealed by validation.** Parsed JSON/FormData leaves,
        route params/search, and query search inputs are tagged with `Untrusted`; schema/CSRF validation reveals with
        framework-owned reasons.
        Evidence: `vp exec vitest --run packages/server/src/untrusted-request-body.test.ts`.
  - [x] **Kovo-owned header/cookie accessors tag values.** Request header/cookie accessors tag values, and CSRF
        Origin/anonymous-cookie validation reveals them with framework-owned reasons.
        Evidence: `vp exec vitest --run packages/server/src/untrusted-request-body.test.ts` and
        `vp exec vitest --run packages/server/src/csrf.test.ts -t 'origin|anonymous|cookie|CSRF'`.
  - [x] **Request-shell accessor contract is explicit.** Native `Request.headers` remains the plain platform API by
        design; the supported Kovo-owned request accessor surface should be documented/covered as DX provenance, not a
        soundness dependency.
        Evidence: `vp exec vitest --run packages/server/src/untrusted-request-body.test.ts`.
- [x] **3.2 Contextual default-deny renderer over the final attribute set (DEC-D).** Escape-by-position; refuse at
      non-inert positions unless a proven trusted brand; spread-aware; unknown→escape, executable→refuse. Acceptance
      (paranoid mode): `meta http-equiv=refresh content`, spread-delivered sinks, `<style>`, event handlers,
      `iframe srcdoc`, and a synthetic new attribute all fail closed or escape with static KV426 stubbed.
      Evidence: `KOVO_PARANOID=1 vp exec vitest --run packages/server/src/jsx-runtime.test.ts` proves spread-delivered
      event/srcdoc/style/URL sinks, final `meta http-equiv=refresh content`, script/style element text, and a synthetic
      future attribute fail closed or escape at the runtime renderer; `pnpm run check:sink-policy` remains green.
- [ ] **3.3 Static KV426 → advisory (DEC-F, gated by A7).**
  - [x] **Runtime renderer choke is live under paranoid mode.** Spread-delivered executable sinks, `meta refresh`,
        script/style text, and synthetic future attributes fail closed or escape with static KV426 stubbed.
        Evidence: `KOVO_PARANOID=1 vp exec vitest --run packages/server/src/jsx-runtime.test.ts`.
  - [x] **KV426 diagnostic/proof-scope wording is honest.** Static KV426 is described as advisory/defense-in-depth and
        names runtime chokes as the security boundary.
        Evidence: `pnpm exec vitest --run packages/core/src/diagnostics.test.ts scripts/check-classifier-verdict-routing.test.mjs scripts/check-fail-closed-classifiers.test.mjs`.
  - [ ] **KV426 runtime-twin deletion proof.** The trusted-output/sink corpus must still fail at runtime with static
        KV426 stubbed to `proven-safe`.

### Phase 4 — Unrepresentability + honest static + total proofs

- [ ] **4.1 Choke unrepresentability (DEC-E).** Brand the constructors; reachability gate replaces shape recognition.
  - [x] **Current egress/DB-exec denominator has a sole-door reachability gate.** The DEC-J inventory and classified
        sole-door gates are green for the current denominator.
        Evidence: `pnpm run check:single-choke && pnpm run check:security-brands && pnpm run check:fundamental-fixes-census`.
  - [x] **`Secret`/`Untrusted` brands are module-private and non-coercible.** Forged structural brands fail and
        accidental coercion does not launder the runtime tag.
        Evidence: `packages/core/src/secret.test.ts`.
  - [ ] **Response/wire-body constructor unrepresentability.** A response or wire body should be constructible only
        through the framework choke or an audited escape path.
  - [ ] **DB exec constructor unrepresentability.** DB execution paths should reach managed read/write chokes by type and
        reachability, not by curated shape recognition.
  - [x] **Escape-hatch forgery rejection.** Shadowed `reveal`, `declareOffWire`, fake trusted brands, and bare casts must
        be rejected or fail to satisfy the validating constructor path.
        Evidence: `pnpm exec vitest --run packages/drizzle/src/index.query-shapes.test.ts packages/browser/src/security-output.test.ts`.
- [x] **4.2 Reword static gates as advisory + fix proof scope (DEC-F/G).** Diagnostics name their choke; scanned roots
      derived from marker-imports (fixes `papercuts-26` P4).
      Evidence: `pnpm exec vitest --run packages/core/src/diagnostics.test.ts scripts/check-classifier-verdict-routing.test.mjs scripts/check-fail-closed-classifiers.test.mjs scripts/security-test-build-gate.test.mjs scripts/lib/source-files.test.mjs`
      and `pnpm run check:fail-closed-classifiers && pnpm run check:classifier-verdict-routing && pnpm run check:security-test-builds`
      prove static diagnostics name runtime chokes/proof scope and classifier gates derive scanned package roots from
      security-marker imports, including compiler sources.
- [ ] **4.3 Property-based generators (DEC-G).** Replace index enumerators with seeded grammar generators varying
      read-SOURCE / SINK-position / wrapping (`papercuts-26` P5).
  - [x] **KV426 trusted-output SINK-position generator.** The production proof surface consumes deterministic seeded
        grammar needles varying sink/source/wrapping shapes, and the mutation harness kills deletion of that generated
        enrollment.
        Evidence: `pnpm exec vitest --run scripts/security-test-build-gate.test.mjs scripts/security-gate-mutations.test.mjs`
        and `pnpm run check:security-test-builds && pnpm run check:security-gate-mutations`.
  - [x] **Read-SOURCE generator.** Seeded cases vary request/query/db-read source families rather than a curated index.
        Evidence: `pnpm exec vitest --run scripts/security-test-build-gate.test.mjs scripts/security-gate-mutations.test.mjs`
        and `pnpm run check:security-test-builds && pnpm run check:security-gate-mutations`.
  - [x] **General wrapping grammar generator.** Seeded cases vary aliases, helpers, local wrappers, component props, and
        other wrapping forms across the security proof surfaces.
        Evidence: `pnpm exec vitest --run scripts/security-test-build-gate.test.mjs scripts/security-gate-mutations.test.mjs`
        and `pnpm run check:security-test-builds && pnpm run check:security-gate-mutations`.
  - [ ] **Round-8 paranoid generator acceptance.** Generated adversarial cases run with static classifiers stubbed and
        prove unsafe cases hit runtime chokes while legitimate cases stay green.

### Phase 5 — Robustness cleanups surfaced by round 7 (independent)

- [x] **5.1** SQLite scaffold declares/bundles `pgsql-ast-parser` (or the choke resolves it from `@kovojs/server`) so
      the now-advisory static SQL check loads (`papercuts-26` P1). With Phase 1 shipped this is DX-only, not security.
      Evidence: `packages/create-kovo/src/index.build.scaffold.sqlite.test.ts` and packed-SQLite scaffold tests prove
      generated and packed SQLite apps declare and install `pgsql-ast-parser`.
- [x] **5.2** Drizzle view relation fixpoint terminates in bounded memory (`papercuts-26` P3); a `sqliteView`/`pgView`
      build completes and (with Phase 2) a secret surfaced through a view is refused at egress.
      Evidence: `vp exec vitest --run packages/drizzle/src/index.query-shapes.test.ts -t 'terminates cyclic.*View|Drizzle view'`
      proves cyclic `sqliteView`/`pgView` relation read derivation terminates and converges to the base read domain;
      `KOVO_PARANOID=1 vp exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t 'Drizzle view'`
      proves a Drizzle-view-surfaced runtime `Secret` is refused at query-wire egress.

## 7. Pre-mortem — what round-8 will attack, and which item closes it

The plan is self-auditing: each anticipated next-boundary attack is named with the item that closes it and the
paranoid-mode test that proves it.

| Anticipated round-8 attack                                                                           | Why it would work if unaddressed                          | Closed by                                                            | Proof                                               |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------- |
| Launder the tag: `` `${secret.token}` `` / `JSON.stringify(row)` / `console.log(row)`                | dynamic taint doesn't propagate through JS ops            | A9b non-coercible box + `inspect.custom` (0.1, DEC-C)                | 0.1 coercion tests + 2.3 log/status                 |
| A wire/egress path that skips `emitToWire` (raw `Response`, header, SSE, static export, error shell) | choke isn't the sole door                                 | DEC-J inventory + DEC-E unrepresentability (0.3, 4.1)                | 0.3 sole-door reachability gate                     |
| Static relaxed before the runtime choke is live → neither enforces                                   | temporal gap during migration                             | A7 ordering + phase-gating (1.3/2.4/3.3 after paranoid pass)         | per-phase paranoid mode (DEC-H)                     |
| Postgres writer scope unsound/unimplemented                                                          | Postgres has no per-statement authorizer                  | DEC-B role-GRANT primary + stat-delta fallback (1.2)                 | 1.2 out-of-scope-write test, both mechanisms        |
| Reader connection leaks read-only state to a later writer                                            | per-connection `query_only`/txn state on a shared pool    | DEC-A dedicated read-only pool (1.1)                                 | 1.1 connection-lifecycle test                       |
| A forged escape hatch (shadowed `reveal`/`declareOffWire`/fake brand)                                | escape hatch becomes the next shadow (bugz-21 B2 history) | module-private symbols + validating constructors (DEC-E) + audit log | reachability gate rejects a non-framework discharge |
| Author disables/routes around a painful choke                                                        | usability failure = soundness failure with a delay        | DEC-I ergonomics + safe server ops + dev-first-request diagnostics   | legit-app corpus stays green in paranoid mode       |
| Column-level REVOKE breaks a legitimate secret read                                                  | over-lockdown                                             | DEC-C fallback tag + declared capability + `reveal`                  | 2.2 legit-declared-read test                        |

## 8. Honest tradeoffs and non-goals

- **Runtime cost.** Read-only transactions: negligible. SQLite authorizer: a cheap per-prepare callback. Non-coercible
  tagging: one wrapper per secret-column value, skippable when the static sound-subset proves off-wire (DEC-F).
  Contextual escaping: the renderer already escapes; the delta is the default-deny branch. Bounded, mostly already
  paid.
- **Escape hatches stay auditable and unforgeable.** `secret.reveal(reason)`, `declareOffWire`, `trustedHtml/Url(x,
{reason})` are validated at the runtime choke via module-private symbols, so a bare cast (`as any`) or a shadowed
  helper cannot forge a discharge (SPEC §10.2/§10.3). This is the point of moving off static.
- **Static is not deleted.** It remains fast author feedback + the perf optimization; only its _load-bearing security
  role_ is removed (A4/A7/A8). This honors SPEC §11.2 (`observed ⊆ declared` is a runtime cross-check) and the
  framework thesis (verify the running artifact, not the source shape).
- **Non-goal:** sandboxing the app author from their own server code (`fs`/`child_process` in their endpoint —
  `papercuts-25` refuted). The chokes protect the framework's data/rendering/egress boundaries, not the author from
  themselves.

## 9. What "done" looks like (the acceptance that ends the round-trip)

A round-8 dogfood, driven by property-based generators over novel authoring shapes, run in **paranoid mode
(`KOVO_PARANOID=1`, every static security gate stubbed to `proven-safe`)**, finds **zero** secret-to-egress leaks,
zero untrusted-to-executable-sink injections, and zero read-only/declared-scope violations — **and** every legitimate
app in the corpus still builds and serves green (no over-block). The explicit thing it checks is **A7: no property is
enforced by neither layer** — with static disabled, the runtime chokes alone must hold. If a novel shape still leaks
with static off, a runtime choke is missing or bypassable (A1/A2 violated) — a concrete, bounded bug, not another
point on an endless enumeration.

## Latest verification

- `vp exec vitest --run packages/server/src/managed-db.test.ts`
- `KOVO_PARANOID=1 vp exec vitest --run packages/server/src/jsx-runtime.test.ts`
- `vp exec vitest --run packages/server/src/untrusted-request-body.test.ts`
- `pnpm exec vitest --run scripts/lib/source-files.test.mjs scripts/check-fail-closed-classifiers.test.mjs scripts/check-classifier-verdict-routing.test.mjs`
- `pnpm exec vitest --run scripts/security-test-build-gate.test.mjs scripts/security-gate-mutations.test.mjs`
- `KOVO_PARANOID=1 vp exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t 'Drizzle view'`
- `vp exec vitest --run packages/create-kovo/src/index.test.ts && vp exec vitest --run packages/create-kovo/src/index.build.scaffold.sqlite.test.ts -t 'runs vp check'`
- `pnpm run check:paranoid-classifiers && pnpm run check:paranoid-runtime`
- `pnpm run check:api-surface && pnpm run check:single-choke && pnpm run check:security-brands && pnpm run check:fundamental-fixes-census`
- `pnpm run check:sink-policy && pnpm run check:vp && git diff --check`
