# Secure-by-Construction Framework Plan

**Date:** 2026-06-23
**Primary objective:** extend Kovo's proven injection-boundary machine — _no unbranded value crosses a
dangerous sink; prove provenance statically at the AST; declare the fact once → derive every surface →
audit the escape hatch in `kovo explain`_ — from **integrity** boundaries (data getting _in_: XSS, SQL,
headers, redirects) to the boundaries Kovo's architecture makes uniquely enforceable but that are still
default-allow: **confidentiality** (data leaking _out_ onto the legible wire), **authorization
completeness** (default-deny, not default-audit), **least authority** (capabilities you only hold if you
declared them), **concurrency/resource** safety, and the **defense-in-depth a byte-aware compiler can mint
for free**.

This plan is the umbrella for the non-injection classes. It indexes — and must not duplicate —
`plans/sql-injection.md` (executable SQL text) and `plans/sources-sinks.md` (the source/sink inventory and
`kovo explain --trust`). Where this plan adds a capability surface (Phase 7), it unifies with the
`--trust`/source-sink inventory those plans propose.

## Review Conclusion

Kovo's shipped and planned security wins are one machine pointed at integrity. The same machine, pointed at
four new axes, closes the highest-value vuln classes Kovo currently leaves default-allow. Two structural
facts (verified, Current Evidence) determine _how_ that machine must be built and reorder the work:

1. **The compiler runs no TypeScript type checker** (`grep getTypeChecker packages/compiler/src` is empty).
   Capture analysis (`packages/compiler/src/lower/handlers.ts`) and KV330
   (`packages/compiler/src/validate/component-contracts.ts`) are name-string matches, not type or
   reachability analysis. **Consequence: branded types (`Secret<T>`, `ServerOnly<T>`, a `public()` brand)
   enforce nothing inside the compiler.** They help only under a separate `tsc` run and only at a typed
   _assignment_; a free-variable capture or an untyped flow site is invisible to them. **The brand is never
   the mechanism — AST symbol-provenance + sink classification + fail-closed runtime is.** Every feature
   below is re-anchored on that and treats the brand as defense-in-depth only.

2. **The static substrate these features need is shared and partly unbuilt.** Confidentiality,
   mass-assignment, read-only handles, and egress all need the same pass: symbol-identity provenance over the
   sound TS subset. Today the projection walk is **lexical** (`tableExpressionBase` keys on identifier text,
   so `alias(users, 'u')` defeats a secret check), the input classifier fails **open**
   (`queryInputKeyOperand`, `packages/drizzle/src/static/summaries.ts:652`, syntactic `getText() === 'input'`),
   and the §11.1 write-reachability pass exists only as fixtures + SPEC prose. Building five lexical checks
   repeats the alias bug five times. **Phase 0 builds the provenance engine once; Phases 1–6 consume it.**

## Current Evidence

- [x] Diagnostic-code ceiling is KV435; KV422–KV426 are already live source/sink and SQL-safety codes.
  - Evidence: `packages/core/src/diagnostics.ts` defines KV422 for SQL text safety, KV423–KV426 for
    source/sink and trust audits, and KV435 for the Phase 1 secret query-wire gate. The older Phase 1
    provisional KV422/KV423 allocation was stale and was corrected in this ledger.
- [x] The compiler has no TS type checker; capture analysis is a name allowlist.
  - Evidence: `grep getTypeChecker packages/compiler/src` empty; `capturesUnserializableReferences`
    (`packages/compiler/src/lower/handlers.ts:294`) is a reference-name allowlist.
- [x] Query projections serialize every selected column to the client with no confidentiality control.
  - Evidence: `query().load` shape is JSON-serialized into `<script kovo-query="…">`; no field-level secret
    concept exists. `QueryDefinition` value is unbounded `unknown` (not `JsonValue`-bounded).
- [x] Client handler closures re-emit captured imports into the client module unchecked for confidentiality.
  - Evidence: `clientImportDependencies` (`handlers.ts:197`) and `clientConstantDependencies` (`:206`)
    re-emit captured bindings; KV201 checks serializability only. Same-module non-literal consts are already
    dropped by the static-literal filter (`packages/compiler/src/parse.ts`), so the live hole is the
    named-import + `publishToClient`-derivation channels.
- [x] Authorization default is default-allow with advisory audit; KV414 covers only `owner:` tables.
  - Evidence: `guard?` is optional on query/route/mutation/endpoint; `--unguarded`/`--unscoped` are advisory
    (`packages/cli/src/graph-output.ts`); KV414 fires only on `owner:`-annotated tables (§10.3).
- [x] Mass assignment is unguarded; `s.object()` gates parsing, not write-reachability.
  - Evidence: no protected-column classification; `owner:` is read-side IDOR only; the CRM fix in
    `plans/fix-security.md` Phase 5 removed client-controlled identity by hand. Input classifier fails open
    (`packages/drizzle/src/static/summaries.ts:652`).
- [x] Raw global `fetch()` is unguarded in every server context; no egress model.
  - Evidence: no egress allowlist/IP-deny/redirect-recheck primitive; `plans/sources-sinks.md` already lists
    "config/env → origin" as a source with no sink lane.
- [x] CSP hash-locking already ships but is opt-in; strict-dynamic / Trusted Types / SRI absent.
  - Evidence: `packages/server/src/csp.ts` mints inline-script/style hashes with non-overridable
    base-uri/object-src/form-action/frame-ancestors; the app must call `renderContentSecurityPolicy` to set
    the header. No `strict-dynamic`, no Trusted Types, no SRI in repo or SPEC.
- [x] Uploaded files are stored/served with verbatim client `Content-Type`; bytes are already buffered.
  - Evidence: `packages/server/src/schema.ts:340-341` puts `await file.arrayBuffer()` with the client
    `file.type` as `contentType`; `respond.file`/`respond.stream` already add `nosniff` + attachment default.
- [x] Pre-dispatch shell bounds size and rate only; the schema engine has no shape bounds.
  - Evidence: `packages/server/src/app-load-shed.ts` enforces `maxBodyBytes` (413) and rate (429); no
    depth / array-length / node-count cap in the `s.*` parser.
- [x] No session-rotation, signed-URL, or wire string-format primitives exist.
  - Evidence: `rg rotateSession packages/server/src` empty (`sessionProvider` is a read-only resolver);
    `rg presign|signUrl|signedUrl` empty (`packages/core/src/storage.ts`, server); no `.email()/.url()/
.pattern()` on the wire schema surface; `verifier.ts` constant-time compare is inbound-webhook only.

## Settled Design Decisions

- **Brands are defense-in-depth, not the proof.** Because the compiler has no type checker, every guarantee
  is carried by AST symbol-provenance + sink classification + fail-closed runtime. A `Secret<T>` /
  `public()` brand may also exist for `tsc`-time ergonomics, but no checkbox may claim by-construction
  safety _on the brand alone_.
- **Provenance is symbol-identity, intra-procedural, fail-closed on `Unknown`.** Lattice
  `Literal | ServerProvenance | InputProvenance | Unknown`; `Unknown ⊔ anything` = flag/reject for the
  write/leak gates (sound: never silently passed). This mirrors the SQL plan's settled lattice and inverts
  the read-side IDOR classifier's fail-open posture for the write/leak direction.
