# High-Value Refactoring 5 (hvr)

Created 2026-07-01 from a five-subsystem survey (compiler, Drizzle static analysis, server/core,
CLI/browser/scripts, headless-ui) hunting for evidenced duplication, drift, god-file seams, and
type-safety gaps. Every finding below was selected for concrete evidence — an already-diverged
copy, a missed union member, or a silently-bypassable guard — not for file size alone.

Scope discipline:

- Refactors are behavior-preserving per `SPEC.md` unless an item explicitly says the current
  copies disagree; those items require a SPEC check to pick the intended semantics before
  unifying, and the unification is the bug fix.
- Compiler items must respect `rules/compiler-hard-rules.md`: shared helpers stay AST/fact-string
  based (no new post-parse source-text channel), and lowering changes must stay fixpoint-stable.
- No overlap with the open items in `plans/high-value-refactoring-4.md` (P1.4–P2.5) or the CAP
  capability items in `plans/compiler-refactoring.md`. HVR-4 P1.5 (unify response header floors)
  is complementary to S3/S4 below and is cross-referenced there.

## P0 — Evidenced behavioral drift (latent-bug candidates)

Each of these has two-or-more live copies of the "same" logic that already return different
answers for the same input. Unifying requires deciding the intended behavior first (SPEC or test
evidence), then deleting the divergence.

- [ ] **D1 — Unify `rawWriteSqlTrustForCallback` (security-relevant divergence).**
      `packages/drizzle/src/static.ts:2229` recursively follows raw-SQL sinks through local helper
      functions (via `rawWriteSqlTrustForNode`/`rawSqlLocalFunctionsByName`, static.ts:2238–2277) and
      uses the method-aware `sqlSinkReceiverCanCarrySql(expr, surface.name)`;
      `packages/drizzle/src/static/derivation.ts:1327` does a flat one-level descendant scan with a
      method-agnostic receiver check. A raw-SQL write hidden inside a local helper called from a
      mutation handler is flagged by the static.ts path but missed by the derivation.ts path — a
      wrong-but-plausible "trusted" verdict. Extract one shared implementation (expected: the
      helper-following version) into `src/static/domain-writes.ts`; confirm intended semantics against
      SPEC before unifying. Effort M · Risk med.
- [ ] **D2 — Single `isQueryShapeWrapper`; the schema.ts copy is missing `table-row`.**
      Triplicated at `packages/drizzle/src/static.ts:366`, `static/query-shapes.ts:2797`, and
      `static/schema.ts:111`. The schema.ts copy (lines 116–120) omits `shape.kind === 'table-row'`,
      so `secretQueryShape` (schema.ts:103) treats a table-row wrapper as a plain object and wraps it
      whole instead of recursing into `.shape`. Export one predicate covering all six
      `QueryShapeWrapper` kinds (static.ts:236) and delete the copies. Effort S · Risk med (changes
      schema.ts secret-projection output for table-row shapes — confirm against SPEC/tests).
- [ ] **C1 — One `unwrapExpression` for the compiler; four copies accept three different
      wrapper-kind sets.** `packages/compiler/src/scan/parse.ts:892` and
      `analyze/reactive-aliases.ts:357` peel 4 kinds (paren, non-null, `as`, `satisfies`);
      `validate/redos-pattern.ts:397` adds `TypeAssertionExpression`; `scan/route-pages.ts:990` adds
      both `TypeAssertionExpression` and `AwaitExpression`. The same authored expression normalizes
      differently per phase. Unify in a shared AST-util module (superset semantics unless a phase
      demonstrably needs less), pin with fixpoint/golden tests first. Effort M · Risk med.
- [ ] **C2 — One `propertyNameText`; five copies, three behaviors.** Copies at
      `packages/compiler/src/style.ts:1374` (rejects template-literal keys: `isStringLiteral` not
      `isStringLiteralLike`), `validate/trusted-html-provenance.ts:905` (omits `isNumericLiteral`, so
      `{ 0: x }` resolves to `null` there), `scan/route-pages.ts:983`, `scan/optimistic-inline.ts:497`,
      `scan/mutation-inputs.ts:137`, plus `scan/parse.ts:2215`. Single helper covering Identifier +
      StringLiteralLike + NumericLiteral; verify the two narrower call sites don't rely on rejection.
      Effort S · Risk low-med.
