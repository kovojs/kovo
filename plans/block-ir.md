# Block IR authoring — TSX as the sole authoring surface (D9)

Status: design agreed 2026-06-11 (decisions: TSX is the sole app-authoring surface; hand-authored lowered IR is a compile **error** (FW235); ejection is not offered and there is no suppression mechanism; Constitution #3's property is unchanged, its ejection payoff is dropped); B1 commerce migration and B2 SPEC text landed, FW235 implementation remains open
Scope: commerce TSX migration (the gating completeness proof), a SPEC PR (Constitution #3 payoff rewording, normative §5.2 authoring-surface text, FW235, FW226 demotion), the FW235 diagnostic in `@jiso/compiler`, and ecosystem constraints (`fw add` vendors TSX only; agents emit TSX and read IR). Referenced from `IMPLEMENT_v1.md` as workstream **D9**.

## Progress checklist

- [x] B1 commerce TSX migration: every component in `examples/commerce` is authored in per-component `.tsx` with JSX renders and compiler-derived stamps; no string-template `component()` renders remain; full gates green; `generated/touch-graph.ts` byte-identical.
      Evidence 2026-06-11: `CartBadge`, `OrderHistory`, and `ProductGrid` live in
      `examples/commerce/src/components/*.tsx`; `examples/commerce/src/app.test.ts` runs
      `node examples/commerce/scripts/emit-components.mjs --check`, compares each committed
      `src/generated/*.tsx` IR artifact, and asserts authored component files contain no
      hand-written `data-bind`, `fw-deps`, `fw-c`, `fw-state`, or `data-p-*` stamps.
      Same-session source audit with `rg` over commerce TypeScript and TSX sources shows
      stamps only in generated IR and non-component app/test infrastructure.
- [x] B2 SPEC PR: Constitution #3 payoff rewording (property unchanged), normative "the IR is an output format" text in §5.2, FW235 in the §11.3 diagnostic table, FW226 demoted to internal fixpoint-path validation.
      Evidence 2026-06-11: `SPEC.md` now preserves the fixpoint property while saying app
      authors still write TSX, adds the §5.2 TSX-only authoring hard rule, names FW235 in the
      diagnostic table, and demotes FW226 to internal emitted-IR fixpoint validation. Verified
      with `pnpm exec vp fmt SPEC.md` and `pnpm run check`.
- [ ] B3 FW235 implementation: error-severity detection of hand-authored lowered IR in app source, golden teaching message showing the TSX equivalent, provenance exemption for compiler-emitted artifacts proven by the fixpoint gate itself, wired into the `vp check`/`vp run fw-check` path.
- [ ] B4 ecosystem constraints recorded and tested where surfaces exist: `fw add` vendoring emits TSX only (constraint registered in `plans/ui.md` D7); starter and docs are TSX-authored; agent guidance documents "emit TSX, read IR".

## Background — the gap

SPEC presents TSX as what authors write: the §3 pipeline (`cart.tsx → cart.server.js`), §4.2 ("`cart-badge.tsx` — what you write"), the §5.2 1:1 mapping, and Appendix A all author in `.tsx`. But Constitution #3 makes the lowered IR _legitimate source_ — `component()` calls with string renders and hand-written `fw-c`/`fw-deps`/`data-bind` stamps compile, fixpoint, and run. That legitimacy created a gravity well: the reference commerce app (`examples/commerce/src/app.ts`) was written entirely at the IR altitude, the TSX front-end (`packages/compiler/src/scan/parse.ts`, `createJisoVitePlugin`) is exercised only by compiler unit fixtures, and the flagship example demonstrates the authoring experience the spec calls "GENERATED".

The resolution: keep the property, drop the posture. Emitted output remains valid, recompilable, fixpoint-checked Jiso source — that buys the fixpoint oracle, the no-private-magic constraint on the compiler, and devtools-readable output, none of which require anyone to _author_ IR. What changes is that hand-authoring IR in app source becomes a compile **error** with no escape hatch: no ejection workflow, no suppression pragma. A front-end gap is fixed in the compiler, not worked around in app code. Pre-1.0, strict→loose is the non-breaking ratchet direction: relaxing FW235 later (e.g., to allow ejection) breaks nobody; introducing it after ejected code exists in the wild would.

Constitution check: #3's normative sentence ("Sugar must lower to authorable IR. Every compiler feature emits valid Jiso source. Compiling the output is a no-op") survives verbatim — only the payoff column ("Any component can be ejected") is reworded to what the property actually earns without ejection. #1/#4/#5 are untouched; knowledge portability improves because every Jiso app an author or agent opens is the same surface.

### Decisions (recorded so we don't relitigate)

- **TSX is the sole app-authoring surface; the IR is an output format.** Like generated code from any compiler: legitimate, readable, versioned — never yours to edit. The IR remains the verification currency (`fw explain`, graphs, emitted modules read in devtools).
- **FW235 is error severity from day one, with no suppression.** A suppressible error is ejection with paperwork; if the forbid means anything, the only answer to "TSX can't express this" is a compiler fix or a SPEC conflict recorded per `CLAUDE.md`. Severity relaxation later is non-breaking; the reverse is not.
- **The ban is a source-tree validation, not a compiler input restriction.** The compiler structurally must accept IR as input — the fixpoint gate (`compile(IR) ≡ IR`, SPEC §5.2.3) feeds emitted IR back through `compileComponentModule`. FW235 is raised by the authoring-surface validation over app source; compiler-emitted artifacts and the fixpoint harness's recompilation path are exempt **by provenance** (the harness compiles output it just emitted), never by pragma. There is no marker an app author can write to opt out.
- **Detection target:** a component module in app source whose `render` builds markup from template strings / string concatenation rather than JSX (equivalently: hand-written derivable stamps — `fw-c`, `fw-deps`, `data-bind` — outside compiler emit). The golden message shows the TSX the author should have written — the reverse of FW201's show-the-lowering discipline.
- **FW226 is demoted, not deleted.** Its audience ("ejected-IR validation") no longer exists; the same `fw-deps`/`fw-c` validation still protects the internal fixpoint path. It leaves the user-facing §11.3 table and becomes internal gate machinery.
- **B1 gates B3.** The commerce migration is the completeness test of the TSX front-end: if the flagship app reaches 100% TSX with zero carve-outs, an unsuppressable error is survivable; gaps it surfaces are fixed in `packages/compiler` _before_ the lint exists, never suppressed under it.
- **Agents emit TSX.** For Dyad and any generation system, TSX is the emission target — generated apps get the full lowering-diagnostic surface (FW201, FW210, FW225, FW230) and stay idiomatic with human-authored code; the IR is what agents _read_ for verification. FW235 applies to generated apps with no carve-out.
- **`fw add` vendors TSX only.** D7's vendored `@jiso/ui` components become bare-named app source, so they are linted; vendoring lowered IR would make the lint fire on framework-shipped code. Load-bearing constraint, registered with D7.

## B-track

- **B1 — Commerce TSX migration.** Split component definitions out of `examples/commerce/src/app.ts` into per-component `.tsx` files honoring the 1:1 mapping (SPEC §5.2); JSX renders replace string templates; stamps become compiler-derived per §4.8 (hand-written stamps in sugar are FW223/FW222). Non-component infrastructure (db, session, CSRF, queries, mutations, page-render helpers) may stay `.ts`. Wire the compile step into the example (`createJisoVitePlugin` in `vite.config.ts` or an emit script beside `scripts/emit-graph.mjs` — whichever keeps `app.test.ts` importing rendered output; record the choice). Gate every migrated component on `assertFixpoint`; output need not be byte-identical to the old hand-written IR — spec-correct stamp-placement/attribute-order differences are fine, and assertions pinning incidental markup may be updated to compiler output (recorded), but behavioral assertions (wire vocabulary, stamp presence and targets, the mutation×query matrix, no-JS fallback) are never weakened. `generated/touch-graph.ts` stays byte-identical (`fw-check` pins it). Migrate incrementally, one component family per checkpoint commit; IR/TSX coexistence mid-migration is fine. Any front-end gap is a compiler fix with a SPEC citation or a recorded SPEC conflict — never hand-written IR in a `.tsx` file, never a weakened test.
- **B2 — SPEC PR.** (1) Constitution #3 payoff column reworded: ejection out; in: the compiler cannot accumulate semantics outside the public model, output is auditable in devtools, fixpoint is mechanically checkable. (2) Normative text in §5.2: TSX is the sole app-authoring surface; the lowered IR is an output format; hand-authoring it is FW235. (3) FW235 row in §11.3 (error) with the teaching-message contract (show the TSX equivalent). (4) FW226 removed from the user-facing table with a note that the validation persists internally on the fixpoint path. (5) §16 acceptance addendum: zero FW235 across commerce and the starter.
- **B3 — FW235 implementation.** Detection per the decision above in the compiler's validation layer; golden diagnostic snapshot (teaching errors are a feature, SPEC §5.2.5); provenance exemption such that the fixpoint and render-equivalence gates — which compile emitted IR — stay green with FW235 active at error severity; wired so `vp check`/`vp run fw-check` fail on a hand-authored IR module in a test app. Lands only after B1 is complete and the commerce tree is FW235-clean by construction.
- **B4 — Ecosystem constraints.** Register the TSX-only vendoring constraint in `plans/ui.md` (D7's `fw add` deliverable); confirm starter templates and docs-site tutorial states (`plans/docs-site.md`) are TSX-authored; document the agent emission guidance (emit TSX, read IR) where the §16.3 agent-answerability story lives.

## Out of scope

A suppression pragma or per-file opt-out (**rejected, not deferred** — it reintroduces ejection with paperwork) · an `fw eject` command or any ejection workflow (never) · weakening or special-casing the fixpoint/render-equivalence gates (the Constitution #3 property is unchanged; the gates keep compiling emitted IR) · relaxing FW235 to a warning (available later as a non-breaking change if real adopters hit walls; not built now) · retroactive rewrites of compiler test fixtures that intentionally exercise IR-as-input (they are the fixpoint path's test surface, exempt by provenance).

## Sequencing & dependencies

- B1 depends only on the existing P1 front-end; it can start immediately and is the critical path.
- B1 gates B3 (the lint flips on only against an FW235-clean flagship). B2 can land before or alongside B3; FW235's table row may merge ahead of its implementation, as FW228/FW229 did for D8.
- B4 rides D7 (`fw add` does not exist yet — the constraint is recorded now, tested when the vendoring path lands) and `plans/docs-site.md`.
- Interaction with D8 R7: commerce's `serve` entry and this migration touch the same example; either order works, but whichever lands second rebases over the other's `examples/commerce` changes.
- P10 acceptance criterion 4 ("every feature has an authorable lowering") is unaffected — lowering targets stay authorable in the grammatical sense; the audit's meaning is now enforced by the fixpoint gate rather than by ejection.

## Exit criteria

1. `examples/commerce` contains zero string-template `component()` renders and zero hand-written derivable stamps; every component is `.tsx`-authored and passes the fixpoint gate; full gates (`vp check`, `vp test`, conformance, `vp run fw-check`) green; `generated/touch-graph.ts` byte-identical.
2. SPEC PR merged: Constitution #3 payoff reworded with the property text verbatim-unchanged; §5.2 names TSX as the sole authoring surface; FW235 in §11.3; FW226 demoted with the internal-validation note.
3. FW235 at error severity: a hand-authored IR component module in a test app fails `vp check`/`fw-check` with the golden teaching message showing its TSX equivalent; the fixpoint and render-equivalence gates remain green with FW235 active — the provenance exemption proven by the gates themselves.
4. The TSX-only vendoring constraint appears in `plans/ui.md`; agent emission guidance (emit TSX, read IR) is documented alongside the §16.3 agent-answerability surface.
