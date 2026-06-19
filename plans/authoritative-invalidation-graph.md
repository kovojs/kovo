# Authoritative Invalidation Graph

`SPEC.md` §10.1–10.3 and §11.1 are the normative source: a query's read set and a
mutation's touch set are **derived from the Drizzle AST** ("the JOIN _is_ the
declaration", "forgetting a joined entity's dependency is unrepresentable",
"calling `cart.addItem` _is_ the invalidation declaration"). This ledger closes the
gap between that promise and what ships: today the derivation exists but is **not
authoritative**, and the cross-check that protects the promise is **coverage-dependent
test instrumentation**, not a static/CI gate. Relates to `plans/data-layer-roadmap.md`
(v1.5 verification layer, still open) and Constitution #2 (no global knowledge at
local sites) / #5 (server truth, never-stale UI).

## Disambiguation findings (2026-06-18)

Traced against implementation, not SPEC claims.

| Question                                                | Answer                                 | Evidence                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is AST extraction implemented?                          | **Yes**, for writes and reads          | `packages/drizzle/src/static.ts` `extractTouchGraphFromProject`; CLI `kovo compile drizzle-static` (`packages/cli/src/index.ts`); generated `examples/*/src/generated/touch-graph.ts` carry `site:` provenance (e.g. `crm/.../mutations.ts:143`).                                                                                                                     |
| Query `reads`: derived or hand-declared?                | **Hand-declared, required field**      | `packages/server/src/query.ts:77` (`reads: readonly Domain[]`, non-optional); doc comment "The read set is the entire invalidation declaration — nothing else registers anywhere." Examples hand-write `reads: [contact]` (`examples/crm/src/queries.ts`).                                                                                                            |
| Mutation `touches`: derived or hand-declared?           | **Hand-declared at runtime**           | `packages/server/src/change-record.ts:60-72`: runtime uses `registry.touches`, else `registry.inferredTouches`. Compiler does **not** populate `inferredTouches` (no reference in `packages/compiler/src`); examples hand-author it inline (`examples/commerce/src/domain.ts:211`) or use explicit `touches` (`examples/crm/src/mutations.ts:159`).                   |
| Is the generated touch-graph wired into the runtime?    | **No**                                 | The generated `touch-graph.ts` feeds `kovo explain`/devtools/conformance only; example `graph.ts` imports the `TouchGraph` _type_, not the runtime invalidation path.                                                                                                                                                                                                 |
| Is there a mismatch cross-check?                        | **Yes, but test-instrumentation only** | `packages/test/src/verifier.ts` `assertObservedReadsCovered` (KV407 "Query read from undeclared domain") / `assertObservedWritesCovered` (KV404/KV406/KV408). Proven by `tests/integration/specs/query-readset-runtime-crosscheck.spec.ts` — `/_q/readset-bad` → HTTP 500 + KV407. The verifier lives in `@kovojs/test`; `@kovojs/server` (prod) does **not** run it. |
| Static / compile-time enforcement of read-set coverage? | **No**                                 | No KV407/readset check in `packages/compiler/src`. KV411 (`Query read set includes an exempt table`) checks declared `reads` against _exempt_ tables only (`packages/drizzle/src/static.ts:86`), not against the `load` AST.                                                                                                                                          |
| Roadmap status                                          | v1.5 cross-check **open**              | `plans/data-layer-roadmap.md`: v1 floor + blessed adapter `[x]`; "v1.5 verification layer. Runtime instrumentation as CI cross-check for KV402-KV409" `[ ]`.                                                                                                                                                                                                          |

**Bottom line:** Not a fully silent prod staleness hole — derivation + a runtime
verifier both exist, and test coverage catches most drift. But the guarantee is weaker
than SPEC promises in three concrete ways:

1. **Not authoritative.** Runtime invalidation reads hand-declared `reads`/`touches`;
   the derived graph is a parallel artifact. Two sources that can drift.
2. **Coverage-dependent, not static.** A too-narrow `reads`/`touches` is only caught
   when that exact code path executes under the `@kovojs/test` harness. Untested
   paths (or prod) ship the staleness; SPEC's "unrepresentable to forget" is
   currently "caught if a test happens to run it."