- [ ] **S1 — Shared `guardFailureToResult`; the four copies already disagree on `auth`.**
      `packages/server/src/route.ts:664` (`routeGuardFailure`, includes `auth`) vs
      `query.ts:431` (includes `auth`) vs `mutation.ts:293` and `mutation.ts:450` (omit `auth`).
      Divergence here can drop the unauthenticated→login redirect or `retryAfter` on one surface.
      Move `routeGuardFailure` into `guards.ts` as the single mapper and call it from all four sites;
      determine whether the mutation paths' missing `auth` is intended before unifying. Effort S ·
      Risk low.
- [ ] **U1 — Reconcile combobox vs autocomplete filtering semantics behind one shared helper.**
      `packages/headless-ui/src/primitives/combobox.ts:487,1054` matches by **substring** over
      label+textValue+value and **keeps** disabled items; `autocomplete.ts:543,1183` matches by
      **prefix** over a single field and **excludes** disabled items. Three independent divergences,
      none documented. Extract `filterCollection({ items, query, match, fields, excludeDisabled })`
      into `lib/` so any true semantic difference is a named argument. Effort M · Risk med.
- [ ] **U2 — Shared `isActivationKey`; `select` is missing the legacy `'Spacebar'` fallback.**
      Identical private helpers at `dropdown-menu.ts:1044`, `context-menu.ts:1128`, `menubar.ts:1096`
      accept `'Spacebar'`; `select.ts:945` inlines the check without it, so Space activates menus but
      not select on browsers reporting the legacy key value. Add the helper to
      `lib/keyboard-navigation.ts`; decide `'Spacebar'` support once. Effort S · Risk low.
- [ ] **T1 — One `isMainEntry` + one exit convention for the gate scripts (silent gate-bypass
      hazard).** At least 8 spellings of the run-as-main guard exist; the
      `` `file://${process.argv[1]}` `` form (`scripts/check-spec-index.mjs:238`,
      `no-committed-generated.mjs:44`) and the `.pathname` comparisons (`build-publish.mjs:253`,
      `check-pack-security.mjs:537`, `egress-floor.mjs:115`, `supply-chain-gates.mjs:96`, …) do not
      round-trip percent-encoding, so a checkout path with a space makes a security gate exit 0
      without running. Exit convention is also split (`process.exit(1)` in ~9 scripts vs
      `process.exitCode = 1` in ~6; the former can truncate buffered output). Add
      `scripts/lib/cli-entry.mjs` with `isMainEntry(importMetaUrl)` (via `pathToFileURL`) and a
      `runGate(main)` wrapper that sets `exitCode`; adopt everywhere. Effort M · Risk low.

## P1 — Single authority for security-critical duplicates

- [ ] **S2 — De-duplicate the Node⇄Web HTTP adapter (live `node.ts` vs string-emitted
      `build.ts`).** `packages/server/src/node.ts:344` (canonical, with `getSetCookie()` splitting and
      the HTTP/2 pseudo-header rationale) vs the hand-maintained emitted copy inside
      `nodeAdapterRuntimeSource()` at `build.ts:606` (already diverged: defensive
      `typeof headers.getSetCookie === 'function'` guard at build.ts:713 that node.ts:369 omits, and
      the rationale comment stripped). Dev (vite-dev.ts imports node.ts) and every prod preset run
      different physical copies of the Set-Cookie/header bridge. Generate the emitted adapter from
      the same source or add a parity test asserting behavioral agreement on Set-Cookie and
      pseudo-header handling. Effort M · Risk med.
