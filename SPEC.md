# Kovo — Technical Specification

**Version:** 0.2 (Draft)
**Status:** Normative specification for v1, with staged roadmap through v3
**Audience:** Framework implementers and AI app-builder integrators

---

## 1. Vision

Kovo is a web-platform-native framework for building multi-page applications that **never show stale or inconsistent UI** and are **interactive at first paint with minimal JS and CSS** — achieved by making the whole system legible at every layer and statically verifiable end-to-end.

It composes ideas from prior systems (Qwik, htmx/LiveView, RTK Query, Replicache; full prior-art table in the README) around one organizing constraint: _every artifact the system produces (compiled output, HTML, wire traffic, dependency graphs) must be readable by a human in devtools and checkable by a machine without executing a browser._

### 1.1 Primary goals

Kovo exists to deliver three outcomes, in priority order, all produced by one technique — machine-auditable generation (§1.3). Every other property of the framework — legibility, static verifiability, the auditable wire — is a _means_ to these ends.

1. **Secure by construction.** Whole vulnerability classes — cross-site scripting, SQL injection, broken access control and IDOR, confidential-data exposure, mass assignment, SSRF, request forgery, lost-update races — are not runtime hazards to test for but build/check errors that never ship, or fail-closed runtime floors where static proof is impossible. Kovo makes the insecure pattern _inexpressible_ wherever the same static analysis that proves data freshness can prove it, and forces the residue into declared, audited, suppressible-in-source decisions visible to `kovo explain`. The distinctive claim is not "secure" — every framework says that — but **secure by the same machine-auditable construction that eliminates stale UI**: one substrate, checked without a browser.
2. **Eliminate stale-UI bugs at compile time.** Inconsistent UI states — a badge that disagrees with the cart, a list that didn't reflect its own mutation, two views of one fact drifting apart — are not runtime races to debug but build/check errors that never ship. Kovo makes the staleness it can statically model (§1.2) a `tsc`/check failure, and forces the residue it cannot prove into declared, suppressible-in-source decisions.
3. **Make loading instant.** First paint is interactive, and the bytes to get there are minimal: little-to-no JavaScript on the critical path (global delegation + `import()` on first interaction, not hydration), compiler-scoped CSS with no runtime style engine, and named incremental wire deltas in prod. Performance is a budget the compiler enforces, not a guideline.

### 1.2 Thesis statement

> An application's complete behavior — every handler wiring, navigation target, form field, mutation contract, data dependency, and optimistic prediction — should be provable by TypeScript static checking plus static graph queries, and auditable by reading the page source and the Network panel.

For v1 data freshness, that proof covers staleness caused by this client's own
statically analyzable, modeled writes. Kovo turns those stale-UI paths into build
or check errors, and turns freshness gaps it cannot statically prove — raw-SQL
seams, database-engine side effects, the wall clock — into declared, checked,
suppressible-in-source decisions. Cross-session liveness is an explicit
out-of-guarantee boundary for v1 and belongs to the opt-in live tier (§9.3), not
to the core mutation proof.

### 1.3 Design driver: machine-auditable generation

Kovo is built to be the most machine-auditable compilation target a code-generation agent can emit: generated apps fail TypeScript static checking if wiring is wrong, and intent is verifiable against printed dependency graphs without headless browsers. Where a design choice trades author convenience for machine-checkability, machine-checkability wins. The corollary holds for every reader, not just agents: debugging always proceeds _down_ into plainer code, never _up_ into compiler internals. Machine-auditable generation is the chief _technique_ by which the three primary goals (§1.1) are reached: the same static analysis that lets an agent's output be checked without a browser is what makes whole vulnerability classes inexpressible (the Prime Principle, §2), turns stale-UI paths into build errors, and lets the compiler hold the byte budget.

### 1.4 Explicit non-goals