- **Runtime taint is unsound and is never a guarantee.** JS string ops strip marks; only static AST
  provenance (compile time) or runtime sink-validation (checking a final value's grammar/shape) are sound.
  Log/error secret-redaction is explicitly best-effort defense-in-depth, never a by-construction claim.
- **Default-deny is a mandatory total field, not an injected guard.** The teeth are a required `access:`
  property (omission won't compile), not auto-injecting `authed` (which would violate Constitution #2).
- **New security KV codes must be re-verified free against `diagnosticDefinitions` before test names land.**
  KV422–KV426 are already live SQL/source-sink codes; Phase 1 uses KV435 for the secret query-wire gate.
  The remaining provisional allocation in the table below is not authoritative until verified.
- **Confidentiality is Scope B (decided 2026-06-23).** The secret boundary covers every `JsonValue`-bounded
  client sink — query results, island state, and `fail()` payloads — not just the query wire. This requires
  making `JsonValue` the bound on query results and `fail()` (a deliberate breaking change; the framework is
  pre-release and breaking changes are accepted across this plan).
- **Authorization is default-deny via a mandatory `access:` field (decided 2026-06-23).** No default, no
  auto-injected `authed`; `public('reason')` and `access: verified` are the explicit non-guard inhabitants;
  `public()` reasons live in a reviewed snapshot; the migration assigns a real decision at every call site
  (no `public('TODO')` stubs).
- **Mass assignment is schema-anchored + fail-closed (decided 2026-06-23).** `owner:` columns and PKs are
  auto-governed; `governed: true` marks the rest; a write reaching a governed column from client input is
  a blocking diagnostic. Escape hatches: `serverValue(v, reason)` (non-input only) and the louder audited
  `adminAssign(input.x, reason)`; helper false positives use `kovoAnalyzerSummary`, not `serverValue` waivers.
- **Egress/SSRF is a runtime private-network deny floor, not a by-construction gate (decided 2026-06-23;
  metadata path workflow-verified).** Public/external egress is unrestricted; private/loopback/link-local
  destinations are denied by default and reachable only via a narrow `host:port` allowlist (provenance-blind →
  no broad CIDRs); the compile-time channel ban and KV427 are dropped. **Enforced at BOTH undici (`dispatch()`,
  not connect-only — pooled-socket reuse) AND `node:http`/`net.connect`** — AWS/GCP credential fetches use raw
  `node:http` and bypass undici, so a dispatcher-only floor fails open. **Identity/metadata endpoints are never
  allowlisted**; they are reachable only inside a module-private `metadataAllowed` AsyncLocalStorage frame
  entered solely by per-cloud credential factories (`kovo.{aws,gcp,azure}Credential`) — unforgeable by SSRF,
  fails closed, but still runtime-DiD (same-process app code can re-patch hooks; freeze prototypes early).
  Threat model is SSRF network position (metadata theft, internal services), not external reachability or
  exfiltration. Cloud credentials use a tiered API (Tier-1 env/WIF needs no API; Tier-2 `cloud:` shell
  declaration + a shared wrapped value; Tier-3 accessors), with a high-confidence **KV427 compile gate** that
  errors when a declared-cloud SDK client is built without the `cloud.*` credential — turning the forgot-it
  runtime failure into a build error; runtime fail-closed backstops indirection/`node_modules`.
- **CSP/Trusted Types is auto-emitted, default-on, no report-only ramp (decided 2026-06-23).** Strict CSP
  (nonce + `strict-dynamic`, no `unsafe-inline`/`eval`) + a framework-sole Trusted Types policy +
  `frame-ancestors` + `nosniff` are minted by the compiler and flipped on directly (pre-release); third-party
  embeds are denied until allowlisted (fail-closed forcing function). SRI is an advisory completeness manifest
  (KV431), not byte-integrity (`import()` can't enforce it). Runtime defense-in-depth, not by-construction.
- **Server-only secret taint uses per-binding provenance only (decided 2026-06-23).** The gate shares Item 1's
  `secret()`/`process.env` provenance (one concept, two sinks: query wire + client module); **no `.server.ts`
  suffix or pragma** (Kovo's compiler already splits server/client, making the suffix a false-positive-prone
  crutch); `ServerOnly<T>` is `tsc`-time sugar, not enforcement; derivation is fail-closed; `publishToClient`
  is the audited escape. Server-code bundling is a separate inference-first lint, not part of this.
- **File-upload safety defaults to attachment + re-encode-for-inline (decided 2026-06-23).** Everything is
  served `attachment` + `nosniff`; inline is a branded opt-in requiring verified-safe bytes (deep sniff or
  framework re-encode); SVG is rasterized or attachment-only; storage keys are server-generated random (user
  filename is metadata only); `.mime()` is removed; `accept.unverified()` is the audited escape. KV428. The
  guarantee is "attacker bytes never rendered inline as active content," not "sniffed type is unspoofable."
- **TOCTOU atomicity ships primitives-first with an option-(a) gate (decided 2026-06-23).** Typed
  compare-and-set + `kovo({ version })` optimistic concurrency (with a typed 409 re-render) ship independently;
  the KV429 static gate flags read-then-write only on declared `atomic`/`version` columns (KV414 philosophy),
  sequenced after the write-reachability pass; DB constraints (`CHECK`) are the fail-closed backstop; multi-row
  invariants use `forUpdate`/SERIALIZABLE (not by-construction). The mutation tx alone (READ COMMITTED) does
  not prevent lost-update.
- **Input-shape DoS is a runtime budget + audit lint (decided 2026-06-23).** A default depth/breadth/node
  budget enforced in the `s.*` parser before descending (covering JSON, FormData, `/_q/`, route params) is the
  protection; `.max()` overrides + a global ceiling declare legitimate large inputs; KV430 is a lint nudging an
  explicit bound, not an error. Closes the small-body-huge-work class the byte+rate limiter misses.
- **Cookies ship the reduced safe-default floor, not fixation-as-compile-error (decided 2026-06-23).** The
  typed builder forces `HttpOnly`/`Secure`/`SameSite` from a cookie class; KV432 errors on an insecure downgrade
  without `unsafeCookie`; forwarded `Set-Cookie` (better-auth) is normalized through the floor + audited in
  `--cookies`; app-data sealing is an optional tamper-evidence add. Fixation is a documented obligation +
  optional advisory lint; `rotateSession()` deferred (Kovo doesn't own session identity, §6.5).
- **Write-reachability-dependent gates require BOTH stages; the by-construction stage is NOT optional (decided
  2026-06-23).** Read-only query handles (KV433), mass-assignment, and TOCTOU (KV429) each ship a
  runtime/primitive safe-default now and a static gate built on the shared §11.1 write-reachability pass. The
  safe-default is a backstop, not a stopping point — the plan is NOT complete until the §11.1 pass and all three
  static gates land. Build the pass once; it serves all three (+ the SQL write analysis).
- **Error/logging/coercion split by honesty (decided 2026-06-23).** Prod error opacity (12a, opaque +
  correlation id) and proto-pollution-safe coercion (12b, null-proto + reject `__proto__`/`constructor`/
  `prototype` across FormData/JSON/`/_q/`/params) ship as sound runtime safe-defaults (no KV codes). Secret-safe
  logging (12c) is the `Secret<T>` brand + Item-1 wire gate (sound DiD); any runtime log redactor is opt-in,
  best-effort, and explicitly NOT a guarantee (value/key-name scrubbing is the unsound taint the plan forbids).
- **Capability-URLs are a typed `signUrl` primitive, by-construction at the verify sink (decided 2026-06-23).**
  HMAC over canonicalized `method+key+expiry+scope` (framework secret), constant-time verify at a framework
  download endpoint before any storage read; short-expiry default; `oneTime` via the replay store; mints audited
  in `--capabilities`. The verify is sound; the URL-as-credential leakage is mitigated (short/scoped/one-time),
  not proven.
- **ReDoS-safe validators: blessed linear formats + literal-only `pattern()` + static reject + step-budget
  (decided 2026-06-23).** `email`/`url`/`uuid`/`slug` ship as audited backtracking-free matchers; `pattern()`
  requires a compile-visible literal with KV434 static exponential-structure reject + a runtime step-budget;
  `unsafeRegex(re, reason)` is the audited escape; the full RE2 engine is deferred. Designed safe before the API
  exists.
- **Phase 0 ships complete before any consumer feature (Option A, decided 2026-06-23).** The shared
  provenance engine is a hard prerequisite _gate_, not built incrementally inside the first consumer: its
  full multi-consumer API and fail-closed posture land and are conformance-tested first, so every feature
  phase is sound on arrival and no consumer ever ships an interim lexical check (the alias-bypass anti-feature
  — `tableExpressionBase` keys on identifier text, defeated by `alias()`/rename; the fix is symbol identity
  via `resolvedSymbolKey`/`aliasedSymbol`, already used by the receiver/WHERE analysis).

### Provisional diagnostic allocation (verify free before use)

| Code  | Class                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------- |
| KV422 | _(already assigned in SPEC §11.3)_ SQL text injection risk                                         |
| KV423 | _(already assigned in SPEC §11.3)_ raw endpoint audit metadata                                     |
| KV424 | _(already assigned in SPEC §11.3)_ app-authored dangerous sink lacks a safe Kovo surface           |
| KV425 | _(already assigned in SPEC §11.3)_ source/sink registry drift                                      |
| KV426 | _(already assigned in SPEC §11.3)_ trust escape lacks auditable provenance                         |
| KV427 | Cloud SDK client built without the declared `cloud.*` credential (forgot-it compile gate, Phase 5) |
| KV428 | Inline rendering of an unverified-content-type upload                                              |
| KV429 | Read-then-write on a contended column without atomic/version guard                                 |
| KV430 | Schema admits unbounded breadth/depth on an untrusted source                                       |
| KV431 | Referenced client module absent from the integrity/CSP manifest                                    |
| KV432 | Insecure cookie downgrade without a recorded justification                                         |
| KV433 | `query()` loader reaches a write without a `query.elevated` brand                                  |
| KV434 | Non-linear-safe pattern literal in a wire string validator                                         |
| KV435 | Secret-classified query result field reaches the client wire projection sink                       |
| KV436 | Missing explicit access decision on a query, mutation, route/page, endpoint, or webhook            |

## Explicit Non-Goals

- [ ] Do not duplicate `plans/sql-injection.md` (executable SQL text) or `plans/sources-sinks.md` (the
      source/sink inventory). SQL stays there; the `--capabilities` surface here composes with `--trust`.
- [ ] Do not claim by-construction safety carried by a branded type alone (Settled Decisions).
- [ ] Do not ship per-module SRI as content-integrity: browser `import()` has no integrity gate, so SRI is
      a completeness/provenance audit only (Phase 4), not byte-enforcement.
- [ ] Do not take ownership of session storage identity in v1 beyond what `sessionProvider` already owns;
      cookie/session work ships as safe-defaults + audit, not a framework session store (Phase 5).

## Phase 0: Shared symbol-provenance engine (foundation — PREREQUISITE GATE)

Build-order decision (2026-06-23): **Option A — the complete shared engine ships and is conformance-tested
before any consumer feature phase (1–6) begins.** The full multi-consumer API is designed up front; no feature
ships an interim lexical check. This front-loads the hardest, least-glamorous work with no user-visible feature
until Phase 1, accepted deliberately so every gate is sound on arrival.

- [x] Build one symbol-identity provenance/reachability pass over the sound TS subset.
  - Resolve table/column refs by Drizzle **symbol**, not lexical text, so `alias()`, re-import, and rename
    cannot defeat a check. Reuse the existing symbol machinery (`resolvedSymbolKey`, `aliasedSymbol`,
    `symbolForStaticMemberReference`, `tableNamesBySymbol`) rather than `tableExpressionBase` (which keys on
    identifier text and is alias-bypassable — see the Settled Decisions note).
  - Lattice `Literal | ServerProvenance | InputProvenance | Unknown`; trace assignments, destructuring
    (`const { x } = input`), shorthand, and operators; join takes the least-safe value; `Unknown` is
    fail-closed for write/leak gates.
  - Evidence: `packages/drizzle/src/static/symbol-provenance.ts` defines the lattice/context and
    `vp exec vitest --run packages/drizzle/src/index.symbol-provenance.test.ts` passed 7 tests on local
    `main` at `91988759`.
- [x] Design and freeze the stable consumer API up front (Option A requirement).
  - Consumers: Phase 1 (confidentiality), Phase 3 (mass-assignment), Phase 5 (egress + read-only handles),
    plus the SQL analyzer in `plans/sql-injection.md`. The API must satisfy all four before Phase 1 starts,
    so no consumer-specific assumptions leak into the engine.
  - Evidence: `packages/drizzle/src/static.ts` exports `symbolProvenanceForExpression`,
    `provenServerProvenanceForExpression`, and `provenInputProvenanceForExpression`; the focused provenance
    test above covers positive and fail-closed proof-helper cases.
- [x] Invert the read-side input classifier for write/leak direction.
  - `queryInputKeyOperand` (`summaries.ts:652`) fails open (fine for read-side IDOR, where the WHERE clause
    is separately audited). The write/leak gates must **prove server-provenance** and reject all else.
  - Evidence: `provenServerProvenanceForExpression` in
    `packages/drizzle/src/static/symbol-provenance.ts` returns proof only for `ServerProvenance`; the focused
    provenance test passed on local `main` at `91988759` and covers input/unknown values returning
    `undefined`.
- [x] Conformance test the bypass corpus before declaring Phase 0 done (the gate criterion).
  - [x] Cover Drizzle aliasing (`alias(users, "u")`), renamed import (`users as accounts`),
        intermediate table binding (`const t = users`), and destructured input provenance in the symbolic
        write-effect corpus.
    - Evidence: `vp exec vitest --run packages/drizzle/src/index.symbol-provenance.test.ts` passed 4
      tests on local `main` at `d8c52437`.
  - [x] Cover helper-returned values and remaining namespace/static-member or conditional table cases; each
        must resolve to the correct symbol or fail closed.
    - Evidence: `vp exec vitest --run packages/drizzle/src/index.symbol-provenance.test.ts` passed 7
      tests on local `main` at `1241d168`.

## Phase 1: Confidentiality field boundary (the dual of XSS) — KV435/TBD

Scope decision (2026-06-23): **Scope B — guard every `JsonValue`-bounded client boundary** (query results,
island `kovo-state`, and `fail()` error payloads), not just the query wire. Breaking changes accepted
(pre-release), so the `JsonValue`-bound retrofit is pulled onto this phase's critical path (first checkbox) by
design.

- [x] Retrofit `JsonValue` as the bound on every client-bound boundary (prerequisite for Doors 2/3).
  - Evidence: `packages/server/src/query.ts` gates `query().load` results through `JsonSerializable`, and
    `packages/server/src/mutation/definition.ts` gates `context.fail()` payloads through the same boundary;
    `packages/server/src/query-endpoint.test.ts` and `packages/server/src/mutation.test.ts` assert non-JSON
    `Date`/function payloads fail at compile time while named readonly JSON DTOs compile. SPEC §6.2/§9.2/§10.2
    now records the JsonValue-bound query/fail contract. Verified with `vp check`, `pnpm run check:api-surface`,
    and focused query/mutation Vitest coverage.
- [x] Add a column-level confidentiality fact: `kovo({ secret: true })` / `s.secret()`, declared once on the
      schema (mirrors `owner:`); generated query result types surface the column as `Secret<T>`.
  - Evidence: `packages/drizzle/src/static/schema.ts` wraps secret-annotated projected columns in
    `{ kind: "secret", shape }`, `packages/core/src/secret.ts` defines non-`JsonValue` `Secret<T>`, and
    `packages/compiler/src/types.ts` converts generated `QueryShapeFact` metadata into `QueryRegistry`
    result types where secret wrappers print as `import('@kovojs/core').Secret<T>`. Verified with
    `vp exec vitest --run packages/compiler/src/query-bindings.test.ts packages/compiler/src/registry.test.ts packages/compiler/src/compile-component.test.ts`.
- [x] Define `Secret<T>` as a brand **not assignable to `JsonValue`**, so Door 2 (`fail()`) and Door 3
      (island state) become type errors by construction. The wire/log poison (`toString`/`toJSON`) rides on
      top as defense-in-depth, not the proof.
  - Evidence: `packages/core/src/secret.ts` defines `Secret<T>` with a non-JSON brand member; compile-time
    assertions in `packages/core/src/index.test.ts`, `packages/server/src/query-endpoint.test.ts`, and
    `packages/server/src/mutation.test.ts` reject `Secret<T>` at `JsonValue`, query, state, and `fail()` client
    boundaries. Verified with `vp check` and focused core/server/Drizzle Vitest coverage.
- [x] Door 1 (query wire): reject a secret column reaching the `<script kovo-query>` projection sink via the
      Phase 0 symbol pass — the structural dual of KV236 (the proof here is AST provenance, not the type,
      because there is a Drizzle `select` to read).
  - Evidence: `packages/compiler/src/validate/confidentiality.ts` emits KV435 for component-declared
    query shapes containing `{ kind: "secret" }`; `vp exec vitest --run packages/compiler/src/query-bindings.test.ts packages/core/src/diagnostics.test.ts`
    verifies the blocking diagnostic and registry definition.
- [x] Opaque/aliased projection backstop (KV435, **error** severity): a `sql\`\``/spread/computed-key
      projection of a table carrying ≥1 secret column must fail closed unless the projection is explicit
      non-secret data. The audited reveal/redaction surface remains the separate escape-hatch item below.
  - Evidence: `packages/drizzle/src/static/query-shapes.ts` preserves spread and computed-key projections as
    unresolved facts, `packages/drizzle/src/static.ts` emits KV435 when opaque/unresolved paths read a
    secret-classified table, and `vp exec vitest --run packages/drizzle/src/index.query-shapes.test.ts`
    verifies `sql<T>` with an output schema plus spread/computed-key backstops on secret tables.
- [x] Cover Drizzle **relational** queries (`with: { author: { columns: { passwordHash: true } } }`) — a
      different AST shape than `db.select({})` and a primary leak vector. In scope for v1, not a follow-on.
  - Evidence: `packages/drizzle/src/static/query-shapes.ts` recursively derives static
    `db.query.<table>.findMany({ columns, with: { relation: { columns } } })` shapes, and
    `packages/drizzle/src/static/schema.ts` maps Drizzle `relations(...)` property names to target table column
    shapes so secret wrappers survive nested projections. Verified with
    `vp exec vitest --run packages/drizzle/src/index.query-shapes.test.ts` and
    `vp exec vitest --run packages/drizzle/src`.
- [x] Escape hatch (fork in Open Design Questions: fixed verifiable redactor set vs arbitrary `fn` behind
      `trustedReveal`): surface every reveal in `kovo explain --revealed`; arbitrary-`fn` reveals are
      audit-grade, not proof-grade. Prefer a server-side projection that never selects the secret.
  - Foundation evidence: `packages/core/src/graph.ts` now defines `revealed` explain facts, `packages/cli/src/graph-output.ts`
    renders `kovo explain --revealed` with proof/audit counts, and `packages/compiler/src/validate/confidentiality.ts`
    recognizes an explicit `revealed` query-shape wrapper without weakening opaque/spread KV435 backstops. Verified with
    `vp exec vitest --run packages/cli/src/index.kovo-explain.test.ts packages/cli/src/commands-manifest.test.ts` and
    `vp exec vitest --run packages/compiler/src/query-bindings.test.ts`.
  - Evidence: `packages/core/src/secret.ts` exposes `trustedReveal` with inline static option guidance,
    `packages/drizzle/src/static/query-shapes.ts` recognizes direct and namespace imports from `@kovojs/core`,
    `packages/drizzle/src/static.ts` emits reveal facts for `kovo explain --revealed`, and malformed
    `revealed` wrappers without metadata fail closed in `packages/compiler/src/validate/confidentiality.ts`.
    Verified with
    `vp exec vitest --run packages/core/src/index.test.ts packages/server/src/query-endpoint.test.ts packages/drizzle/src/index.query-shapes.test.ts packages/cli/src/index.kovo-compile.test.ts packages/compiler/src/query-bindings.test.ts`,
    `vp check`, `pnpm run check:api-surface`, and `git diff --check`.
  - Note: Drizzle relational `columns` remains fail-closed because that grammar has no expression slot; reveal
    projections must use the analyzed `select({ ... })` path. Runtime-only `trustedReveal` calls outside the
    Drizzle static projection analyzer are type-level escapes until a broader non-Drizzle scanner exists.

## Phase 2: Authorization completeness — default-deny (KV436)

Decision (2026-06-23): mandatory `access:` field, **no default and no auto-injected `authed`**; `public()`
reasons live in a reviewed snapshot (a new public surface is a code-review diff); signature-verified machine
endpoints use `access: verified`; the migration **assigns a real decision at every call site — no
`public('TODO')` stubs**. The build staying red until every surface genuinely decides is the migration's value.

- [x] Make `access:` a **required** field on every query, mutation, route, endpoint, and webhook; omission is
      a blocking diagnostic (KV436). Inhabitants: a guard chain, `public('reason')`, or `access: verified`
      (signature-verified machine endpoints). No default; never auto-inject `authed` (Constitution #2 — silent
      behavior-at-a-distance).
  - Evidence: `packages/server/src/{query.ts,mutation/definition.ts,route.ts,endpoint.ts,webhook.ts}`
    require `access:` in public definition types; `packages/server/src/access-graph.ts` emits KV436 for
    missing explicit access even when legacy guard/auth posture exists. Verified by `vp check`, `vp test`,
    `vp run integration`, `pnpm run check:api-surface`, and
    `access-declaration-scan/v1 misses=0`.
- [x] Keep the missing-access diagnostic orthogonal to correctness: it proves a decision _exists_, never that it is _correct_ (a
      no-op `return true` guard satisfies it). Retain KV414 (IDOR) and record every `public()` in a reviewed
      `kovo explain --access` snapshot so each public surface is a diff, not an invisible default.
  - Evidence: `packages/cli/src/index.kovo-explain.test.ts` records all public access decisions in the stable
    `kovo explain --access` snapshot, and `packages/cli/src/index.kovo-check.test.ts` proves `access: public`
    does not suppress KV414 owner-scope correctness. Verified by
    `vp exec vitest --run packages/cli/src/index.kovo-explain.test.ts packages/cli/src/index.kovo-check.test.ts`.
- [x] Migrate by updating call sites with real decisions, not stubs.
  - Mechanically port existing `guard: X` → `access: X`. For every currently-unguarded surface, assign the
    correct decision by hand — a real guard or `public('<genuine reason>')`. **No `public('TODO')` placeholder
    debt.** Touches every surface type, all fixtures, and `runGuard`; amend SPEC §10.2 and follow
    `rules/api-surface.md`.
  - Evidence: `examples/**`, `site/**`, `packages/create-kovo/templates/**`, `conformance/**`,
    `tests/integration/**`, repo-local test/helper fixtures, and generated graph inputs now carry explicit
    decisions; `SPEC.md` §6.4/§10.2/§10.3 documents explicit access. Verified by `vp check`, `vp test`,
    `vp run integration`, `node site/tutorial/run-steps.mjs`, `vp run typecheck-examples`, and
    `access-declaration-scan/v1 misses=0`.
  - Open risk: `public()` reasons are greppable intent leakage (legibility-as-confidentiality footgun);
    reasons must not carry sensitive operational detail.

## Phase 3: Mass assignment — protected columns (write-side dual of IDOR) — KV437

Decision (2026-06-23): **`owner:` columns and primary keys are auto-governed**; explicit `governed: true` for
the rest (`role`/`balance`/`isAdmin`). **Fail-closed** posture (non-negotiable — it is the guarantee). Two-tier
escape hatch: `serverValue(v, reason)` (non-input args only) and the louder audited `adminAssign(input.x,
reason)`. Helper false positives are resolved with `kovoAnalyzerSummary`, never reflexive `serverValue`.

- [x] Add the `governed` fact: auto-derive for `owner:` columns + primary keys; explicit
      `kovo({ governed: true })` for the rest. A write reaching a governed column with input-provenance is
      a blocking diagnostic (KV437; KV425 is already assigned), proven by the Phase 0 inverted (fail-closed) pass.
  - Evidence: `packages/drizzle/src/static/derivation.ts` auto-governs owner and primary-key columns, honors
    explicit `governed`, and emits KV437 through `kovo compile drizzle-static` `verificationDiagnostics`.
    Verified by `vp exec vitest --run packages/drizzle/src/index.symbol-provenance.test.ts packages/core/src/diagnostics.test.ts packages/cli/src/index.kovo-compile.test.ts`
    and `vp check packages/drizzle/src packages/core/src packages/cli/src`.
- [x] Trace destructuring/aliasing (Phase 0 bypass corpus): `const { ownerId } = input; .values({ ownerId })`
      is caught; `.values(input)` spread is rejected unless the input type provably lacks governed keys.
  - Evidence: `packages/drizzle/src/index.symbol-provenance.test.ts` covers destructured input into an owner
    column plus whole-input/spread/helper-returned governed writes failing closed with KV437. Verified by the
    focused Vitest command above.
- [x] Two-tier escape hatch, both surfaced in `kovo explain --capabilities`:
  - `serverValue(value, reason)` discharges **only non-input** arguments — `serverValue(input.x, …)` still
    fails the mass-assignment diagnostic (input provenance inside the brand is not a bypass).
  - `adminAssign(input.x, reason)` is the explicit, louder, audited path for a legitimate admin write that
    intentionally sets a governed column from client input.
  - Evidence: `packages/drizzle/src/index.symbol-provenance.test.ts` covers `serverValue` non-input discharge,
    `serverValue(input.x)` still failing KV437, and `adminAssign(input.x, reason)` emitting capability facts;
    `packages/cli/src/index.kovo-explain.test.ts` covers `kovo explain --capabilities`. Verified by
    `vp exec vitest --run packages/drizzle/src/index.symbol-provenance.test.ts packages/drizzle/src/runtime-surface.test.ts packages/cli/src/index.kovo-explain.test.ts packages/cli/src/index.kovo-compile.test.ts packages/cli/src/commands-manifest.test.ts packages/core/src/graph.test.ts`.
- [x] Resolve helper false positives with `kovoAnalyzerSummary` (mark `resolveOwner`-style helpers as
      returning server provenance); document this as THE fix, not reflexive `serverValue`, which would erode
      the gate.
  - Evidence: `packages/drizzle/src/index.symbol-provenance.test.ts` covers `kovoAnalyzerSummary` proving a
    resolveOwner-style helper returns private/server provenance without using `serverValue`. Verified by the
    focused Vitest command above.

## Phase 4: Server-only secret taint into client modules (diagnostic code TBD)

Decision (2026-06-23): the secret gate is **per-binding AST provenance only** — `secret()`/`process.env`,
**shared with Item 1** (one "secret" concept, two sinks: query wire + client module). **No `.server.ts` suffix
and no `// kovo:server` pragma** — Kovo already splits server/client by construction (the compiler emits
`*.server.js`/`*.client.js` and tracks handler imports), so the suffix is a Next/Remix crutch that only adds
false positives. `ServerOnly<T>` is at most `tsc`-time sugar, never the enforcement (no type checker in the
compiler). Derivation is fail-closed.

- [x] Add AST-origin secret provenance on handler-closure captures + an emit filter. The live hole is the
      named-import channel (`clientImportDependencies`, `handlers.ts:197`) and same-module non-literal consts.
      Provenance reuses the Phase 1 `secret()` lattice — one concept, second sink.
  - Evidence: `packages/compiler/src/scan/parse.ts`, `packages/compiler/src/lower/handlers.ts`, and
    `packages/compiler/src/emit/client.ts` record `process.env`/`secret()` provenance, fail closed on imported
    data captures with KV201, and redact blocked client handler bodies. Verified by
    `vp exec vitest --run packages/compiler/src/handler-lowering.test.ts`, `vp check packages/compiler/src packages/core/src`,
    and `git diff --check`.
- [x] Fail-closed derivation: any reference to a secret-provenance binding taints the result
      (`KEY.slice(0,4)`, `{ k: KEY }`, `cond ? KEY : ''`); the only escape is `publishToClient`.
  - Evidence: `packages/compiler/src/handler-lowering.test.ts` covers `process.env` and `secret()` direct
    captures plus `slice`, object, and conditional derivations; verified by
    `vp exec vitest --run packages/compiler/src/handler-lowering.test.ts`.
- [x] `publishToClient(derive, { reason })` is the audited, recorded escape — an author assertion (a loud
      `as`), surfaced in `kovo explain --capabilities`; the derivation is NOT checked. Frame honestly.
  - Evidence: `packages/compiler/src/handler-lowering.test.ts`, `packages/compiler/src/registry.test.ts`,
    and `packages/cli/src/index.kovo-explain.test.ts` cover non-empty static reasons, KV201 fail-closed
    missing/non-static reasons, client emission, app graph capability facts, and `kovo explain
--capabilities`; verified by `vp exec vitest --run packages/compiler/src/handler-lowering.test.ts
packages/compiler/src/registry.test.ts packages/cli/src/index.kovo-explain.test.ts
packages/core/src/index.test.ts`, `vp check packages/compiler/src packages/core/src`, and
    `git diff --check`.
- [ ] `ServerOnly<T>` brand, if shipped, is `tsc`-time ergonomic sugar only.
  - Open risk: `process.env` retention changes the `ModuleScopeBindingModel` invariant (non-literal bindings
    are dropped today, `parse.ts`); scope the refactor blast radius.
- [ ] Separate concern (NOT this phase): "don't bundle server code/deps into the client" is a module-graph
      property, not a secret. If needed, handle via inference (flag a client-reachable import of a module
      transitively using Node builtins) as a small lint; Kovo's existing component split already covers most.

## Phase 5: Least authority — capabilities you only hold if you declared them

- [ ] **Egress / SSRF — private-network deny (runtime floor; no compile-time channel ban).**
      Decision (2026-06-23): the threat is SSRF _network position_ (cloud metadata, localhost sidecars, internal
      services), not reaching public sites. **Public/external egress is UNRESTRICTED; private/loopback/link-local/
      metadata destinations are DENIED by default, reachable only via a narrow `host:port` allowlist.** The
      compile-time channel ban (former KV427) and mandatory declared external channels are **dropped** — not worth
      the friction. This is an explicit runtime defense-in-depth floor, not a by-construction proof (an IP is only
      knowable at resolve time, so the check must be runtime sink-validation).
  - [ ] **Dual-layer enforcement (verified necessary 2026-06-23).** A `setGlobalDispatcher`-only floor fails
        OPEN: AWS IMDS (`@smithy/credential-provider-imds`, raw `node:http`) and GCP (`gaxios`/node-fetch)
        bypass undici entirely, so `require('http').get('http://169.254.169.254/…')` never hits it. Enforce at
        BOTH (a) a custom undici dispatcher and (b) the `node:http` / `net.Socket.prototype.connect` layer. The
        allow/deny DECISION runs at undici's per-request `dispatch(opts,handler)`, **not connect-only** —
        pooled-socket reuse skips `beforeConnect` (proven: 3 same-origin fetches fire the connect guard 2×), so
        a connect-only gate fails open on socket reuse. Keep the connect/lookup hook for IP classification +
        DNS-rebinding pinning. (ALS context propagates into both the undici connector and `net.connect` —
        verified Node v24.)
  - [ ] Decision rule (both layers, per request AND per redirect hop): resolve → normalize (IPv4-mapped
        `::ffff:`, decimal/octal/hex, NAT64) → pin to the exact validated IP. Public IP → allow. **Identity/
        metadata endpoint** (`169.254.169.254`/`.170.2`/`.170.23`, Azure loopback `IDENTITY_ENDPOINT`) → allow
        ONLY if the privileged metadata ALS scope is active (below), else deny — **never** via `allowInternal`.
        Other private IP ({127/8, ::1, fe80::/10, 10/8, 172.16/12, 192.168/16, fc00::/7, 100.64/10, 0.0.0.0,
        IANA special-use}) → allow iff `host:port ∈ allowInternal`, else deny. Native-TCP DB drivers
        (`pg`/`ioredis`) reach declared internal hosts via `allowInternal`; raw-socket libs are governed only
        at layer (b)'s `net.connect` patch.
  - [ ] Config: `createApp({ egress: { allowInternal: ['otel:4318', 'localhost:11434', '10.0.5.2:6379'] } })`
        — **narrow `host:port` entries only.** The allowlist is provenance-blind (anything allowed is reachable
        by any caller, incl. an SSRF landing there), so broad CIDRs re-open the private space; permit but flag
        them. Starter ships a dev `allowInternal` with common localhost entries; policy is uniform across envs.
  - [ ] Fail-closed: a blocked connection throws a typed `EgressBlockedError` (502-class) logged with the
        destination + "add to `egress.allowInternal` if intended."
  - [ ] **Managed-identity wrinkle — RESOLVED via a privileged metadata ALS capability (workflow-verified
        2026-06-23).** The capability to reach an identity endpoint is "running inside the framework-owned
        credential ALS frame" — NOT a `host:port` allowlist (provenance-blind, SSRF-reachable) and NOT a stack
        frame (forgeable). A module-private `AsyncLocalStorage` (`metadataAllowed`, mirroring `jsx-context.ts:28`
        — never exported, and **no** generic `withMetadataAccess(cb)` helper, which would let app code run
        inside it) is entered ONLY by per-cloud credential factories `kovo.{aws,gcp,azure}Credential()`. AWS is
        trivial — wrap the provider fn: `credentials: () => metadataAllowed.run({on:true}, fromNodeProviderChain())`;
        the AWS memoize layer re-invokes it on lazy in-request refresh, re-establishing the scope (proven).
        GCP/Azure cost more — the app must obtain the credential from the framework factory or refresh runs
        outside the frame and is denied. A reflected SSRF never calls the factory → never enters the frame →
        denied at the same IP. **Unforgeable by SSRF** (survives await/timer boundaries that destroy stack
        frames; can't be acquired by calling through an SDK function) but NOT by-construction. **Never allowlist
        an identity endpoint.** Covers every endpoint: `169.254.169.254`/`.170.2` (ECS)/`.170.23` (EKS Pod
        Identity), Azure loopback `IDENTITY_ENDPOINT`.
  - [ ] **Credential API (tiered) + compile-time forgot-it gate (KV427).** Tier 1 — env/WIF/key-file
        deployments touch no identity endpoint, so `new S3Client()`/`new Storage()` need NO Kovo API (starter
        default; floor is free). Tier 2 — metadata-creds deployments declare the cloud once in the shell
        (`createApp({ cloud: { aws: 'instance-role', gcp: 'metadata' } })`) and pass the shared wrapped
        credential at construction: `new S3Client({ credentials: cloud.aws })`,
        `new Storage({ authClient: cloud.gcp })` (declare-once + shared value, not per-call-site re-derivation).
        Tier 3 — optional pre-wired accessors (`cloud.aws.s3({ region })`) for the popular SDKs.
  - [ ] KV427 high-confidence compile gate (reuses the code freed by dropping the channel ban — verify free):
        when the app declares `cloud.<x>`, a `new X(...)` whose `X` is imported from
        `@aws-sdk/*`/`@google-cloud/*`/`@azure/*` with the credential option **entirely absent** is a compile
        error (it would fail closed at runtime on refresh — catch it at build, per the plan's #1 philosophy).
        High-confidence scope only: package-scope detection (not a per-class list — low drift); flag ONLY when
        the credential key is missing (any explicit `credentials:`/`authClient:` value → no flag, author's
        choice); no indirection chasing. Reuses Item 5's import-binding tracking (AST-only, no type checker).
        Passing `cloud.x` without declaring it is a reverse-mistake lint. Runtime fail-closed stays the backstop
        for helpers/`node_modules`/dynamic construction the static gate can't see.
  - [ ] Fallback when a cloud SDK isn't factory-integrated: the floor **fails closed** (refresh →
        `EgressBlockedError` naming the endpoint + the fix). Prefer workload-identity-federation (IRSA/WIF) or
        env/sidecar creds so the app never HTTP-fetches an identity endpoint (floor is then free; starter
        default); IMDSv2 (token + hop-limit-1) is independent belt-and-suspenders. The wrinkle only bites
        managed-identity deployments (EC2 instance profile, ECS/Fargate, GKE/Cloud Run default SA, Azure MI),
        never Lambda/PaaS/on-prem (env creds).
  - [ ] Residual holes (document as limitations, since this is runtime-DiD not a proof): same-process app code
        can call its own `setGlobalDispatcher`, re-patch `net.connect`/`tls.connect`, or build its own
        credential provider → mitigate by freezing the dispatcher/`net`/`dns`/`tls` prototypes early at
        bootstrap and detecting re-patching (hardening, not proof); worker threads/child processes don't inherit
        the hooks (install in every worker bootstrap); GCP/Azure provider-shape drift is ongoing maintenance.
  - [ ] Audit: `kovo explain --capabilities` lists `allowInternal` (the internal-reachability holes — the
        high-value question); external egress is unrestricted, so there is nothing to enumerate.
  - [ ] Out of scope (documented): external data exfiltration (needs a full egress allowlist — an infra/network
        concern) and confused-deputy proxying. Optional typed-client sugar (`egress('https://api.stripe.com')`)
        may remain as convenience but is not a security boundary.
- [ ] **Read-only `query()` handle (KV433).**
      Decision (2026-06-23): two stages, **both required for plan completion** — the runtime safe-default is a
      backstop, not a stopping point. Sequenced (not optional): Stage 1 now; Stage 2 lands with the shared §11.1
      write-reachability pass (also required by mass-assignment and KV429).
  - [ ] Stage 1 (now, safe-default): Reader type narrows the loader handle (no `insert`/`update`/`delete`/
        `execute`) + a fail-closed runtime read-only proxy (write verbs throw at the managed handle). Catches a
        direct `req.db.insert` in a loader; the type is `tsc`-time ergonomics (unsound under `as any`); the
        proxy guards only writes through that handle.
  - [ ] Stage 2 (REQUIRED, after the §11.1 write-reachability pass): KV433 statically proves no write is
        reachable from a query loader — INCLUDING via an imported `domain()` fn called with a module-scope/
        captured handle (the confused-deputy case Stage 1 misses). This is the by-construction guarantee; the
        plan is not complete until it lands.
  - [ ] `query.elevated` stays a GET (§9.4, idempotent over `/_q/`): allow the write via the proxy + audit in
        `--capabilities`; document it MUST be idempotent-safe-to-repeat (GETs are re-fetched/prefetched).
        State-changing writes belong in mutations. Read-only raw defers to the SQL managed-handle guard.
- [ ] **Cookie safe-defaults + class-derived floor (KV432).**
      Decision (2026-06-23): ship the **reduced form (i)** — a sound cookie-attribute floor by construction;
      **fixation-as-compile-error is cut** (no `rotateSession` primitive exists, "authenticating mutation" is not
      soundly recognizable, and `better-auth` runs login inside the package so app code shows nothing to analyze).
  - [ ] Typed cookie builder forces `HttpOnly` + `Secure`(prod) + a required `SameSite` (+ `__Host-` prefix
        where applicable), derived from a cookie **class** (`session`/`auth`/`app-data`) — declare the class
        once, get the floor everywhere. Enforce at BOTH the builder (can't express insecure) and a runtime
        normalize at the `Set-Cookie` sink.
  - [ ] KV432: an explicit insecure downgrade (`Secure`/`HttpOnly` false, or `SameSite=None`) of a
        session/auth-reachable cookie without `unsafeCookie({ downgrade, justification })` is an error
        (downgrade path is audit-grade; justification surfaced in `kovo explain --cookies`).
  - [ ] Normalize forwarded `Set-Cookie` (`forwardBetterAuthSetCookie` etc.) through the attribute floor where
        safe and audit them in `--cookies` — closes the integration hole rather than documenting around it.
        2026-06-24 bounded cookie-floor slice: `packages/server/src/cookies.ts` now floors typed
        builder output and forwarded session-provider cookies to `HttpOnly; Secure; SameSite=Lax`,
        rejects KV432 downgrades without `unsafeCookie(...)`, and enforces `__Host-` constraints.
        Focused proof: `pnpm exec vitest --run packages/server/src/cookies.test.ts
packages/server/src/csrf.test.ts packages/server/src/mutation.test.ts
packages/server/src/app-document.test.ts`; `vp check packages/server/src`; `git diff --check`.
        Gap: class declaration/audit plumbing and `kovo explain --cookies` are still open, so this
        parent item and forwarded-cookie audit subitem remain unchecked.
  - [ ] Optional sound add: HMAC sealing (constant-time verify via `verifier.ts`, framework secret) for
        **app-data** cookies — framed honestly as tamper-evidence, NOT the session-id defense (`HttpOnly` is that).
  - [ ] Fixation: **documented obligation** (app/auth layer rotates the session id on login; `better-auth`
        already does) + an OPTIONAL advisory lint flagging a mutation writing `req.session.user` with no visible
        rotate (hint, not KV-error — recognition is unsound, better-auth is opaque). A real `rotateSession()`
        helper is **deferred** to a possible later session-ownership item (Kovo does not own session identity, §6.5).
- [ ] **Capability-URL primitive.**
      Decision (2026-06-23): typed `ctx.signUrl({ key, method, scope?, expiresIn, oneTime? })` dual to the cookie
      builder. **By-construction at the verify sink** (an object is un-dereferenceable without a valid token —
      sound sink-validation) + **safe-default mitigations** for the inherent URL-as-credential leakage (not a
      proof). Closes a gap the legible wire amplifies (links leak via the readable store, `Referer`, logs, shared
      caches); without it apps hand-roll HMAC URLs and hit the canonical mistakes.
  - [ ] HMAC over **canonicalized** bytes (`method+key+expiry+scope`), framework secret (anonymous-CSRF
        machinery), **constant-time verify** (`verifier.ts`) at a framework-owned download endpoint BEFORE any
        storage read; unsigned/tampered/expired → fail closed, object never read.
  - [ ] Canonicalize-before-sign (reuse the path normalization) so backslash/`//`/dot-segment cannot reopen the
        capability. Scope = per-key+method by default (optional prefix); **short expiry default**; `oneTime` via
        the replay store (reuse).
  - [ ] Do NOT embed signed URLs in the legible query store / cacheable contexts by default; list mints in
        `kovo explain --capabilities`. Revocation tradeoff documented (stateless → can't revoke pre-expiry
        unless `oneTime`; default short expiry). No new KV code — it's a provided safe API, not a static gate.

## Phase 6: Concurrency, resource, and uploads

- [ ] **TOCTOU atomicity (KV429).**
      Decision (2026-06-23): ship the **primitives first** (no analysis needed); the static gate is **option (a)** —
      flag read-then-write only on a declared `kovo({ atomic })`/`kovo({ version })` column without a guard (the
      KV414 philosophy: precise + declare-once, not blanket). Replay dedups the _same_ submit; this covers _two
      distinct_ concurrent read-decide-write requests (oversell, double-spend, coupon reuse), which survive auth and
      input validation. Note: the existing mutation tx (`READ COMMITTED`) does NOT prevent lost-update — CAS or
      version is what closes it.
  - [ ] Primitives (shippable independently): typed compare-and-set (`UPDATE … WHERE` folds check+act into one
        statement; 0 rows → conflict) and `kovo({ version })` optimistic concurrency (read carries version;
        stale → typed 409/422 the enhanced path re-renders). Wire the 409-conflict outcome into the lifecycle.
  - [ ] KV429 static gate, option (a): flag read-then-write on a declared `atomic`/`version` column without a
        CAS/version guard. **Sequence after the §11.1 write-reachability pass** (needs read-then-write
        dataflow); cross-function check-then-act is a false-negative floor until that pass lands.
  - [ ] DB-constraint backstop (recommended, fail-closed under everything): `CHECK stock >= 0`, unique
        constraints. Multi-row/aggregate invariants need `forUpdate`/`SERIALIZABLE` — documented as NOT
        by-construction (provide the tool + guidance; do not pretend CAS covers them).
- [ ] **Input-shape DoS (KV430).**
      Decision (2026-06-23): the **runtime budget is the protection** (a safe-default, not a compile-time proof);
      KV430 is an auditable lint, not an error. Closes the small-body-huge-work class the byte+rate limiter misses;
      high-ROI because it lives in the shared schema engine and protects every wire boundary at once.
  - [x] Runtime budget enforced in the `s.*` parser **before descending** (fail fast, 413/422-class, no partial
        work): default max depth, max array/record breadth, max total node count. Reuse the `Object.create(null)`
        proto-safety path for the counter. Cover JSON nesting, the FormData→object key-count expansion, `/_q/`
        arg coercion, and route params — all through the one budget.
        Evidence: `packages/server/src/schema.ts` enforces default depth/breadth/node budgets in `s.object`,
        `s.array`, and `entriesToRecord`; focused server schema/query/route Vitest coverage exercises JSON
        nesting, FormData key expansion, `/_q/` arg coercion, and route params; `vp check packages/server/src`
        passed.
  - [ ] Per-schema overrides (`s.array().max(n)`, `s.string().max(len)`) + a global config ceiling so
        legitimate large inputs (bulk imports) declare their bound (declare-once).
        Partial evidence: `packages/server/src/schema.ts` now exposes immutable `s.array(...).max(n)` and
        `s.string().max(n)` chains with focused coverage in `packages/server/src/schema.test.ts`; the global
        config ceiling remains open.
  - [ ] KV430 **lint** (not error): flag an unbounded `s.array()`/`s.record()` on a wire-reachable schema with
        no `.max()`; surface in `kovo explain`. Lint because the runtime default already protects — this just
        makes the bound explicit/auditable. Recursive (`s.lazy`) depth is runtime-only.
- [ ] **File-upload inline-XSS gate (KV428).**
      Decision (2026-06-23): **default to `Content-Disposition: attachment` + `nosniff` for everything**; inline
      rendering is a **branded opt-in requiring verified-safe bytes** (deep sniff, or framework re-encode). The
      durable guarantee is "attacker bytes are never rendered inline as active content" (attachment-default +
      re-encode), **not** "the sniffed type is unspoofable" — magic-byte sniffing proves a prefix, not the absence
      of script.
  - [x] Mint stored-upload `Content-Type` from server-sniffed bytes for the common safe signatures, not the
        client-declared `file.type`; unknown bytes fall back to `application/octet-stream`.
    - Evidence: `packages/server/src/schema.ts` derives stored upload `contentType` and async `.mime()`
      validation from `sniffUploadContentType`; `packages/server/src/schema.test.ts` covers a client MIME lie,
      real PNG/PDF signatures, and octet-stream fallback. Verified by
      `vp exec vitest --run packages/server/src/schema.test.ts packages/server/src/response.test.ts`,
      `vp check packages/server/src`, and `git diff --check`.
  - [ ] Deep sniffer probes ZIP/office containers and rejects HTML/SVG/ambiguous/polyglot for the inline path;
        for the inline guarantee prefer **server-side re-encode/rasterize** of images (framework-produced bytes
        are provably inert).
  - [ ] **SVG: rasterize or force attachment, never sniff-and-trust** (SVG is XML+script; a prefix check is
        meaningless).
  - [ ] **Server-generated random/opaque storage keys** by construction; the user filename is sanitized
        metadata used only for the download `filename`, never the key — kills path traversal/overwrite.
  - [ ] **Remove `.mime()`** (pre-release breaking change): the only verbatim-client-MIME path becomes the
        explicit `accept.unverified()` opt-out, listed in `kovo explain --capabilities`.
  - Honest scope: the common `respond.storedFile(key)` path takes a bare string key, so the static
    `VerifiedContentType` brand degrades to a runtime sidecar-marker check (refuse-to-serve-inline if
    unverified — fail-closed). Attachment content-type confusion (a lying type on a _download_) is a lesser,
    separate issue from the inline-XSS pivot this closes.
- [ ] **ReDoS-safe validators (KV434).**
      Decision (2026-06-23): blessed-formats-first + compile-visible-literal `pattern()` with static reject +
      runtime step-budget; full RE2 engine deferred. Design-the-API-safe-from-day-one (the validator API doesn't
      exist yet — cheap before apps depend on JS `RegExp` semantics, expensive after).
  - [x] Blessed linear formats: `email`/`url`/`uuid`/`slug` ship as audited backtracking-free matchers (no
        regex) — covers most needs.
        Evidence: `packages/server/src/schema.ts` implements `s.string().email()`, `.url()`, `.uuid()`, and
        `.slug()` with parser/URL/character-scan validators and no app-provided `RegExp`; `vp exec vitest --run
packages/server/src/schema.test.ts` and `vp check` passed.
  - [ ] `s.string().pattern(...)` REQUIRES a compile-visible literal; KV434 statically rejects exponential
        structure (conservative: nested/overlapping quantifiers); execute with a runtime step-budget/timeout as
        the backstop. A non-literal pattern → KV434 (unanalyzable).
  - [ ] `unsafeRegex(re, justification)` is the audited escape for genuinely dynamic patterns ("you own the
        ReDoS risk"), surfaced in `kovo explain --capabilities`.
  - [ ] Full linear (RE2-style/DFA) engine deferred unless static-reject + step-budget proves insufficient
        (avoids a heavy dep in v1). Honest: by-construction-ish (compile gate + runtime backstop); airtight only
        with the deferred engine.
- [x] **Prod error opacity (12a, CWE-209).** Unexpected handler/loader/stream exceptions return an OPAQUE error
      in prod (no stack trace, no DB/driver error text, no internal detail) + a correlation id; the real error
      is logged server-side, retrievable by id. Dev keeps the §11.3 verbose teaching-error docs. Cover the
      `respond.stream` mid-stream error path too. Runtime safe-default, sound — no new KV code.
  - Evidence: `packages/server/src/diagnostics.ts`, `packages/server/src/route.ts`, `packages/server/src/query.ts`,
    `packages/server/src/mutation.ts`, `packages/server/src/webhook.ts`, and `packages/server/src/node.ts` attach
    opaque correlation ids to unexpected 500 responses without exposing raw errors; verified by
    `git diff --check` and
    `vp exec vitest --run packages/server/src/route.test.ts packages/server/src/route-response.test.ts packages/server/src/query-endpoint.test.ts packages/server/src/mutation-no-js.test.ts packages/server/src/mutation-response.test.ts packages/server/src/replay.test.ts packages/server/src/wire-html.test.ts packages/server/src/node.test.ts packages/server/src/build.test.ts packages/server/src/webhook.test.ts packages/server/src/app.test.ts`.
- [x] **Prototype-pollution-safe coercion (12b).** FormData→object AND JSON-body→object coercion use null-proto
      (`Object.create(null)`, already used) and reject/strip `__proto__`/`constructor`/`prototype` keys before
      assignment; cover `/_q/` args + route params. Runtime safe-default, sound — no new KV code.
  - Evidence: `packages/server/src/schema.ts` materializes schema/request records as null-prototype objects
    and rejects `__proto__`/`constructor`/`prototype`; `packages/server/src/query-endpoint.test.ts` and
    `packages/server/src/route.test.ts` cover `/_q/` args and route params. Verified by
    `vp exec vitest --run packages/server/src/schema.test.ts packages/server/src/query-endpoint.test.ts packages/server/src/route.test.ts`.
- [ ] **Secret-safe logging (12c, CWE-532).** The SOUND defense is the `Secret<T>` brand (Items 1/5 — poisoned
      `toString`/`toJSON`) plus the Item-1 Scope-B `JsonValue` wire gate: a secret is hard to stringify and is
      inexpressible on the typed wire, which covers the log sink as defense-in-depth. Optional: an opt-in
      structured-logging redactor, explicitly **best-effort, NOT a guarantee** — do NOT build the value-equality
      / key-name scrubber as a security claim (it misses transformed secrets — the unsound runtime-taint the
      plan forbids — and it is the Rails/Django denylist this plan criticizes). Optional advisory lint (KV436,
      verify free) if a secret-provenance value reaches a known logging sink.

## Phase 7: Defense-in-depth the compiler mints for free — CSP / Trusted Types (KV431)

Decision (2026-06-23): **default-on directly, NO report-only ramp** (pre-release; breaking changes accepted).
Because the framework is the sole DOM-writer and emits no inline code, the strict policy fits its own output by
construction; third-party embeds that break must be allowlisted (fail-closed) — that is the intended forcing
function. Classified runtime defense-in-depth: makes a slipped-through XSS inert; does not prevent it.

- [x] Auto-emit a strict CSP by default (today opt-in): `script-src 'self' 'nonce-…' 'strict-dynamic'`, no
      `unsafe-inline`/`unsafe-eval`; the nonce flows through the request shell onto every emitted script tag.
      Build on `packages/server/src/csp.ts` (keep its non-overridable `base-uri`/`object-src`/`form-action`/
      `frame-ancestors`).
      Evidence: `pnpm vitest --run packages/server/src/document.test.ts
packages/server/src/deferred-stream.test.ts packages/server/src/hints.test.ts` proves default CSP headers,
      nonce-bearing document/deferred/hint scripts, `strict-dynamic`, no unsafe script sources, and
      non-overridable hardening directives.
- [ ] Install a Trusted Types policy with the framework as the SOLE policy (`require-trusted-types-for 'script'`)
      so any non-framework DOM-write sink (`innerHTML`/`script.src`) throws — kills DOM-XSS sinks outside the
      framework. Chromium-only (one-engine DiD; the CSP carries the cross-browser floor). **Flipped on
      directly** — app/third-party sinks that break must move to a framework-safe path or be allowlisted.
- [ ] Add `frame-ancestors` (clickjacking) and `nosniff` (MIME-confusion) to the minted policy.
- [ ] Third-party allowlist config (`script-src`/`frame-src` extras for analytics/payments/widgets), surfaced
      in `kovo explain --capabilities`. Required precisely because there is no report-only ramp — a third-party
      embed is denied until declared (fail-closed).
- [ ] KV431 is a **completeness** gate (every referenced client module is listed/allowed), not byte-integrity —
      browser `import()` has no SRI. Label any integrity manifest advisory; the real module-tamper defense is
      immutable versioned URLs + same-origin + the CSP `'self'` restriction, not SRI. Do not claim a swapped
      module is "inexpressible."

## Phase 8: Unifying capability surface

- [ ] Add `kovo explain --capabilities`: one diffable table of every surface's held dangerous capabilities —
      confidentiality reveals, egress channels, raw-db/elevated reads, raw `Response`, secrets published to
      client, and `serverValue`/`unsafeCookie`/`accept.unverified` escape hatches with justifications.
- [ ] Unify with `plans/sources-sinks.md` `kovo explain --trust` and the §11.4 Keppo contract: extend "what
      can reach this app and what can it touch" to "**and what can it leak, call out to, or write**" —
      answerable without a browser.

## Phase 9: Red corpus and acceptance

- [ ] One negative + one positive test per phase (the dangerous source is rejected/neutralized; the blessed
      path still works without forcing the raw escape hatch). Seed the confidentiality, mass-assignment, and
      egress corpora with the alias/destructure/helper bypasses Phase 0 must defeat.
- [ ] Acceptance: every new gate fails closed on `Unknown` provenance, and the bypass corpus (aliasing,
      re-import, destructuring, `globalThis.fetch`, relational `with:` selection) is green.
- [ ] Acceptance: existing security lanes stay green — `plans/fix-security.md` focused suites, the SQL corpus
      once landed, endpoint/webhook conformance, and `git diff --check`.
- [ ] Acceptance (completion gate): the shared §11.1 write-reachability pass is built AND every by-construction
      stage built on it lands — mass-assignment, KV429 (TOCTOU), KV433 (read-only query). The
      runtime/primitive safe-defaults are backstops, not completion; the plan is not green until these static
      gates ship.
- [ ] Keep this ledger compact: as items land, replace prose with the narrowest verifying command or
      authoritative file, and collapse superseded evidence.

## Open Design Questions

- [ ] Phase 0 precision dial (build-order is settled as Option A; this is orthogonal): intra-procedural only
      for v1, add trivial same-file arrow inlining, or full interprocedural summaries (reusing
      `kovoAnalyzerSummary`)? Proposed default: intra-procedural with `kovoAnalyzerSummary` as the
      helper-returned-value escape valve; finalize after measuring false-positive noise on real apps.
- [ ] Confidentiality reveal hatch: fixed verifiable redactor set vs arbitrary `fn` behind `trustedReveal`?
- [ ] Default-deny migration: is a sea of `public('TODO')` acceptable as a one-time reviewed audit, or should
      missing-access diagnostic require a non-placeholder reason after a grace window?
- [ ] Read-only handle: does `query.elevated` stay a GET (and how) or is a write-from-read always pushed to a
      mutation? Resolve against §9.4 before building.
- [ ] Egress: is the residual `node_modules`/`globalThis` socket path acceptable as a documented boundary
      (like KV406's `node_modules` hole), or does it need a runtime dispatcher interposition?

## SPEC Alignment

- [x] **Landed now (principles, ahead of implementation):** SPEC §1.1 now lists **"Secure by construction" as
      primary goal #1** (machine-auditable generation reframed as producing all three goals); §1.3 names the
      security corollary; §2 adds the **Prime Principle** (security by construction) above the five tests, keeping
      their numbers (no renumber — ~20 `Constitution #N` cross-refs preserved); Test #4 (wire) refined for the
      confidentiality dual; Test #2 consequence cites the security declare-once facts; **§6.6 gains the normative
      Security-soundness paragraph** (no type checker → brands are DiD; runtime taint unsound → static provenance;
      by-construction vs runtime-DiD labeled). `rules/constitution.md` mirrored.
- [ ] **Deferred to land WITH each feature (per-feature normative contracts):** §6.2 typed-surface rows
      (confidentiality / authorization-completeness / write-provenance); the confidentiality dual near §4.8/§5.2;
      `access:` default-deny + `governed` in §10.1/§10.3; a new outbound-egress section (classified runtime-DiD);
      `kovo explain --capabilities`/`--trust` in §11.4; new KV codes in §11.3 with the
      ceiling-note correction. Holding these avoids SPEC promising behavior that is not yet built (CLAUDE.md
      plan/SPEC-conflict rule).

## Latest Verification

- `rg -o "KV4[0-9][0-9]" packages/core/src/diagnostics.ts | sort -u | tail` — diagnostic ceiling KV421.
- `grep getTypeChecker packages/compiler/src` — empty (no type checker in the compiler).
- `ls packages/server/src/csp.ts` — CSP hashing present; header opt-in.
- `rg -n "file\.type|arrayBuffer" packages/server/src/schema.ts` — verbatim served content-type at :340-341.
- `rg -n "maxBodyBytes|429" packages/server/src/app-load-shed.ts` — size+rate only, no shape bounds.
- `rg -n "queryInputKeyOperand" packages/drizzle/src/static/summaries.ts` — input classifier at :652.
- `rg -n "clientImportDependencies|clientConstantDependencies|capturesUnserializableReferences" packages/compiler/src/lower/handlers.ts` — capture re-emit at :197/:206/:294.
- `rg -ln "rotateSession" packages/server/src` and `rg -n "presign|signUrl|signedUrl" packages/core/src/storage.ts packages/server/src` — both empty (no rotation/signed-URL primitives).
- Source design memo: multi-agent recon→design→critique workflow over the ten domains plus a completeness
  critic (TOCTOU, input-shape DoS, ReDoS, capability-URL); critiques grounded against the
  files cited above.
