# Static Analysis & Verification (SPEC §11 except §11.3)

This file is incorporated by reference from [../SPEC.md](../SPEC.md) and is normative for Kovo framework behavior.
The root spec remains the entry point and cross-reference index; this module owns the detailed contract below.

## 11. Static Analysis & Verification

### 11.1 Touch-set extraction (the static pass)

Rests on one property: **Drizzle's table argument is always an imported identifier with a statically known declaration site.**

```
For each write() body (ts-morph over the program):
  1. Find CallExpressions where callee.name ∈ {insert, update, delete}
     AND receiver's TYPE originates in drizzle-orm        ← type identity, not variable names;
                                                            renames/destructuring irrelevant
  2. Resolve argument 0:
     A. imported identifier        → follow symbol → pgTable declaration   (90%+)
     B. namespace/re-export chains → getAliasedSymbol loop
     C. alias(T, …)                → recurse on T
     D. conditional initializer    → union both branches (over-approximation is safe:
                                     missing = bug, excess = warning)
     E. runtime-flowing value      → 'unresolved' → KV406 (error: manual touches REQUIRED;
                                     dev/build/export gate blocks until supplied — §10.3)
  3. Interprocedural: helpers receiving a Drizzle-typed value are summarized bottom-up
     (memoized fixpoint); calls into node_modules with a db arg → KV406 (error, same gate).
     `update…from(R)` / `insert…select` contribute R to the READ set, not touches.
     Opaque/raw query projections (KV410, §10.2) contribute their declared `reads:`
     table set to the READ set; a `reads:` entry naming an `exempt` table is KV411.
  4. Parameterized keys: extract eq(T.keyCol, expr) from .where(); expr traceable to a
     write param ⇒ key derivation recorded; ranges/IN ⇒ table-level (KV409 notice).
  5. Whenever a write site's touch set is not fully statically resolved (any 'unresolved'
     table at step 2.E, any node_modules db call at step 3, or any raw-SQL statement whose
     mutated tables cannot be read off the AST), it is **KV406 (error)** absent a manual
     `touches`/`tables` declaration, and an unexecuted conditional write on such a site is
     **KV405 (error, CI-gating)** — see §11.2. KV405 is no longer advisory: a write site
     whose touch set is not fully statically resolved and whose branches were not all
     observed under instrumentation blocks build and static export, because the runtime
     cross-check (§11.2) cannot have proven the unexecuted arm's touch set sound.
```

Output is **reproducible on demand** through `kovo emit` / `kovo explain` and mechanically proven
by fixpoint plus render-equivalence gates. The emitted graph is also the runtime authority for
derived query reads and mutation touches; manual `reads` / `touches` are checked overrides for
opaque sites, not the default authoring model. Invalidation-graph changes are inspected through
those commands and CI evidence, not by committing app-local generated files:

```ts
// emitted generated/touch-graph.ts — DO NOT EDIT
export const touchGraph = {
  'cart.addItem': {
    touches: [
      { domain: 'cart', via: 'cart_items', site: 'cart.domain.ts:8', keys: null },
      { domain: 'product', via: 'products', site: 'cart.domain.ts:12', keys: 'arg:productId' },
    ],
    unresolved: [],
  },
} as const;
```

### 11.2 Runtime verification (independent cross-check)

Dev server and the test harness wrap `db`; every executed statement is parsed by the configured dialect path (Postgres uses `pgsql-ast-parser`; SQLite normalizes `?` placeholders before the same structural walk) and checked. Static over-approximates (all branches); runtime under-approximates (executed branches). **Invariant: `observed ⊆ static ∪ KV406-annotated`** — violation means analyzer bug or smuggled SQL; either is a CI failure. For raw-SQL writes this invariant is enforced structurally: the executor parses each statement with the configured dialect path and checks its mutated-table set against the write's declared `tables:` allowlist (§10.3). A statement that mutates a table outside `tables:` is a CI failure under instrumentation and, in production where instrumentation is absent, fails closed — the executor conservatively invalidates every domain in the write's `touches` and records the violation, never silently dropping the unexpected table's invalidation.

For managed SQL handles, runtime verification is over a framework-owned statement artifact, not the
caller-owned JavaScript object. The first managed boundary MUST snapshot every accepted carrier
(`sql` template calls, Drizzle SQL, separated `{ text, values }`, prepared statements, trusted SQL)
into an immutable statement value containing the exact SQL text, parameters, dialect, and provenance
that the framework validates. Validation, table/function classification, diagnostics,
instrumentation, and driver execution MUST consume that same immutable artifact. A mutable object,
getter-backed carrier, proxy, or object identity reused across calls cannot present one statement to
the verifier and a different statement to the driver; Kovo must either reject it or make a one-time
snapshot before any check. Passing the original carrier to the driver after validating a snapshot is
a verification bug.