- [ ] **S3 — Collapse the double CSRF→parse→guard execution in the mutation lifecycle.**
      `executeMutationLifecycle` validates CSRF, parses input, and maps guard failure
      (`packages/server/src/mutation.ts:256–303`), then `runMutation` repeats the byte-identical CSRF
      gate (mutation.ts:414), input parse, and guard mapping (447–457). Two textually-identical
      security gates must stay in lockstep by hand. Route all callers through one gate — e.g. a
      module-private `csrfValidated` sentinel consumed by `runMutation`, per the CLAUDE.md type-level
      security-ergonomics guidance. Preserves the normative CSRF→parse→guard order. Effort M ·
      Risk med.
- [ ] **S4 — One cookie-safe header-bag discipline; make the unsafe spread unrepresentable.**
      The correct multi-value model exists (`response.ts:12` `ResponseHeaders`,
      `appendResponseHeader`, `mergeMutationResponseHeaders`), but many paths build ad-hoc
      `Record<string,string>` bags combined by object spread (`mutation.ts:833–843`,
      `webhook.ts:1034`, `response.ts:409` `retryAfterHeaders`, `query.ts:887`) — a spread of two
      bags silently collapses multiple `Set-Cookie`. Make the ad-hoc builders return
      `ResponseHeaders` and route every merge through the cookie-safe combinator; consider a branded
      `HeaderBag` whose only combinator is the safe merge (CLAUDE.md calls out exactly this footgun).
      Complementary to `plans/high-value-refactoring-4.md` P1.5 (which floors apply); this item is
      about how bags combine. Effort M · Risk low.
- [ ] **S5 — Share the fail-closed replay reservation between mutation and webhook; one webhook
      response builder.** `webhook.ts:741` (`reserveWebhookReplayBeforeRun`) hand-mirrors the
      mutation replay reserve→get→re-reserve→fail-closed machine (`replay.ts` /
      `mutation.ts:1143–1250`) — two copies of the same idempotency invariant. Separately the
      `Cache-Control: private, no-store` + `Content-Type` webhook response floor is inlined five
      times (`webhook.ts:962,997,1013,1024,1034`). Lift the reservation algorithm into `replay.ts`
      parameterized by store shape; add one `webhookResponse(...)` builder owning the header floor.
      Effort M · Risk med.
- [ ] **D3 — Move the byte-identical mutation-config cluster to one module.**
      `forEachMutationConfig`, `mutationHandlerCallback`, `rawTablesFromMutationRegistry`,
      `isTrustedSqlArgument` are exact copies in `packages/drizzle/src/static.ts` (2130/2170/2162/2349)
      and `static/derivation.ts` (1266/1306/1298/1353) — the same cluster D1 already drifted in.
      Pure mechanical dedup into `static/domain-writes.ts`; natural precursor to D1. Effort S ·
      Risk low.
- [ ] **D4 — Add `assertNever` exhaustiveness to the Drizzle analyzer's discriminated unions.**
      Zero exhaustiveness checks across ~20k lines (`grep assertNever|switch` → 2 hits, both in
      framework-identity.ts). `PredicatePnf` (summaries.ts:3352, 6 kinds) is dispatched by ~9 partial
      if-chains (e.g. summaries.ts:537–552 silently returns `[]` for three kinds;
      summaries.ts:3772 handles only `eq`/`and`); a new kind silently degrades to "no scope proven".
      Add a shared `assertNever`, terminate the total chains with it, convert central dispatchers to
      `switch`, and centralize the `and`/`or` recursion helper. Behavior-preserving where chains are
      total; makes intentional subsets explicit. Effort M · Risk low-med.
- [ ] **C3 — Exhaustive fold for the two parallel `QueryShapeWrapper` switches in emitted-type
      codegen.** `packages/compiler/src/types.ts:918` (`wrapperQueryShapeTypeExpr`) and
      `types.ts:941–963` (`typeExprFromRevealedQueryShape`) enumerate the same union with divergent
      arms; exhaustiveness is enforced in only one, so a new wrapper kind can ship with a silent gap
      in emitted `.d.ts`. Extract one `foldQueryShapeWrapper` with a
      `Record<QueryShapeWrapper['kind'], …>` handler object; guard with `.d.ts` golden tests
      (registry atomicity, compiler hard rule 6). Effort M · Risk med.