3. **Constitution #2 burden.** Authors hand-maintain the sets — the global-knowledge
   chore the spec says should not exist. Examples are inconsistent (`touches` vs
   `inferredTouches`), evidence of the friction.

## Goal

Make the AST-derived graph the **authoritative** invalidation source and promote the
existing coverage-dependent cross-check into a **static/CI gate**, so a forgotten
dependency is a compile error — not a latent prod bug or a hand-maintained list.

## Open work

- [ ] **Compiler injects `inferredTouches` into the mutation registry.** Wire
      `extractTouchGraphFromProject` output into the generated mutation registry so
      `inferredTouches` is compiler-populated, not hand-authored. App code stops
      writing `registry: { touches }` / `inferredTouches` for statically-analyzable
      writes (KV406 sites keep manual `touches` as the declared escape hatch).
      Evidence target: a generated registry artifact carrying `inferredTouches` with
      `site:` provenance, consumed by `change-record.ts`; commerce/crm `domain.ts`
      no longer hand-lists touches.
- [ ] **Compiler derives query `reads` from the `load` AST.** Extract the read-set
      (FROM/JOIN domains) from each `query()` `load` body via the same `static.ts`
      machinery; make authored `reads` optional, deriving when omitted. Hand-declared
      `reads` becomes a checked override, not the default. Evidence target: a query
      with a multi-domain JOIN and no authored `reads` invalidates from every joined
      domain's mutation in an integration test.
- [ ] **Static superset gate: declared ⊇ derived.** New compile/CI diagnostic (reuse
      KV407/KV408 semantics statically; add a write-side analogue) firing when a
      hand-declared `reads`/`touches` override is **narrower** than the AST-derived
      set — the staleness direction. Excess (over-invalidation) stays a warning.
      Evidence target: a fixture declaring `reads: [contact]` over a `load` that joins
      `deals` fails `kovo check` statically (not only at runtime).
- [ ] **Promote the read/write cross-check off the test-only path.** Surface
      `assertObservedReadsCovered` / `assertObservedWritesCovered` as a CI gate in
      `kovo check` (the v1.5 "verification layer" roadmap item) so coverage of the
      verifier is reported and gaps are visible, independent of whether an app's own
      tests exercise the path. Evidence target: `kovo check` reports readset/touch
      verification coverage; a deliberately-uncovered query is flagged.
- [ ] **Migrate examples + docs to the derived-default model.** Remove hand-authored
      `reads`/`touches`/`inferredTouches` from commerce/crm/stackoverflow where the
      writes/reads are statically analyzable; align `site/content/guides/queries.md`
      so the taught model is "declare the JOIN, the dependency is derived." Evidence
      target: examples compile + pass invalidation integration tests with no
      hand-listed domains except at KV406 sites.
- [ ] **Update SPEC cross-references + roadmap.** Reconcile §10.2/§10.3 wording with
      the override-and-gate model (derived authoritative; manual = checked escape
      hatch); flip `plans/data-layer-roadmap.md` v1.5 once the CI gate lands.

## Risks / open questions

- **KV406 interprocedural opacity.** Writes flowing `db` into node_modules can't be
  AST-derived; manual `touches` must remain a first-class, audited escape hatch, and
  the superset gate must exempt declared KV406 sites rather than fight them.
- **Override ergonomics.** Need a clear authored spelling for "I'm intentionally
  declaring touches because this is opaque" vs "I forgot one" — the gate must
  distinguish the two so the escape hatch stays usable (Constitution #2).
- **Query `load` analyzability parity.** Confirm `static.ts` read extraction covers
  the same Drizzle surface (subqueries, `sql` projections, CTEs) the write side
  handles, or that gaps degrade to a required-`reads` + KV410-style notice rather
  than a silent miss.

## Latest verification

None yet — this ledger is the disambiguation + scoping pass. Proving commands to add
per slice: `pnpm --filter @kovojs/drizzle test` (extraction), targeted
`tests/integration/specs/query-readset-runtime-crosscheck.spec.ts` plus a new
static-gate fixture, `kovo check` on the migrated examples, and `pnpm run acceptance`
before flipping the roadmap checkbox.