On the Postgres/PGlite managed path, the engine also enforces the dangerous write-scope cases below the framework declared-write wrapper. Owner and owner-via tables are granted to the writer role only with row-level security and `WITH CHECK` policies that bind writes to the current principal, so cross-owner writes and ownership reassignment are denied by the database. Unclassified/reference tables are not granted to the writer role at all, so attempts to mutate tables such as `verification` fail with engine permission denial even if an app smuggles a raw statement past the declared-write wrapper. The framework declared-write wrapper remains load-bearing for coverage and invalidation: over-declaring among writable owner/authz-policy tables can still produce stale or excessive invalidation behavior and is a KV406 contract violation, but it is not the confidentiality/integrity boundary for cross-owner or unclassified-table writes on this engine path. Full per-mutation engine roles remain outside v1.

Because instrumentation under-approximates (executed branches only), passing dev/test runs do **not** establish KV406 completeness; an unexercised raw-SQL arm is proven sound only by its statically-declared `tables:`/`touches`, which is why those declarations are KV406-`error` (not advisory) and an unexecuted such branch is KV405-`error` (§11.1). Read-side gets identical treatment (query loaders' SELECT/JOIN tables vs. derived read sets, **and observed result shapes vs. declared/inferred types — the runtime half of KV410**, so an opaque projection's schema claim is tested against what the database actually returns; an opaque projection that reads a table absent from its declared `reads:` set (§10.2) is a CI failure on the same `observed ⊆ static ∪ declared` invariant, but the static `reads:` declaration — not this dev/test-only observation — is what proves an unexercised branch sound). An observed read of an `exempt` table is the runtime half of **KV411** (§10.1) — the same CI failure whether the exempt read was statically visible or smuggled through raw SQL.

**C9 sink-proof inventory (normative).** The verification surface MUST keep a single reviewed
inventory for the required boundary-crossing sinks named in §10.3 C9. Each row names: the sink, its
mechanism (`reconstruct`, `box`, or framework-`own`), the sole door, at least one lint/check/build
proof, at least one hostile-value test file or command, and the stable owner responsible for a gap.
The machine gate MUST compare its covered-family union with the complete source/sink census and
fail on a missing or unknown family, duplicate sink row, missing owner, absent root proof command,
or stale evidence path. The inventory is a proof index, not a runtime policy source: if a sink
exists without an inventory row, or a row has no hostile-value evidence, the verification surface
is incomplete even if the implementation happens to be sound.
For engine-door claims the inventory row points at the engine-closure audit; for wire/file/task/log
surfaces it points at the single framework-owned choke or box, never at a proxy-only wrapper.

### 11.4 The verification surface (the Keppo contract)

For a Kovo app, the following are checkable **without executing a browser**:

1. TypeScript static checking — all wiring (handlers, routes & links, forms, targets, bindings, IDREFs, transforms, guards).
2. `kovo check` — touch-graph consistency, optimistic exhaustiveness (KV310), update coverage (KV311), fixpoint + render-equivalence invariants, unguarded and unscoped audits.
3. Graph queries over `kovo explain` output — intent-level assertions ("every component displaying cart data is refreshed by cart/add") as set operations over printed, stable-format graphs.
4. Property suite — prediction ⊆ eventual-truth generative tests over hand-written transforms and derivation soundness (commuting diagrams).
5. HTTP-level integration tests — mutations as request/response assertions against pglite (real Postgres semantics, in-memory, no container).

`kovo explain --endpoints` is the stable machine-ingress audit. Its diffable table lists every declared endpoint and webhook, every `mutation()`, plus every route that returns `respond.file()`/`respond.stream()`: source-derived registry identity where applicable, method, path, mount mode, auth scheme (`session+guard`, `verifier:<resolved scheme>`, `custom:<name>`, or `none:<justification>`), CSRF/effect posture, and for webhooks the write→domain chain. Endpoint posture is `safe:read-only` for the closed `GET`/`HEAD`/`OPTIONS` set from §9.1, `checked` when an unsafe method receives the default synchronizer-token check, or `exempt:<justification>` when an unsafe endpoint explicitly opts out. Mutation posture remains `checked` or `exempt:<justification>`; a `csrf: false` mutation appears here with the latter posture, and KV418 (§6.6) guarantees it references no ambient session. The pre-dispatch coarse limiter posture (§9.5) is enrolled and printed here too. The command is snapshot-locked with the rest of P8 output so security review can answer "what can reach this app, and what can it touch?" without executing a browser.

Browser tests are a first-class part of the **framework's** own suite: morph runs on every mutation response, and its survival contract (focus, caret, scroll, transitions) plus L0 platform behaviors are irreducibly browser-bound. The reconciliation suite splits accordingly: a browser-free structural property suite (`morph(a, b) ≡ b` with keyed-node identity preserved — runs in jsdom-class DOM), and a named browser suite for the survival contract. The claim is bounded: **application wiring is proof-carrying**, so apps need few or no browser tests of their own — most SPA testing exists to compensate for unverifiable wiring, and Kovo removes that category, not testing itself.

---