- [ ] **T2 — One source-file walker + `isProductionSourceFile` policy for the security gates.**
      Six independent recursive walkers with differing exclusion sets feed gates that decide which
      files get scanned for dangerous sinks: `check-sink-policy-gate.mjs:2344/2354/2374`,
      `check-pack-security.mjs:432`, `compiler-build-id.mjs:30`, `import-boundary.mjs:258`,
      `fundamental-fixes-inventory.mjs:117`, `ci-shards.mjs:515`. An omission in one walker means
      files silently escape a gate. Add `scripts/lib/source-files.mjs` with one canonical
      collect/predicate pair; confirm each caller's current filter is preserved (the `.test.mjs`
      siblings cover this). Effort M · Risk med.

## P2 — Mechanical consolidation (low risk, drift prevention)

- [ ] **C4 — Generic `mergeFactsByKey` for the app-graph fact-merge triplets.** Seven byte-identical
      dedup-and-sort merge bodies at `packages/compiler/src/app-graph.ts:164/194/215/236/316/351/361`,
      each pairing an unenforced key-fn/comparator (e.g. `mergeAccessExplainFacts` dedups on
      `kind\0name` but sorts on `kind,name,decision`). One generic helper makes the coupling one line
      per fact type. Effort S · Risk low.
- [ ] **C5 — Move byte-identical compiler micro-helpers to `shared.ts`.** `uniqueSorted`
      char-for-char identical in `app-graph.ts:984`, `css.ts:554`, `package-styles.ts:283`,
      `scan/route-pages.ts:380`; `sanitizeIdentifier` and no-op `outputWriteFact` duplicated between
      `style.ts` and `lower/structural-jsx.ts`; three kebab-case variants. Consolidate; verify no
      phase-specific casing before merging the kebab helpers. Effort S · Risk low.
- [ ] **C6 — Promote the rich `propertyAccessPath` from parse.ts as the shared implementation.**
      `scan/parse.ts:708–745` resolves element access, zero-arg call receivers, and optional
      chaining; the simplified copies at `scan/route-pages.ts:1034` and `scan/query-binding.ts:146`
      handle only identifier + plain property access, so route/query-key facts diverge from component
      facts for accessor/call/optional forms. Share the rich version; confirm widened coverage via
      query-binding/route tests. Effort M · Risk med.
- [ ] **T3 — One CLI arg-parsing framework.** `packages/cli/src/graph-output.ts:1261`
      (`parseFlaggedArgs`, boolean-only, used by check/audit/explain) duplicates and diverges from
      the spec-driven `parseCommandArgv` (`commands-manifest.ts:708`, used by build/export/compile) on
      `--flag=value`, missing-value, and unknown-option messaging. Express check/audit/explain as
      `CommandArgvSpec`s; delete `parseFlaggedArgs`; keep message parity with
      `index.kovo-check/explain/audit.test.ts`. Effort M · Risk med.
- [ ] **T4 — Shared command argv-error and positional-validation helpers.** `buildArgvError` /
      `exportArgvError` are byte-identical modulo the command name
      (`commands/build-export.ts:153,226`); `commands/compile.ts` repeats the same three-branch
      mapper and positional guards seven times (587–822). Add `commandArgvError(name, error, usage)`
      and `requireSinglePositional(...)` in commands-manifest.ts. Effort M · Risk low.
- [ ] **T5 — Shared `findNearestFile` walk-up and `readJsonRecord`.** Three walk-up loops with
      drifted termination semantics (`commands/build-export.ts:918` stops at `stopDir`;
      `commands/compile.ts:416` walks to filesystem root; `build-export.ts:1556` falls back to cwd),
      and the parse+narrow-JSON idiom copy-pasted ~6× in compile.ts plus private `readJson` helpers
      in ≥3 scripts with inconsistent malformed-input handling. One walker with an explicit stop
      policy; one JSON reader each for CLI (`shared.ts`) and scripts (`scripts/lib`). Effort S ·
      Risk low.