- **Figma-class shared-workspace apps.** Long-lived client sessions over one mutable heap (collaborative canvases, video editors, DAWs) are outside the sweet spot. Kovo islands can host rich widgets, but the framework will not grow a client router or global client store to serve this segment.
- **Offline-first.** Server truth is unconditionally authoritative; Kovo does not ship a sync engine.
- **App-authored persistent navigation state** in v1. Enhanced navigation may preserve unchanged compiler-stamped layout DOM when JS is present (§8), but the canonical behavior is still real URLs and server-rendered documents.
- **Browser support parity for enhancements.** Speculation Rules and invoker commands are Chromium-led; Kovo degrades gracefully (real navigations, real forms) but does not polyfill them.
- **A sanctioned JSON/REST public API in v1.** Typed public APIs need their own token-auth and schema-reuse story. Until that exists, ad-hoc JSON APIs live only behind declared `endpoint()` entries (§9.1), where their auth and CSRF posture stay visible to audits; `respond.json()` is not a route outcome.

---

## 2. The Constitution (Design Tests)

The framework's overriding commitment is the **Prime Principle**, which precedes and is served by every test below:

> **Security is by construction.** A feature crossing a trust boundary — data coming _in_, data going _out_, _who_ may act, _how much_ — makes the unsafe state inexpressible at compile time wherever static analysis can prove it (over AST symbol-identity provenance, never a branded type or runtime taint, both unsound here; §6.6), falls back to a fail-closed runtime floor where it cannot, and routes every exception through an audited escape hatch surfaced in `kovo explain`. **Default-deny over default-allow; advanced TypeScript types make the safe path explicit wherever they naturally encode the contract, but are defense-in-depth, not the mechanism; runtime floors are labeled as floors, never sold as proofs.** This turns XSS, SQL injection, IDOR/broken access control, confidential-data exposure, mass assignment, SSRF, and lost-update races into build errors or fail-closed floors — checkable without a browser, by the same machine-auditable generation (§1.3) that eliminates stale UI. It is the first primary goal (§1.1) and the lead gate here precisely because it is the highest-stakes property _and_ is delivered by the legibility, declare-once, and static-auditability the tests below enforce.

Every feature proposal is then evaluated against five design tests. A feature failing the Prime Principle or any test is redesigned or rejected. These are normative. The objectives are the three primary goals (§1.1); the tests are how those goals — security included — are kept honest under pressure.

