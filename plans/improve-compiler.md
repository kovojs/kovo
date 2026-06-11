# Improve `@jiso/compiler` (packages/compiler/src/index.ts)

Status: planned
Scope: `packages/compiler/src/` only (plus `tests/fw-check.node.mjs` where gate expectations move). No behavior changes to SPEC-defined diagnostics or emitted IR except where a phase explicitly fixes a miscompile.

## Background

`index.ts` is currently a single 2,925-line module implementing the entire compiler via
regex scanning over raw TSX source. A review (2026-06-11) found that the string-matching
foundation is the limiting factor: it has produced silent miscompiles, it discards source
positions the diagnostics need, and ~15 validators each re-scan the full source with
duplicated patterns. SPEC.md does not mandate the string approach — it is an
implementation choice we can replace without touching normative behavior.

### Decision: parser = TypeScript API (not oxc)

Use `ts.createSourceFile` (parse-only, no `Program`, no checker) behind a thin parsing
layer. Rationale, recorded so we don't relitigate:

- The compiler is fact-based by design (query shapes / registry facts passed in; type
  enforcement happens in the user's tsc via emitted `.d.ts` declaration merging, SPEC §10).
  We only need syntax + spans.
- TS's parser is error-tolerant (editor-grade): keeps producing an AST + diagnostics on
  broken input. Our product is FW-coded diagnostics on code the user is mid-edit on.
- Runs anywhere JS runs — keeps the in-browser/Dyad-generation-target option open;
  `oxc-parser` is a napi native binary.
- TS AST shape is stable; oxc has had breaking AST changes between minors.
- Perf: single-file parse-only TS is sub-ms-to-low-ms per `transform` call and replaces
  ~15 full-source regex passes. Revisit oxc only if watch-mode profiling shows the parser
  as the bottleneck — the swap is contained by the parse-layer interface (Phase 3).

Dependency note: add `typescript` as a regular dependency of `@jiso/compiler` (pin a
minimum compatible with root's `^6.0.3`); do not vendor.

### Hard rule for all phases

`ts.Node` types must not leak past the parse layer (`src/scan/` in Phase 3). Validators,
lowerers, and emitters consume the intermediate model only — this is what keeps the
parser swappable and the validators unit-testable.

## Phase 0 — Fix known silent miscompiles (ship immediately, regex-level fixes)

These are wrong-output or silently-dropped-validation bugs, worth fixing before any
refactor. Each gets a regression test in `index.test.ts` first.

1. **`findMatchingClosingTag` (index.ts:1267) miscounts self-closing same-name tags.**
   A nested `<div />` increments depth and never closes → wrong boundary or -1 → list
   stamps and FW222/FW230 silently skipped for that subtree. Skip matches whose attrs
   end in `/` (reuse `isSelfClosing`).
2. **Nested braces break handler extraction.** `eventAttributePattern` (index.ts:888)
   captures `[^}]*`, truncating `onClick={() => { a(); b(); }}` and
   `onClick={() => emit('x', { id })}`. Replace the regex tail: locate `on<Event>={`,
   then use `findMatchingToken(source, braceStart, '{', '}')` to find the real end.
   Apply the same span-based extraction to the rewrite in `emitServerModule`
   (index.ts:2474), which shares the broken pattern.
3. **`emitServerModule` order-dependent first-match replace.** It replaces the first
   `on*={...}` occurrence per handler, assuming extraction order == document order.
   Once #2 gives us spans, rewrite by exact span instead.
4. **`staticStateJson` (index.ts:2586) corrupts string values.** `replaceAll("'", '"')`
   turns `"it's"` into invalid JSON → catch → `fw-state` stamp silently vanishes
   (SPEC §5.2 island-local state). Parse the state object with the existing
   `topLevelObjectEntries`/`literalValue` machinery instead of quote-munging; if a value
   isn't statically serializable, that should be a visible behavior (documented skip),
   not silent loss.
5. **`lowerHandlerExpression` (index.ts:2402) substring collisions.** Unanchored
   `replace` of param expressions rewrites `item.id` inside `item.idx`. Add a
   `(?![\w$])` lookahead (and a non-identifier left boundary) to the generated regex.
6. **`prefixCssSelectors` (index.ts:544) leaks unscoped rules inside `@media`/`@supports`**
   — inner selectors follow `{`, not `}` (SPEC §13.1 scoping honesty; the `@scope` output
   is fine, the fallback isn't). Recurse into conditional at-rule blocks.

Verification: `pnpm vitest --run` in `packages/compiler`, then root `pnpm run check` and
`pnpm run check:fw` (gate fixtures may legitimately change for #4/#6 — record any
expectation updates in the commit message). Commit per fix or per pair of related fixes.

## Phase 1 — Source positions in diagnostics

`CompilerDiagnostic` gains optional `start: { line: number; column: number }` (and
`length?`). Nearly every validator already has `match.index` in hand and discards it.

- Add a per-file line-index helper (`offsetToPosition(source, offset)`), computed once.
- Thread the offset through each validator's diagnostic constructor
  (`diagnosticFor` grows an optional offset param).
- Optional field keeps `CompileResult` consumers and existing tests compatible; tests
  for _where_ get added per validator as they're touched.
- Update `tests/fw-check.node.mjs` output to print `file:line:col` when present.

Verification: compiler vitest suite + `pnpm run check:fw`. One checkpoint commit.

## Phase 2 — Module split + validator registry + shared tag scan

No behavior change; structure only. Keep `src/index.ts` as the public barrel re-exporting
the existing API surface verbatim.

Proposed layout:

```
src/
  index.ts          # public API barrel (types, compileComponentModule, helpers)
  compile.ts        # compileComponentModule orchestration + validator registry
  scan/             # source scanning: findMatchingToken, skipObjectValue,
                    #   topLevelObjectEntries, tag scan, offsetToPosition
  lower/            # view transitions, platform behaviors, navigation sugar, handlers
  validate/         # one module per FW family (state, fragments, bindings, html, attrs…)
  emit/             # client, server, css, registry, bootstrap emitters
  css.ts            # scopeComponentCss, dedupeCss, manifest helpers
  graph.ts          # deriveAppGraph / registry fact derivation
```

Mechanical cleanups bundled here:

- **Validator registry**: `const validators: Validator[] = [...]` consumed by
  `compile.ts` via one `flatMap` — removes the call-list/diagnostics-array drift hazard
  (index.ts:261-324, two places to edit per new validator today).
- **Shared tag scan**: one pass producing `{ tag, attrs, start, end, selfClosing }[]`
  handed to all validators; deletes the five copies of the tag regex and the per-tag
  `new RegExp` construction in `readStaticAttribute`/`findMatchingClosingTag` call sites.
- Dedupe helpers: single `dedupeBy(key)` replacing `dedupeDiagnostics`/`dedupeUpdateCoverage`;
  collapse `findHandlerBodies`' twin loops; early-return in `compileComponentModule`
  becomes `{ ...createEmptyCompileResult(), files: [...] }`.

This phase parallelizes well: sub-agents can own `validate/`, `emit/`, and `lower/`
extraction separately (explicit file ownership, no shared edits to `index.ts` barrel
until integration); integration, gate runs, and commits stay in the main agent.

Verification: full compiler suite, root `pnpm run check` + `pnpm run test`, and
`pnpm run check:build` (package exports moved). Commit per extracted family.

## Phase 3 — Parsed intermediate model (TS API), migrate incrementally

Introduce `scan/parse.ts`: `parseComponentModule(fileName, source) → ComponentModel`,
where `ComponentModel` is a plain-data model (no `ts.Node` leakage):

- component declaration(s): local name, explicit name, options-object entries with spans
  (`queries`, `props`, `state`, `render`, `fragmentTarget`, `css`)
- JSX elements: tag, attributes (name, value kind: static / expression-with-span),
  children spans, self-closing, parent chain
- handler expressions with full spans (replaces Phase 0's regex+brace-matching stopgap)
- top-level statements classification (for comment/string blindness — code in comments
  and strings stops false-triggering validators like `fragmentTarget: true` in a comment)

Migration order (each step deletes its regex counterpart and keeps the suite green):

1. Component/options extraction (`inferComponentName`, `extractObjectLiteralAfterProperty`,
   `extractStateReturnObject`, `componentQueryNames`, `findFragmentTargetFacts`).
2. JSX-tag-based validators (html content model FW225 — fixes whole-file string/import
   interference; attribute merges FW231-233; idrefs FW221; static ids FW224;
   residual stamps FW226).
3. Handler lowering + element params (FW201/FW210) and `emitServerModule` rewriting
   (span-based attribute replacement).
4. Binding/stamp validators (FW222/FW223/FW302/FW303/FW311/FW320/FW330) and
   update-plan collection.
5. Lowering passes (`lowerViewTransitions`, `lowerPlatformBehaviors`, navigation sugar
   per SPEC §6.4) — these rewrite source; keep emitting text via spans.
6. Delete dead scanner code (`findMatchingClosingTag` and friends) once nothing
   references it.

Also in this phase: tighten `capturesUnserializableValue` (index.ts:941) from name-based
`\b(db|request|response)\b` to actual identifier-reference analysis on the handler body
(kills false FW201 on a local `const response = ...`); replace the magic 240-char
comment window in `hasFw211Justification` with "comment attached to the JSX attribute's
node" semantics.

`assertFixpoint` and the vitest suite are the safety net: emitted IR must be
byte-identical for inputs the regex path handled correctly; intentional differences
(bug fixes) get explicit test updates with SPEC citations.

Verification: full `pnpm run acceptance` at the end of this phase (touches runtime-visible
emit). Commit per migration step.

## Phase 4 — API cleanups

- `EmittedFile` gains `kind: 'server' | 'client' | 'css' | 'registry'`; vite plugin,
  `assertFixpoint`, and consumers stop sniffing extensions.
- `collectMinifierReservedNames` reads handler export names from compile facts instead
  of regex-scraping emitted output — add `handlerExports: readonly string[]` (or similar)
  to `CompileResult`, keep the old function as a wrapper.
- Make `CompileResult.diagnostics` / `files` / `platformSubstitutions` `readonly` for
  consistency (check downstream packages for mutation before flipping).
- Audit remaining heuristics; document any that stay name-based in their diagnostic
  `help` text.

Verification: `pnpm run check` + `pnpm run test` + `pnpm run check:build`.

## Non-goals

- No new FW diagnostics or SPEC behavior changes (anything found that suggests one goes
  to a SPEC.md discussion first, per CLAUDE.md).
- No oxc/swc adoption now (recorded decision above; revisit only with profiling data).
- No programmatic AST→code emission — the compiler stays text-emitting; the fixpoint
  property (`assertFixpoint`) is preserved throughout.

## Sequencing summary

| Phase | Deliverable                                                 | Risk                             | Gate before commit         |
| ----- | ----------------------------------------------------------- | -------------------------------- | -------------------------- |
| 0     | 6 miscompile fixes + regression tests                       | Low, behavior-visible (intended) | compiler vitest + check:fw |
| 1     | Positions in diagnostics                                    | Low, additive                    | compiler vitest + check:fw |
| 2     | Module split, validator registry, shared scan               | Low, mechanical                  | check + test + check:build |
| 3     | TS-parser model, validators migrated, regex scanner deleted | Medium                           | full acceptance            |
| 4     | EmittedFile.kind, facts-not-scraping, readonly              | Low                              | check + test + check:build |

Each phase is independently shippable; stop points between phases are safe.