- [ ] **U3 — Shared active-descendant/`describedBy` helpers for combobox + autocomplete.** The
      same bugfix cluster (filtered-index option-id synthesis, explicit-list-id `TypeError`,
      `describedBy` join) was hand-applied twice with byte-identical bodies
      (`combobox.ts:1007–1052`, `autocomplete.ts:1147–1191`). Move to `lib/active-descendant.ts`
      parameterized by a rendered-items resolver so the next fix lands once. Effort M · Risk low.
- [ ] **U4 — Thread `now` through select's keyboard handler.** `select.ts:980` hard-codes
      `Date.now()` inside `selectKeyDown` while every sibling injects `now` (dropdown-menu.ts:784,
      context-menu.ts:846, menubar.ts:803, combobox.ts:781, autocomplete.ts:909); select's typeahead
      window is untestable via injected time. `selectTypeahead` already accepts `now`. Effort S ·
      Risk low.
- [ ] **U5 — Shared trigger-attribute builder for consistent ARIA wiring.** `aria-controls` is
      stripped when disabled by dropdown/context/menubar (`dropdown-menu.ts:472`) but emitted
      unconditionally by select/combobox (`select.ts:520`); the native `disabled` attribute is
      always-emitted-boolean in dropdown/combobox, only-when-true in select, and `aria-disabled` in
      menubar/context. Add `triggerAttributes({ open, disabled, controlsId, haspopup, labelledBy })`
      in `lib/`; diff ARIA snapshots carefully. Effort M · Risk med.
- [ ] **U6 — Collection-adapter factory to retire the six-fold primitive scaffolding.** Each
      menu/listbox primitive re-declares the same typeahead/move wrapper + option/result interfaces +
      collection-item projector over `lib/collection-controller` (e.g. `dropdown-menu.ts:774–795`
      vs `select.ts:802–818`, near-verbatim). A `createCollectionAdapter({ getItems, projector })`
      factory removes ~40–60 lines per file and gives U1/U2/U4 a single home. Effort L · Risk med.
- [ ] **U7 — Delete or reposition the dead floating-positioning fallback.**
      `packages/headless-ui/src/lib/positioning-fallback.ts` (~7.4 KB engine + `Floating*` type
      surface) is exported via `internal.ts:9,43` but consumed by nothing in the repo (only its own
      unit test); primitives delegate positioning to CSS anchor positioning. Remove it (run the
      `audit-public-api` process first) or document it as deliberately reserved. Effort S · Risk low.

## P3 — Structural splits (mechanical once P0–P1 land)

- [ ] **D5 — Finish the `static.ts` monolith extraction.** `packages/drizzle/src/static.ts`
      (4913 lines) re-exports 13 `static/*` modules yet still privately defines parallel copies of
      extracted logic (the root cause of D1/D2/D3 and the loose `'kind' in shape` traversal at
      static.ts:3354 vs the strict predicate at query-shapes.ts:2790). Move the remaining shared
      implementations out (query-shape traversal → query-shapes.ts via a shared `foldQueryShape`
      visitor; raw-write/mutation cluster → domain-writes.ts) leaving static.ts a thin barrel.
      Effort L · Risk med.
- [ ] **S6 — Split `mutation.ts` along its existing `mutation/` seam and unify the
      enhanced/no-JS fork behind the delivery-mode union.** The 1973-line file mixes the lifecycle
      state machine (242–382), `runMutation` (398–550), enhanced wire rendering (744–1034), no-JS PRG
      rendering (1071–1524), replay-policy adapters (1143–1250), and failure HTML (1686–1803);
      `mutation/definition|streaming|targets|stale-version.ts` show the intended split. The
      enhanced/no-JS reauth and stale-session-CSRF branches are hand-forked pairs differing only in
      the terminal response builder (mutation.ts:1825–1842 vs 1936–1951; 1844–1867 vs 1869–1892)
      despite `MutationResponseDeliveryMode` (211–223) existing to dispatch them. Extract
      `mutation/wire-response.ts`, `mutation/no-js.ts`, `mutation/replay-policy.ts`,
      `mutation/failure-html.ts`; compute the lifecycle outcome once and map to mode-specific
      responses in one renderer. Effort L · Risk low-med (mechanical; depends on S3).