| #   | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Consequence                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Legibility is load-bearing.** Names appear in HTML attributes and wire traffic, so they structurally cannot be mangled.                                                                                                                                                                                                                                                                                                                                                                                                                               | Minifiers cannot rename handler exports; debugging never requires decompiling the framework.                                                                                                                                                                                       |
| 2   | **No global knowledge at local sites.** Any API requiring the author to enumerate distant call sites from memory is a bug factory and is rejected.                                                                                                                                                                                                                                                                                                                                                                                                      | Killed manual fragment targets, manual per-island optimism, query-side mutation registration, call-site mass-assignment allowlists, and per-handler authorization — security facts (`secret`/`owner`/`governed`/`access`) are declared once and derived everywhere.                |
| 3   | **Sugar must lower to authorable IR.** Every compiler feature emits valid Kovo source. Compiling the output is a no-op (CI-enforced fixpoint).                                                                                                                                                                                                                                                                                                                                                                                                          | Output is auditable in devtools and mechanically checked; app authors still write TSX.                                                                                                                                                                                             |
| 4   | **The wire is the documentation.** Named POSTs and schema-shaped JSON in every environment; full self-describing HTML fragments in dev; size-optimized but still named/schema-shaped deltas against a version-validated base in prod (§9.1.1). The wire documents what the server **chose to send**, not all it knows: a `secret`-classified field is ineligible to reach the client wire or a client module, so legibility and confidentiality coexist by construction — the dual of output-safety (§5.2 rule 10, integrity), now for confidentiality. | A dev frame is a complete document auditable from the Network panel; a prod frame shows _what changed_, reconstructable via `kovo explain`. Names are never mangled in either mode (#1). A typed `secret` boundary keeps the readable wire from becoming an over-exposure channel. |
| 5   | **Server truth always wins.** No client cache to invalidate; reconciliation is "morph the authority in."                                                                                                                                                                                                                                                                                                                                                                                                                                                | Optimistic predictions are disposable; there is no consistency protocol.                                                                                                                                                                                                           |

---

## 3. Architecture Overview

```
                        AUTHORING                    COMPILED IR                  RUNTIME
┌──────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────────────┐
│  cart.tsx        │   │ cart.server.js           │   │ Self-describing HTML             │
│  (JSX, inline    │──▶│   render fns, queries    │──▶│  • plain elements, kovo-c stamps   │
│   closures,      │   │ cart.client.js           │   │  • on:click="cart.js#Cart$remove"│
│   single file)   │   │   named handler exports, │   │  • <script kovo-query="cart"> JSON │
│                  │   │   derives, transforms    │   │  • kovo-deps="cart" stamps         │
└──────────────────┘   └──────────────────────────┘   └──────────────────────────────────┘
        │                        │                                  │
        │ fixpoint:              │ 1:1 file mapping,                │ budgeted bootstrap: global event
        │ compile(IR) ≡ IR       │ source-derived names             │ delegation + import() on
        ▼                        ▼                                  ▼ first interaction
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ MPA SPINE: real URLs + server documents + optional enhanced navigation over the full-doc │
│ oracle + Speculation Rules + cross-document View Transitions + bfcache. No client router.│
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ DATA PLANE: queries (typed reads) ← invalidation graph → mutations (typed writes)        │
│ derived from domain layer / Drizzle AST. Optimistic transforms may be hand-written        │
│ or compiler-derived.                                                                     │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ WIRE: one fragment/query-JSON vocabulary, transport-agnostic:                            │
│ document load · enhanced fetch (mutations) · SSE live queries                            │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Rejected from prior art

Client-owned routers and SPA navigation state; hydration; hash-named heuristic chunks; load-bearing semantic optimizer; single global state blob; **runtime signal graphs in the core client — proprietary or TC39** (the client dependency graph is compile-time-known, so the compiler emits a per-query update plan instead; Signals interop is outside the core client); opaque closure capture (`useLexicalScope`); client-side cache with invalidation lifecycle; manual invalidation calls as the primary mechanism; **shadow DOM** (tree-scoped IDREFs, form participation, and ARIA all break at the boundary — fatal to L0 platform behaviors and the no-JS form contract; style scoping comes from the compiler instead, `plans/open-design-areas.md`); **custom-element registration** (resumability comes from delegation + `import()`, never from `customElements.define`; component identity is the `kovo-c` stamp, dashed tags survive as inert sugar, and native hosts like `<tr kovo-c="cart-row">` avoid the table-nesting problem); **load-bearing import maps** (the compiler and server emit full module URLs with cache-busting they control; import maps remain an optional deployment strategy); **portals and runtime context APIs** (composition is lexical at render time and the DOM tree is the runtime context, §4.5 — framework code never reparents islands, so `closest('[kovo-c]')` resolution stays sound; native top-layer promotion (`<dialog>`, popover) does not reparent, which is exactly why no portal is needed). Enhanced navigation (§8) is not a client router: it starts from a real `<a href>`, fetches the canonical server document, and falls back to the browser's full GET on uncertainty.

---

### 3.2 Authority and module split

`SPEC.md` remains Kovo's entry point and highest-level normative authority. The detailed contracts in `spec/*.md` are incorporated by reference and are normative with the same force as text that appears in this file. When a sub-spec and this root disagree, treat that as a specification bug: follow the more specific sub-spec for its owned domain, preserve the Prime Principle in §2, and fix the conflict in the same change that exposes it.

The split is editorial, not semantic. It reduces the root to the material readers need first: vision, constitution, architecture, an index of normative modules, and short local invariants. No framework behavior changes merely because text moved from the root to a numbered module.

`rules/` remains the standing rule layer for agents, releases, conformance, docs, and workflow discipline. `docs/` and `site/content/` remain explanatory unless this spec explicitly delegates a narrow artifact to them. Active ledgers in `plans/` sequence work; they do not override the normative contracts here or in `spec/*.md`.

### 3.3 Normative module index

| Old section(s)    | Normative module                                         | Owns                                                                                                                                                                                  |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §4, §13.1, §13.2  | [spec/04-component-model.md](spec/04-component-model.md) | Component authoring, rendered output, handlers, loader obligations, composition, primitive merging, update plans, dynamic rendering bounds, StyleX/theme tokens, `kovo-key` identity. |
| §5                | [spec/05-compiler.md](spec/05-compiler.md)               | Compiler pipeline, hard rules, render-plan version token, prod render-equivalence, and `kovo explain`.                                                                                |
| §6                | [spec/06-type-system.md](spec/06-type-system.md)         | Generated registries, package component prefixes, typed surfaces, mutation typing, routes/links, sessions, and soundness boundaries.                                                  |
| §7, §8            | [spec/07-navigation.md](spec/07-navigation.md)           | Interaction ladder, MPA spine, enhanced navigation, bfcache posture, speculation rules, view transitions, and streaming/defer behavior.                                               |
| §9                | [spec/09-wire-protocol.md](spec/09-wire-protocol.md)     | Mutation round trips, prod deltas, error envelopes, live/liveness, typed reads, request shell, HMR, durable tasks, and scheduling.                                                    |
| §10               | [spec/10-data-plane.md](spec/10-data-plane.md)           | Schema/domain annotations, queries, access decisions, SQL safety, mutations/writes, optimism, derivation algebra, and exhaustiveness.                                                 |
| §11, except §11.3 | [spec/11-verification.md](spec/11-verification.md)       | Touch-set extraction, runtime verification, and the browser-free verification surface.                                                                                                |
| §11.3             | [spec/11-diagnostics.md](spec/11-diagnostics.md)         | Normative KV### diagnostic registry and generated-reference comparison target.                                                                                                        |
| §12               | [spec/12-testing.md](spec/12-testing.md)                 | Framework testing API and proof-surface test model.                                                                                                                                   |
| §14               | [spec/14-deploy-skew.md](spec/14-deploy-skew.md)         | Deploy skew recovery, render-plan token mismatch handling, and prior-version retention floor.                                                                                         |

### 3.4 Compatibility map for section citations

Existing comments, diagnostics, tests, and docs may still cite `SPEC §N.M`. Those citations remain understandable by preserving the old top-level numbers in this root and by keeping the detailed numbered headings inside the linked modules. For example, `SPEC §4.8` means the update-plan contract in `spec/04-component-model.md`; `SPEC §10.3` means the mutations-and-writes contract in `spec/10-data-plane.md`; `SPEC §11.3` means the diagnostic registry in `spec/11-diagnostics.md`. New citations may use either the old number (`SPEC §10.3`) or the file-qualified form (`spec/10-data-plane.md §10.3`) when the file qualification prevents ambiguity.

Detailed moved-subsection map:

| Citation                                         | Detailed owner                                           |
| ------------------------------------------------ | -------------------------------------------------------- |
| §4.1 Anatomy of a component                      | [spec/04-component-model.md](spec/04-component-model.md) |
| §4.2 Rendered output                             | [spec/04-component-model.md](spec/04-component-model.md) |
| §4.3 Handlers and closures                       | [spec/04-component-model.md](spec/04-component-model.md) |
| §4.4 The loader                                  | [spec/04-component-model.md](spec/04-component-model.md) |
| §4.5 Composition: children, slots, layouts       | [spec/04-component-model.md](spec/04-component-model.md) |
| §4.6 Primitive composition and attribute merging | [spec/04-component-model.md](spec/04-component-model.md) |
| §4.7 Execution triggers                          | [spec/04-component-model.md](spec/04-component-model.md) |
| §4.8 The update plan: bindings, derives, stamps  | [spec/04-component-model.md](spec/04-component-model.md) |
| §4.9 Update coverage                             | [spec/04-component-model.md](spec/04-component-model.md) |
| §4.10 Registry-bounded dynamic rendering         | [spec/04-component-model.md](spec/04-component-model.md) |
| §5.1 Pipeline                                    | [spec/05-compiler.md](spec/05-compiler.md)               |
| §5.2 Hard rules                                  | [spec/05-compiler.md](spec/05-compiler.md)               |
| §5.2.1 Render-plan version token                 | [spec/05-compiler.md](spec/05-compiler.md)               |
| §5.2.2 Prod render-equivalence gate              | [spec/05-compiler.md](spec/05-compiler.md)               |
| §5.3 `kovo explain`                              | [spec/05-compiler.md](spec/05-compiler.md)               |
| §6.1 The registries                              | [spec/06-type-system.md](spec/06-type-system.md)         |
| §6.1.1 Package component prefixes                | [spec/06-type-system.md](spec/06-type-system.md)         |
| §6.2 Typed surfaces                              | [spec/06-type-system.md](spec/06-type-system.md)         |
| §6.3 Mutation typing contract                    | [spec/06-type-system.md](spec/06-type-system.md)         |
| §6.4 Routes and links                            | [spec/06-type-system.md](spec/06-type-system.md)         |
| §6.5 Session schema                              | [spec/06-type-system.md](spec/06-type-system.md)         |
| §6.6 Soundness boundary                          | [spec/06-type-system.md](spec/06-type-system.md)         |
| §7 Interaction ladder                            | [spec/07-navigation.md](spec/07-navigation.md)           |
| §8 MPA spine and navigation                      | [spec/07-navigation.md](spec/07-navigation.md)           |
| §9.1 Enhanced mutation round-trip                | [spec/09-wire-protocol.md](spec/09-wire-protocol.md)     |
| §9.1.1 Prod delta encoding                       | [spec/09-wire-protocol.md](spec/09-wire-protocol.md)     |
| §9.2 Errors                                      | [spec/09-wire-protocol.md](spec/09-wire-protocol.md)     |
| §9.3 Liveness and live                           | [spec/09-wire-protocol.md](spec/09-wire-protocol.md)     |
| §9.4 Typed reads: the query endpoint             | [spec/09-wire-protocol.md](spec/09-wire-protocol.md)     |
| §9.5 Request shell                               | [spec/09-wire-protocol.md](spec/09-wire-protocol.md)     |
| §9.5.1 Dev HMR                                   | [spec/09-wire-protocol.md](spec/09-wire-protocol.md)     |
| §9.6 Durable tasks and scheduling                | [spec/09-wire-protocol.md](spec/09-wire-protocol.md)     |
| §10.1 Schema as domain registry                  | [spec/10-data-plane.md](spec/10-data-plane.md)           |
| §10.2 Queries                                    | [spec/10-data-plane.md](spec/10-data-plane.md)           |
| §10.3 Mutations and writes                       | [spec/10-data-plane.md](spec/10-data-plane.md)           |
| §10.4 Optimistic updates                         | [spec/10-data-plane.md](spec/10-data-plane.md)           |
| §10.5 Derivation algebra                         | [spec/10-data-plane.md](spec/10-data-plane.md)           |
| §10.6 Exhaustiveness                             | [spec/10-data-plane.md](spec/10-data-plane.md)           |
| §11.1 Touch-set extraction                       | [spec/11-verification.md](spec/11-verification.md)       |
| §11.2 Runtime verification                       | [spec/11-verification.md](spec/11-verification.md)       |
| §11.3 Diagnostic codes                           | [spec/11-diagnostics.md](spec/11-diagnostics.md)         |
| §11.4 Verification surface                       | [spec/11-verification.md](spec/11-verification.md)       |
| §12 Testing API                                  | [spec/12-testing.md](spec/12-testing.md)                 |
| §13.1 StyleX and theme tokens                    | [spec/04-component-model.md](spec/04-component-model.md) |
| §13.2 `kovo-key` runtime identity                | [spec/04-component-model.md](spec/04-component-model.md) |
| §14 Deploy skew and version recovery             | [spec/14-deploy-skew.md](spec/14-deploy-skew.md)         |

### 3.5 Diagnostic and generated-reference ownership

The full diagnostic table lives in [spec/11-diagnostics.md](spec/11-diagnostics.md). The framework-owned `diagnosticDefinitions` registry remains the implementation source used by compiler, CLI, MCP, and generated docs. Generated references must compare framework KV### mentions and registry entries against the normative table; they may not invent codes, severities, or local blocking policy outside that source.

### 3.6 Maintenance rules for spec edits

Use this root for contracts that shape the whole framework: the Prime Principle, the architecture model, module ownership, cross-reference maps, and deployment-wide authority. Put domain-specific normative detail in the owning `spec/*.md` file, and link back here only when the root needs to name the invariant at a high level.

When changing a detailed contract, update the smallest owning module first, then update this root only if the module index, compatibility map, or root summary would otherwise mislead a reader. When adding a new KV### code, update the shared `diagnosticDefinitions` registry and [spec/11-diagnostics.md](spec/11-diagnostics.md) together so generated reference checks compare one implementation registry with one normative table.

When adding explanatory examples, tutorials, or decision history, prefer `docs/`, `site/content/`, or `plans/` unless the example is itself a normative rule. A docs link from this file is a pointer to supporting material, not authority transfer, unless the text explicitly says the linked artifact owns a narrowly scoped contract.

When changing `rules/`, keep the relationship one-way: rules may enforce process, conformance, release, accessibility, docs, workflow, or agent discipline around the spec, but they do not silently override Kovo behavior. If a process rule needs a behavior change, make that behavior change in this root or the owning sub-spec.

When moving text between modules, preserve the old numbered heading until its inbound references have been deliberately migrated. A renumbering that makes existing `SPEC §...` citations ambiguous is a behavior-affecting documentation change and must land with the matching compatibility-map edit.

When in doubt, keep the root terse and make the linked module carry the full proof.

## 4. Component Model & Authoring

Normative module: [spec/04-component-model.md](spec/04-component-model.md).

Components are authored as TSX/JSX source with `component()` definitions. Authors do not repeat compiler-derivable registry strings, stamps, bindings, or lowered IR by hand. The compiler derives component identities from exported bindings and module paths, emits readable runtime stamps, and rejects app-authored lowered output that would make the proof model dishonest.

The local invariant is that rendered output is both browser-valid HTML and machine-checkable IR: handlers load through named event references, data dependencies are visible through query stamps, IDREF and content-model constraints are statically checked, and server-refreshable fragments have enough identity to reconcile without clobbering state-bearing children. StyleX/theme-token extraction and `kovo-key` runtime identity are part of this component contract, not a separate styling compatibility layer.

Subsection map: §4.1 anatomy, §4.2 rendered output, §4.3 handlers and closures, §4.4 loader, §4.5 composition/slots/layouts, §4.6 primitive merging, §4.7 triggers, §4.8 update plan/bindings/derives/stamps, §4.9 update coverage, §4.10 registry-bounded dynamic rendering, §13.1 StyleX/theme tokens, §13.2 `kovo-key`.

## 5. Compiler

Normative module: [spec/05-compiler.md](spec/05-compiler.md).

The compiler lowers authored TSX into readable server/client modules, generated registries, CSS assets, query/update metadata, and verification artifacts. Its hard rules keep generated output authorable, deterministic, source-derived, and security-preserving. The compiler must prove its own fixpoint and prod render-equivalence instead of relying on opaque optimizer behavior.

The local invariant is that every emitted artifact remains auditable: generated names survive minification, app-authored TSX remains the source of truth, render-plan version tokens move with shape-changing grammar edits, and `kovo explain` exposes the graph facts needed for review without executing a browser.

## 6. Type System

Normative module: [spec/06-type-system.md](spec/06-type-system.md).

Kovo uses TypeScript to make safe wiring the normal authoring path: generated registries type components, routes, queries, mutations, sessions, forms, and public surfaces. These types prevent accidental misspellings and unsafe call shapes, but the security proof still belongs to AST/provenance analysis and fail-closed runtime floors.

The local invariant is the honesty boundary: branded or conditional types are author-time guardrails, not trust proofs. The framework must still verify access, ownership, SQL provenance, output sinks, CSRF posture, session shape, package-prefix uniqueness, and deploy-skew retention through runtime validation, compiler provenance, or generated registries.

## 7. The Interaction Ladder

Normative module: [spec/07-navigation.md](spec/07-navigation.md).

The interaction ladder orders behavior from platform-native L0 through lazy islands and enhanced server round trips. Kovo starts from real HTML and real browser semantics, then adds JavaScript only where the compiler can name, load, and verify the enhancement.

The local invariant is progressive capability: an interaction must preserve the no-JS or low-JS path unless its contract explicitly requires a higher rung, and any eager or enhanced behavior must remain visible to static checks and the wire.

## 8. MPA Spine & Navigation

Normative module: [spec/07-navigation.md](spec/07-navigation.md).

Navigation is an MPA spine, not a client router. Canonical URLs, server-rendered documents, browser history, forms, bfcache, and full GET fallback remain authoritative. Enhanced navigation may fetch and morph the canonical server document when the proof model allows it, but uncertainty falls back to the browser.

The local invariant is that navigation state is URL/server-owned. Speculation Rules, View Transitions, streaming navigation, and `<Defer>` improve the experience without creating app-authored persistent navigation state or a global client store.

## 9. Wire Protocol

Normative module: [spec/09-wire-protocol.md](spec/09-wire-protocol.md).

The wire is the documentation: mutation posts, fragment responses, query reads, live events, errors, HMR frames, endpoint audits, durable-task scheduling, and prod deltas use named, schema-shaped traffic. Dev can ship full self-describing frames; prod may compress them only when render-plan tokens and reconstruction rules keep the delta auditable.

The local invariant is that server truth always wins and every trust boundary stays explicit. Client optimism is disposable, `/_q/` reads are typed and token-tagged, errors preserve per-region/per-field identity where applicable, and endpoint/webhook surfaces are auditable through declared auth, CSRF, cache, and response-body posture.

## 10. Data Plane

Normative module: [spec/10-data-plane.md](spec/10-data-plane.md).

The data plane connects schema facts, query read sets, mutation touch sets, access decisions, SQL safety, optimistic transforms, and exhaustiveness checks. Drizzle-backed schema and AST provenance are the blessed path because they let the compiler derive domains, row keys, ownership, secret classification, and read/write edges.

The local invariant is default-deny plus freshness proof. Queries, mutations, endpoints, and routes need explicit access posture; owner/secret/governed facts flow from schema to wire eligibility and invalidation; and Kovo only claims "the engine is the sole authorization/confidentiality door" when the runtime is least-privilege and a closure audit proves every role-reachable object is `FORCE`-RLS+policy, proven `security_invoker`, or explicitly allowlisted. In-process PGlite is a single-tenant dev/test database whose bootstrap identity is superuser; production MUST refuse it before serving and requires an external Postgres URL whose runtime login passes the least-privilege boot invariant. Security-relevant boundary crossings are further constrained by C9: sinks must be reconstructed carriers, runtime boxes, or framework-owned doors, with a named sink inventory and hostile-value proof for each class. Raw or opaque SQL must declare the facts the analyzer cannot prove and is then runtime-verified.

## 11. Static Analysis & Verification

Normative modules: [spec/11-verification.md](spec/11-verification.md) and [spec/11-diagnostics.md](spec/11-diagnostics.md).

Kovo's verification surface combines static touch/read extraction, runtime instrumentation, graph inspection, generated diagnostics, and browser-free contract tests. Static analysis over-approximates, runtime instrumentation under-approximates executed paths, and the invariant is that observed behavior remains within static or explicitly declared facts.

For managed Postgres/PGlite writes, dangerous observed-vs-declared escapes are also engine-bounded: owner-table writes are constrained by RLS/WITH CHECK, and unclassified/reference tables are default-denied by writer grants. That engine-door claim is honest only while the runtime itself is non-superuser/`NOBYPASSRLS` and the closure audit has proved every app-role-reachable object safe; build-time lints are defense-in-depth. The declared-write wrapper still carries the coverage/invalidation contract for benign over-declaration among writable tables, and the C9 sink inventory records the hostile-value proof surface for DB, wire, file, webhook, task, log, and outbound-egress sinks; §10.3 and §11.2 own the detailed layer split.

The diagnostic registry is split out because it is lookup material with independent generated-reference checks. Its authority remains normative: every framework KV### code, severity, and fix posture must agree with the shared `diagnosticDefinitions` registry and the generated diagnostics reference.

## 12. Testing API

Normative module: [spec/12-testing.md](spec/12-testing.md).

The testing API mirrors the proof surface. Mutations execute as functions with touch checking, pages render to inspectable HTML without a browser, typed error unions stay visible, optimistic transforms are pure enough for property tests, and HTTP integration tests exercise the wire against realistic database semantics.

The local invariant is that application wiring should be testable through generated contracts and HTTP/HTML assertions. Browser tests still matter for framework-owned morph survival and platform behavior, but apps should not need broad browser suites to compensate for unverifiable wiring.

## 13. Related Rules and Roadmaps

`SPEC.md` is the normative source of framework behavior. The following files
carry standing conformance rules, release gates, implementation roadmaps, and
explanatory examples:

- Accessibility conformance: `rules/accessibility-conformance.md`
- Data-layer policy: `rules/data-layer-policy.md`
- v1 acceptance gates: `rules/v1-acceptance.md`
- Open design areas: `plans/open-design-areas.md`
- Data-layer roadmap: `plans/data-layer-roadmap.md`
- Risk register: `docs/risk-register.md`
- Worked add-to-cart example: `docs/worked-example-add-to-cart.md`
- Integration testing and browser-free test API examples: `docs/integration-testing.md`
- Layout authoring examples: `site/content/guides/layouts.md`
- Component authoring and copy-in UI examples: `site/content/guides/components.md`
- Optimistic derivation examples and expanded grammar: `site/content/guides/optimistic.md`
- StyleX, stylesheet, and theme-token guidance: `site/content/guides/styling.md`

StyleX/theme-token contracts and the `kovo-key` runtime-identity contract moved to [spec/04-component-model.md](spec/04-component-model.md) as §13.1 and §13.2 because they are component/runtime identity rules.

Rules and roadmaps do not weaken the spec. If a plan conflicts with this root or a linked normative module, follow the spec and update the plan or ask before coding through the conflict.

## 14. Deploy Skew & Version Recovery

Normative module: [spec/14-deploy-skew.md](spec/14-deploy-skew.md).

Kovo treats long-lived documents, stale prerenders, and redeploy skew as recoverable version mismatches, not silent stale patches. A render-plan token mismatch prevents delta/query merge, triggers full-value refetch when possible, and escalates to full page reload when document and server tokens cannot be reconciled.

The local invariant is a deployment floor: every supported deployment must retain prior immutable client modules and token-scoped `/_q/` reads for at least 24 hours of wall-clock retention across redeploys, or surface KV417 instead of shipping a broken artifact.