- [ ] **T6 — Split `graph-output.ts` (3046 lines) along its three clean seams.** Input
      acquisition (`readGraphInput:73`, `discoverGraphInputPath:112`), arg parsing
      (`parseCheckArgs:1042` etc., unified by T3), and ~35 pure `Fact → string` formatters
      (≈lines 1300–3046) barely touch. Extract `graph-input.ts`, `graph-args.ts`,
      `graph-explain-format.ts`; keep orchestration in graph-output.ts. Effort L · Risk low.
- [ ] **T7 — Tightly-scoped structural cleanup in `inline-loader-build.ts` (no rewrite).**
      Two safe moves only: (a) extract the ~80-entry line-array module emission in
      `buildInlineKovoLoaderModuleSource` (`packages/browser/src/inline-loader-build.ts:1215`) into a
      named-parts builder so interpolations are testable in one place; (b) merge the readable/minified
      trusted-types routing assertions (:1560, :1590) into one parameterized checker. Do NOT attempt
      to eliminate the hand-written `String.raw` installer (:113–1042) — that is a behavior-changing
      rewrite guarded by byte-exact artifact parity. Effort M · Risk high (parity-sensitive; gate on
      `inline-loader-build.test.ts` + `check:inline-loader` before/after).
- [ ] **T8 — Fold repo-root/path bootstrapping into `scripts/lib`.** Four different `repoRoot`
      computations across scripts (`check-sink-policy-gate.mjs:6`, `public-packages.mjs:14`,
      `security-gate-mutations.mjs:13`, `fundamental-fixes-census-gate.mjs:9`); rides along with
      T1/T2/T5's shared `scripts/lib` module. Effort S · Risk low.

## Areas checked and found healthy

- Compiler: no `as any` in non-test code; escaping centralized in `shared.ts`
  (`escapeAttribute`/`escapeCssString`).
- Server: webhook error swallowing (webhook.ts:453,482,633–659) is intentional fail-closed
  sanitization with SPEC citations, not a bug.
- headless-ui: `packages/ui` composes headless-ui without reimplementing behavior; the
  `defaultPrevented` guard convention is machine-enforced (`tooling/primitive-handler-lint.ts`,
  KOVO_HUI001); `now`-injection is otherwise consistent (U4 is the lone exception).
- Unproven (needs a deeper pass if pursued): token/value drift between
  `headless-ui/src/lib/token-sheet.ts` and `packages/style/src/theme.ts` — they appear to be
  different layers, not duplicates.

## Verification map

- Drizzle (D1–D5): `pnpm --filter @kovojs/drizzle test`, `pnpm run test:conformance` (Drizzle
  conformance pins extraction verdicts).
- Compiler (C1–C6): focused `pnpm --filter @kovojs/compiler test`, then `vp run compiler-perf`
  and the render-equivalence/fixpoint gates; `.d.ts` goldens for C3.
- Server (S1–S6): `pnpm --filter @kovojs/server test`; S2 needs a new emitted-adapter parity
  test; broad `pnpm run test:integration` for mutation/webhook wire behavior.
- CLI/scripts (T1–T8): `pnpm --filter @kovojs/cli test`; each gate script's `.test.mjs` sibling;
  `pnpm run check` end-to-end for the gate wiring; `check:inline-loader` +
  `pnpm --filter @kovojs/browser test` for T7.
- headless-ui (U1–U7): `pnpm --filter @kovojs/headless-ui test`, `pnpm run test:browser`, gallery
  browser gate for ARIA-visible changes (U5); `audit-public-api` process before U7 removal.

## Suggested sequencing

1. P0 first — each is a candidate latent bug; land D3 before D1 (same cluster), D2 before D5.
2. S3 before S6; T3 before T6; U-family items U2/U4 → U3 → U1/U5 → U6 (factory last, once the
   shared helpers exist to move into it).
3. P2/P3 items are independent of each other and safe to fan out in parallel worktrees per the
   Progress Discipline rules.
