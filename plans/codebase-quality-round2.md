# Codebase Quality Remediation Plan - Round 2

Status: active. Last compacted on 2026-06-13.

This is the current codebase-quality ledger. It supersedes `plans/codebase-quality.md` and the
remaining compiler cleanup from archived `plans/improve-compiler.md`.

Keep this file compact: track open work, current state, latest proving commands, and integration
risks. Check a box only when the exact item is closed with same-session file and test evidence.

## Checklist

- [x] Phase 0 ledger honesty: false checked items corrected; checklist evidence rule added to
      `AGENTS.md`; round-1 open work merged here.
- [ ] Phase 1 gate de-tautologization: `tests/fw-check.node.mjs` verifies behavior and structured
      artifacts, not source text or its own test names.
- [ ] Phase 2 compiler IR: one parsed model, explicit source patches and offset maps, validators
      consume model facts, no compatibility reparses where parser facts are sufficient.
- [ ] Phase 3 Drizzle extraction: ts-morph/project facts end-to-end; bespoke lexers deleted;
      impossible or indirect surfaces degrade to FW406 instead of fabricated facts.
- [ ] Phase 4 runtime: one runtime apply path, checked inline-loader parser/minifier parity, no
      duplicated wire/apply parsers or compatibility exports.
- [x] Phase 5 server/app-shell: subtractive server extraction, one request/document/static-export
      path, stable public export boundaries, static export and Vite adoption closed.
- [ ] Phase 6 verification harness and commerce honesty: `@jiso/test` seams prove behavior through
      public fixtures; commerce source/dependency/generated-artifact story is honest.
- [ ] Phase 7 test restructuring: monolith tests split along module seams, shared fixtures used
      deliberately, diagnostics asserted through `diagnosticDefinitions`.

## Operating Rules

- Keep implementation slices large enough to close a coherent phase surface.
- Keep evidence with implementation; avoid evidence-only branches unless fixing this ledger.
- Prefer deleting compatibility wrappers, source-string lowerers, bespoke parsers, and duplicate
  public paths over adding adapters.
- Keep P10 external/non-code evidence separate from implementation progress.
- Preserve dirty main-thread changes while integrating worker branches.

## Phase 1 - Gate De-tautologization

Current state: `tests/fw-check.node.mjs` now consumes shared `@jiso/test` fixtures for HTML
fragments, generated modules/source facts, command output/Vite facts, markdown/source facts, MCP,
static export, starter templates, `fw-explain`, TypeScript, wire, touch-graph provenance, graph
facts, and structured `fw-check/v1` result facts. Shared `@jiso/test/html-fragment` now owns
form-field maps, keyed-element projections, and response-body query/fragment/stylesheet/key
summaries for commerce app/source-truth tests. Shared markdown fixtures now own SPEC rule-title
canonicalization for doc gates, so `tests/fw-check.node.mjs` no longer keeps that local normalizer.
Shared source/command fixtures now own conformance package manifest and Vite+ gate projections for
the conformance fw-check case. Shared source fixtures also own the Drizzle query/touch source
fixtures and query/diagnostic/touch behavior projections used by the fw-check Drizzle gate. Shared
`fw-export` fixtures now own static export CLI stream, artifact byte, and summary projections for
the D10 fw-check gate. Shared diagnostic-output fixtures now own the lowered Vite event-diagnostic
projection used by the D10 fw-check gate, including lowered handler reference shape.
Shared compiler fixtures now own diagnostic and update-coverage projections for the P1/P3
fw-check compiler harness cases, so those assertions no longer compare source offsets, lengths, or
`sourceSpan` fields in the monolith.
Shared generated-module fixtures now own generated server render element facts, compact handler
reference summaries, and generated client export type summaries used by the fw-check generated
artifact harness cases, reducing repeated local render/HTML parsing/export-shape mechanics.
Shared generated-module fixtures also own the inline enhanced-form loader VM fixture and project
listener/fetch/query/fragment effects into structured facts, so the S2 fw-check gate no longer
keeps a local DOMParser/FormData/fetch VM harness.
Shared runtime fixtures now own the loader smoke fake-root, visibility observer, refetch, and
template-stamp mechanics used by the P2 fw-check gate, so the monolith asserts a structured public
runtime behavior fact instead of rebuilding that harness locally.
Shared Vite fixtures now own plugin middleware capture, generated transform element/handler
projections, generated-handler middleware smoke behavior, the S1 production emit contract, and
red/green build temp-project mechanics for the S1 and D10 fw-check cases.
Shared compiler fixtures now own generated query-shape fact construction, query-update-plan
projection, and diagnostic message projection for the P5 fw-check data-bind gate. Shared generated
module fixtures now own generated-registry interface and consumer type assertions for the P2/P3/P1
fw-check registry gates, so those cases no longer read registry artifact source or recreate virtual
TypeScript program files in the monolith. Shared generated-module fixtures now also own generated
query update-plan application, bootstrap deferred-stream application, server deferred-stream
application, and wire deferred-stream projection facts for the D3 fw-check gate, so the monolith no
longer builds those reusable fake DOM/runtime mechanics inline. Shared generated-module fixtures
now also own minifier handler export invocation, typed data-param coercion, and render-equivalence
behavior projections used by the P1 fw-check generated-module gates.
Shared starter-template fixtures now own starter browser client loader/fetch/fragment/deferred
behavior projections for the P10 starter fw-check gate, so the monolith no longer replays those
fake document/runtime mechanics inline.
Shared starter-template fixtures now also own the starter acceptance projection for package
scripts/dependencies, graph facts, `fw-check`/`fw-explain` assertions, Vite+ task execution, CI
commands, emitted graph freshness, app compile fixpoint/render equivalence, CSS/HTML facts, and
browser client behavior, so the P10 starter fw-check gate no longer assembles that broad fixture
mechanic locally.
Shared generated-module fixtures now own generated CSS artifact scope-rule projection for the P10
normative-docs fw-check gate, so the monolith no longer extracts generated CSS source and parses
scope rules locally.
Shared runtime fixtures now also own pagehide optimism cleanup lifecycle, pending-stamp, fetch,
and rebase behavior projections for the P6 fw-check gate, so the monolith no longer rebuilds that
fake lifecycle root locally.
Shared graph fixtures now own generated graph artifact honesty projections for commerce emitted
graph checks, invalidations, and source-derived touch-graph provenance, so the P4 fw-check commerce
gate asserts one structured artifact fact instead of assembling provenance and invalidation
summaries inline.
Shared graph fixtures now also own the compact generated graph artifact honesty summary used by the
P4 fw-check commerce gate, keeping exact invalidation and source-derived touch evidence in the
package fixture instead of the monolith.
Shared graph fixtures now also own a compact generated graph artifact acceptance evidence
projection for emit-check cleanliness, `fw-check/v1` OK status, static graph behavior,
invalidations, source-site provenance, and touches-by-mutation; the P4 fw-check commerce gate and
commerce source-truth graph acceptance assert that public fixture instead of duplicated local
summary object shape.
Shared graph fixtures now also own a generated graph artifact acceptance checklist projection that
keeps the P4 fw-check commerce gate and commerce source-truth graph acceptance on public fixture
facts for clean emit, `fw-check/v1` OK status, invalidation keys, static behavior, source-site
coverage, touch counts, and unresolved mutations instead of repeating the generated-artifact
evidence object in those tests.
Shared graph fixtures now also own project-level generated graph artifact acceptance mechanics for
loading checked-in graph artifacts, running emit freshness commands, collecting touch provenance,
and projecting the acceptance checklist, so the P4 fw-check commerce gate and commerce
source-truth graph acceptance no longer assemble those mechanics locally.
Shared generated-module fixtures now own committed-IR freshness facts for authored/generated
component pairs, including compiler fixpoint/render-equivalence hook execution and exact generated
output comparison against SPEC.md section 5.2 provenance.
Shared source fixtures now own allowed module-import failure projection for fw-check fallback paths,
and shared touch-graph fixtures now own provenance honesty summaries used by both the fw-check
commerce committed graph gate and commerce source-truth tests.
Shared HTML fragment fixtures now own static export main-marker projections for the D10 fw-check
gate, so the monolith no longer keeps a local helper that parses exported HTML for
`data-fw-check-export`.
Shared generated-module fixtures now own generated view-transition stamp behavior projections,
including rendered host attributes, registry member types, and JSX prop elision for the P2
fw-check gate.
Shared verification fixtures now own the P9 CSRF, harness, DB verifier, structured SQL, and
Pglite verification behavior fact, so `tests/fw-check.node.mjs` no longer defines that reusable
fake DB and assertion harness locally.
Shared runtime fixtures now own enhanced mutation broadcast, malformed change-header, keyed query
state, and optimistic pending-stamp behavior projections for the P9 verification-layer fw-check gate, so the monolith
no longer defines that fake DOM/mutation root harness inline.
Shared command fixtures now own browser-suite and P10 perf acceptance-gate projections, including
Vite+ task input facts, CI/acceptance membership, ordering, and acceptance module shapes, so the
P10 fw-check cases no longer rebuild that gate mechanic locally.
Shared command fixtures now also own browser-suite project-root fixture assembly, including package
manifest, CI workflow, Vite+ config, and acceptance module import, so the P10 browser acceptance
fw-check case no longer reads those project files locally.
Shared command fixtures now also own P10 perf acceptance project-root fixture assembly, including
package manifest, CI workflow, Vite+ config, acceptance module import, ordering, and task input
facts, so the P10 perf fw-check case no longer reads those project files or imports the acceptance
module locally.
Shared runtime fixtures now own the keyed morph and fragment-application behavior projection used by
the P5 fw-check gate, so the monolith no longer builds that fake structural tree, fragment target,
and query-store fixture inline.
Shared markdown fixtures now own the v1 acceptance ledger projection for SPEC §16 criterion
coverage, evidence artifacts, audit statuses, acceptance runs, and clean-checkout status facts, so
the P10 fw-check gate no longer stitches those markdown tables locally.
Shared markdown fixtures now also own the legibility-study and prelaunch-checklist readiness
projections, including pending external evidence, dated ledger review facts, local checklist
coverage, and packet-readiness counts, so the P10 fw-check gate no longer assembles those
markdown tables inline.
Shared wire fixtures now own sorted `.http` fixture source loading, the intentionally byte-for-byte
generated response body pins, and named response-body selection, so the Phase 0 and D3 fw-check
wire cases no longer keep fixture directory reads or generated wire pin maps in the monolith.
Shared HTML fragment fixtures now also own document query-script behavior projection for the P3
fw-check server hydration gate, including head/body query script placement and body element facts,
so the monolith no longer assembles those document-region/query-script projections inline.
Shared fw-export fixtures now own D10 static export red/green mechanics for API and CLI paths,
including temp app-module generation, emitted artifact presence, structured CLI output projection,
and exported main-marker checks, so the monolith no longer creates export temp projects or reads
generated export artifacts inline. Shared compiler fixtures now own the P5 data-bind generated
query-shape fixture assembly, nullable-path diagnostics, and D3 derive/stamp query-plan
projection, so those fw-check cases no longer keep reusable TSX source assembly or raw compiler
offset fields in the monolith. Shared compiler fixtures now also own the P1 validation fixture
assembly for IDREF, static-id, content-model, execution-trigger, and residual `fw-c`/`fw-deps`
checks, so the monolith asserts public diagnostic facts without rebuilding those TSX sources inline.

- [ ] Search for remaining custom parsers, raw source membership checks, and generated-artifact
      projections in `tests/fw-check.node.mjs`.
- [ ] Replace each remaining case with public behavior or structured `@jiso/test` fixture
      assertions.
- [ ] Keep intentional byte-for-byte wire pins explicitly scoped.
- [ ] Keep create-jiso scaffold checks executable against real generated files, Vite+ tasks, graph
      assertions, and typechecking.

Latest evidence:

- Phase 5 Vite SSR dev node-handler boundary slice:
  `pnpm exec vitest --run packages/server/src/vite-dev.test.ts packages/server/src/vite.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`;
  `pnpm exec vp check packages/server/src/vite-dev.ts packages/server/src/vite-dev.test.ts packages/server/src/vite.test.ts plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
  Evidence: `packages/server/src/vite-dev.ts` now rejects explicit Vite SSR dev
  `nodeHandlerExportName` exports unless they are adapter-edge Node handlers with
  `(request, response)`, and `packages/server/src/vite-dev.test.ts` proves stale web
  `Request -> Response` exports fail before entering the middleware chain.
- Phase 5 static export manifest inventory directory-index slice:
  `pnpm exec vitest --run packages/server/src/vite-static-export-result.test.ts packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`;
  `pnpm exec vp check packages/server/src/static-export-result.ts packages/server/src/vite-static-export-result.test.ts plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
  Evidence: `packages/server/src/static-export-result.ts` now treats public manifest `files`
  route-document inventory entries as part of the SPEC §9.5 directory-index document contract, and
  `packages/server/src/vite-static-export-result.test.ts` proves a stale flat inventory route
  document is rejected before export-task manifest evidence is accepted.
- Phase 5 static export asset source boundary slice:
  `pnpm exec vitest --run packages/server/src/static-export-output.test.ts packages/server/src/static-export.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`;
  `pnpm exec vp check packages/server/src/static-export-output.ts packages/server/src/static-export-output.test.ts packages/server/src/static-export.ts packages/server/src/static-export.test.ts plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
  Evidence: `packages/server/src/static-export-output.ts` now rejects non-`file:` URL static asset
  sources with FW229, and `packages/server/src/static-export.ts` normalizes public static export
  assets before SPEC §9.5 synthetic route replay so invalid asset source URLs fail before route
  rendering, output planning, or writes.
- Phase 5 static export replay origin boundary slice:
  `pnpm exec vitest --run packages/server/src/static-export-request.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`;
  `pnpm exec vp check packages/server/src/static-export-replay-context.ts packages/server/src/static-export-request.test.ts packages/server/src/static-export.test.ts plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`. Evidence: `packages/server/src/static-export-replay-context.ts` now
  validates public SPEC §9.5 static-export `origin` options before synthetic replay, accepting
  only absolute `http(s)` origins without path, search, or hash and proving `exportStaticApp()`
  rejects invalid origins before route replay or output writes.
- Phase 4 runtime hydration apply-error continuation slice:
  `pnpm exec vitest --run packages/runtime/src/query-events.test.ts packages/runtime/src/query-script-hydration.test.ts packages/runtime/src/query-hydration.browser.test.ts`;
  `pnpm exec vitest --run packages/runtime/src/query-visible-return.test.ts packages/runtime/src/loader-query-hydration.test.ts`;
  `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/query-hydration.browser.test.ts`;
  `pnpm exec vp check packages/runtime/src/query-events.ts packages/runtime/src/query-events.test.ts packages/runtime/src/query-script-hydration.ts packages/runtime/src/query-script-hydration.test.ts packages/runtime/src/query-hydration.browser.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`. Evidence: `packages/runtime/src/query-events.ts` and
  `packages/runtime/src/query-script-hydration.ts` now forward hydration apply failures through
  the canonical decoded query apply `onError` seam, so one bad inline-event or direct script query
  does not abort later valid query chunks in the same batch. Focused node and browser tests prove
  SPEC §9.1/§9.4 query truth continues through the shared mutation/typed-read apply path with
  loader-context error reporting intact.
- Phase 5 Vite manifest hint static-host boundary slice:
  `pnpm exec vitest --run packages/server/src/vite-manifest.test.ts packages/server/src/vite-build.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`;
  `pnpm exec vp check packages/server/src/vite-manifest.ts packages/server/src/vite-manifest.test.ts plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`. Evidence: `packages/server/src/vite-manifest.ts` now sends non-external
  Vite manifest hint assets through the shared dist-file validator before route hint generation,
  keeping SPEC §9.5 Vite route hints aligned with static-export asset copy planning and rejecting
  unsafe `..` or encoded-dot paths before adoption/export wiring.
- Phase 1/7 S1 Vite production emit fixture closure:
  `pnpm exec vitest --run packages/test/src/vite-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  `node --test --test-name-pattern "S1 production build" tests/fw-check.node.mjs`;
  `pnpm exec vp check`;
  `pnpm run check:fw`;
  `git diff --check`.
  Evidence: `packages/test/src/vite-fixtures.ts` now owns the S1 product-card source fixture,
  `prod-emit-check/v1` command projection, Vite middleware capture, generated handler transform
  summary, and executable handler invocation fact; `tests/fw-check.node.mjs` asserts that public
  fixture fact instead of assembling the production emit and generated-client middleware harness
  locally.
- Phase 5 static export client-module discovery boundary slice:
  `pnpm exec vitest --run packages/server/src/static-export-document.test.ts packages/server/src/static-export-document-client-modules.test.ts packages/server/src/static-export.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`;
  `pnpm exec vp check packages/server/src/static-export-document-refs.ts packages/server/src/static-export-document.test.ts packages/server/src/static-export-document-client-modules.test.ts packages/server/src/static-export.test.ts plans/app-shell.md plans/codebase-quality-round2.md`.
  Evidence: `packages/server/src/static-export-document-refs.ts` now limits SPEC §9.5 static
  export `/c/` client-module replay discovery to declared module surfaces: `on:*` handler refs,
  module scripts, modulepreload links, and modulepreload `Link` header entries. Focused tests prove
  unrelated `data-*`, stylesheet, JSON script, plain script, and non-modulepreload `/c/` refs do
  not trigger copied static-host client-module artifacts.
- Phase 5 static export route-document target safety slice:
  `pnpm exec vitest --run packages/server/src/static-export-route-plan.test.ts packages/server/src/static-export-output-targets.test.ts packages/server/src/static-export.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`;
  `pnpm exec vp check packages/server/src/static-export-route-plan.ts packages/server/src/static-export-route-plan.test.ts packages/server/src/static-export-output-targets.ts packages/server/src/static-export-output-targets.test.ts packages/server/src/static-export.test.ts plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
  Evidence: `packages/server/src/static-export-route-plan.ts` rejects concrete route document
  targets whose URL path segments decode to separators, dot segments, or invalid URL encoding
  before SPEC §9.5 synthetic replay, and `packages/server/src/static-export-output-targets.ts`
  applies the same guard to direct output-plan callers.
- Phase 1/7 compiler fixture harness closure:
  `pnpm exec vitest --run packages/test/src/compiler-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `node --test --test-name-pattern "P5 data-bind|D3 deferred" tests/fw-check.node.mjs`;
  `pnpm run check:build`;
  `pnpm exec vp check`;
  `pnpm run check:fw`;
  `git diff --check`.
  Evidence: `packages/test/src/compiler-fixtures.ts` now owns the reusable P5 data-bind
  query-shape source assembly and compiler diagnostic projections, while
  `compilerQueryUpdatePlanFacts()` strips D3 derive/stamp source-span and template offset fields;
  `tests/fw-check.node.mjs` asserts those public fixture facts instead of assembling local TSX
  sources or comparing raw compiler artifact internals.
- Phase 1/7 P1 compiler validation fixture closure:
  `pnpm exec vitest --run packages/test/src/compiler-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `node --test --test-name-pattern "P1 compiler validation" tests/fw-check.node.mjs`;
  `pnpm run check:build`;
  `pnpm run check:fw`;
  `pnpm exec vp check`;
  `git diff --check`.
  Evidence: `packages/test/src/compiler-fixtures.ts` now owns the reusable P1 compiler validation
  TSX source assembly for IDREF, static-id, content-model, execution-trigger, and residual
  `fw-c`/`fw-deps` checks; `tests/fw-check.node.mjs` asserts the resulting structured diagnostic
  facts rather than locally compiling each fixture source.
- Phase 5 static export client-module snapshot conflict slice:
  `pnpm exec vitest --run packages/server/src/static-export-document-client-modules.test.ts packages/server/src/static-export.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`. Evidence:
  `packages/server/src/static-export-client-modules.ts` now rejects same-path `/c/` module
  variants when replayed response headers, status, or body differ, and
  `packages/server/src/static-export-document-client-modules.test.ts` proves byte-drift and
  header-drift variants fail with FW229 before SPEC §9.5 static-export artifacts are published.
- Phase 5 Vite dev client-module request boundary slice:
  `pnpm exec vitest --run packages/server/src/vite-dev.test.ts packages/server/src/vite.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`. Evidence:
  `packages/server/src/vite-dev.ts` now lets unversioned `/c/*` requests fall through to Vite
  dev middleware while retaining app-shell ownership for SPEC §9.5 immutable `/c/*?v=` client
  modules, and `packages/server/src/vite-dev.test.ts` proves both the direct ownership predicate
  and SSR dev middleware fallback behavior.
- Phase 3 Drizzle destructured static action alias slice:
  `pnpm exec vitest --run packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts -t "destructured static domain action aliases|domain action shorthand aliases"`;
  `pnpm exec vitest --run packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`;
  `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
  Evidence: `packages/drizzle/src/static.ts` now reuses the ts-morph static binding-element
  reference path for domain `write(...)` action aliases destructured from static containers,
  covering `domain({ add })` and renamed aliases without source-name compatibility extraction;
  `packages/drizzle/src/index.test.ts` and `conformance/drizzle-pin/src/index.test.ts` pin the
  surface with real Postgres Drizzle fixtures.
- UI/gallery simple styled visual-baseline and button form-owner slice:
  `pnpm exec vitest --run packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.test.ts`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "representative styled static gallery routes")`;
  exact `pnpm exec vp check packages/ui/src/button.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/visual-fixtures/badge.html.txt examples/gallery/src/visual-fixtures/breadcrumb.html.txt examples/gallery/src/visual-fixtures/button.html.txt examples/gallery/src/visual-fixtures/card.html.txt examples/gallery/src/visual-fixtures/kbd.html.txt examples/gallery/src/visual-fixtures/skeleton.html.txt plans/ui.md plans/codebase-quality-round2.md`;
  `git diff --check`. Evidence: `packages/ui/src/button.tsx` preserves external native `form`
  ownership on styled buttons per SPEC §3.1 light-DOM/native-form fallback, while static gallery
  fixtures and Chromium visual hashes now cover badge, breadcrumb, button, card, kbd, and skeleton
  routes.
- UI/gallery native status/display static visual-baseline slice:
  `pnpm exec vitest --run packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.test.ts`;
  `pnpm exec tsc -p examples/gallery/tsconfig.json --noEmit`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "representative styled static gallery routes")`;
  exact `pnpm exec vp check examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/visual-fixtures/avatar.html.txt examples/gallery/src/visual-fixtures/meter.html.txt examples/gallery/src/visual-fixtures/progress.html.txt examples/gallery/src/visual-fixtures/scroll-area.html.txt examples/gallery/src/visual-fixtures/separator.html.txt plans/ui.md plans/codebase-quality-round2.md`;
  `git diff --check`. Evidence: avatar, meter, progress, scroll-area, and separator static gallery
  routes now have raw route fixtures synchronized against `renderGalleryRoute()` and Chromium
  geometry/hash baselines; avatar, meter, progress, and separator render the styled `@jiso/ui`
  wrapper surface while preserving SPEC §3.1 light-DOM/native semantics.
- Phase 5 Vite plugin closed-app runtime guard slice:
  `pnpm exec vitest --run packages/server/src/vite.test.ts packages/server/src/api/app.test.ts`;
  `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs the generated starter app-shell request and export proof"`;
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "exports the public commerce shell while the dynamic session shell stays non-exportable"`;
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs -t "serves generated docs HTML through the app shell before static export copies modules"`;
  `pnpm exec tsc --noEmit --pretty false`. Evidence:
  `packages/server/src/vite-plugin.ts` now applies the shared `isJisoApp()` aggregate guard before
  creating Vite dev/build/export handlers, and `packages/server/src/vite.test.ts` proves runtime
  JavaScript callers cannot pass raw request handlers or partial compatibility shells into the
  SPEC §9.5 Vite plugin boundary.
- Phase 3 Drizzle static accessor callback closure slice:
  `pnpm exec vitest --run packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts -t "static (property|accessor)"`;
  `pnpm exec vitest --run packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts`.
  Evidence: `packages/drizzle/src/static.ts` now resolves class static accessor return
  expressions through the same ts-morph project declaration path used for static callback
  properties, covering visible Postgres query-loader option objects, loader callbacks, domain
  action objects, and `write(...)` mutation callbacks while non-single-return/opaque accessors
  continue to degrade through the existing FW406 unresolved paths.
- Phase 5 plugin-time Vite static-export option guard slice:
  `pnpm exec vitest --run packages/server/src/vite-static-export-options.test.ts packages/server/src/vite-plugin-build.test.ts`;
  `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs the generated starter app-shell request and export proof"`;
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "exports the public commerce shell while the dynamic session shell stays non-exportable"`;
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs -t "serves generated docs HTML through the app shell before static export copies modules"`;
  `pnpm exec tsc --noEmit --pretty false`. Evidence:
  `packages/server/src/vite-static-export-options.ts` now rejects stale runtime `distDir` fields on
  plugin/build-output static-export options before asset planning, replay, or writes, keeping
  SPEC §9.5 Vite static-host asset roots owned by the build output directory.
- Phase 5 app aggregate client-module guard slice:
  `pnpm exec vitest --run packages/server/src/api/app.test.ts`;
  `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs the generated starter app-shell request and export proof"`;
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "exports the public commerce shell while the dynamic session shell stays non-exportable"`;
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs -t "serves generated docs HTML through the app shell before static export copies modules"`;
  `pnpm exec tsc --noEmit --pretty false`;
  `pnpm exec vp check packages/server/src/app-guards.ts packages/server/src/api/app.test.ts packages/create-jiso/templates/src/app-shell.test.ts packages/create-jiso/src/index.test.ts examples/commerce/src/app-shell.test.ts site/scripts/app-shell.test.mjs plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
  Evidence: `packages/server/src/app-guards.ts` now rejects dynamically loaded app aggregates whose
  client-module registry lacks `put()` or `resolve()`, and server/starter/commerce/docs adoption
  tests pin that shared SPEC §9.5 public-boundary guard before Vite/static export replay.
- Phase 5 docs-site app-shell server API guard slice:
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs`;
  `pnpm exec tsc --noEmit --pretty false`;
  exact `pnpm exec vp check site/scripts/app-shell.mjs site/scripts/app-shell.test.mjs plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`. Evidence:
  `site/scripts/app-shell.mjs` now validates the focused SPEC §9.5 docs server API before binding
  routes, and `site/scripts/app-shell.test.mjs` proves incomplete injection fails before export
  replay while the docs static export adoption path remains green.
- P3 document query-script HTML fixture slice:
  `pnpm exec vitest --run packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P3 server renders initial query scripts for document-load hydration" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/html-fragment.ts packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`. Evidence: `packages/test/src/html-fragment.ts` exposes
  `documentQueryScriptBehaviorFact()` as a public fixture projection for rendered query scripts,
  head/body placement, and body element facts; `tests/fw-check.node.mjs` consumes that fact instead
  of locally stitching document regions, `fw-query` facts, and body element projections.
- D10 static export fixture closure slice:
  `pnpm exec vitest --run packages/test/src/fw-export-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "D10" tests/fw-check.node.mjs`.
  Evidence: `packages/test/src/fw-export-fixtures.ts` exposes
  `fwExportStaticBehaviorFact()` as a public fixture for static export API rejection,
  lint-only artifact emission, CLI red/green module generation, structured `fw-export/v1`
  projection, and exported main-marker checks; `tests/fw-check.node.mjs` now asserts that
  structured fact instead of managing export temp directories or reading generated artifacts
  inline.
- Wire fixture package seam slice:
  `pnpm exec vitest --run packages/test/src/wire-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "Phase 0 wire fixture|SSE remains a v2 backlog fixture|D3 deferred stream responses are consumed by the runtime" tests/fw-check.node.mjs`.
  Evidence: `packages/test/src/wire-fixtures.ts` exposes `loadWireFixtureSources()`,
  `generatedWireResponseBodies`, and `wireFixtureResponseBody()`; `tests/fw-check.node.mjs`
  consumes those public fixture seams for fixture loading, explicit byte pins, and deferred-stream
  wire response selection instead of local directory reads, source parsing, or generated wire maps.
- P10 starter acceptance fixture slice:
  `pnpm exec vitest --run packages/test/src/starter-template-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P10 starter wires graph assertions into CI" tests/fw-check.node.mjs`;
  `pnpm exec vp check packages/test/src/starter-template-fixtures.ts packages/test/src/starter-template-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs`;
  `pnpm run check:fw`;
  `git diff --check`. Evidence: `packages/test/src/starter-template-fixtures.ts` exposes
  `starterTemplateAcceptanceFact()` as a public fixture for starter package/dependency facts,
  graph facts, `fw-check`/`fw-explain` projections, Vite+ task execution, CI command ordering,
  emitted graph freshness, SPEC §5.2 app compile fixpoint/render-equivalence assertions,
  CSS/HTML facts, and browser client behavior; `tests/fw-check.node.mjs` consumes that structured
  fact instead of locally assembling those fixture mechanics.
- Project graph artifact acceptance fixture slice:
  `pnpm exec vitest --run packages/test/src/graph-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`.
  Evidence: `packages/test/src/graph-fixtures.ts` exposes
  `generatedGraphArtifactAcceptanceProjectFact()`; `tests/fw-check.node.mjs` and
  `examples/commerce/src/source-truth.test.ts` use that public fixture for graph artifact loading,
  emit-check freshness, touch provenance, `fw-check/v1` OK status, and acceptance checklist
  projection instead of locally composing the generated-artifact evidence.
- P10 perf acceptance command fixture slice:
  `pnpm exec vitest --run packages/test/src/command-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P10 perf acceptance is wired through Playwright and CDP" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/command-fixtures.ts packages/test/src/command-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`. Evidence: `packages/test/src/command-fixtures.ts` exposes
  `p10PerfAcceptanceProjectFact()` as a public fixture for package manifest, CI workflow, Vite+
  config, P10 acceptance module import, ordering, and task input facts; `tests/fw-check.node.mjs`
  consumes that fixture instead of locally reading project files and importing the acceptance
  module.
- Phase 5 manifest-file Vite replay cleanup slice:
  `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/api/app.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`;
  `pnpm exec vp check packages/server/src/vite-static-export-manifest-file.ts plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`. Evidence:
  `packages/server/src/vite-static-export-manifest-file.ts` now routes manifest-file write,
  manifest, and inventory tasks through one local SPEC §9.5 build/replay helper while preserving
  the focused `@jiso/server/app-shell/vite` public boundary.
- Phase 5 directory-index adoption closure slice:
  `pnpm exec vitest --run packages/server/src/vite-static-export-result.test.ts packages/server/src/api/app.test.ts`;
  `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs the generated starter app-shell request and export proof|runs .* with the built stylesheet href"`;
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "exports the public commerce shell|wires .* to the public commerce shell static output"`;
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs`;
  `pnpm exec tsc --noEmit --pretty false`. Evidence:
  `packages/server/src/static-export-result.ts` now rejects non-directory-index route documents at
  the public manifest/result boundary used by the Vite export bridge; starter, commerce, and docs
  adoption tests prove their static-host exports do not publish stale flat `.html` route documents.
- Graph artifact acceptance checklist fixture slice:
  `pnpm exec vitest --run packages/test/src/graph-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/source-truth.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact|P10 commerce graph assertions answer behavior mechanically" tests/fw-check.node.mjs`.
  Evidence: `packages/test/src/graph-fixtures.ts` exposes
  `generatedGraphArtifactAcceptanceChecklistFact()`; `tests/fw-check.node.mjs` and
  `examples/commerce/src/source-truth.test.ts` assert that public checklist instead of duplicating
  the full generated graph artifact evidence projection, while the focused graph fixture tests keep
  projection coverage.
- Phase 5 static-export path-style closure slice:
  `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/static-export-document.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/vite-static-export-options.test.ts packages/server/src/api/app.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`. Evidence:
  `packages/server/src/static-export-types.ts` removes the stale `htmlPathStyle` public option and
  `StaticExportHtmlPathStyle` type; `packages/server/src/static-export-document.ts` emits only
  SPEC §9.5 directory-index route documents; `packages/server/src/static-export.ts` rejects
  runtime `htmlPathStyle` callers with FW229 before replay or writes; Vite export option tests
  prove the deleted option no longer crosses the Vite static-export boundary.
  Starter, commerce, and docs adoption remained green with their focused app-shell export tests.
  Exact follow-up gates:
  `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs the generated starter app-shell request and export proof|serves the generated starter app-shell through|runs .* with the built stylesheet href|formats generated export task diagnostics"`;
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "documents the commerce app-shell|public commerce shell static output|vp run export|npm run static"`;
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs`;
  `pnpm exec vp check packages/server/src/api/app-shell/static-export.ts packages/server/src/static-export-document.test.ts packages/server/src/static-export-document.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export-replay.ts packages/server/src/static-export-types.ts packages/server/src/static-export.test.ts packages/server/src/static-export.ts packages/server/src/vite-static-export-options.test.ts plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- Phase 5 static-export replay-context slice:
  `pnpm exec vitest --run packages/server/src/static-export-request.test.ts packages/server/src/static-export-document.test.ts packages/server/src/static-export-document-client-modules.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`. Evidence:
  `packages/server/src/static-export-replay-context.ts` creates the closed-app SPEC §9.5 replay
  context, and route-document/client-module replay now consumes that context rather than separate
  handler/origin pairs.
- Phase 5 Vite plugin app-only boundary slice:
  `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/vite.test.ts packages/server/src/vite-dev.test.ts packages/server/src/vite-plugin-build.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`. Evidence: `packages/server/src/vite-plugin.ts`
  deletes the raw `RequestHandler` input alias from `jisoAppShellVitePlugin()`, and
  `packages/server/src/api/app-shell/vite.ts` stops re-exporting the stale type.
- P8 fw-explain fixture assertion slice:
  `pnpm exec vitest --run packages/test/src/fw-explain-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P8 component explain includes handler, derive, trigger, and merge facts" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/fw-explain-fixtures.ts packages/test/src/fw-explain-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- P5 keyed morph runtime fixture slice:
  `pnpm exec vitest --run packages/test/src/runtime-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P5 morph evidence preserves keyed identity and applies fragments" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/runtime-fixtures.ts packages/test/src/runtime-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- P10 normative-docs fixture slice:
  `pnpm exec vitest --run packages/test/src/markdown-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P10 normative docs cover the constitution and compiler hard rules" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/markdown-fixtures.ts packages/test/src/markdown-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- P10 v1 acceptance ledger fixture slice:
  `pnpm exec vitest --run packages/test/src/markdown-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P10 v1 acceptance ledger tracks every freeze criterion" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/markdown-fixtures.ts packages/test/src/markdown-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs`;
  `git diff --check`.
- P10 legibility/prelaunch markdown fixture slice:
  `pnpm exec vitest --run packages/test/src/markdown-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P10 legibility study packet is ready but not claimed complete|pre-launch checklist is tracked explicitly" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/markdown-fixtures.ts packages/test/src/markdown-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- Phase 4 inline query batch apply slice:
  `pnpm exec vitest --run packages/runtime/src/query-events.test.ts packages/runtime/src/inline-loader-response-apply.test.ts packages/runtime/src/inline-loader-artifact-minifier.test.ts packages/runtime/src/inline-loader-build.test.ts`;
  `pnpm exec vitest --run packages/runtime/src`;
  `pnpm run check:inline-loader`;
  `git diff --check`.
- Phase 5 docs-site app-shell boundary slice:
  `pnpm exec vitest --run packages/server/src/api/app.test.ts site/scripts/app-shell.test.mjs`;
  `pnpm exec tsc --noEmit --pretty false`; exact `pnpm exec vp check packages/server/src/api/app-shell/core.ts packages/server/src/api/app.test.ts site/scripts/app-shell.mjs site/scripts/export-static.mjs site/scripts/app-shell.test.mjs plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`. Evidence: `@jiso/server/app-shell/core` now exposes `route()`/`respond` for
  SPEC §9.5 app construction, and `site/scripts/export-static.mjs` loads only focused app-shell SSR
  subpaths.
- P10 acceptance command-fixture slice:
  `pnpm exec vitest --run packages/test/src/command-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "framework-owned browser suite is wired into acceptance" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/command-fixtures.ts packages/test/src/command-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
  Targeted `node --test --test-name-pattern "P10 perf acceptance is wired through Playwright and CDP" tests/fw-check.node.mjs`
  is blocked before fixture assertions by outside-ownership server export state:
  `TypeError: createMemoryVersionedClientModuleRegistry is not a function` from
  `tests/p10-perf.node.mjs`.
- P10 browser acceptance project fixture assembly slice:
  `pnpm exec vitest --run packages/test/src/command-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "framework-owned browser suite is wired into acceptance" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/command-fixtures.ts packages/test/src/command-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs`;
  `git diff --check`.
- Enhanced mutation runtime fixture slice:
  `pnpm exec vitest --run packages/test/src/runtime-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P9 verification layer evidence remains represented" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/runtime-fixtures.ts packages/test/src/runtime-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- Verification-layer fixture slice:
  `pnpm exec vitest --run packages/test/src/verification-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P9 verification layer evidence remains represented" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/verification-fixtures.ts packages/test/src/verification-fixtures.test.ts packages/test/src/package-exports.test.ts packages/test/package.json tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- Generated view-transition stamp fixture slice:
  `pnpm exec vitest --run packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P2 compiler merges view transition stamps into existing styles" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- Static export main-marker fixture slice:
  `pnpm exec vitest --run packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "D10 seeded diagnostics gate Vite, static export, and MCP red-green surfaces" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/html-fragment.ts packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- `pnpm exec vitest --run packages/test/src/fw-check-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`
- `pnpm run check:build`
- `pnpm exec vitest --run packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `node --test --test-name-pattern "P1 minifier name preservation evidence remains represented|P1 typed data param coercion remains represented|P1 render-equivalence gate remains represented" tests/fw-check.node.mjs`
- `pnpm run check:build`
- targeted `node --test --test-name-pattern ... tests/fw-check.node.mjs`
- exact `pnpm exec vp check ... tests/fw-check.node.mjs examples/commerce/src/source-truth.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run examples/commerce/src/app.test.ts examples/commerce/src/source-truth.test.ts`
- targeted `node --test --test-name-pattern "P10 commerce graph assertions answer behavior mechanically|P10 commerce invalidation is expressed through graph facts|P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`
- exact `pnpm exec vp check packages/test/src/html-fragment.ts packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/app.test.ts examples/commerce/src/source-truth.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src/command-fixtures.test.ts packages/test/src/diagnostic-output-fixtures.test.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm run check:build`
- `node --test --test-name-pattern "S1 production build proves the compiler 1:1 emit contract|Conformance suites are an explicit gate" tests/fw-check.node.mjs`
- exact `pnpm exec vp check tests/fw-check.node.mjs packages/test/src/command-fixtures.ts packages/test/src/command-fixtures.test.ts packages/test/src/diagnostic-output-fixtures.ts packages/test/src/diagnostic-output-fixtures.test.ts packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run examples/commerce/src/app.test.ts examples/commerce/src/source-truth.test.ts`
- `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts`
- `pnpm run check:build`
- `node --test --test-name-pattern "D3 deferred stream responses are consumed by the runtime" tests/fw-check.node.mjs`
- exact `pnpm exec vp check tests/fw-check.node.mjs packages/test/src/html-fragment.ts packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/app.test.ts examples/commerce/src/app-shell.test.ts examples/commerce/src/source-truth.test.ts plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src/markdown-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm run check:build`
- `node --test --test-name-pattern "P10 normative docs cover the constitution and compiler hard rules" tests/fw-check.node.mjs`
- `pnpm exec vitest --run packages/test/src/command-fixtures.test.ts packages/test/src/source-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm run check:build`
- `node --test --test-name-pattern "Conformance suites are an explicit gate" tests/fw-check.node.mjs`
- exact `pnpm exec vp check tests/fw-check.node.mjs packages/test/src/command-fixtures.ts packages/test/src/command-fixtures.test.ts packages/test/src/source-fixtures.ts packages/test/src/source-fixtures.test.ts packages/test/src/package-exports.test.ts plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src/source-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm run check:build`
- `node --test --test-name-pattern "P3 Drizzle query facts include select shapes and instance keys" tests/fw-check.node.mjs`
- exact `pnpm exec vp check packages/test/src/source-fixtures.ts packages/test/src/source-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src/fw-export-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm run check:build`
- `node --test --test-name-pattern "D10 seeded diagnostics gate Vite, static export, and MCP red-green surfaces" tests/fw-check.node.mjs`
- exact `pnpm exec vp check packages/test/src/fw-export-fixtures.ts packages/test/src/fw-export-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`
- `git diff --check`
- Diagnostic-output lowered event projection slice:
  `pnpm exec vitest --run packages/test/src/diagnostic-output-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm exec vp run build`;
  `node --test --test-name-pattern "D10 seeded diagnostics gate Vite, static export, and MCP red-green surfaces" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check tests/fw-check.node.mjs packages/test/src/diagnostic-output-fixtures.ts packages/test/src/diagnostic-output-fixtures.test.ts packages/test/src/package-exports.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- Compiler fixture diagnostic/update-coverage projection slice:
  `pnpm exec vitest --run packages/test/src/compiler-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  exact `pnpm exec vp check --fix tests/fw-check.node.mjs packages/test/src/compiler-fixtures.ts packages/test/src/compiler-fixtures.test.ts packages/test/src/package-exports.test.ts packages/test/package.json`;
  exact `pnpm exec vp check tests/fw-check.node.mjs packages/test/src/compiler-fixtures.ts packages/test/src/compiler-fixtures.test.ts packages/test/src/package-exports.test.ts packages/test/package.json plans/codebase-quality-round2.md`;
  `git diff --check`.
  Targeted `node --test --test-name-pattern "P1 compiler validates component-scoped IDREFs|P1 compiler validates static id uniqueness|P1 compiler validates HTML content-model parser stability|P1 compiler validates declared execution trigger names|P1 compiler validates residual fw-c and fw-deps stamps|P1 compiler emits FW311 update coverage facts|P1 compiler validates binding stamp expression drift|P1 compiler validates primitive composition attribute merges|P1 compiler validates fragment-target child hoisting failures|P3 typed routes validate navigation targets" tests/fw-check.node.mjs`
  originally exposed a server root export gap; Round247 fixed root `createApp`/`createRequestHandler`
  forwarding and reran the same pattern after `pnpm run check:build`.
- Generated artifact fixture projection slice:
  `pnpm exec vitest --run packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P2 compiler merges view transition stamps into existing styles|P3 typed routes validate navigation targets|S1 production build proves the compiler 1:1 emit contract|D10 seeded diagnostics gate Vite, static export, and MCP red-green surfaces|P1 minifier name preservation evidence remains represented|P1 typed data param coercion remains represented|P1 render-equivalence gate remains represented" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- Inline enhanced-form loader fixture projection slice:
  `pnpm exec vitest --run packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  `node --test --test-name-pattern "S2 loader budget and inline enhanced form behavior are acceptance evidence" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check --fix tests/fw-check.node.mjs packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts plans/codebase-quality-round2.md`;
  exact `pnpm exec vp check tests/fw-check.node.mjs packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- Runtime loader smoke fixture slice:
  `pnpm exec vitest --run packages/test/src/runtime-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  `node --test --test-name-pattern "P2 loader smoke evidence is asserted through runtime behavior" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/runtime-fixtures.ts packages/test/src/runtime-fixtures.test.ts packages/test/src/package-exports.test.ts packages/test/package.json tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- Vite harness fixture slice:
  `pnpm exec vitest --run packages/test/src/vite-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  `node --test --test-name-pattern "S1 production build proves the compiler 1:1 emit contract|D10 seeded diagnostics gate Vite, static export, and MCP red-green surfaces" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/vite-fixtures.ts packages/test/src/vite-fixtures.test.ts packages/test/src/package-exports.test.ts packages/test/package.json tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- Generated registry/query-shape harness fixture slice:
  `pnpm exec vitest --run packages/test/src/generated-module-fixtures.test.ts packages/test/src/compiler-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P2 compiler merges view transition stamps into existing styles|P3 typed routes validate navigation targets|P1 fragment targets emit typed registry facts|P5 data-bind paths are checked against generated query shape facts" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/compiler-fixtures.ts packages/test/src/compiler-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- Generated deferred-stream fixture slice:
  `pnpm exec vitest --run packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "D3 deferred stream responses are consumed by the runtime" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check --fix packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- Starter browser client fixture slice:
  `pnpm exec vitest --run packages/test/src/starter-template-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P10 starter wires graph assertions into CI" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/starter-template-fixtures.ts packages/test/src/starter-template-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- Generated CSS artifact projection slice:
  `pnpm exec vitest --run packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P10 normative docs cover the constitution and compiler hard rules" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- Committed commerce IR freshness fixture slice:
  `pnpm exec vitest --run packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm exec vitest --run examples/commerce/src/app.test.ts -t "compiles TSX-authored components to committed IR through the fixpoint gate"`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check --fix packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/app.test.ts plans/codebase-quality-round2.md`;
  exact `pnpm exec vp check packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/app.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- Source/touch-graph harness projection slice:
  `pnpm exec vitest --run packages/test/src/source-fixtures.test.ts packages/test/src/touch-graph-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P3 Drizzle query facts include select shapes and instance keys|P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`;
  `git diff --check`.
- Runtime pagehide optimism cleanup fixture slice:
  `pnpm exec vitest --run packages/test/src/runtime-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P6 navigation bfcache optimism cleanup acceptance is represented" tests/fw-check.node.mjs`.
- Generated graph artifact honesty fixture slice:
  `pnpm exec vitest --run packages/test/src/graph-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`;
  `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts examples/commerce/src/app.test.ts`;
  exact `pnpm exec vp check packages/test/src/graph-fixtures.ts packages/test/src/graph-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- Generated graph artifact honesty summary fixture slice:
  `pnpm exec vitest --run packages/test/src/graph-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`;
  `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts examples/commerce/src/app.test.ts`;
  exact `pnpm exec vp check packages/test/src/graph-fixtures.ts packages/test/src/graph-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- Generated graph artifact acceptance fixture slice:
  `pnpm exec vitest --run packages/test/src/graph-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/source-truth.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/graph-fixtures.ts packages/test/src/graph-fixtures.test.ts tests/fw-check.node.mjs examples/commerce/src/source-truth.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- Generated graph artifact acceptance evidence fixture slice:
  `pnpm exec vitest --run packages/test/src/graph-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/source-truth.test.ts`;
  `pnpm exec vp run build`;
  targeted `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/graph-fixtures.ts packages/test/src/graph-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/source-truth.test.ts tests/fw-check.node.mjs`;
  `git diff --check`.

## Phase 2 - Compiler IR

Current state: the compiler threads `ComponentPipelineState` and `SourceOffsetMap`s through ordered
lowerings. Platform, navigation, inline-derive, server-render, opening-tag, static `href()`,
static `<Link>`, and view-transition lowering use explicit patch helpers in several paths. Parsed
JSX spans now drive static `<Link>` tag/`href` patching and view-transition style insertion without
reconstructing child or opening-tag source. Server render host stamping emits parsed attribute
replacement/insertion patches for handlers, `fw-c`, `fw-deps`, and `fw-state`. Many validators now
consume parser/model facts instead of regex or source-string facts. Inline text binding and
data-bind drift validation now consume parser-provided sole JSX child facts instead of re-reading
trimmed child source. Self-closing opening-tag insertions now consume parser-provided slash spacing
facts instead of re-inspecting opening-tag source. Render-equivalence execution now uses an
executable module variant emitted from the same render facts as the public server module, without
reparsing the generated artifact.
JSX child-body offsets/source are now stored as parser model facts, and consumers read that model
field through the helper instead of recomputing child trimming at each validation/analysis site.
Handler element params now carry their parsed source expression through the lowering model, so
client emission no longer recovers it by slicing braces from the generated `data-p-*` value.
Template stamp placeholders now carry analyzed relative read paths, so client query-plan emission no
longer derives item reads by slicing `.field` binding strings while producing source.
Template stamp list facts now also carry their analyzed relative read path, so client query-plan
emission no longer derives list reads by splitting `query.path` strings.
JSX event attributes now carry normalized DOM event and execution-trigger names as parser facts, so
handler lowering, platform lowering, inline derive skipping, and event-trigger validation no longer
derive those names from raw attribute text.
Data-bind path classification is centralized into analysis/validator facts, so plan collection,
coverage, template placeholder extraction, and binding validation consume query/relative-read facts
instead of reparsing each binding at every use site.
Template stamp facts now carry structured read segments for list/item paths; client query-plan
emission consumes those analyzed segments for item reads instead of splitting encoded path strings.
Inline derive lowering now uses shared query-path helpers for query-root checks instead of local
string splitting.
Data-derive stamp analysis now uses the shared binding-path parser instead of local `split('.')`
handling.
Relative binding detection is centralized in query-shape helpers and reused by query update
analysis plus data-bind validation. Handler param lowering now consumes parser-provided terminal
property names for captured member expressions when emitting `data-p-*` names, without
rediscovering the final segment from expression text.
Zero-argument handler call arguments now carry parser-provided reference facts, and standalone
identifier params use those facts for `data-p-*` names without expression-text fallback parsing.
Handler call-argument extraction no longer fabricates params for unmodeled expression text:
standalone references are lowered through parser reference spans, property accesses through parser
access spans, and other call arguments remain diagnostic/client code instead of server-only params.
View-transition, platform, static `<Link>`, static `href()`, and inline-derive lowerings are now
collected from the original parsed model and applied as one model source-patch pass. The compiler
reparses only the combined lowered source needed for generated derive/data-bind model facts instead
of reparsing once before inline-derive and again afterward.
The now-unused ordered lowering sequence helper and tests were deleted after production compile
stopped using it, leaving explicit patch passes as the remaining compile-path abstraction.
The compiler pipeline no longer exports dead lowering/result option types left behind by the
sequence helper; only the active patch helpers keep annotated internal result shapes.
The compile pipeline now names the combined pre-derive patch state for what it is rather than
carrying the old navigation-only compatibility name.
Unused offset-map identity/prefix/composition helpers and the stale data-bind template-body
validator export were deleted after the single model-patch pass and analyzer-owned template stamp
facts made them dead.
The parser model no longer exposes raw `openingSource`/`childSource` JSX element fields now that
lowerers consume structured tag spans, slash-spacing, child-body, and expression-container facts.
The terminal server-render emit patch helper now exposes only patched source; offset maps remain
limited to model-changing passes and diagnostics instead of an unused emit-only compatibility
contract.
The terminal emit patch helper now returns the patched source string directly instead of a one-field
compatibility result wrapper.
Template stamp item placeholders now carry template-relative parser spans, so generated client
query-plan renderers assemble HTML from model-derived segments instead of emitting runtime
`html.replace(...)` source-string patching.
Template stamp facts no longer carry the duplicate `itemBindings` compatibility list; validation,
shared test fixtures, and fw-check projections consume the structured placeholder paths directly.
Client handler arrow-body lowering no longer returns a one-field compatibility wrapper; the emitter
now applies parser-derived handler source replacements directly.

- [ ] Remove remaining compatibility fallback reparses where parser facts are sufficient.
- [ ] Audit production `createSourceFile`, `getText`, `indexOf`, `slice`, and regex usage; keep
      parser/scanner internals and diagnostics, retire source-string lowerers/validators.
- [ ] Keep Phase 2 open until source-returning lowering is gone from the compile path or each
      remaining case is explicitly justified.

Latest evidence:

- Template stamp render-segment lowering: `pnpm exec vitest --run
packages/compiler/src/query-update-plans.test.ts packages/compiler/src/query-coverage.test.ts
packages/compiler/src/query-bindings.test.ts`; `pnpm exec tsc --noEmit --pretty false`; exact
  `pnpm exec vp check packages/compiler/src/types.ts packages/compiler/src/analyze/query-updates.ts
packages/compiler/src/emit/client.ts packages/compiler/src/query-update-plans.test.ts
packages/compiler/src/query-coverage.test.ts`; `git diff --check`.
- Template stamp duplicate-field deletion: `pnpm exec vitest --run
packages/compiler/src/query-update-plans.test.ts packages/compiler/src/query-coverage.test.ts
packages/compiler/src/query-bindings.test.ts`; `pnpm exec vitest --run
packages/test/src/compiler-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  targeted `node --test --test-name-pattern "P5 data-bind paths are checked against generated query
shape facts|P1 fragment targets emit typed registry facts" tests/fw-check.node.mjs`;
  `pnpm exec tsc --noEmit --pretty false`.
- Client handler lowering wrapper deletion: `pnpm exec vitest --run
packages/compiler/src/handler-lowering.test.ts packages/compiler/src/compile-component.test.ts`;
  exact `pnpm exec vp check packages/compiler/src/emit/client.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- Combined model-patch reparse reduction: `pnpm exec vitest --run
packages/compiler/src/model-pipeline.test.ts packages/compiler/src/navigation-lowering.test.ts
packages/compiler/src/platform-lowering.test.ts packages/compiler/src/view-transitions.test.ts
packages/compiler/src/query-coverage.test.ts packages/compiler/src/query-update-plans.test.ts`;
  `pnpm exec vitest --run packages/compiler/src`; `pnpm exec tsc --noEmit --pretty false`.
- Dead compiler helper cleanup: `pnpm exec vitest --run packages/compiler/src/shared.test.ts
packages/compiler/src/query-coverage.test.ts packages/compiler/src/query-update-plans.test.ts
packages/compiler/src/id-content-model.test.ts`; `pnpm exec tsc --noEmit --pretty false`;
  exact `pnpm exec vp check packages/compiler/src/shared.ts
packages/compiler/src/validate/bindings.ts plans/codebase-quality-round2.md`; `git diff --check`.
- JSX model raw-source field deletion: `pnpm exec vitest --run
packages/compiler/src/scan/parse.test.ts packages/compiler/src/navigation-lowering.test.ts
packages/compiler/src/view-transitions.test.ts packages/compiler/src/stamps.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`; exact `pnpm exec vp check
packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts
plans/codebase-quality-round2.md`; `git diff --check`.
- Emit-only patch contract narrowing: `pnpm exec vitest --run
packages/compiler/src/model-pipeline.test.ts packages/compiler/src/compile-component.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`; exact `pnpm exec vp check
packages/compiler/src/model-pipeline.ts packages/compiler/src/model-pipeline.test.ts
plans/codebase-quality-round2.md`; `git diff --check`.
- Emit-only patch result wrapper deletion: `pnpm exec vitest --run
packages/compiler/src/model-pipeline.test.ts packages/compiler/src/compile-component.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`; exact `pnpm exec vp check
packages/compiler/src/model-pipeline.ts packages/compiler/src/model-pipeline.test.ts
packages/compiler/src/compile.ts plans/codebase-quality-round2.md`; `git diff --check`.
- Pre-derive lowering reparse reduction: `pnpm exec vitest --run
packages/compiler/src/view-transitions.test.ts packages/compiler/src/platform-lowering.test.ts
packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/compile-component.test.ts
packages/compiler/src/model-pipeline.test.ts`; `pnpm exec tsc --noEmit --pretty false`.
- Ordered lowering sequence helper deletion: `pnpm exec vitest --run
packages/compiler/src/model-pipeline.test.ts packages/compiler/src/compile-component.test.ts
packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/platform-lowering.test.ts
packages/compiler/src/view-transitions.test.ts`; `pnpm exec tsc --noEmit --pretty false`.
- Pipeline dead type cleanup: `pnpm exec vitest --run packages/compiler/src/model-pipeline.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`.
- Pre-derive state naming cleanup: `pnpm exec vitest --run
packages/compiler/src/compile-component.test.ts packages/compiler/src/navigation-lowering.test.ts
packages/compiler/src/platform-lowering.test.ts packages/compiler/src/view-transitions.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`.
- Handler call-argument reference facts: `pnpm exec vitest --run
packages/compiler/src/handler-lowering.test.ts packages/compiler/src/scan/parse.test.ts`; `pnpm exec
tsc --noEmit --pretty false`.
- Handler call-argument fallback removal: `pnpm exec vitest --run
packages/compiler/src/handler-lowering.test.ts packages/compiler/src/scan/parse.test.ts`; `pnpm exec
tsc --noEmit --pretty false`.
- Handler param expression-parser deletion: `pnpm exec vitest --run
packages/compiler/src/handler-lowering.test.ts packages/compiler/src/compile-component.test.ts
packages/compiler/src/scan/parse.test.ts`; `pnpm exec tsc --noEmit --pretty false`; exact
  `pnpm exec vp check packages/compiler/src/lower/handlers.ts packages/compiler/src/types.ts
packages/compiler/src/handler-lowering.test.ts`; `git diff --check`.
- Handler param terminal-name facts: `pnpm exec vitest --run
packages/compiler/src/handler-lowering.test.ts packages/compiler/src/scan/parse.test.ts
packages/compiler/src/compile-component.test.ts`; `pnpm exec tsc --noEmit --pretty false`; exact
  `pnpm exec vp check packages/compiler/src/scan/parse.ts
packages/compiler/src/scan/parse.test.ts packages/compiler/src/lower/handlers.ts
packages/compiler/src/types.ts packages/compiler/src/handler-lowering.test.ts
plans/codebase-quality-round2.md`; `git diff --check`.
- Render-equivalence executable module emission: `pnpm exec vitest --run
packages/compiler/src/compile-component.test.ts packages/compiler/src/model-pipeline.test.ts
packages/compiler/src/stamps.test.ts`; `pnpm exec tsc --noEmit --pretty false`; exact `pnpm exec
vp check packages/compiler/src/emit/server.ts packages/compiler/src/compile.ts
packages/compiler/src/compile-component.test.ts`; `git diff --check`.
- Structured template-stamp read segments: `pnpm exec vitest --run
packages/compiler/src/query-update-plans.test.ts packages/compiler/src/query-coverage.test.ts
packages/test/src/compiler-fixtures.test.ts packages/test/src/generated-module-fixtures.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`; `pnpm run check:build`; targeted `node --test
--test-name-pattern "D3 deferred stream responses are consumed by the runtime|P5 data-bind paths
are checked against generated query shape facts" tests/fw-check.node.mjs`; exact `pnpm exec vp
check packages/compiler/src/types.ts packages/compiler/src/analyze/query-updates.ts
  packages/compiler/src/emit/client.ts packages/compiler/src/query-update-plans.test.ts
  packages/compiler/src/query-coverage.test.ts packages/test/src/compiler-fixtures.ts
  packages/test/src/compiler-fixtures.test.ts tests/fw-check.node.mjs`; `git diff --check`.
- Inline derive query-path helper reuse: `pnpm exec vitest --run
packages/compiler/src/query-coverage.test.ts packages/compiler/src/query-update-plans.test.ts
packages/compiler/src/compile-component.test.ts packages/compiler/src/scan/parse.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`; exact `pnpm exec vp check
packages/compiler/src/lower/inline-derives.ts packages/compiler/src/query-coverage.test.ts
packages/compiler/src/query-update-plans.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- Data-derive parser helper reuse: `pnpm exec vitest --run
packages/compiler/src/query-update-plans.test.ts packages/compiler/src/query-coverage.test.ts
packages/compiler/src/compile-component.test.ts`; `pnpm exec tsc --noEmit --pretty false`;
  exact `pnpm exec vp check packages/compiler/src/analyze/query-updates.ts
packages/compiler/src/query-update-plans.test.ts packages/compiler/src/query-coverage.test.ts
plans/codebase-quality-round2.md`; `git diff --check`.
- Relative binding helper reuse: `pnpm exec vitest --run
packages/compiler/src/query-bindings.test.ts packages/compiler/src/query-update-plans.test.ts
packages/compiler/src/query-coverage.test.ts packages/compiler/src/compile-component.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`; exact `pnpm exec vp check
packages/compiler/src/analyze/query-shapes.ts packages/compiler/src/analyze/query-updates.ts
packages/compiler/src/validate/bindings.ts packages/compiler/src/query-bindings.test.ts
plans/codebase-quality-round2.md`; `git diff --check`.
- `pnpm exec vitest --run packages/compiler/src/shared.test.ts packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/view-transitions.test.ts`
- `pnpm exec vitest --run packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/compile-component.test.ts`
- `pnpm exec vitest --run packages/compiler/src/execution-triggers.test.ts packages/compiler/src/compile-component.test.ts`
- `pnpm exec vitest --run packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/compile-component.test.ts`
- exact `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/lower/navigation.ts packages/compiler/src/navigation-lowering.test.ts plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/model-pipeline.test.ts packages/compiler/src/compile-component.test.ts`
- exact `pnpm exec vp check packages/compiler/src/lower/navigation.ts packages/compiler/src/navigation-lowering.test.ts plans/codebase-quality-round2.md IMPLEMENT_v1.md`
- `pnpm exec vitest --run packages/compiler/src/stamps.test.ts packages/compiler/src/compile-component.test.ts packages/compiler/src/view-transitions.test.ts packages/compiler/src/navigation-lowering.test.ts`
- exact `pnpm exec vp check packages/compiler/src/emit/server.ts packages/compiler/src/stamps.test.ts plans/codebase-quality-round2.md IMPLEMENT_v1.md`
- `pnpm exec vitest --run packages/compiler/src/view-transitions.test.ts packages/compiler/src/compile-component.test.ts packages/compiler/src/model-pipeline.test.ts`
- exact `pnpm exec vp check packages/compiler/src/lower/view-transitions.ts packages/compiler/src/view-transitions.test.ts packages/compiler/src/shared.ts`
- `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/query-coverage.test.ts packages/compiler/src/stamps.test.ts`
- exact `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/lower/inline-derives.ts packages/compiler/src/validate/bindings.ts plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/stamps.test.ts packages/compiler/src/view-transitions.test.ts packages/compiler/src/compile-component.test.ts`
- exact `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/lower/view-transitions.ts packages/compiler/src/emit/server.ts plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/compiler/src/compile-component.test.ts`
- exact `pnpm exec vp check packages/compiler/src/emit/server.ts packages/compiler/src/compile-component.test.ts plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/query-coverage.test.ts packages/compiler/src/query-bindings.test.ts packages/compiler/src/query-update-plans.test.ts packages/compiler/src/fragment-targets.test.ts`
- exact `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/compiler/src/handler-lowering.test.ts packages/compiler/src/compile-component.test.ts`
- exact `pnpm exec vp check packages/compiler/src/types.ts packages/compiler/src/lower/handlers.ts packages/compiler/src/emit/client.ts packages/compiler/src/handler-lowering.test.ts plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/compiler/src/query-coverage.test.ts packages/compiler/src/query-update-plans.test.ts`
- exact `pnpm exec vp check packages/compiler/src/types.ts packages/compiler/src/analyze/query-updates.ts packages/compiler/src/emit/client.ts packages/compiler/src/query-coverage.test.ts packages/compiler/src/query-update-plans.test.ts plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/compiler/src/query-update-plans.test.ts`
- exact `pnpm exec vp check packages/compiler/src/types.ts packages/compiler/src/analyze/query-updates.ts packages/compiler/src/emit/client.ts packages/compiler/src/query-update-plans.test.ts plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/handler-lowering.test.ts packages/compiler/src/execution-triggers.test.ts packages/compiler/src/compile-component.test.ts`
- exact `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/lower/handlers.ts packages/compiler/src/validate/event-triggers.ts plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/compiler/src/platform-lowering.test.ts packages/compiler/src/handler-lowering.test.ts packages/compiler/src/compile-component.test.ts`
- exact `pnpm exec vp check packages/compiler/src/lower/platform.ts plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/compiler/src/query-coverage.test.ts packages/compiler/src/handler-lowering.test.ts packages/compiler/src/compile-component.test.ts`
- exact `pnpm exec vp check packages/compiler/src/lower/inline-derives.ts packages/compiler/src/query-coverage.test.ts plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/compiler/src/query-update-plans.test.ts packages/compiler/src/query-coverage.test.ts packages/compiler/src/query-bindings.test.ts packages/compiler/src/compile-component.test.ts`
- exact `pnpm exec vp check packages/compiler/src/analyze/query-updates.ts packages/compiler/src/query-update-plans.test.ts packages/compiler/src/query-coverage.test.ts plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/compiler/src/query-bindings.test.ts packages/compiler/src/query-update-plans.test.ts packages/compiler/src/query-coverage.test.ts packages/compiler/src/compile-component.test.ts`
- exact `pnpm exec vp check packages/compiler/src/validate/bindings.ts packages/compiler/src/query-bindings.test.ts plans/codebase-quality-round2.md`
- `git diff --check`

## Phase 3 - Drizzle Extraction

Current state: direct Drizzle/project extraction is backed by ts-morph where proven. A broad set of
indirect receiver, carrier, destructuring, nested destructuring, detached method, helper handoff, and
quoted property surfaces now degrade to FW406 instead of fabricating exact facts. Project tuple
receiver aliases now use ts-morph tuple/array element type facts for exact Postgres receiver proof,
while source-mode array receiver carriers degrade destructured and assigned aliases to FW406.
Project destructured variable declarations now use ts-morph object-property and tuple element type
facts for exact Postgres receiver proof while fake sibling members remain ignored.
Shorthand query loaders now resolve through ts-morph symbols instead of disappearing. Dynamic or
otherwise unresolved query-loader and domain-write callback references now degrade to FW406 instead
of dropping the executable surface. V1 proof remains Postgres-only; SQLite/MySQL conformance is
deferred to late hardening. Tuple-destructured callback containers now resolve through static
literal aliases and binding-element facts for project query loaders and domain writes. Static
computed callback/action keys resolve only on executable Drizzle surfaces; unresolved computed
loader/action keys remain visible as FW406. Project Postgres receiver proof now uses ts-morph
type/symbol names plus exact unresolved type-reference parsing instead of broad printed type-text
membership, so similarly named fake types such as `PgDatabaseLike` stay invisible while real
`PgDatabase` carriers and destructured helper parameters remain exact. Query projection extraction
now uses the same parsed wrapper unwrapping as the rest of static extraction, so wrapped column and
typed `sql<T>` expressions are resolved from source/project facts instead of degrading behind
duplicate parenthesis-only projection logic.

- [ ] Delete remaining bespoke lexer/compat extraction paths where ts-morph facts can replace them.
- [ ] Cover or degrade remaining invisible source/project query-loader and mutation surfaces.
      Evidence: `packages/drizzle/src/static.ts` resolves `query(..., { load })` through
      referenced function symbols; `packages/drizzle/src/index.test.ts` covers source shorthand,
      typed project shorthand, and untyped project shorthand; `conformance/drizzle-pin/src/index.test.ts`
      pins real `drizzle-orm` typed shorthand loaders.
      Evidence 2026-06-13: `packages/drizzle/src/static.ts` now resolves local referenced
      `write(..., handler)` domain callbacks through ts-morph symbols; `packages/drizzle/src/index.test.ts`
      covers source referenced write callbacks, typed project callbacks, and untyped project
      non-fabrication; `conformance/drizzle-pin/src/index.test.ts` pins real `drizzle-orm`
      referenced domain write callbacks.
      Evidence 2026-06-13: `packages/drizzle/src/static.ts` resolves static member-referenced
      callbacks such as `load: loaders.product` and `write(callbacks.addItem)` through parsed
      callback declarations; `packages/drizzle/src/index.test.ts` covers project query loaders plus
      source/project domain write callbacks; `conformance/drizzle-pin/src/index.test.ts` pins the
      same surfaces against real `drizzle-orm` Postgres receiver types.
      Evidence 2026-06-13 round287: `packages/drizzle/src/static.ts` now falls back from local
      literal-container walking to ts-morph `symbolForStaticTypePath()` member facts for static
      callback/config containers and accepts `PropertyDeclaration` initializers in query body,
      callback, literal-container, and domain action resolution. `packages/drizzle/src/index.test.ts`
      and `conformance/drizzle-pin/src/index.test.ts` pin `ProductLoaders.options` and
      `ProductActions.actions` under Postgres `PgDatabase` receivers. Verified by
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "static property declarations"`
      and
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "static property callback containers"`.
      Evidence 2026-06-13: `packages/drizzle/src/static.ts` now treats project member receiver
      expressions such as `carrier.db` as exact only when ts-morph proves their Postgres Drizzle
      database type, removing the carrier-member FW406 fallback for proven reads/writes while
      retaining FW406 for raw SQL, relational query APIs without static projection, helper handoff,
      detached methods, and overwritten fake members; package and real `drizzle-orm` tests pin the
      split.
      Evidence 2026-06-13: `packages/drizzle/src/static.ts` deleted the project relational query
      resolver that scanned every identifier text and now builds `db.query.<table>` proof from
      table declaration/import/namespace-export symbols; `packages/drizzle/src/index.test.ts` pins
      namespace-imported relational query tables, and `conformance/drizzle-pin/src/index.test.ts`
      pins real `drizzle-orm` relational query facts despite loader-local shadows.
      Evidence 2026-06-13: `packages/drizzle/src/static.ts` removed project carrier-member
      fallback diagnostics built from source-mode property paths; project unresolved/helper and
      detached-method surfaces now rely on ts-morph-proven Drizzle member expressions such as
      `carrier.db`, while fake sibling members remain ignored. `packages/drizzle/src/index.test.ts`
      and `conformance/drizzle-pin/src/index.test.ts` pin helper-container FW406 degradation for
      typed member handoff against package and real `drizzle-orm` Postgres receivers.
      Evidence 2026-06-13: `packages/drizzle/src/static.ts` now detects project-mode typed
      containers whose ts-morph type contains a Postgres Drizzle database member and degrades
      helper handoffs such as `audit({ context })`/`runReport({ context })` to FW406 instead of
      dropping them; `packages/drizzle/src/index.test.ts` and
      `conformance/drizzle-pin/src/index.test.ts` pin query-loader and mutation/domain helper
      handoffs while fake context containers remain ignored. Verified by
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Evidence 2026-06-13: `packages/drizzle/src/static.ts` now resolves object-member callback
      aliases and shorthand members such as `load: loaders.aliased`, `load: loaders.loadProducts`,
      `write(callbacks.aliased)`, and `write(callbacks.addItem)` through ts-morph callback
      symbols with cycle protection; `packages/drizzle/src/index.test.ts` covers source query
      loaders and source domain writes, and `conformance/drizzle-pin/src/index.test.ts` pins the
      same surfaces against real `drizzle-orm` Postgres receiver types. Verified by
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Evidence 2026-06-13 round290: `packages/drizzle/src/static.ts` now resolves whole
      conditional project query option objects when one branch is a statically visible loader
      config, while retaining FW406 for opaque sibling branches per SPEC §10.2/§11.1;
      `packages/drizzle/src/index.test.ts` covers the package fixture and
      `conformance/drizzle-pin/src/index.test.ts` pins the same surface against real
      `drizzle-orm` Postgres receiver types. Verified by
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts -t "conditional (query-loader )?option objects|conditional options"` and
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts`.
      Evidence 2026-06-13: static element-access callback references such as
      `load: loaders["loadProducts"]` and `write(callbacks["addItem"])` are covered as real
      executable callback surfaces instead of invisible aliases; `packages/drizzle/src/index.test.ts`
      pins source query-loader and domain write extraction, and
      `conformance/drizzle-pin/src/index.test.ts` pins the same aliases against real
      `drizzle-orm` Postgres receivers. Verified by
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Evidence 2026-06-13: `packages/drizzle/src/static.ts` deleted the local callback-container
      by-name compatibility lookup and now resolves executable callback containers through
      ts-morph symbols while following exact local object aliases and spreads with override/cycle
      protection; `packages/drizzle/src/index.test.ts` pins source/project query-loader and domain
      write callbacks through object aliases/spreads plus non-fabricating overrides, and
      `conformance/drizzle-pin/src/index.test.ts` pins the same project surfaces against real
      `drizzle-orm` Postgres receiver types. Verified by
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Evidence 2026-06-13 round292: `packages/drizzle/src/static.ts` now treats project
      string-indexed query config and domain action spreads as opaque executable surfaces, so
      `Record<string, ...>`/index-signature bags degrade to FW406 instead of being accepted as
      empty static objects per SPEC §10.2/§11.1. `packages/drizzle/src/index.test.ts` and
      `conformance/drizzle-pin/src/index.test.ts` pin the package and real `drizzle-orm`
      query-loader/domain-action behavior. Verified by
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts -t "string-indexed"` and
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts`.
      Evidence 2026-06-13 round245: `packages/drizzle/src/static.ts` removed the remaining
      local object callback-container walker from query-loader and domain-write callback
      resolution; `symbolForCallbackReference` is now the only member-reference path for these
      surfaces, using ts-morph member symbols per SPEC §10.2/§11.1. Existing
      `packages/drizzle/src/index.test.ts` object alias/spread coverage stayed green, and
      `conformance/drizzle-pin/src/index.test.ts` now pins nested alias/spread query-loader and
      domain-write containers against real `drizzle-orm` Postgres receiver types. Verified by
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts` and
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`.
      Evidence 2026-06-13: `packages/drizzle/src/static.ts` now follows nested static callback
      container members through local object aliases and spreads with override/cycle protection,
      so `load: spread["nested"]["loadProducts"]` and `write(spread["nested"]["addItem"])`
      resolve to executable callback bodies while overridden nested fake callbacks remain
      non-facts; `packages/drizzle/src/index.test.ts` covers source/project query-loader and
      domain write callbacks, and `conformance/drizzle-pin/src/index.test.ts` pins the same
      project surfaces against real `drizzle-orm` Postgres receiver types. Verified by
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Evidence 2026-06-13: project imported callback references now follow ts-morph alias symbols
      for query loaders and domain writes, including imported callback containers such as
      `loaders.loadProducts`; project-mode synthetic table facts are available across source-file
      summaries so imported callback read/write bodies resolve to Postgres v1 table domains
      without source-name fallback. `packages/drizzle/src/index.test.ts` covers imported project
      query-loader and write callbacks, and `conformance/drizzle-pin/src/index.test.ts` pins the
      same surfaces against real `drizzle-orm` Postgres receiver types. Verified by
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Evidence 2026-06-13 round253: unresolved dynamic callback references such as
      `load: loaders[loaderName]` and `write(callbacks[actionName])` now remain visible as FW406
      instead of being dropped from query facts or domain write touch graphs; package and real
      `drizzle-orm` conformance tests pin the source/project behavior. Verified by
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Evidence 2026-06-13 round295: `packages/drizzle/src/static.ts` resolves
      non-argument-shifting bound callback references such as `loadProducts.bind(undefined)` and
      `write(addItem.bind(null))` through the existing ts-morph callback declaration path, while
      pre-bound positional arguments stay visible as FW406 per SPEC §10.2/§11.1.
      `packages/drizzle/src/index.test.ts` and `conformance/drizzle-pin/src/index.test.ts` pin
      exact project query-loader/domain-write extraction plus pre-bound degradation against real
      `drizzle-orm` Postgres receiver types.
      Evidence 2026-06-13: static callback references such as
      `LoaderBarrel.loaders["loadProducts"]` and `CallbackBarrel.callbacks["addItem"]` now resolve
      through ts-morph receiver type member symbols before falling back to local object walking, so
      namespace-imported query-loader and domain-write callback containers survive re-export
      barrels without source-name compatibility lookup. `packages/drizzle/src/index.test.ts` covers
      the package project surfaces, and `conformance/drizzle-pin/src/index.test.ts` pins the same
      paths against real `drizzle-orm` Postgres receiver types. Verified by
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin`,
      `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts
conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`, and
      `git diff --check`.
      Evidence 2026-06-13: local helper summary propagation now resolves static member helper
      calls such as `helpers.loadProducts(db)` and `helpers.touchProduct(db)` through ts-morph
      callback symbols, so query loaders and mutations fold proven local helper reads/touches
      instead of also degrading them as external opaque calls. `packages/drizzle/src/index.test.ts`
      covers project query-loader and mutation member helpers with fake siblings ignored, and
      `conformance/drizzle-pin/src/index.test.ts` pins the same surface against real
      `drizzle-orm` Postgres receiver types. Verified by
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin`,
      `pnpm exec vp check --fix packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts
conformance/drizzle-pin/src/index.test.ts`, exact
      `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts
conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`, and
      `git diff --check`.
      Evidence 2026-06-13 round254: query option spreads such as
      `query('product', { ...spreadConfig })` now resolve a statically proven `load` callback
      through ts-morph member facts, while later unknown/`any` config spreads that could obscure
      the loader degrade to FW406 instead of dropping the query-loader surface.
      `packages/drizzle/src/index.test.ts` covers source and project config-spread loaders plus
      obscuring spreads; `conformance/drizzle-pin/src/index.test.ts` pins the same behavior against
      real `drizzle-orm` Postgres receiver types. Verified by
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Evidence 2026-06-13 round256: domain action spreads such as
      `domain({ ...actionConfig })` now resolve statically proven `write(...)` callbacks through
      ts-morph property declarations, preserve later spread/direct override semantics, and keep
      unresolved callback entries inside known spreads visible as FW406 instead of dropping the
      mutation surface. `packages/drizzle/src/index.test.ts` covers source/project spread actions,
      overrides, and unresolved callbacks; `conformance/drizzle-pin/src/index.test.ts` pins the
      same behavior against real `drizzle-orm` Postgres receiver types. Verified by
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Evidence 2026-06-13: detached Drizzle receiver method aliases now resolve only by
      ts-morph symbol keys; `packages/drizzle/src/static.ts` deleted the receiver-method alias
      source-name map/fallback, while `packages/drizzle/src/index.test.ts` and
      `conformance/drizzle-pin/src/index.test.ts` pin same-name shadowed query-loader aliases
      against package and real `drizzle-orm` Postgres receiver types. Verified by
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Evidence 2026-06-13 round250: inline object-literal helper members are summary-only
      ts-morph callback facts for local helper propagation, so project query loaders and domain
      writes fold exact read/touch summaries through `helpers.load(db)`/`helpers.touch(db)` without
      emitting helper members as public graph entries; `packages/drizzle/src/index.test.ts` and
      `conformance/drizzle-pin/src/index.test.ts` pin the package and real `drizzle-orm`
      Postgres receiver surfaces. Verified by `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Evidence 2026-06-13 round251: destructured static callback and local-helper container
      members now resolve through ts-morph binding-element/member symbols, so
      `write(addFromContainer)`, `load: loadFromContainer`, and `loadFromHelper(db)`/`touchFromHelper(db)`
      fold exact Postgres read/touch summaries instead of disappearing or degrading as opaque helper
      handoffs. `packages/drizzle/src/index.test.ts` and
      `conformance/drizzle-pin/src/index.test.ts` pin package and real `drizzle-orm` surfaces.
      Evidence 2026-06-13 round258: opaque domain action spreads such as
      `domain({ ...dynamicActions })` now remain visible as
      `domainName.<spread>` FW406 mutation graph entries instead of disappearing when ts-morph
      reports the spread expression as `any`/`unknown`; static spreads still resolve to exact
      `write(...)` callbacks. `packages/drizzle/src/index.test.ts` pins source behavior and
      `conformance/drizzle-pin/src/index.test.ts` pins the same surface against real `drizzle-orm`
      Postgres receiver types.
      Evidence 2026-06-13 round259: external query options such as `query(name, configAlias)` now
      resolve static object aliases through ts-morph symbols, while unresolved external configs
      such as `query(name, dynamicConfig)` degrade to FW406 instead of disappearing.
      `packages/drizzle/src/index.test.ts` covers source/project behavior and
      `conformance/drizzle-pin/src/index.test.ts` pins the project surface against real
      `drizzle-orm` Postgres receiver types. Verified by
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Evidence 2026-06-13 round294: wrapped variable-assigned local helpers such as
      `const read = ((db) => ...) satisfies unknown` and `const touch = (async (...) => ...) as
      unknown` are now registered in source/project function inventories after static TS wrapper
      unwrapping, so query loaders and domain action callbacks that call them retain exact
      read/touch facts. `packages/drizzle/src/index.test.ts` covers the package fixture, and
      `conformance/drizzle-pin/src/index.test.ts` pins the same path against real `drizzle-orm`
      Postgres receiver types. Verified by
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm --filter @jiso/conformance-drizzle-pin test`,
      `pnpm exec tsc --noEmit`, exact
      `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Evidence 2026-06-13 round260: external domain action objects such as
      `domain(actionsAlias)` now resolve static object aliases through ts-morph symbols for source
      and project mutation extraction, while opaque action aliases such as
      `domain(dynamicActions)` degrade to `domainName.<spread>` FW406 entries instead of
      disappearing. `packages/drizzle/src/index.test.ts` covers source/project behavior and
      `conformance/drizzle-pin/src/index.test.ts` pins the project surface against real
      `drizzle-orm` Postgres receiver types.
      Evidence 2026-06-13 round283 worker B: typed non-literal factory calls such as
      `query(name, makeQueryOptions())` and `domain(makeActions())` now remain visible as FW406
      instead of disappearing when ts-morph cannot resolve the loader/action object to a static
      declaration. `packages/drizzle/src/static.ts` keeps unresolved option/action objects as
      diagnostics, while `packages/drizzle/src/index.test.ts` and
      `conformance/drizzle-pin/src/index.test.ts` pin package and real `drizzle-orm` Postgres
      surfaces. Verified by
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`, exact
      `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Evidence 2026-06-13 round262: source-mode indirect query loaders such as
      `query(name, configAlias)`, `query(name, { load })`, `load: loaders.member`, static
      element-access members, and object/nested spread callback containers now degrade to FW406
      instead of deriving reads from untyped loader receiver names. Project mode keeps the same
      surfaces as exact ts-morph symbol/type facts, including real `drizzle-orm` Postgres
      conformance pins. Verified by
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`, exact
      `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Evidence 2026-06-13 round263: source-mode member receiver surfaces such as
      `context.db.select()`, `context.tx.execute()`, and helper handoffs like
      `runReport(context.db)` now degrade to FW406 instead of deriving project member facts or
      disappearing. Project-mode member receivers remain gated by ts-morph Drizzle type proof.
      `packages/drizzle/src/index.test.ts` covers query-loader and mutation/function member
      surfaces, and `conformance/drizzle-pin/src/index.test.ts` pins source-mode behavior with
      real `drizzle-orm` imports.
      Evidence 2026-06-13 round264: typed domain action spreads whose members cannot be proven as
      `write(...)` callbacks now remain visible as named FW406 mutation graph entries instead of
      disappearing behind spread syntax. `packages/drizzle/src/index.test.ts` covers source and
      project typed spread members, and `conformance/drizzle-pin/src/index.test.ts` pins the
      project surface against real `drizzle-orm` Postgres receiver types. Verified by
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm --filter @jiso/conformance-drizzle-pin test`,
      exact `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Evidence 2026-06-13 round265: namespace-spread domain actions whose exported members are
      `const action = write(callback)` now resolve through ts-morph variable declarations instead
      of being left to action-spread compatibility gaps; opaque namespace remainders still degrade
      to `domainName.<spread>` FW406. `packages/drizzle/src/index.test.ts` covers the project
      namespace spread, and `conformance/drizzle-pin/src/index.test.ts` pins the same surface
      against real `drizzle-orm` Postgres receiver types. Verified by
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm --filter @jiso/conformance-drizzle-pin test`, exact
      `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Evidence 2026-06-13 round269: wrapped static-expression surfaces such as
      `(query(...) satisfies unknown)`, `(domain(...) as unknown)`, and wrapped `write(...)`
      action initializers now remain visible to project/source extraction; opaque wrapped domain
      aliases degrade to FW406 instead of disappearing. `packages/drizzle/src/index.test.ts` and
      `conformance/drizzle-pin/src/index.test.ts` pin exact query/domain extraction plus FW406
      degradation under package and real `drizzle-orm` Postgres receivers. Verified by
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm --filter @jiso/conformance-drizzle-pin test`.
      Evidence 2026-06-13 round271: project-mode variable declarations such as
      `const { db: writer, nested: { tx } } = context` and
      `const [reader] = context.tuple` now promote Drizzle receiver aliases only when ts-morph
      proves the destructured property/element type is a Postgres Drizzle database receiver.
      `packages/drizzle/src/index.test.ts` pins exact read/write extraction plus ignored fake
      sibling members, and `conformance/drizzle-pin/src/index.test.ts` pins the same behavior
      against real `drizzle-orm` Postgres receiver imports. Verified by
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`, exact
      `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Evidence 2026-06-13 round272: conditional config/action spreads now preserve static
      ts-morph callback facts while keeping opaque branches visible as FW406: project
      `query(..., { ...(flag ? dynamicConfig : staticConfig) })` folds the proven loader read and
      warns on the dynamic branch, while `domain({ ...(flag ? dynamicActions : staticActions) })`
      extracts proven `write(...)` touches and emits `domainName.<spread>` for the opaque branch.
      `packages/drizzle/src/index.test.ts` covers package query-loader and source mutation
      behavior, and `conformance/drizzle-pin/src/index.test.ts` pins the same surfaces against real
      `drizzle-orm` Postgres receiver types. Verified by
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts` and
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`.
      Evidence 2026-06-13 round273: tuple-destructured static callback containers such as
      `const [add] = callbacks` and `const [{ load }] = loaders` now resolve through static
      literal aliases/binding-element facts instead of degrading mutation actions or dropping
      query-loader facts; `packages/drizzle/src/index.test.ts` and
      `conformance/drizzle-pin/src/index.test.ts` pin package and real `drizzle-orm` Postgres
      receiver behavior. Verified by
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts`
      and `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`; exact
      `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts
conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`; and
      `git diff --check`.
      Evidence 2026-06-13 round276: project-mode object-contained tuple assignment aliases such
      as `({ wrappers: { receivers: [db] } } = context)` now recurse through ts-morph property and
      tuple element types, extracting exact query-loader reads and mutation touches only when the
      element type is a pinned Postgres Drizzle receiver. `packages/drizzle/src/index.test.ts` and
      `conformance/drizzle-pin/src/index.test.ts` pin the package and real `drizzle-orm` surfaces.
      Evidence 2026-06-13 round274: project-mode opaque helper handoffs now treat factory-returned
      typed carrier expressions as ts-morph receiver-container facts, so `writeAudit(makeContext())`
      and `runReport(makeContext())` degrade to FW406 when the returned type contains a pinned
      Postgres Drizzle database instead of disappearing. Object/array literal wrappers still report
      the contained receiver for stable diagnostics. `packages/drizzle/src/index.test.ts` covers the
      package mutation graph surface, and `conformance/drizzle-pin/src/index.test.ts` pins the query
      loader surface against real `drizzle-orm` Postgres receiver imports.
      Evidence 2026-06-13 round277: direct domain action members now resolve static `write(...)`
      action aliases through ts-morph symbols and keep opaque direct members, method members, and
      action-bag members visible as named FW406 mutation graph entries instead of disappearing.
      `packages/drizzle/src/index.test.ts` covers source/project exact aliases plus direct
      degradation, and `conformance/drizzle-pin/src/index.test.ts` pins the same surface against
      real `drizzle-orm` Postgres receiver imports.
      Evidence 2026-06-13 round278: direct conditional query-loader and domain-action members
      such as `load: flag ? dynamicLoad : loadProducts` and
      `add: flag ? dynamicAction : write(addItem)` now preserve proven ts-morph callback facts
      while keeping the opaque branch visible as FW406. `packages/drizzle/src/index.test.ts` and
      `conformance/drizzle-pin/src/index.test.ts` pin package and real `drizzle-orm` Postgres
      receiver behavior.
      Evidence 2026-06-13 round279: tuple-indexed static containers such as
      `query(name, queryConfigs[0])`, `domain(actionConfigs[0])`,
      `load: callbackTuples[1][0].loadProducts`, and `write(callbackTuples[0][0])` now resolve
      through static literal/project facts instead of degrading to FW406. `packages/drizzle/src/index.test.ts`
      and `conformance/drizzle-pin/src/index.test.ts` pin package and real `drizzle-orm` Postgres
      receiver behavior.
      Evidence 2026-06-13 round282: executable computed property names such as
      `{ [loadKey](...) {} }`, `{ [addKey]: write(addItem) }`, and `{ [keyBag.restock]: ... }`
      now resolve through static literal facts for query-loader and domain-action surfaces without
      making computed `output` schemas authoritative; unresolved computed loader/action keys degrade
      to FW406 as `Query load callback could not be statically resolved` and
      `domainName.<computed>`. `packages/drizzle/src/index.test.ts` and
      `conformance/drizzle-pin/src/index.test.ts` pin package and real `drizzle-orm` Postgres
      receiver behavior. Verified by
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm --filter @jiso/conformance-drizzle-pin test`, exact
      `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Evidence 2026-06-13 round284 worker B: `packages/drizzle/src/static.ts` replaced the broad
      Drizzle database type-text pattern with ts-morph symbol/name receiver proof and an anchored
      unresolved type-reference fallback, and now applies that proof to destructured project
      receiver parameters and local-helper carrier satisfaction. `packages/drizzle/src/index.test.ts`
      and `conformance/drizzle-pin/src/index.test.ts` pin that fake `PgDatabaseLike` query/mutation
      receivers do not fabricate facts while real `PgDatabase` carriers still emit exact facts or
      FW406 for raw surfaces. Verified by
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts conformance/drizzle-pin/src/index.test.ts`;
      exact `pnpm exec vp check packages/drizzle/src/drizzle-surface.ts packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`;
      and `git diff --check`.
      Evidence 2026-06-13 round285: `packages/drizzle/src/static.ts` deleted the projection-only
      `unwrappedExpression()` path and routes query-shape, static path, opaque projection, and
      typed `sql<T>` extraction through shared parsed `unwrappedTsExpression()` semantics for
      parentheses, `as`, `satisfies`, angle-bracket assertions, and non-null wrappers.
      `packages/drizzle/src/index.test.ts` covers wrapped source and project query projection
      expressions, and `conformance/drizzle-pin/src/index.test.ts` pins the same behavior under
      real `drizzle-orm` Postgres imports. Verified by
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts`
      and `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`.
      Evidence 2026-06-13 round299: project query-helper diagnostics now consume the same
      ts-morph project helper summary keys used for exact read/touch folding, and static class
      helper methods/properties are registered as summary-only project facts rather than source
      compatibility names. `packages/drizzle/src/index.test.ts` and
      `conformance/drizzle-pin/src/index.test.ts` pin query-loader reads and domain-write touches
      through `ProductHelpers.loadProducts(...)`/`ProductHelpers.touchProduct(...)` against real
      `drizzle-orm` Postgres receiver types. Verified by `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm --filter @jiso/conformance-drizzle-pin test`, `pnpm exec tsc --noEmit --pretty false`,
      exact `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Evidence 2026-06-13 round286: rest destructuring no longer promotes rest containers such as
      `[...writerRest]` or `{ ...objectRest }` to direct Drizzle receiver aliases; exact
      project-mode facts still come from typed member/element access like `writerRest[0]`, and
      source-mode rest carrier member access degrades to FW406 instead of disappearing.
      `packages/drizzle/src/index.test.ts` and `conformance/drizzle-pin/src/index.test.ts` pin
      package and real `drizzle-orm` behavior. Verified by
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts`
      and `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`.
- [x] Keep SQLite conformance deferred to late hardening; focus v1 on Postgres behavior.
      Evidence: `packages/drizzle/src/drizzle-surface.ts`, `packages/drizzle/src/static.ts`,
      `packages/drizzle/src/index.test.ts`, and `conformance/drizzle-pin/src/index.test.ts` pin the
      Postgres-only v1 surface and deferred SQLite/MySQL degradation.

Latest evidence:

- round299 static class helper summary closure:
  `pnpm exec vitest --run packages/drizzle/src`;
  `pnpm --filter @jiso/conformance-drizzle-pin test`;
  `pnpm exec tsc --noEmit --pretty false`;
  exact `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- round285 wrapped query projection extraction slice:
  `pnpm exec vitest --run packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts`;
  `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`;
  exact `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- round284 worker B project receiver type proof slice:
  `pnpm exec vitest --run packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts conformance/drizzle-pin/src/index.test.ts`;
  exact `pnpm exec vp check packages/drizzle/src/drizzle-surface.ts packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- round278 direct conditional loader/action member slice:
  `pnpm exec vitest --run packages/drizzle/src`;
  `pnpm --filter @jiso/conformance-drizzle-pin test`;
  exact `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- round279 tuple-indexed static callback/config container slice:
  `pnpm exec vitest --run packages/drizzle/src`;
  `pnpm --filter @jiso/conformance-drizzle-pin test`;
  exact `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- round277 direct opaque domain action member slice:
  `pnpm exec vitest --run packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts`;
  `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`;
  exact `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- round274 factory-returned typed carrier helper-handoff slice:
  `pnpm exec vitest --run packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts conformance/drizzle-pin/src/index.test.ts`;
  exact `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- round276 object-contained tuple assignment receiver slice:
  `pnpm exec vitest --run packages/drizzle/src`;
  `pnpm --filter @jiso/conformance-drizzle-pin test`.
- round273 tuple callback container slice:
  `pnpm exec vitest --run packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts`;
  `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`;
  exact `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- `pnpm exec vitest --run packages/drizzle/src/index.test.ts`
- `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`
- `pnpm exec vitest --run packages/drizzle/src/index.test.ts`
- `pnpm --filter @jiso/conformance-drizzle-pin test`
- exact `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts`
- `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`
- exact `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/drizzle/src`
- `pnpm --filter @jiso/conformance-drizzle-pin test`
- exact `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/drizzle/src`
- `pnpm --filter @jiso/conformance-drizzle-pin test`
- exact `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`
- `git diff --check`

## Phase 4 - Runtime

Current state: store-only mutation/query/deferred compatibility exports have been removed or
narrowed. Visible-return hydration, typed-read refetch, mutation responses, deferred streams, inline
query events, enhanced submit, broadcast, and hydrated query scripts increasingly share canonical
parser/apply helpers. Runtime test coverage has moved out of `index.test.ts` into focused
query/apply/loader/optimism/morph/delegated-handler integration tests; the broad barrel test is now
focused on public loader installation smoke only, while loader query hydration, enhanced mutations,
visible-return refetch, and disposal live in dedicated runtime tests. Inline readable/minified/generated/extracted loader
parity coverage now owns parser-helper extraction in `inline-loader-parser-parity.test.ts` and
inline enhanced-submit behavior in `inline-loader-enhanced-submit.test.ts`; delegated handler,
trigger, response-apply, and minified artifact coverage now live in focused owner suites, leaving
`inline-loader.test.ts` focused on source installation smoke. Response-apply extraction and
readable/minified embed parity assertions now live with response-apply behavior in
`packages/runtime/src/inline-loader-response-apply.test.ts`, leaving parser parity focused on the
wire-parser helper closure.
Enhanced submit, broadcast replay, deferred stream chunks, DOM apply, and store-only apply now parse
transport mutation bodies first and call `applyMutationResponseChunksToRuntime` as the single
decoded query/fragment apply primitive; the internal `applyMutationResponseBodyToRuntime`
body/apply wrapper has been deleted. Browser query hydration coverage now lives in
`packages/runtime/src/query-hydration.browser.test.ts`, including inserted hydrated scripts updating
DOM bindings through `queryPlans` on the shared runtime apply path.
Hydrated query script ledgers now decode all unseen successful scripts first and enter
`applyQueryChunksToRuntime` once per hydration pass, so visible-return hydration shares the same
batched binding-index/update-plan path as mutation and typed-read query chunks while malformed
scripts remain retryable.
Parsed query scripts are also marked seen only after that shared runtime apply path succeeds, so
transient apply-hook/update-plan failures report through the loader error seam and remain retryable
on a later hydration pass.
Query script hydration now lives in `packages/runtime/src/query-script-hydration.ts`, leaving
`packages/runtime/src/query-apply.ts` as the decoded query chunk primitive only.
DOM mutation response body parsing now lives in `packages/runtime/src/mutation-response-dom.ts`,
leaving `packages/runtime/src/apply-mutation-response.ts` as the decoded chunk/query/fragment apply
primitive used by enhanced submit, broadcast, deferred streams, and mutation-response tests; typed
read refetch now parses query chunks and calls `applyQueryChunksToRuntime` directly.
The root runtime barrel no longer re-exports the internal `applyMutationResponseToDom` DOM body
parser/apply helper; DOM callers import the canonical module seam directly, and the root public
surface keeps only the higher-level enhanced mutation apply APIs.
Visible-return typed-read refetch now decodes all successful response bodies for a refetch pass
before entering `applyQueryChunksToRuntime`, so typed reads share the same batched binding-index
path as hydrated query scripts while apply-hook failures still report through the runtime error
seam and allow later chunks to apply.
The old broad `packages/runtime/src/mutation-response.test.ts` has been split by ownership:
parsed wire-body store apply lives in `packages/runtime/src/mutation-response-wire-apply.test.ts`,
DOM body apply lives in `packages/runtime/src/mutation-response-dom.test.ts`, and decoded chunk
apply remains in `packages/runtime/src/mutation-response-apply.test.ts`.
Deferred stream part detection now uses the canonical mutation response element scanner instead of
a regex-only `fw-query`/`fw-fragment` filter, and the remaining broad
`packages/runtime/src/query-runtime-integration.test.ts` assertions have moved to derive,
optimism, mutation response, and deferred-stream owner suites.
Deferred stream boundary scanning now accepts CRLF multipart framing and line-start boundaries
before handing each part to `readMutationResponseBodyChunks`, so query/fragment application still
enters `applyMutationResponseChunksToRuntime` without a deferred-only parser/apply fork.
Fragment element decoding/error helpers are now private inside `wire-parser.ts`; the checked
decoded body readers remain the shared parser surface used by modular apply and the extracted
inline-loader parser closure. Delegated handler reference parsing is now private inside
`handlers.ts`; dispatch behavior remains covered through focused handler tests instead of root
barrel exports.
Low-level wire element scanning and HTML entity helpers now live in
`packages/runtime/src/wire-response-scanner.ts`, so `packages/runtime/src/wire-parser.ts` owns only
decoded query/body readers while handler-context, mutation-failure, deferred stream filtering, and
the extracted inline-loader parser closure share the same scanner module.
Enhanced failure output parsing now also classifies declared and validation `<output>` chunks from
one shared scanner projection, preserving declared-over-validation form semantics without a second
output parser pass.
Fragment element projection also lives in `packages/runtime/src/wire-response-scanner.ts`, so the
modular decoded mutation-body parser and extracted inline response parser no longer carry separate
`fw-fragment` element-to-chunk decoders.
Query script hydration helpers now remain internal to the loader/visible-return modules instead of
root `@jiso/runtime` exports; `query-apply.test.ts` covers decoded chunk application while
`query-script-hydration.test.ts` owns script parsing, ledger replay, retry, and hydration/apply
parity.
Loader-level `applyQuery` interposition now threads through enhanced mutation submit responses and
default BroadcastChannel replay, so loader-installed mutation transports share the same decoded
query apply hook as initial hydration, inline query events, visible-return hydration, and typed-read
refetch. Enhanced-mutation-specific `applyQuery` hooks are also pinned ahead of the broader loader
hook for default BroadcastChannel replay.
Inline and modular fragment response apply now share `applyResponseFragment` and
`applyResponseFragments` from `packages/runtime/src/response-fragment-apply.ts`: the extracted
inline helper supplies tiny DOM append/replace adapters, while `packages/runtime/src/morph.ts`
supplies the modular morph and island-signal cleanup adapters around the same target/mode and
applied-target-list decision.
The inline HTML append/replace adapter has also moved into
`packages/runtime/src/response-fragment-apply.ts` as `applyHtmlResponseFragments`, so
`packages/runtime/src/inline-response-apply.ts` only dispatches decoded query events and delegates
decoded fragment application to the shared fragment helper extracted into the inline loader.
Inline enhanced-response apply now parses response bodies in the generated installer and enters the
extracted helper at `applyInlineMutationResponseChunks`, deleting the inline-only
`applyInlineMutationResponseBody` parser/apply wrapper while preserving readable/minified artifact
parity.
Inline enhanced-response query event projection now also lives inside the extracted
`packages/runtime/src/inline-response-apply.ts` helper, so the generated bootstrap only constructs
the browser `CustomEvent` while the runtime-owned helper strips scanner offsets and owns the
batched `jiso:query` detail shape consumed by `packages/runtime/src/query-events.ts`.
Browser runtime coverage now follows the same Phase 4 seam split: the old broad
`packages/runtime/src/index.browser.test.ts` has been deleted, loader/L0 behavior lives in
`packages/runtime/src/loader.browser.test.ts`, visible-return typed-read refetch lives in
`packages/runtime/src/query-visible-return.browser.test.ts`, and real DOM mutation-response apply
lives in `packages/runtime/src/mutation-response-dom.browser.test.ts`.
Deferred stream runtime result types no longer carry the old `*ToDom` compatibility name; rooted
stream apply is named as root-aware runtime apply, while rootless stream parsing/apply coverage now
lives in its own focused owner suite.
Mutation response decoded runtime apply now uses `AppliedMutationResponseWithRoot` for root-aware
results, so deferred stream aggregation and DOM response parsing no longer depend on the old
`AppliedMutationResponseToDom` compatibility type/export.
Mutation response decoded runtime apply now also forwards `onError` into the shared query apply
primitive, so enhanced mutation responses, DOM body apply, deferred stream chunks, and broadcast
replay report per-query apply failures without forking fragment apply or blocking later decoded
query truth.

- [x] Normalize canonical query instance wire identities at the shared runtime parser boundary.
      Evidence 2026-06-13 round276: `packages/runtime/src/wire-parser.ts` now decodes
      SPEC.md §9.4/§10.2 `query:key` names into the same `{ name, key }` query chunk shape used by
      split `name`/`key` attributes, so hydration scripts, inline query events, typed-read refetch,
      and visible-return ledgers converge before `applyQueryChunksToRuntime`. Verified by
      `pnpm exec vitest --run packages/runtime/src`, browser hydration
      `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/query-hydration.browser.test.ts`, and
      `pnpm --filter @jiso/runtime run check:inline-loader`.
- [x] Batch visible-return typed-read response apply through the shared runtime query primitive.
      Evidence 2026-06-13 round288 runtime: `packages/runtime/src/query-refetch.ts` now decodes
      successful typed-read bodies first and enters `applyQueryChunksToRuntime` once per refetch
      pass, using `afterApplyQuery` to keep the visible-return ledger scoped to actually applied
      chunks. `packages/runtime/src/query-apply.ts` now supports explicit runtime error reporting
      for per-query apply failures, and `packages/runtime/src/query-refetch.test.ts` proves
      SPEC.md §4.4/§9.4 typed-read batching reuses one compiled binding index across multiple
      responses while a failed apply hook reports and later chunks still apply. Verified by
      focused `pnpm exec vitest --run packages/runtime/src/query-refetch.test.ts
packages/runtime/src/query-visible-return.test.ts
packages/runtime/src/loader-visible-return-refetch.test.ts
packages/runtime/src/loader-query-apply-interposition.test.ts`, full runtime
      `pnpm exec vitest --run packages/runtime/src`, browser runtime
      `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/query-visible-return.browser.test.ts
packages/runtime/src/query-hydration.browser.test.ts`, and exact `pnpm exec vp check
packages/runtime/src/query-apply.ts packages/runtime/src/query-refetch.ts
packages/runtime/src/query-refetch.test.ts plans/codebase-quality-round2.md`.
- [x] Keep hydrated query script retry ledgers scoped to successful shared runtime apply.
      Evidence 2026-06-13 round289 runtime: `packages/runtime/src/query-script-hydration.ts`
      now forwards apply errors into `applyQueryChunksToRuntime` and marks script nodes seen only
      after their decoded query object completes the SPEC.md §4.4/§9.4 shared apply path.
      `packages/runtime/src/query-script-hydration.test.ts` proves a parsed script is retried after
      a transient `applyQuery` failure, and
      `packages/runtime/src/query-hydration.browser.test.ts` proves the installed browser loader
      recovers the same script on a later `visibilitychange` pass. Verified by focused
      `pnpm exec vitest --run packages/runtime/src/query-script-hydration.test.ts
packages/runtime/src/query-visible-return.test.ts packages/runtime/src/loader-query-hydration.test.ts`,
      browser `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/query-hydration.browser.test.ts`, full runtime
      `pnpm exec vitest --run packages/runtime/src`, and browser runtime
      `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/**/*.browser.test.ts`; inline-loader parity
      `pnpm --filter @jiso/runtime run check:inline-loader`; exact `pnpm exec vp check
packages/runtime/src/query-script-hydration.ts
packages/runtime/src/query-script-hydration.test.ts
packages/runtime/src/query-hydration.browser.test.ts plans/codebase-quality-round2.md`; and
      `git diff --check`.
- [x] Keep CRLF deferred stream parts on the shared mutation response apply path.
      Evidence 2026-06-13 round291 runtime: `packages/runtime/src/wire-parser.ts` now detects
      deferred stream boundaries only at line starts, accepts CRLF boundary lines, trims boundary
      prelude line endings, and leaves each part to `readMutationResponseBodyChunks` before
      `packages/runtime/src/apply-deferred-stream.ts` enters the existing
      `applyMutationResponseChunksToRuntime` primitive. `packages/runtime/src/wire-parser.test.ts`
      proves multipart-ish CRLF parts decode through the mutation parser,
      `packages/runtime/src/apply-deferred-stream.test.ts` proves preamble/trailing data is ignored
      while query truth and fragments apply through rooted runtime apply, and
      `packages/runtime/src/apply-deferred-stream.browser.test.ts` proves real browser DOM
      fragment morphing shares query truth through the separate query root. Verified by focused
      `pnpm exec vitest --run packages/runtime/src/wire-parser.test.ts
packages/runtime/src/apply-deferred-stream.test.ts
packages/runtime/src/apply-deferred-stream-rootless.test.ts`, full runtime
      `pnpm exec vitest --run packages/runtime/src`, browser runtime
      `pnpm exec vitest --run --config vitest.browser.config.ts`, exact `pnpm exec vp check
packages/runtime/src/wire-parser.ts packages/runtime/src/wire-parser.test.ts
packages/runtime/src/apply-deferred-stream.test.ts
packages/runtime/src/apply-deferred-stream.browser.test.ts plans/codebase-quality-round2.md`, and
      `git diff --check`.
- [x] Report mutation response query hook failures through the shared runtime apply seam.
      Evidence 2026-06-13 round292 runtime: `packages/runtime/src/apply-mutation-response.ts`
      now passes `onError` into `applyQueryChunksToRuntime`, so SPEC.md §9.1/§9.4 decoded
      mutation responses share the same per-query error reporting path as hydration and typed-read
      apply while continuing later query chunks and fragment morphing. Verified by focused
      `pnpm exec vitest --run packages/runtime/src/mutation-response-apply.test.ts`,
      browser DOM `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/mutation-response-dom.browser.test.ts`, full runtime
      `pnpm exec vitest --run packages/runtime/src`, browser runtime
      `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/**/*.browser.test.ts`, exact `pnpm exec vp check
packages/runtime/src/apply-mutation-response.ts
packages/runtime/src/mutation-response-apply.test.ts
packages/runtime/src/mutation-response-dom.browser.test.ts plans/codebase-quality-round2.md`, and
      `git diff --check`.
- [x] Keep component-stamp fragment targets in parity across enhanced submit headers and inline apply.
      Evidence 2026-06-13 round293 runtime: `packages/runtime/src/mutation-targets.ts` and the
      generated inline loader now fall back from `fw-fragment-target`/`id` to `fw-c` when collecting
      SPEC.md §9.1 `FW-Targets`, and inline fragment apply resolves `[fw-c]` before id/explicit
      target to match `packages/runtime/src/fragment-targets.ts`. Verified by focused
      `pnpm exec vitest --run packages/runtime/src/mutation-targets.test.ts
packages/runtime/src/inline-loader-enhanced-submit.test.ts
packages/runtime/src/inline-loader-response-apply.test.ts
packages/runtime/src/inline-loader-artifact-minifier.test.ts
packages/runtime/src/mutation-response-dom.browser.test.ts`, inline-loader parity
      `pnpm run check:inline-loader`, browser DOM
      `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/mutation-response-dom.browser.test.ts`, exact `pnpm exec vp check
packages/runtime/src/mutation-targets.ts packages/runtime/src/mutation-targets.test.ts
packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.ts
packages/runtime/src/inline-loader-test-utils.ts
packages/runtime/src/inline-loader-enhanced-submit.test.ts
packages/runtime/src/inline-loader-response-apply-fixture.ts
packages/runtime/src/inline-loader-response-apply.test.ts
packages/runtime/src/inline-loader-artifact-minifier.test.ts
packages/runtime/src/mutation-response-dom.browser.test.ts plans/codebase-quality-round2.md`, and
      `git diff --check`.
- [x] Audit for any remaining internal compatibility-style apply wrappers after `applyFragmentQueryBody`
      deletion.
      Evidence 2026-06-13 round259: `packages/runtime/src/wire-parser.ts` deleted the unused
      standalone `readFragmentChunks` decoded-body helper, leaving fragment response decoding on
      `readMutationResponseBodyChunks` and private fragment element helpers only.
      `packages/runtime/src/wire-parser.test.ts` now asserts `readFragmentChunks` is not exported
      from the parser module and proves malformed/target-filtered fragment decoding through the
      canonical mutation response body reader. Focused parser/apply/inline-loader files were
      verified with `pnpm exec vitest --run`; the full runtime source suite was verified with
      `pnpm exec vitest --run packages/runtime/src`. Inline generation was verified with
      `pnpm --filter @jiso/runtime run check:inline-loader`. Formatting/lint/type evidence:
      targeted `pnpm exec vp check`, `pnpm exec tsc --noEmit --pretty false`, and
      `git diff --check`.
      Evidence 2026-06-13 round282 worker C: `packages/runtime/src/wire-response-scanner.ts` now
      owns `readElementChunks`, `readAttribute`, entity decoding, mutation response element
      scanning, and the inline response-body projection used by SPEC.md §4.4/§9.1 inline loader
      extraction. `packages/runtime/src/wire-parser.ts` imports that scanner for decoded
      query/body readers and no longer exports the low-level scanner helpers; handler context and
      mutation failure parsing import the same scanner instead of reaching through the decoded
      wire parser. Verified by focused `pnpm exec vitest --run
packages/runtime/src/wire-parser.test.ts
packages/runtime/src/inline-loader-parser-parity.test.ts
packages/runtime/src/inline-loader-response-apply.test.ts
packages/runtime/src/inline-loader-artifact-minifier.test.ts
packages/runtime/src/mutation-failure.test.ts packages/runtime/src/handler-context.test.ts`,
      full runtime `pnpm exec vitest --run packages/runtime/src`, inline generation
      `pnpm run check:inline-loader`, exact `pnpm exec vp check
packages/runtime/src/wire-response-scanner.ts packages/runtime/src/wire-parser.ts
packages/runtime/src/wire-parser.test.ts packages/runtime/src/inline-loader-build.ts
packages/runtime/src/inline-response-apply.ts packages/runtime/src/handler-context.ts
packages/runtime/src/mutation-failure.ts plans/codebase-quality-round2.md`, and
      `git diff --check`.
      Evidence 2026-06-13 round283 worker C: `packages/runtime/src/wire-response-scanner.ts` now
      exports the scanner-owned fragment element projection used by
      `readInlineMutationResponseBodyChunks`, and `packages/runtime/src/wire-parser.ts` imports that
      projection instead of carrying a duplicated modular parser copy.
      `packages/runtime/src/wire-parser.test.ts` pins parity across scanner projection, inline
      response body projection, and decoded mutation response body parsing for SPEC.md §4.4/§9.1.
      Verified by focused `pnpm exec vitest --run packages/runtime/src/wire-parser.test.ts
packages/runtime/src/inline-loader-parser-parity.test.ts
packages/runtime/src/inline-loader-response-apply.test.ts
packages/runtime/src/inline-loader-artifact-minifier.test.ts`, full runtime
      `pnpm exec vitest --run packages/runtime/src`, and inline generation
      `pnpm run check:inline-loader`; exact `pnpm exec vp check
packages/runtime/src/wire-response-scanner.ts packages/runtime/src/wire-parser.ts
packages/runtime/src/wire-parser.test.ts plans/codebase-quality-round2.md`; and
      `git diff --check`.
      Evidence 2026-06-13 round284 worker C:
      `packages/runtime/src/mutation-failure.ts` now reads all failure `<output>` chunks once
      through `readElementChunks` and classifies declared/validation failures from that scanner
      projection, preserving SPEC.md §9.2 declared-failure priority while deleting the duplicated
      declared-vs-validation output parser passes. Verified by focused
      `pnpm exec vitest --run packages/runtime/src/mutation-failure.test.ts
packages/runtime/src/submit-context.test.ts`, full runtime
      `pnpm exec vitest --run packages/runtime/src`, and
      `pnpm run check:inline-loader`.
      Evidence 2026-06-13 round281: `packages/runtime/src/apply-mutation-response.ts` renamed the
      rooted decoded apply result to `AppliedMutationResponseWithRoot`, and
      `packages/runtime/src/mutation-response-dom.ts`, `packages/runtime/src/apply-deferred-stream.ts`,
      and `packages/runtime/src/index.ts` no longer re-export or consume
      `AppliedMutationResponseToDom`. Verified by focused runtime tests `pnpm exec vitest --run
packages/runtime/src/mutation-response-dom.test.ts
packages/runtime/src/mutation-response-apply.test.ts
packages/runtime/src/apply-deferred-stream.test.ts
packages/runtime/src/apply-deferred-stream-rootless.test.ts
packages/runtime/src/index-exports.test.ts` and TypeScript
      `pnpm exec tsc --noEmit --pretty false`.
- [x] Keep inline-loader readable/minified output mechanically tied to canonical parser helpers.
      Evidence 2026-06-13: `packages/runtime/src/inline-loader-build.ts` generates
      `inlineJisoLoaderInstallerReadableSource` through
      `buildInlineJisoLoaderInstallerReadableSource(inlineWireParserReadableSource)`, where
      `inlineWireParserReadableSource` is extracted from `wire-response-scanner.ts`. New
      `packages/runtime/src/inline-loader-parser-parity.test.ts` owns readable generation,
      helper-closure extraction, readable/minified parser embed drift failures, and rejection of
      non-self-contained helper dependencies. Verified by `pnpm exec vitest --run
packages/runtime/src/inline-loader-build.test.ts
packages/runtime/src/inline-loader-parser-parity.test.ts
packages/runtime/src/inline-loader.test.ts
packages/runtime/src/inline-js-minifier.test.ts` and
      `pnpm --filter @jiso/runtime run check:inline-loader`.
      Evidence 2026-06-13 round272: `packages/runtime/src/inline-response-apply.ts` now owns
      `applyResponseFragment` as the shared decoded fragment target/mode branch for both extracted
      inline response apply and modular DOM morph apply in `packages/runtime/src/morph.ts`.
      `packages/runtime/src/inline-loader.ts` was regenerated from that helper closure, and
      `packages/runtime/src/inline-loader-parser-parity.test.ts` plus
      `packages/runtime/src/inline-loader-artifact-minifier.test.ts` pin the readable/minified
      helper embed around `applyResponseFragment`, `appendInlineFragment`, and
      `replaceInlineFragment`. Verified by focused runtime tests `pnpm exec vitest --run
      packages/runtime/src/inline-loader-parser-parity.test.ts
      packages/runtime/src/inline-loader-response-apply.test.ts
      packages/runtime/src/inline-loader-artifact-minifier.test.ts
      packages/runtime/src/inline-loader-build.test.ts packages/runtime/src/inline-js-minifier.test.ts
      packages/runtime/src/mutation-response-dom.test.ts
      packages/runtime/src/mutation-response-apply.test.ts
      packages/runtime/src/mutation-response-wire-apply.test.ts packages/runtime/src/morph.test.ts`;
      browser runtime `pnpm exec vitest --config vitest.browser.config.ts --run
      packages/runtime/src/index.browser.test.ts packages/runtime/src/query-hydration.browser.test.ts`;
      inline generation `pnpm --filter @jiso/runtime run check:inline-loader`; exact `pnpm exec vp
      check packages/runtime/src/inline-response-apply.ts packages/runtime/src/morph.ts
      packages/runtime/src/inline-loader.ts
      packages/runtime/src/inline-loader-parser-parity.test.ts
      packages/runtime/src/inline-loader-artifact-minifier.test.ts plans/codebase-quality-round2.md`;
      and `git diff --check`.
      Evidence 2026-06-13 round278: `packages/runtime/src/inline-response-apply.ts` deleted the
      inline-only `applyInlineMutationResponseBody` wrapper and now exposes the extracted
      `applyInlineMutationResponseChunks` decoded apply helper. `packages/runtime/src/inline-loader-build.ts`
      parses once with `readInlineMutationResponseBodyChunks(body)` before apply, and regenerated
      `packages/runtime/src/inline-loader.ts` no longer contains the body/apply compatibility
      wrapper. Verified by focused inline/runtime tests `pnpm exec vitest --run
      packages/runtime/src/inline-loader-response-apply.test.ts
      packages/runtime/src/inline-loader-artifact-minifier.test.ts
      packages/runtime/src/inline-loader-parser-parity.test.ts
      packages/runtime/src/inline-loader-build.test.ts packages/runtime/src/inline-js-minifier.test.ts
      packages/runtime/src/mutation-response-dom.test.ts packages/runtime/src/morph.test.ts`;
      full runtime `pnpm exec vitest --run packages/runtime/src`; and inline generation
      `pnpm --filter @jiso/runtime run check:inline-loader`.
      Evidence 2026-06-13 round279: inline decoded response apply now returns the applied fragment
      target list from `applyInlineMutationResponseChunks`, matching modular DOM apply's
      `appliedFragments` parity while preserving ignored missing targets. The generated/minified
      inline loader artifact was regenerated and pins the returned applied-fragment path; response
      apply extraction now has owner-suite coverage for rejecting imports, top-level helper values,
      and default-parameter module state. Verified by focused runtime tests `pnpm exec vitest --run
      packages/runtime/src/inline-loader-response-apply.test.ts
      packages/runtime/src/inline-loader-artifact-minifier.test.ts
      packages/runtime/src/inline-loader-parser-parity.test.ts
      packages/runtime/src/inline-loader-build.test.ts packages/runtime/src/inline-js-minifier.test.ts
      packages/runtime/src/mutation-response-dom.test.ts packages/runtime/src/morph.test.ts`, full
      runtime `pnpm exec vitest --run packages/runtime/src`, browser runtime `pnpm exec vitest
      --run --config vitest.browser.config.ts packages/runtime/src/**/*.browser.test.ts`, exact
      `pnpm exec vp check packages/runtime/src/inline-response-apply.ts
      packages/runtime/src/inline-loader.ts
      packages/runtime/src/inline-loader-response-apply.test.ts
      packages/runtime/src/inline-loader-artifact-minifier.test.ts
      packages/runtime/src/query-hydration.browser.test.ts plans/codebase-quality-round2.md`,
      TypeScript `pnpm exec tsc --noEmit --pretty false`, `git diff --check`, and inline
      generation `pnpm --filter @jiso/runtime run check:inline-loader`.
      Evidence 2026-06-13 round287b runtime closure:
      `packages/runtime/src/inline-response-apply.ts` now owns the batched inline `jiso:query`
      event detail projection via `dispatchInlineMutationQueries`, including dropping scanner-only
      `start`/`end` offsets before dispatch. `packages/runtime/src/inline-loader-build.ts` now
      passes only a `dispatchQueryEvent` CustomEvent seam into the extracted helper, and
      regenerated `packages/runtime/src/inline-loader.ts` pins that readable/minified production
      artifact. Verified by focused runtime tests `pnpm exec vitest --run
      packages/runtime/src/inline-loader-response-apply.test.ts
      packages/runtime/src/inline-loader-artifact-minifier.test.ts
      packages/runtime/src/query-events.test.ts
      packages/runtime/src/response-fragment-apply.test.ts`; inline generation
      `pnpm run check:inline-loader`; browser runtime `pnpm exec vitest --config
      vitest.browser.config.ts --run packages/runtime/src/query-hydration.browser.test.ts
      packages/runtime/src/loader.browser.test.ts`.
      Evidence 2026-06-13 round270: inline enhanced-response application now extracts both sides of
      the inline parser/apply boundary from runtime-owned source. `packages/runtime/src/wire-response-scanner.ts`
      owns `readInlineMutationResponseBodyChunks`, while
      `packages/runtime/src/inline-response-apply.ts` owns
      the extracted response apply helper closure; `packages/runtime/src/inline-loader-build.ts` rejects
      readable/minified drift for both helper closures before regenerating
      `packages/runtime/src/inline-loader.ts`. `packages/runtime/src/inline-loader-parser-parity.test.ts`
      pins readable/minified response-apply closure extraction, and
      `packages/runtime/src/inline-loader-response-apply.test.ts` directly exercises the helper plus
      readable/minified/generated/extracted installer parity. Verified by focused inline/apply tests
      `pnpm exec vitest --run packages/runtime/src/inline-loader-build.test.ts
packages/runtime/src/inline-loader-parser-parity.test.ts
packages/runtime/src/inline-loader-response-apply.test.ts
packages/runtime/src/inline-loader-enhanced-submit.test.ts packages/runtime/src/inline-loader.test.ts
packages/runtime/src/inline-js-minifier.test.ts packages/runtime/src/mutation-response-dom.test.ts
packages/runtime/src/mutation-response-wire-apply.test.ts
packages/runtime/src/mutation-response-apply.test.ts`; full runtime
      `pnpm exec vitest --run packages/runtime/src`; inline generation
      `pnpm --filter @jiso/runtime run check:inline-loader`; browser runtime `pnpm run
      test:browser`; exact `pnpm exec vp check packages/runtime/src/inline-response-apply.ts
packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.ts
packages/runtime/src/inline-loader-build.test.ts
packages/runtime/src/inline-loader-parser-parity.test.ts
packages/runtime/src/inline-loader-response-apply.test.ts plans/codebase-quality-round2.md`; and
      `git diff --check`.
      Evidence 2026-06-13 round251: inline enhanced-response application now keeps body parsing and
      decoded chunk application as separate generated helpers: `applyResponseBody` calls extracted
      `readInlineMutationResponseBodyChunks` once and passes canonical raw query chunks plus decoded
      fragment chunks to `applyResponseChunks`.
      `packages/runtime/src/inline-loader-parser-parity.test.ts`,
      `packages/runtime/src/inline-loader-build.test.ts`,
      `packages/runtime/src/wire-parser.test.ts`, and regenerated
      `packages/runtime/src/inline-loader.ts` pin the readable/minified parser/apply boundary.
      Verified by `pnpm exec vitest --run packages/runtime/src/wire-parser.test.ts
packages/runtime/src/inline-loader-build.test.ts
packages/runtime/src/inline-loader-parser-parity.test.ts
packages/runtime/src/inline-loader-response-apply.test.ts` and `pnpm --filter @jiso/runtime run
check:inline-loader`.
      Evidence 2026-06-13 round258: inline wire-parser closure extraction now follows helper
      references from default parameter initializers, so future canonical parser defaults cannot
      silently omit dependencies from the readable/minified inline loader. The extractor also
      rejects unsupported top-level bindings reached from parameter defaults. Verified by focused
      `pnpm exec vitest --run packages/runtime/src/inline-loader-parser-parity.test.ts
packages/runtime/src/inline-loader-build.test.ts packages/runtime/src/inline-js-minifier.test.ts`,
      full runtime `pnpm exec vitest --run packages/runtime/src`, and `pnpm --filter
      @jiso/runtime run check:inline-loader`.
- [ ] Continue splitting large runtime tests along apply/query/loader/minifier seams.
      Evidence 2026-06-13 round287 runtime closure: pure delegated handler dispatch, chaining,
      state queueing, param coercion, state hydration, and failure-persistence coverage moved from
      `packages/runtime/src/delegated-runtime-integration.test.ts` into the handler owner suite
      `packages/runtime/src/handlers.test.ts`, leaving the integration file focused on SPEC.md
      §4.4/§4.7 island signal lifecycle and loader/morph interactions. Verified by
      `pnpm exec vitest --run packages/runtime/src/handlers.test.ts
      packages/runtime/src/delegated-runtime-integration.test.ts`.
      Evidence 2026-06-13 round280: deferred stream apply deleted the runtime-only
      `AppliedDeferredStreamResponseToDom` compatibility type/export in favor of
      `AppliedDeferredStreamResponseWithRoot`, and rootless deferred stream parser/apply assertions
      moved from `packages/runtime/src/apply-deferred-stream.test.ts` into
      `packages/runtime/src/apply-deferred-stream-rootless.test.ts`. Verified by focused
      `pnpm exec vitest --run packages/runtime/src/apply-deferred-stream.test.ts
      packages/runtime/src/apply-deferred-stream-rootless.test.ts
      packages/runtime/src/index-exports.test.ts`, full runtime
      `pnpm exec vitest --run packages/runtime/src`, and TypeScript
      `pnpm exec tsc --noEmit --pretty false`; exact `pnpm exec vp check
      packages/runtime/src/apply-deferred-stream.ts packages/runtime/src/index.ts
      packages/runtime/src/apply-deferred-stream.test.ts
      packages/runtime/src/apply-deferred-stream-rootless.test.ts plans/codebase-quality-round2.md`;
      `git diff --check`.
      Evidence 2026-06-13 round275: broad browser runtime coverage was split along loader, query,
      and DOM response-apply seams. `packages/runtime/src/index.browser.test.ts` was deleted;
      `packages/runtime/src/loader.browser.test.ts` owns P2 first-paint loader, delegated idle, and
      L0 IDREF/popover behavior; `packages/runtime/src/query-visible-return.browser.test.ts` owns
      visible-return typed-read refetch; and
      `packages/runtime/src/mutation-response-dom.browser.test.ts` owns real DOM fragment apply,
      keyed morph preservation, append, and target resolution. Verified by browser runtime
      `pnpm exec vitest --config vitest.browser.config.ts --run
      packages/runtime/src/loader.browser.test.ts
      packages/runtime/src/query-visible-return.browser.test.ts
      packages/runtime/src/mutation-response-dom.browser.test.ts`; focused apply/query/inline
      boundary tests `pnpm exec vitest --run packages/runtime/src/mutation-response-apply.test.ts
      packages/runtime/src/mutation-response-wire-apply.test.ts packages/runtime/src/query-apply.test.ts
      packages/runtime/src/inline-loader-response-apply.test.ts
      packages/runtime/src/inline-loader-parser-parity.test.ts
      packages/runtime/src/inline-js-minifier.test.ts`; inline generation `pnpm --filter
      @jiso/runtime run check:inline-loader`; exact `pnpm exec vp check
      packages/runtime/src/loader.browser.test.ts
      packages/runtime/src/query-visible-return.browser.test.ts
      packages/runtime/src/mutation-response-dom.browser.test.ts
      packages/runtime/src/index.browser.test.ts plans/codebase-quality-round2.md`; and
      `git diff --check`.
      Evidence 2026-06-13: `packages/runtime/src/index.test.ts` now owns only public barrel
      loader smoke. `packages/runtime/src/loader-query-hydration.test.ts`,
      `packages/runtime/src/loader-enhanced-mutation.test.ts`, and
      `packages/runtime/src/loader-disposal.test.ts` own the moved query hydration,
      enhanced mutation/broadcast, and disposal cases. Verified by focused runtime tests:
      `pnpm exec vitest --run packages/runtime/src/index.test.ts
packages/runtime/src/loader-query-hydration.test.ts
packages/runtime/src/loader-enhanced-mutation.test.ts
packages/runtime/src/loader-disposal.test.ts`.
      Evidence 2026-06-13: inline parser/helper parity coverage moved from
      `packages/runtime/src/inline-loader-build.test.ts` into
      `packages/runtime/src/inline-loader-parser-parity.test.ts`; the build test now stays focused
      on generated module/package-script/budget behavior. Verified by the focused inline-loader
      vitest command listed under parser-helper evidence.
      Evidence 2026-06-13: inline enhanced-submit gate/failure/request-target parity moved from
      `packages/runtime/src/inline-loader.test.ts` into
      `packages/runtime/src/inline-loader-enhanced-submit.test.ts`, with shared source-install
      cases owned by `packages/runtime/src/inline-loader-test-utils.ts`. Verified by `pnpm exec
vitest --run packages/runtime/src/inline-loader.test.ts
packages/runtime/src/inline-loader-enhanced-submit.test.ts
packages/runtime/src/inline-loader-parser-parity.test.ts
packages/runtime/src/inline-loader-build.test.ts
packages/runtime/src/inline-js-minifier.test.ts`.
      Evidence 2026-06-13 round260: inline execution trigger coverage moved from
      `packages/runtime/src/inline-loader.test.ts` into
      `packages/runtime/src/inline-loader-triggers.test.ts`, leaving the original suite focused on
      source installation and delegated handler parity. Mutation response compatibility export
      assertions moved from metadata behavior coverage into
      `packages/runtime/src/index-exports.test.ts`. Verified by `pnpm exec vitest --run
packages/runtime/src/inline-loader.test.ts
packages/runtime/src/inline-loader-triggers.test.ts packages/runtime/src/index-exports.test.ts
packages/runtime/src/mutation-response-metadata.test.ts`.
      Evidence 2026-06-13 round257: query script hydration moved from
      `packages/runtime/src/query-apply.ts` into
      `packages/runtime/src/query-script-hydration.ts`, and
      `packages/runtime/src/query-apply.test.ts` now pins that decoded query apply no longer exports
      hydration parser helpers. `packages/runtime/src/query-refetch.ts` now parses typed-read query
      chunks and calls `applyQueryChunksToRuntime` directly instead of wrapping query-only responses
      in the mutation response apply primitive. Verified by focused runtime tests `pnpm exec vitest
      --run packages/runtime/src/query-apply.test.ts
      packages/runtime/src/query-script-hydration.test.ts
      packages/runtime/src/query-visible-return.test.ts packages/runtime/src/query-refetch.test.ts`,
      full runtime suite `pnpm exec vitest --run packages/runtime/src`, inline-loader check `pnpm
      --filter @jiso/runtime run check:inline-loader`, browser runtime `pnpm exec vitest --config
      vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts
      packages/runtime/src/query-hydration.browser.test.ts`, TypeScript `pnpm exec tsc --noEmit
      --pretty false`, targeted `pnpm exec vp check packages/runtime/src/query-apply.ts packages/runtime/src/query-apply.test.ts packages/runtime/src/query-script-hydration.ts packages/runtime/src/query-script-hydration.test.ts packages/runtime/src/query-visible-return.ts packages/runtime/src/query-refetch.ts packages/runtime/src/loader-lifecycle.ts packages/runtime/src/index.ts plans/codebase-quality-round2.md`, and `git diff --check`.
      Supporting checks: `pnpm --filter @jiso/runtime run check:inline-loader`; `pnpm exec vp
check packages/runtime/src/inline-loader.test.ts
packages/runtime/src/inline-loader-enhanced-submit.test.ts
packages/runtime/src/inline-loader-test-utils.ts plans/codebase-quality-round2.md`; `git diff
--check`.
      Evidence 2026-06-13 round267: loader query-apply interposition coverage now pins that
      enhanced-mutation `applyQuery` overrides the broader loader hook for default
      BroadcastChannel replay, matching direct enhanced submit hook precedence under SPEC.md §9.2.
      Verified by `pnpm exec vitest --run
      packages/runtime/src/loader-query-apply-interposition.test.ts
      packages/runtime/src/broadcast.test.ts` and `pnpm --filter @jiso/runtime run
      check:inline-loader`.
      Evidence 2026-06-13: inline response-apply parity moved from
      `packages/runtime/src/inline-loader.test.ts` into
      `packages/runtime/src/inline-loader-response-apply.test.ts`, leaving the broad inline-loader
      test focused on install, delegated handler, and trigger behavior. Verified by `pnpm exec
vitest --run packages/runtime/src/inline-loader.test.ts
packages/runtime/src/inline-loader-response-apply.test.ts
packages/runtime/src/inline-loader-enhanced-submit.test.ts
packages/runtime/src/inline-loader-parser-parity.test.ts
packages/runtime/src/inline-loader-build.test.ts
packages/runtime/src/inline-js-minifier.test.ts`.
      Evidence 2026-06-13 round266: the minified inline response-apply follow-up is now folded
      into `packages/runtime/src/inline-loader-response-apply.test.ts`; the response-apply owner
      suite checks freshly minified source compactness and executes the shared readable/minified/
      generated/extracted installer parity matrix, so the standalone minified response-apply test
      file was deleted. Verified by focused inline response/apply and minifier tests, browser
      runtime checks, targeted `vp check`, and `git diff --check`.
      Evidence 2026-06-13 round256: query script hydration coverage moved from
      `packages/runtime/src/query-apply.test.ts` into
      `packages/runtime/src/query-script-hydration.test.ts`, leaving `query-apply.test.ts` focused
      on decoded `applyQueryChunksToRuntime` behavior. `packages/runtime/src/index.ts` no longer
      root-exports `hydrateQueryScripts`, `createQueryScriptHydrationLedger`, or their loader-only
      types; `packages/runtime/src/index-exports.test.ts` pins the narrowed public surface.
      Verified by `pnpm exec vitest --run packages/runtime/src/query-apply.test.ts
packages/runtime/src/query-script-hydration.test.ts packages/runtime/src/index-exports.test.ts
packages/runtime/src/loader-query-hydration.test.ts packages/runtime/src/query-visible-return.test.ts
packages/runtime/src/query-hydration.browser.test.ts`, full `pnpm exec vitest --run
packages/runtime/src`, browser `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/query-hydration.browser.test.ts packages/runtime/src/index.browser.test.ts`,
      `pnpm --filter @jiso/runtime run check:inline-loader`, `pnpm exec tsc --noEmit`, targeted
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/index-exports.test.ts
packages/runtime/src/query-apply.test.ts packages/runtime/src/query-script-hydration.test.ts
plans/codebase-quality-round2.md`, and `git diff --check`.
      Evidence 2026-06-13: query binding/update-plan helper coverage moved from
      `packages/runtime/src/query-runtime-integration.test.ts` into
      `packages/runtime/src/query-bindings.test.ts`, leaving the integration file focused on
      response apply, deferred stream, broadcast, and enhanced mutation flows. Verified by
      `pnpm exec vitest --run packages/runtime/src/query-bindings.test.ts
packages/runtime/src/query-runtime-integration.test.ts`.
      Evidence 2026-06-13: mutation response metadata/barrel/idempotency/change-record coverage
      moved from `packages/runtime/src/mutation-response.test.ts` into
      `packages/runtime/src/mutation-response-metadata.test.ts`, and the duplicated hook-aware
      store-only apply case plus local morph/query fake classes were removed. Shared
      `packages/runtime/src/runtime-test-fakes.ts` now owns attribute-binding fake behavior and
      binding-index scan counting used by runtime apply/query tests. Verified by `pnpm exec vitest
--run packages/runtime/src/mutation-response.test.ts
packages/runtime/src/mutation-response-metadata.test.ts packages/runtime/src/query-bindings.test.ts`
      and `pnpm exec vitest --run packages/runtime/src/query-runtime-integration.test.ts
packages/runtime/src/morph.test.ts`.
      Evidence 2026-06-13: duplicate local broadcast/morph/query/pending fake classes were deleted
      from `packages/runtime/src/broadcast.test.ts`,
      `packages/runtime/src/mutation-apply.test.ts`,
      `packages/runtime/src/apply-deferred-stream.test.ts`,
      `packages/runtime/src/query-bindings.test.ts`, and
      `packages/runtime/src/mutation-optimistic.test.ts`; those apply/query/optimism suites now use
      the shared `packages/runtime/src/runtime-test-fakes.ts` helpers. Verified by `pnpm exec
vitest --run packages/runtime/src/broadcast.test.ts packages/runtime/src/mutation-apply.test.ts
packages/runtime/src/apply-deferred-stream.test.ts packages/runtime/src/query-bindings.test.ts
packages/runtime/src/mutation-optimistic.test.ts`.
      Evidence 2026-06-13: direct enhanced-submit integration coverage moved from
      `packages/runtime/src/query-runtime-integration.test.ts` into
      `packages/runtime/src/mutation-submit.test.ts`; remaining broadcast replay/sync cases moved
      into `packages/runtime/src/broadcast.test.ts`; `packages/runtime/src/morph.test.ts` deleted
      its local morph fakes and now uses shared `packages/runtime/src/runtime-test-fakes.ts`.
      Verified by `pnpm exec vitest --run packages/runtime/src/query-runtime-integration.test.ts
packages/runtime/src/broadcast.test.ts packages/runtime/src/mutation-submit.test.ts
packages/runtime/src/morph.test.ts`.
      Evidence 2026-06-13: duplicate local query-store hydration/refetch and pending-stamp fake
      classes were deleted from `packages/runtime/src/query-store.test.ts` and
      `packages/runtime/src/pending.test.ts`; shared
      `packages/runtime/src/runtime-test-fakes.ts` now owns binding-aware loader roots,
      enhanced-form, morph, broadcast, and pending fakes used by those runtime suites. Verified by
      `pnpm exec vitest --run packages/runtime/src/query-store.test.ts
packages/runtime/src/loader-query-hydration.test.ts
packages/runtime/src/query-runtime-integration.test.ts
packages/runtime/src/loader-disposal.test.ts
packages/runtime/src/delegated-runtime-integration.test.ts` and `pnpm exec vitest --run
packages/runtime/src/pending.test.ts packages/runtime/src/mutation-submit.test.ts
packages/runtime/src/mutation-optimistic.test.ts`.
      Evidence 2026-06-13: duplicate local loader root/element/form fakes were deleted from
      `packages/runtime/src/loader.test.ts`, `packages/runtime/src/loader-lifecycle.test.ts`, and
      `packages/runtime/src/mutation-form.test.ts`; shared
      `packages/runtime/src/runtime-test-fakes.ts` now owns default empty elements, exact-optional
      form method typing, progress children, and native-submit state for loader/form helper suites.
      Verified by `pnpm exec vitest --run packages/runtime/src/loader.test.ts
packages/runtime/src/loader-lifecycle.test.ts packages/runtime/src/mutation-form.test.ts
packages/runtime/src/loader-enhanced-mutation.test.ts
packages/runtime/src/delegated-runtime-integration.test.ts` and `pnpm exec vp check
packages/runtime/src/runtime-test-fakes.ts packages/runtime/src/loader.test.ts
packages/runtime/src/loader-lifecycle.test.ts packages/runtime/src/mutation-form.test.ts
plans/codebase-quality-round2.md`.
      Evidence 2026-06-13: `packages/runtime/src/query-apply.ts` now applies unseen hydrated query
      scripts as one decoded runtime batch after `packages/runtime/src/wire-parser.ts` extracts the
      single-script parser helper; `packages/runtime/src/query-apply.test.ts` pins one binding-index
      scan for multi-script hydration plus malformed-script retry. Verified by `pnpm exec vitest
--run packages/runtime/src/query-apply.test.ts packages/runtime/src/wire-parser.test.ts` and
      `pnpm exec vitest --run packages/runtime/src`.
      Evidence 2026-06-13 round251: `packages/runtime/src/wire-parser.ts` now owns
      `readInlineMutationResponseBodyChunks`, which wraps the shared response element scanner for
      the inline loader and returns canonical raw query chunks plus decoded fragment chunks before
      apply. `packages/runtime/src/inline-loader-build.ts` extracts that body-decoder helper as the
      generated inline-loader parser root instead of letting inline apply separately map fragment
      element chunks. `packages/runtime/src/wire-parser.test.ts`,
      `packages/runtime/src/inline-loader-parser-parity.test.ts`,
      `packages/runtime/src/inline-loader-build.test.ts`, and the regenerated
      `packages/runtime/src/inline-loader.ts` pin readable/minified helper parity and response
      behavior. Verified by `pnpm exec vitest --run packages/runtime/src/wire-parser.test.ts
packages/runtime/src/inline-loader-parser-parity.test.ts
packages/runtime/src/inline-loader-build.test.ts
packages/runtime/src/inline-loader-response-apply.test.ts`, `pnpm --filter @jiso/runtime run
check:inline-loader`, and browser runtime tests `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts
packages/runtime/src/query-hydration.browser.test.ts`. Broader/runtime gates:
      `pnpm exec vitest --run packages/runtime/src`; exact `pnpm exec vp check
packages/runtime/src/wire-parser.ts packages/runtime/src/wire-parser.test.ts
packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader-build.test.ts
packages/runtime/src/inline-loader-parser-parity.test.ts
packages/runtime/src/inline-loader-response-apply.test.ts
packages/runtime/src/inline-loader.ts plans/codebase-quality-round2.md`; `git diff --check`.
      Evidence 2026-06-13: DOM mutation response body parsing moved into
      `packages/runtime/src/mutation-response-dom.ts`; `packages/runtime/src/apply-mutation-response.ts`
      now owns only decoded `MutationResponseBodyChunks` apply, and the broad
      `packages/runtime/src/inline-loader.test.ts` no longer carries the redundant enhanced
      response round-trip already covered by inline enhanced-submit and response-apply suites.
      Verified by `pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts
packages/runtime/src/mutation-response-metadata.test.ts packages/runtime/src/mutation-apply.test.ts
packages/runtime/src/apply-deferred-stream.test.ts
packages/runtime/src/query-runtime-integration.test.ts packages/runtime/src/inline-loader.test.ts
packages/runtime/src/inline-loader-response-apply.test.ts
packages/runtime/src/inline-loader-enhanced-submit.test.ts
packages/runtime/src/index-exports.test.ts packages/runtime/src/morph.test.ts`,
      `pnpm --filter @jiso/runtime run check:inline-loader`, `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts
packages/runtime/src/query-hydration.browser.test.ts`, `pnpm exec vitest --run
packages/runtime/src`, exact `pnpm exec vp check packages/runtime/src/apply-mutation-response.ts
packages/runtime/src/mutation-response-dom.ts packages/runtime/src/index.ts
packages/runtime/src/mutation-apply.ts packages/runtime/src/apply-deferred-stream.ts
packages/runtime/src/index-exports.test.ts packages/runtime/src/mutation-response-metadata.test.ts
packages/runtime/src/morph.test.ts packages/runtime/src/inline-loader-response-apply.test.ts
packages/runtime/src/inline-loader.test.ts plans/codebase-quality-round2.md`, and
      `git diff --check`.
      Evidence 2026-06-13: `packages/runtime/src/wire-parser.ts` now decodes mutation-body and
      standalone `fw-fragment` element chunks through `readFragmentElementChunk`, and
      `packages/runtime/src/wire-parser.test.ts` pins target filtering plus append-mode parity
      between `readMutationResponseBodyChunks(body).fragments` and `readFragmentChunks(body)`.
      Verified by `pnpm exec vitest --run packages/runtime/src/wire-parser.test.ts
packages/runtime/src/mutation-response.test.ts packages/runtime/src/inline-loader-parser-parity.test.ts
packages/runtime/src/inline-loader-build.test.ts`, broader apply-adjacent checks `pnpm exec vitest
--run packages/runtime/src/wire-parser.test.ts packages/runtime/src/mutation-response.test.ts
packages/runtime/src/mutation-apply.test.ts packages/runtime/src/apply-deferred-stream.test.ts
packages/runtime/src/broadcast.test.ts`, `pnpm --filter @jiso/runtime run check:inline-loader`, and
      exact `pnpm exec vp check packages/runtime/src/wire-parser.ts
packages/runtime/src/wire-parser.test.ts plans/codebase-quality-round2.md`.
      Evidence 2026-06-13: the generated inline loader now extracts
      `readFragmentElementChunk` into the checked parser helper closure and applies decoded
      fragment chunks, so inline response apply no longer has a separate target/mode decoder from
      modular runtime apply. `packages/runtime/src/inline-loader-parser-parity.test.ts` pins the
      readable/minified parser root and `packages/runtime/src/inline-loader-response-apply.test.ts`
      keeps inline response effects in parity with `applyMutationResponseToDom`. Verified by
      `pnpm exec vitest --run packages/runtime/src/inline-loader-parser-parity.test.ts
packages/runtime/src/inline-loader-build.test.ts
packages/runtime/src/inline-loader-response-apply.test.ts
packages/runtime/src/inline-js-minifier.test.ts packages/runtime/src/wire-parser.test.ts`,
      `pnpm --filter @jiso/runtime run check:inline-loader`, `pnpm exec vitest --run
packages/runtime/src`, and browser runtime tests `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts
packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13: visible-return hydration/refetch coverage moved from
      `packages/runtime/src/query-refetch.test.ts` into
      `packages/runtime/src/query-visible-return.test.ts`; `packages/runtime/src/query-refetch.test.ts`
      now owns typed-read fetch/apply behavior, while `packages/runtime/src/query-visible-return.ts`
      exposes the hydration script reader so the installer tests pin the exact query-script source.
      Verified by `pnpm exec vitest --run packages/runtime/src/query-visible-return.test.ts
packages/runtime/src/query-refetch.test.ts`, `pnpm exec vitest --run packages/runtime/src`, and
      browser runtime tests `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13: `packages/runtime/src/query-runtime-integration.test.ts` was deleted
      after pagehide cleanup, derive input metadata, mutation response binding/compiled-plan/keyed
      apply, and deferred boundary-order cases moved to `packages/runtime/src/optimism.test.ts`,
      `packages/runtime/src/derive.test.ts`, `packages/runtime/src/mutation-response.test.ts`, and
      `packages/runtime/src/apply-deferred-stream.test.ts`. `packages/runtime/src/wire-parser.ts`
      now filters deferred stream parts with `readMutationResponseElementChunks` so deferred
      stream detection shares the modular/inline mutation element scanner. Verified by
      `pnpm exec vitest --run packages/runtime/src/wire-parser.test.ts
packages/runtime/src/apply-deferred-stream.test.ts packages/runtime/src/mutation-response.test.ts
packages/runtime/src/derive.test.ts packages/runtime/src/optimism.test.ts`,
      `pnpm exec vitest --run packages/runtime/src`, `pnpm --filter @jiso/runtime run
check:inline-loader`, and browser runtime tests `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts
packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13 round252: fragment chunk decoding now runs through the shared
      `readFragmentChunksFromElements` helper for mutation bodies, standalone fragment reads, and
      inline response bodies in `packages/runtime/src/wire-parser.ts`; regenerated
      `packages/runtime/src/inline-loader.ts` includes that helper in the extracted parser closure,
      pinned by `packages/runtime/src/inline-loader-parser-parity.test.ts`. Decoded mutation apply
      coverage moved from `packages/runtime/src/mutation-response.test.ts` into
      `packages/runtime/src/mutation-response-apply.test.ts`. Verified by `pnpm exec vitest --run
packages/runtime/src/wire-parser.test.ts packages/runtime/src/mutation-response.test.ts
packages/runtime/src/mutation-response-apply.test.ts
packages/runtime/src/inline-loader-parser-parity.test.ts
packages/runtime/src/inline-loader-build.test.ts
packages/runtime/src/inline-loader-response-apply.test.ts
packages/runtime/src/inline-js-minifier.test.ts`, `pnpm exec vitest --run packages/runtime/src`,
      `pnpm --filter @jiso/runtime run check:inline-loader`, and browser runtime tests `pnpm exec
vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts
packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13 round253: `packages/runtime/src/wire-parser.ts` no longer exports
      `readFragmentElementChunk` or `malformedFragmentError`; `packages/runtime/src/wire-parser.test.ts`
      pins that private parser boundary while the inline-loader extractor still consumes the helper
      closure from source. Verified by `pnpm exec vitest --run packages/runtime/src/wire-parser.test.ts
packages/runtime/src/inline-loader-parser-parity.test.ts
packages/runtime/src/inline-loader-build.test.ts
packages/runtime/src/inline-loader-response-apply.test.ts
packages/runtime/src/inline-js-minifier.test.ts`, `pnpm exec vitest --run packages/runtime/src`,
      `pnpm --filter @jiso/runtime run check:inline-loader`, `pnpm exec tsc --noEmit --pretty
false`, and browser runtime tests `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13 round254: `parseHandlerReference` and `parseHandlerReferences` were
      removed from the runtime root barrel and made private in `packages/runtime/src/handlers.ts`.
      New `packages/runtime/src/handlers.test.ts` proves chained `url#export` dispatch and malformed
      reference rejection through `dispatchDelegatedEvent`; the direct parser assertion was removed
      from `packages/runtime/src/delegated-runtime-integration.test.ts`, and
      `packages/runtime/src/index-exports.test.ts` pins the negative public export boundary.
      Verified by `pnpm exec vitest --run packages/runtime/src/handlers.test.ts
packages/runtime/src/delegated-runtime-integration.test.ts
packages/runtime/src/index-exports.test.ts`, `pnpm exec vitest --run packages/runtime/src`,
      `pnpm --filter @jiso/runtime run check:inline-loader`, browser runtime tests `pnpm exec
vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts
packages/runtime/src/query-hydration.browser.test.ts`, `pnpm exec tsc --noEmit --pretty false`,
      exact `pnpm exec vp check packages/runtime/src/handlers.ts
packages/runtime/src/handlers.test.ts packages/runtime/src/index.ts
packages/runtime/src/index-exports.test.ts
packages/runtime/src/delegated-runtime-integration.test.ts plans/codebase-quality-round2.md`, and
      `git diff --check`.
      Evidence 2026-06-13 round255: `packages/runtime/src/mutation-response.test.ts` was deleted
      after parsed wire-body store apply coverage moved to
      `packages/runtime/src/mutation-response-wire-apply.test.ts` and DOM response body apply
      coverage moved to `packages/runtime/src/mutation-response-dom.test.ts`; decoded pre-parsed
      chunk apply remains in `packages/runtime/src/mutation-response-apply.test.ts`. The root
      runtime barrel also stopped re-exporting the compatibility-only `ApplyQueryInterposition`
      type alias, and `packages/runtime/src/apply-mutation-response.ts` now refers directly to the
      canonical query apply interposition type. Verified by `pnpm exec vitest --run
packages/runtime/src/mutation-response-wire-apply.test.ts
packages/runtime/src/mutation-response-dom.test.ts
packages/runtime/src/mutation-response-apply.test.ts packages/runtime/src/index-exports.test.ts`
      and `pnpm exec vitest --run packages/runtime/src`; `pnpm --filter @jiso/runtime run
check:inline-loader`; browser runtime tests `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts
packages/runtime/src/query-hydration.browser.test.ts`; `pnpm exec tsc --noEmit --pretty false`;
      exact `pnpm exec vp check packages/runtime/src/apply-mutation-response.ts
packages/runtime/src/index.ts packages/runtime/src/index-exports.test.ts
packages/runtime/src/mutation-response-wire-apply.test.ts
packages/runtime/src/mutation-response-dom.test.ts
packages/runtime/src/mutation-response-apply.test.ts plans/codebase-quality-round2.md`; and
      `git diff --check`.
      Evidence 2026-06-13 round262: loader-level visible-return refetch integration moved from
      `packages/runtime/src/query-store.test.ts` into
      `packages/runtime/src/loader-visible-return-refetch.test.ts`, leaving `query-store.test.ts`
      as the pure query-store owner while loader hydration/refetch still pins enhanced mutation,
      broadcast replay, keyed query, and inserted script drift. Verified by `pnpm exec vitest --run
packages/runtime/src/query-store.test.ts packages/runtime/src/loader-visible-return-refetch.test.ts`,
      full runtime `pnpm exec vitest --run packages/runtime/src`, browser runtime `pnpm exec vitest
      --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts
      packages/runtime/src/query-hydration.browser.test.ts`, and `git diff --check`.
      Evidence 2026-06-13 round263: `packages/runtime/src/loader.ts` now threads the configured
      `applyQuery` hook into initial script hydration, visible-return script hydration, typed-read
      refetch, and inline `jiso:query` hydration through `query-visible-return.ts`,
      `query-refetch.ts`, and `query-events.ts`. New
      `packages/runtime/src/loader-query-apply-interposition.test.ts` pins the fake-root loader
      boundary, and `packages/runtime/src/query-hydration.browser.test.ts` pins the browser inline
      hydration path. Verified by the focused runtime, full runtime, browser runtime, TypeScript,
      inline-loader, exact `vp check`, and `git diff --check` commands listed in Latest evidence.
      Evidence 2026-06-13 round264: `packages/runtime/src/loader.ts` now forwards loader-level
      `applyQuery` into `enhancedMutations`, `packages/runtime/src/mutation-submit.ts` and
      `packages/runtime/src/mutation-apply.ts` thread it through enhanced submit response apply,
      and `packages/runtime/src/broadcast.ts` threads it through default BroadcastChannel replay.
      `packages/runtime/src/loader-query-apply-interposition.test.ts` pins enhanced-submit and
      broadcast replay interposition before DOM binding/morph effects. Verified by focused runtime,
      full runtime, inline-loader, browser runtime, exact `vp check`, and `git diff --check`
      commands listed in Latest evidence.
      Evidence 2026-06-13 round265: minified inline response apply parity now has a direct owner
      suite in `packages/runtime/src/inline-loader-minified-response-apply.test.ts`, with the shared
      response fixture extracted to `packages/runtime/src/inline-loader-response-apply-fixture.ts`.
      The focused suite proves the freshly minified inline loader keeps enhanced mutation response
      query events and fragment effects in parity with `applyMutationResponseToDom`; the existing
      artifact-wide response suite still covers readable, minified, generated-bootstrap, and
      extracted installer sources. Verified by focused runtime and full runtime commands listed in
      Latest evidence.
      Evidence 2026-06-13 round271: delegated handler parity moved from
      `packages/runtime/src/inline-loader.test.ts` into
      `packages/runtime/src/inline-loader-delegated.test.ts`, leaving the broad inline-loader source
      suite focused on generated import-expression installation. Minified shipped-artifact pins
      moved from `packages/runtime/src/inline-loader-build.test.ts` into
      `packages/runtime/src/inline-loader-artifact-minifier.test.ts`, leaving build coverage focused
      on readable/module emission, package scripts, syntax rejection, gzip budget rejection, and
      custom bootstrap expression trimming. Verified by focused inline-loader/minifier tests, full
      runtime tests, inline-loader generation check, TypeScript, browser runtime tests, targeted
      `vp check`, and `git diff --check` commands listed in Latest evidence.
      Evidence 2026-06-13 round273: `packages/runtime/src/inline-loader-build.ts` now drives
      inline wire-parser and response-apply extraction/parity checks through one helper-spec path,
      so readable/minified embed checks no longer maintain duplicated parser/apply plumbing.
      `packages/runtime/src/inline-loader-artifact-minifier.test.ts` splits shipped minified
      artifact assertions into parser and response-apply owner checks. Verified by focused
      inline-loader/minifier tests, full runtime tests, inline-loader generation check, TypeScript,
      browser runtime tests, exact `vp check`, and `git diff --check` commands listed in Latest
      evidence.
      Evidence 2026-06-13 round274: readable response-apply generation plus readable/minified
      response-apply embed drift assertions moved from
      `packages/runtime/src/inline-loader-parser-parity.test.ts` into
      `packages/runtime/src/inline-loader-response-apply.test.ts`. The parser parity suite now
      owns parser-helper generation/extraction only, while response-apply behavior and helper
      embed parity share one owner. Verified by focused inline parser/apply/minifier/build tests,
      inline-loader generation check, browser runtime tests, exact `vp check`, and `git diff
      --check` commands listed in Latest evidence.
      Evidence 2026-06-13 round285: the decoded fragment apply primitive moved to
      `packages/runtime/src/response-fragment-apply.ts`, so modular morph no longer imports the
      generic helper through the inline response-apply module. `packages/runtime/src/morph.ts` and
      `packages/runtime/src/inline-response-apply.ts` now share that helper, while
      `packages/runtime/src/inline-loader-build.ts` bundles the neutral helper source into the
      self-contained inline response-apply closure before readable/minified parity checks.
      `packages/runtime/src/response-fragment-apply.test.ts` pins replace, append, and missing
      target behavior. Verified by focused response-apply/morph/runtime tests, full runtime tests,
      inline-loader generation check, browser runtime tests, exact `vp check`, and `git diff
      --check` commands listed in Latest evidence.
- [x] Split browser query hydration and inline query-event coverage out of
      `packages/runtime/src/index.browser.test.ts`.
      Evidence: `packages/runtime/src/query-hydration.browser.test.ts` covers inserted
      hydrated scripts, malformed script recovery, inline `jiso:query` events, store writes,
      visible-return refetch keys, and DOM binding updates.
- [ ] Re-run browser runtime tests after each apply/loader surface change.
      Evidence 2026-06-13: browser runtime checks passed after the loader test split. Command:
      `pnpm exec vitest --config vitest.browser.config.ts --run`; files:
      `packages/runtime/src/index.browser.test.ts` and
      `packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13 round252: browser runtime checks passed after the shared fragment
      decoder/inline-loader extraction change. Command: `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts
packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13 round253: browser runtime checks passed after the fragment element
      parser helper exports were narrowed. Command: `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts
packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13: browser runtime checks passed after readable loader parser-generation
      and parser-parity test split. Command: `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts
packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13: browser runtime checks passed after the inline enhanced-submit test
      split. Command: `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13: browser runtime checks passed after hydrated query script ledgers moved
      to one decoded runtime batch per hydration pass. Command: `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/query-hydration.browser.test.ts
packages/runtime/src/index.browser.test.ts`.
      Evidence 2026-06-13: browser runtime checks passed after the inline response scanner moved
      to the shared `readMutationResponseElementChunks` helper. Command: `pnpm exec vitest
--config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts
packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13: browser runtime checks passed after fragment element decoding was
      unified behind `readFragmentElementChunk` for mutation-body and standalone fragment readers.
      Command: `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13: browser runtime checks passed after inline response body parsing was
      split from decoded chunk application in the generated loader. Command: `pnpm exec vitest
--config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts
packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13: browser runtime checks passed after inline fragment apply moved to the
      shared decoded `readFragmentElementChunk` helper. Command: `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts
packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13: browser runtime checks passed after visible-return hydration/refetch
      coverage moved into `packages/runtime/src/query-visible-return.test.ts` and the hydration
      script reader became an explicit runtime seam. Command: `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts
packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13: browser runtime checks passed after deferred stream part detection moved
      to `readMutationResponseElementChunks` and `query-runtime-integration.test.ts` was split into
      owner suites. Command: `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13 round255: browser runtime checks passed after mutation response apply
      coverage split into wire-body and DOM owner suites and the root runtime type alias surface was
      narrowed. Command: `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13 round262: browser runtime checks passed after loader visible-return
      refetch integration coverage moved into its own owner suite. Command: `pnpm exec vitest
      --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts
      packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13 round263: browser runtime checks passed after the loader query
      `applyQuery` hook was threaded through browser inline hydration. Command: `pnpm exec vitest
      --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts
      packages/runtime/src/query-hydration.browser.test.ts`.
      Evidence 2026-06-13 round264: browser runtime checks passed after loader-level `applyQuery`
      was threaded through enhanced submit and default broadcast replay. Command: `pnpm exec vitest
      --run --config vitest.browser.config.ts packages/runtime/src/**/*.browser.test.ts`.
      Evidence 2026-06-13 round265: browser runtime checks passed after the minified inline
      response apply parity split. Command: `pnpm exec vitest --run --config
      vitest.browser.config.ts packages/runtime/src/**/*.browser.test.ts`.
      Evidence 2026-06-13 round271: browser runtime checks passed after the inline delegated
      handler and minified artifact test ownership split. Command: `pnpm exec vitest --run --config
      vitest.browser.config.ts packages/runtime/src/**/*.browser.test.ts`.
      Evidence 2026-06-13 round273: browser runtime checks passed after the shared inline helper
      extraction/parity cleanup and minified artifact parser/apply test split. Command: `pnpm exec
      vitest --run --config vitest.browser.config.ts packages/runtime/src/**/*.browser.test.ts`.
      Evidence 2026-06-13 round274: browser runtime checks passed after moving response-apply
      extractor/parity assertions into the response-apply owner suite. Command: `pnpm exec vitest
      --run --config vitest.browser.config.ts packages/runtime/src/**/*.browser.test.ts`.
      Evidence 2026-06-13 round285: browser runtime checks passed after neutral fragment apply
      helper extraction and inline response-apply closure bundling. Command: `pnpm exec vitest
      --run --config vitest.browser.config.ts packages/runtime/src/**/*.browser.test.ts`.

Latest evidence:

- Runtime root DOM body parser export removal:
  `pnpm exec vitest --run packages/runtime/src/index-exports.test.ts packages/runtime/src/mutation-response-apply.test.ts packages/runtime/src/delegated-runtime-integration.test.ts packages/runtime/src/morph.test.ts`;
  `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/mutation-response-dom.browser.test.ts`;
  exact `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/index-exports.test.ts packages/runtime/src/mutation-apply.ts packages/runtime/src/delegated-runtime-integration.test.ts packages/runtime/src/mutation-response-dom.browser.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
  Evidence: `packages/runtime/src/index.ts` no longer exports `applyMutationResponseToDom` or
  `ApplyMutationResponseToDomOptions`; callers and internal tests import
  `packages/runtime/src/mutation-response-dom.ts` directly, while
  `packages/runtime/src/index-exports.test.ts` type-pins the removed root compatibility export
  against regression under SPEC.md §4.4/§9.1.
- Round297 runtime fragment type ownership closure:
  `pnpm exec vitest --run packages/runtime/src/wire-parser.test.ts packages/runtime/src/mutation-response-apply.test.ts packages/runtime/src/morph.test.ts packages/runtime/src/index-exports.test.ts`;
  exact `pnpm exec vp check packages/runtime/src/wire-parser.ts packages/runtime/src/wire-parser.test.ts packages/runtime/src/index.ts packages/runtime/src/apply-mutation-response.ts packages/runtime/src/morph.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
  Evidence: `packages/runtime/src/wire-parser.ts` no longer re-exports the `FragmentChunk`
  compatibility type; root `@jiso/runtime` keeps the public type from the canonical
  `packages/runtime/src/wire-response-scanner.ts` owner, and `packages/runtime/src/wire-parser.test.ts`
  type-pins the removed parser alias against regression under SPEC.md §4.4/§9.1.
- Round287c runtime fragment adapter closure:
  `pnpm exec vitest --run packages/runtime/src/response-fragment-apply.test.ts packages/runtime/src/inline-loader-response-apply.test.ts packages/runtime/src/inline-loader-artifact-minifier.test.ts`;
  `pnpm exec vitest --run packages/runtime/src/mutation-response-dom.test.ts packages/runtime/src/mutation-response-apply.test.ts packages/runtime/src/mutation-response-wire-apply.test.ts packages/runtime/src/inline-loader-enhanced-submit.test.ts packages/runtime/src/inline-loader-build.test.ts packages/runtime/src/inline-loader-parser-parity.test.ts`;
  `pnpm exec vitest --run packages/runtime/src`;
  `pnpm run check:inline-loader`;
  `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/mutation-response-dom.browser.test.ts packages/runtime/src/loader.browser.test.ts packages/runtime/src/query-hydration.browser.test.ts`;
  exact `pnpm exec vp check packages/runtime/src/response-fragment-apply.ts packages/runtime/src/response-fragment-apply.test.ts packages/runtime/src/inline-response-apply.ts packages/runtime/src/inline-loader-response-apply.test.ts packages/runtime/src/inline-loader-artifact-minifier.test.ts packages/runtime/src/inline-loader.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
  Evidence: `packages/runtime/src/response-fragment-apply.ts` now owns
  `applyHtmlResponseFragments` and the HTML append/replace adapter used by the extracted SPEC.md
  §4.4/§9.1 inline response apply closure; `packages/runtime/src/inline-response-apply.ts`
  delegates decoded fragments to that shared helper, and the regenerated
  `packages/runtime/src/inline-loader.ts` pins the shared helper in the minified bootstrap.
- Round253 private fragment parser surface:
  `pnpm exec vitest --run packages/runtime/src/wire-parser.test.ts
packages/runtime/src/inline-loader-parser-parity.test.ts
packages/runtime/src/inline-loader-build.test.ts
packages/runtime/src/inline-loader-response-apply.test.ts
packages/runtime/src/inline-js-minifier.test.ts`;
  `pnpm exec vitest --run packages/runtime/src`;
  `pnpm --filter @jiso/runtime run check:inline-loader`;
  `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts packages/runtime/src/query-hydration.browser.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`;
  exact `pnpm exec vp check packages/runtime/src/wire-parser.ts
packages/runtime/src/wire-parser.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- `pnpm exec vitest --run packages/runtime/src/wire-parser.test.ts packages/runtime/src/inline-loader-parser-parity.test.ts packages/runtime/src/inline-loader-build.test.ts packages/runtime/src/inline-loader-response-apply.test.ts`
- `pnpm exec vitest --run packages/runtime/src`
- `pnpm --filter @jiso/runtime run check:inline-loader`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts packages/runtime/src/query-hydration.browser.test.ts`
- exact `pnpm exec vp check packages/runtime/src/wire-parser.ts packages/runtime/src/wire-parser.test.ts packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader-build.test.ts packages/runtime/src/inline-loader-parser-parity.test.ts packages/runtime/src/inline-loader-response-apply.test.ts packages/runtime/src/inline-loader.ts plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/runtime/src/wire-parser.test.ts packages/runtime/src/apply-deferred-stream.test.ts packages/runtime/src/mutation-response.test.ts packages/runtime/src/derive.test.ts packages/runtime/src/optimism.test.ts`
- `pnpm exec vitest --run packages/runtime/src`
- `pnpm --filter @jiso/runtime run check:inline-loader`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts packages/runtime/src/query-hydration.browser.test.ts`
- `pnpm exec vitest --run packages/runtime/src/index.test.ts packages/runtime/src/delegated-runtime-integration.test.ts`
- `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts`
- `pnpm exec vitest --run packages/runtime/src`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm --filter @jiso/runtime run check:inline-loader`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts packages/runtime/src/mutation-apply.test.ts packages/runtime/src/apply-deferred-stream.test.ts packages/runtime/src/broadcast.test.ts packages/runtime/src/index-exports.test.ts`
- `pnpm exec vitest --run packages/runtime/src`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm --filter @jiso/runtime run check:inline-loader`
- `pnpm exec tsc --noEmit --pretty false`
- exact `pnpm exec vp check packages/runtime/src/apply-mutation-response.ts packages/runtime/src/mutation-apply.ts packages/runtime/src/apply-deferred-stream.ts packages/runtime/src/broadcast.ts packages/runtime/src/mutation-response.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- exact `pnpm exec vp check packages/runtime/src/apply-mutation-response.ts packages/runtime/src/mutation-apply.ts packages/runtime/src/broadcast.ts packages/runtime/src/apply-deferred-stream.ts packages/runtime/src/mutation-response.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `pnpm exec vp check packages/runtime/src/index.test.ts packages/runtime/src/delegated-runtime-integration.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/runtime/src/query-events.test.ts packages/runtime/src/query-apply.test.ts packages/runtime/src/query-runtime-integration.test.ts`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/query-hydration.browser.test.ts packages/runtime/src/index.browser.test.ts`
- `pnpm --filter @jiso/runtime run check:inline-loader`
- `git diff --check`
- `pnpm exec vitest --run packages/runtime/src/query-apply.test.ts packages/runtime/src/wire-parser.test.ts`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/query-hydration.browser.test.ts packages/runtime/src/index.browser.test.ts`
- `pnpm exec vitest --run packages/runtime/src`
- exact `pnpm exec vp check packages/runtime/src/query-apply.ts packages/runtime/src/query-apply.test.ts packages/runtime/src/wire-parser.ts plans/codebase-quality-round2.md`
- Round263 loader query apply interposition:
  `pnpm exec vitest --run packages/runtime/src/loader-query-apply-interposition.test.ts packages/runtime/src/query-script-hydration.test.ts packages/runtime/src/query-refetch.test.ts packages/runtime/src/query-events.test.ts packages/runtime/src/loader-query-hydration.test.ts`;
  `pnpm exec vitest --run packages/runtime/src`;
  `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts packages/runtime/src/query-hydration.browser.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`;
  `pnpm --filter @jiso/runtime run check:inline-loader`;
  exact `pnpm exec vp check packages/runtime/src/loader.ts packages/runtime/src/loader-query-apply-interposition.test.ts packages/runtime/src/query-visible-return.ts packages/runtime/src/query-refetch.ts packages/runtime/src/query-events.ts packages/runtime/src/query-script-hydration.ts packages/runtime/src/query-hydration.browser.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round264 loader mutation apply interposition:
  `pnpm exec vitest --run packages/runtime/src/loader-query-apply-interposition.test.ts packages/runtime/src/mutation-apply.test.ts packages/runtime/src/mutation-submit.test.ts packages/runtime/src/broadcast.test.ts`;
  `pnpm exec vitest --run packages/runtime/src`;
  `pnpm --filter @jiso/runtime run check:inline-loader`;
  `pnpm exec vitest --run --config vitest.browser.config.ts packages/runtime/src/**/*.browser.test.ts`;
  exact `pnpm exec vp check packages/runtime/src/loader.ts packages/runtime/src/broadcast.ts packages/runtime/src/mutation-submit.ts packages/runtime/src/mutation-apply.ts packages/runtime/src/loader-query-apply-interposition.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round265 minified inline response apply closure:
  `pnpm exec vitest --run packages/runtime/src/inline-loader-response-apply.test.ts packages/runtime/src/inline-loader-minified-response-apply.test.ts packages/runtime/src/inline-loader-parser-parity.test.ts packages/runtime/src/inline-loader-build.test.ts packages/runtime/src/inline-js-minifier.test.ts packages/runtime/src/loader-query-apply-interposition.test.ts packages/runtime/src/mutation-submit.test.ts packages/runtime/src/broadcast.test.ts`;
  `pnpm exec vitest --run packages/runtime/src`;
  `pnpm --filter @jiso/runtime run check:inline-loader`;
  `pnpm exec vitest --run --config vitest.browser.config.ts packages/runtime/src/**/*.browser.test.ts`;
  exact `pnpm exec vp check packages/runtime/src/inline-loader-response-apply.test.ts packages/runtime/src/inline-loader-minified-response-apply.test.ts packages/runtime/src/inline-loader-response-apply-fixture.ts packages/runtime/src/inline-loader-test-utils.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round271 inline-loader delegated/minified artifact test ownership:
  `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/inline-loader-delegated.test.ts packages/runtime/src/inline-loader-artifact-minifier.test.ts packages/runtime/src/inline-loader-build.test.ts packages/runtime/src/inline-loader-response-apply.test.ts packages/runtime/src/inline-loader-parser-parity.test.ts packages/runtime/src/inline-js-minifier.test.ts`;
  `pnpm exec vitest --run packages/runtime/src`;
  `pnpm --filter @jiso/runtime run check:inline-loader`;
  `pnpm exec vitest --run --config vitest.browser.config.ts packages/runtime/src/**/*.browser.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`;
  exact `pnpm exec vp check packages/runtime/src/inline-loader.test.ts packages/runtime/src/inline-loader-delegated.test.ts packages/runtime/src/inline-loader-build.test.ts packages/runtime/src/inline-loader-artifact-minifier.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round273 inline helper parity cleanup:
  `pnpm exec vitest --run packages/runtime/src/inline-loader-parser-parity.test.ts packages/runtime/src/inline-loader-artifact-minifier.test.ts packages/runtime/src/inline-loader-build.test.ts packages/runtime/src/inline-loader-response-apply.test.ts packages/runtime/src/inline-js-minifier.test.ts`;
  `pnpm exec vitest --run packages/runtime/src`;
  `pnpm --filter @jiso/runtime run check:inline-loader`;
  `pnpm exec vitest --run --config vitest.browser.config.ts packages/runtime/src/**/*.browser.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`;
  exact `pnpm exec vp check packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader-artifact-minifier.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round274 inline response-apply parity ownership:
  `pnpm exec vitest --run packages/runtime/src/inline-loader-parser-parity.test.ts packages/runtime/src/inline-loader-response-apply.test.ts packages/runtime/src/inline-loader-artifact-minifier.test.ts packages/runtime/src/inline-loader-build.test.ts packages/runtime/src/inline-js-minifier.test.ts`;
  `pnpm --filter @jiso/runtime run check:inline-loader`;
  `pnpm exec vitest --run --config vitest.browser.config.ts packages/runtime/src/**/*.browser.test.ts`;
  exact `pnpm exec vp check packages/runtime/src/inline-loader-parser-parity.test.ts packages/runtime/src/inline-loader-response-apply.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round285 neutral response fragment apply helper:
  `pnpm exec vitest --run packages/runtime/src/response-fragment-apply.test.ts packages/runtime/src/inline-loader-response-apply.test.ts packages/runtime/src/inline-loader-build.test.ts packages/runtime/src/inline-loader-artifact-minifier.test.ts packages/runtime/src/morph.test.ts packages/runtime/src/mutation-response-dom.test.ts`;
  `pnpm exec vitest --run packages/runtime/src`;
  `pnpm run check:inline-loader`;
  `pnpm exec vitest --run --config vitest.browser.config.ts packages/runtime/src/**/*.browser.test.ts`;
  exact `pnpm exec vp check packages/runtime/src/response-fragment-apply.ts packages/runtime/src/response-fragment-apply.test.ts packages/runtime/src/inline-response-apply.ts packages/runtime/src/morph.ts packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader-response-apply.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round286 response fragment batch apply closure:
  `pnpm exec vitest --run packages/runtime/src/response-fragment-apply.test.ts packages/runtime/src/morph.test.ts packages/runtime/src/inline-loader-response-apply.test.ts packages/runtime/src/inline-loader-artifact-minifier.test.ts packages/runtime/src/inline-loader-build.test.ts packages/runtime/src/mutation-response-dom.test.ts packages/runtime/src/mutation-response-apply.test.ts`;
  `pnpm exec vitest --run packages/runtime/src`;
  `pnpm run check:inline-loader`;
  `pnpm exec vitest --run --config vitest.browser.config.ts packages/runtime/src/**/*.browser.test.ts`;
  exact `pnpm exec vp check packages/runtime/src/response-fragment-apply.ts packages/runtime/src/response-fragment-apply.test.ts packages/runtime/src/inline-response-apply.ts packages/runtime/src/inline-loader-response-apply.test.ts packages/runtime/src/inline-loader-artifact-minifier.test.ts packages/runtime/src/inline-loader.ts packages/runtime/src/morph.ts plans/codebase-quality-round2.md`;
  `git diff --check`; `git diff --cached --check`.

## Phase 5 - Server And App Shell

Current state: static export output target planning, output staging, asset planning, Vite build
output, synthetic replay requests, route-document replay, client-module replay, app request
document assembly, mutation request handling, and SPEC §9.5 dispatch branches have been split into
focused modules. Static export replay preserves one SPEC §9.5 route/client export pipeline:
`static-export-request.ts` owns synthetic GET construction, `static-export-response.ts` owns
route/client response snapshots and FW229 response diagnostics, `static-export-document.ts` owns
route artifact assembly and L0/L1 server endpoint rejection, and
`static-export-client-modules.ts` owns discovered `/c/` module replay and dedupe.
Static export diagnostics have a focused owner for compile-diagnostic blocking, FW229 formatting,
type guards, and `StaticExportError`, leaving static-export types for artifact/manifest shapes.
The create-jiso starter imports app-shell dev/export/static-export helpers from public subpaths and
includes a static preview task that serves exported `dist` output without Vite source fallback;
the preview serves exported files for `GET`/`HEAD` only and rejects unsupported methods before any
dynamic app route fallback.
Commerce Vite dev/export adoption now uses the public `@jiso/server/app-shell/vite` and
`@jiso/server/app-shell/static-export` subpaths instead of the root package app-shell aliases.
Commerce app-shell source also imports client-module registry, core request-shell, node adapter,
and static export helpers from those public app-shell subpaths, leaving root imports for
non-app-shell data/routing helpers.
Commerce app-shell adoption now proves dynamic node/http documents, query endpoints, client
modules, and command-exported static output over HTTP rather than package-internal request or
mutation shortcuts.
The root `@jiso/server` app-shell compatibility surface now star-forwards directly from the split
public app-shell owner subpaths instead of duplicating a manual symbol inventory; the public API
test compares local/package app-shell aggregate values and root aliases so split-owner drift is
observable through module behavior.
The root `@jiso/server` app-shell compatibility surface is now narrowed to the CLI's static export
entry point plus type-only static-export/app contracts; app-shell core, node, client-module, Vite,
manifest, diagnostic, and output-plan helpers resolve only through `@jiso/server/app-shell/*`
subpaths.
The `@jiso/server/app-shell/static-export` subpath now forwards diagnostics, manifest/inventory,
and output-plan helpers from their split owners instead of routing those names through the
aggregate `static-export.ts` facade.
Static export option/result contracts now live with the artifact/manifest types in
`static-export-types.ts`, so Vite build/static-export helpers no longer import type-only
contracts through the `static-export.ts` orchestrator facade.
Static export option normalization now lives in `static-export-options.ts`: replay consumes that
owner for html path-style FW229 diagnostics, `static-export-types.ts` remains data/option shapes,
and `StaticExportNonExportablePolicy` is the single public policy type exported through app-shell
static-export subpaths.
The `@jiso/server/app-shell` aggregate compatibility subpath has been removed after starter,
commerce, and docs adoption pinned the split public app-shell subpaths. The public API test now
proves only `client-modules`, `core`, `node`, `static-export`, and `vite` remain exported app-shell
package subpaths, so R5/R6/R7 consumers cannot drift back to the aggregate barrel.
The internal `static-export.ts` orchestration facade now exports only `exportStaticApp`;
compile/static-export diagnostics, manifest/inventory helpers, and output-plan helpers stay on
their focused owner modules and the public `@jiso/server/app-shell/static-export` replacement seam.
The root `@jiso/server` surface now forwards SPEC §9.5 `createApp()` and
`createRequestHandler(app)` from the app-core owner plus the CLI `exportStaticApp` alias from the
focused static-export orchestrator. The built-root acceptance harness boundary also explicitly
keeps `createMemoryVersionedClientModuleRegistry()` and `toNodeHandler()` from their focused
client-module/node owners, while the aggregate `@jiso/server/app-shell` compatibility subpath
stays deleted. Public API tests pin the exact root value surface and prove document/data
query-script aliases share the single `wire-html.ts` emitter while static-export diagnostic helpers
resolve to `static-export-diagnostics.ts`.
App-shell app contracts now live in `packages/server/src/app-types.ts`, so app dispatch,
document, mutation, static-export replay/request/document/route-plan, node, and Vite modules no
longer type-import through the `app.ts` constructor facade; `@jiso/server/app-shell/core` re-exports
those public types from the focused owner while `app.ts` stays limited to construction and
`Request -> Response` handler creation.
Vite app-shell build output now returns the same compiled `/c/` module output plan that its staged
writer commits, giving plugin `onBuild` consumers one observable target plan for build/static-export
adoption. Vite app-shell build output also reuses one planned SPEC §9.5 static-export asset list
for both `staticExportAssets` and the write export, so custom `staticExport.assets` no longer
diverge between the observable plan and exported files. Vite plugin `writeBundle`
build/static-export execution now lives in a focused helper exported from the public app-shell Vite
subpath, leaving the plugin module focused on middleware and hook delegation. Vite static export
inventory/manifest option helpers now reject `outDir` with FW229 instead of silently dropping write
targets, so R6 dry-run preview/export introspection cannot be mistaken for an output write path.
Vite build-output static-export option projection now also lives in
`packages/server/src/vite-static-export-options.ts`, so plugin-time output writes, direct Vite
export, and inventory/manifest helpers share the same SPEC §9.5 asset/option owner while
`vite-build-output.ts` consumes the projected write plan.
Vite app-shell export tasks that need both write output and manifest evidence now use
`exportJisoAppShellViteBuildWithManifest()` or its manifest-file variant, so the public Vite
subpath owns the dry-run manifest/write-export consistency check for starter, commerce, and docs
adoption instead of each consumer hand-wiring duplicate calls.
The Vite static-export result proof now lives in `packages/server/src/vite-static-export-result.ts`:
that boundary converts dry-run replay to a manifest, runs the write replay, and asserts both
surfaces match for SPEC §9.5 Vite export tasks.
Vite build-backed export replay now lives in `packages/server/src/vite-static-export-build.ts`,
while manifest-file export wrappers live in `packages/server/src/vite-static-export-manifest-file.ts`;
the old internal `vite-static-export.ts` compatibility facade is deleted, and the app-shell Vite
public API test pins that subpath to the focused owners.
Static export inventory/manifest projection now lives in `packages/server/src/static-export-result.ts`
and response-header snapshots in `static-export-headers.ts`, leaving `static-export-types.ts` as a
type/contract module while the app-shell static-export public subpath forwards from the focused
result owner. Static export replay response validation now lives in
`packages/server/src/static-export-response.ts`, so route documents and `/c/` client modules share
one SPEC §9.5 status/content-type/body snapshot path while `static-export-request.ts`,
`static-export-document.ts`, and `static-export-client-modules.ts` own request construction,
document artifact assembly, and client-module replay/dedupe respectively.
Docs-site app-shell adoption now has a build-authored `.jiso-site-routes.json` route manifest:
`site/scripts/build.mjs` records the exact HTML routes it writes, and `site/scripts/app-shell.mjs`
uses that manifest for SPEC §9.5 export replay before falling back to recursive fixture discovery,
so stale `index.html` files in `dist` cannot silently become exported docs routes.
Docs-site export now also composes public app-shell helpers from the focused client-modules, core,
static-export, and Vite subpaths instead of the aggregate app-shell compatibility module; its
adoption test rejects accidental aggregate loading while proving manifest-backed static replay.
Docs-site export now checks the manifest-file dry-run claim against the written static export
result through the public `@jiso/server/app-shell/static-export` result helper before reporting
SPEC §9.5 export-task evidence.
Static export document reference discovery now distinguishes real opening-tag attributes from
comments/declarations and raw-text element bodies, so SPEC §9.5 L0/L1 endpoint rejection and
`/c/` module copy planning do not treat code/data examples as live exported document refs.
The public app-shell Vite subpaths now expose only the singular built-stylesheet manifest helper;
the plural `jisoAppShellViteManifestStylesheetHrefs*` compatibility helpers are private/deleted,
and server/starter/commerce/docs adoption tests pin the singular helper for SPEC §9.5 export-task
stylesheet evidence.
The runtime `isJisoApp()` guard for dynamically loaded app-shell modules now lives in the server
app-shell core boundary and is reused by Vite dev plus starter/commerce static export tasks, so
those consumers no longer carry local app-shape compatibility helpers.
The shared guard now also rejects dynamic app exports that are missing the closed `createApp()`
aggregate's document/error-shell owners, and starter/commerce export tasks require their explicit
public app exports instead of falling back to stale named-app or shell-object compatibility aliases.
The public app-shell Vite boundary now keeps the generic `createJisoAppShellBuild()`/`routeEntries`
constructor internal to the server build owner; public consumers use the Vite-specific
`createJisoAppShellViteBuild()` route-entry-map path for manifest hint/base wiring.

- [x] Continue subtractive extraction until `packages/server/src/index.ts`, Vite, static export,
      replay, document, and app boundaries are small and obvious.
- [x] Finish R5/R6/R7 closure: Vite build/static export/adoption should be proven through server,
      commerce, and starter surfaces.
- [x] Keep one wire-html emitter and one compile/static-export diagnostic seam.
- [x] Delete dead compatibility modules and aliases as soon as tests pin the public replacement.

Latest evidence:

- Static export output root boundary:
  `pnpm exec vitest --run packages/server/src/static-export-output.test.ts packages/server/src/static-export.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`; exact `pnpm exec vp check
packages/server/src/static-export-output.ts packages/server/src/static-export-output.test.ts
packages/server/src/static-export.ts packages/server/src/static-export.test.ts plans/app-shell.md
plans/codebase-quality-round2.md`; `git diff --check`.
  Evidence: `packages/server/src/static-export-output.ts` now shares a
  `staticExportOutputRoot()` guard that accepts filesystem paths and `file:` URLs but rejects
  non-file URL output directories with FW229, and `packages/server/src/static-export.ts` calls the
  guard before SPEC §9.5 synthetic replay so invalid output roots fail before route rendering.
- Round276 built-root P10 boundary:
  `packages/server/src/index.ts` forwards the focused client-module registry constructor and
  node/http adapter needed by `tests/p10-perf.node.mjs` from the built root, and
  `packages/server/src/api/app.test.ts` pins those values while keeping the aggregate app-shell
  subpath absent. `pnpm exec vitest --run packages/server/src/api/app.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`; `pnpm run check:build`;
  `node --test --test-name-pattern "P10 perf acceptance is wired through Playwright and CDP" tests/fw-check.node.mjs`.

- Round277 app-shell Vite public boundary:
  `packages/server/src/api/app-shell/vite.ts` stops forwarding the generic
  `createJisoAppShellBuild()` value and `JisoAppShellBuildOptions` type; `packages/server/src/vite.test.ts`
  proves the public Vite-specific route-entry-map helper still wires manifest route hints and base
  paths, and `packages/server/src/api/app.test.ts` pins the public subpath absence.
  `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/vite.test.ts packages/server/src/vite-build.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`.

- Round274 Vite static-export facade deletion:
  `packages/server/src/vite-static-export.ts` was deleted. `@jiso/server/app-shell/vite` now
  forwards build-backed export/inventory/manifest helpers directly from
  `packages/server/src/vite-static-export-build.ts`, manifest-file wrappers directly from
  `packages/server/src/vite-static-export-manifest-file.ts`, and option types from
  `packages/server/src/vite-static-export-options.ts`; `packages/server/src/api/app.test.ts` pins
  the public app-shell Vite subpath to those focused owners for SPEC §9.5 export-task consumers.
  `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite-static-export-result.test.ts packages/server/src/vite-static-export-options.test.ts`;
  `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs the generated starter app-shell request and export proof|serves the generated starter app-shell through|runs .* with the built stylesheet href|formats generated export task diagnostics"`;
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "documents the commerce app-shell|public commerce shell static output|vp run export|npm run static"`;
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs`;
  `pnpm exec tsc --noEmit --pretty false`;
  exact `pnpm exec vp check packages/server/src/api/app-shell/vite.ts packages/server/src/vite-static-export-build.ts packages/server/src/vite-static-export-manifest-file.ts packages/server/src/vite-static-export-options.ts packages/server/src/vite-build.test.ts packages/server/src/api/app.test.ts packages/server/src/vite-static-export-result.test.ts packages/server/src/vite-static-export-options.test.ts packages/create-jiso/src/index.test.ts examples/commerce/src/app-shell.test.ts site/scripts/app-shell.test.mjs plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.

- Round273 Vite static-export facade extraction:
  `packages/server/src/vite-static-export-build.ts` owns build-backed export/write, dry-run
  inventory, manifest projection, and dry-run/write consistency for SPEC §9.5 Vite export tasks;
  `packages/server/src/vite-static-export-manifest-file.ts` owns manifest-file construction and
  option projection; `packages/server/src/vite-static-export.ts` is now a public re-export facade
  and `packages/server/src/api/app.test.ts` pins the app-shell Vite subpath to the focused owners.
  `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite-static-export-result.test.ts packages/server/src/vite-static-export-options.test.ts`;
  `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs the generated starter app-shell request and export proof|serves the generated starter app-shell through|runs .* with the built stylesheet href|formats generated export task diagnostics"`;
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "documents the commerce app-shell|public commerce shell static output|vp run export|npm run static"`;
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs`;
  `pnpm exec tsc --noEmit --pretty false`;
  exact `pnpm exec vp check packages/server/src/vite-static-export-build.ts packages/server/src/vite-static-export-manifest-file.ts packages/server/src/vite-static-export.ts packages/server/src/vite-build.ts packages/server/src/api/app.test.ts plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.

- Round272 Vite static-export result boundary:
  `packages/server/src/vite-static-export-result.ts` owns the dry-run manifest/write-result
  consistency assertion for SPEC §9.5 Vite export tasks, with
  `packages/server/src/vite-static-export.ts` delegating the public combined export helper to that
  boundary and the app-shell Vite subpath preserving the existing result type.
  `pnpm exec vitest --run packages/server/src/vite-static-export-result.test.ts packages/server/src/vite-build.test.ts packages/server/src/api/app.test.ts`;
  `pnpm exec vitest --run packages/server/src/vite-static-export-options.test.ts`;
  `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs vp run export with the built stylesheet href|runs npm run static with the built stylesheet href|formats generated export task diagnostics"`;
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "documents the commerce app-shell|public commerce shell static output|vp run export|npm run static"`;
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs`;
  `pnpm exec tsc --noEmit --pretty false`;
  exact `pnpm exec vp check packages/server/src/vite-static-export-result.ts packages/server/src/vite-static-export-result.test.ts packages/server/src/vite-static-export.ts packages/server/src/api/app-shell/vite.ts plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round271 Vite export result/manifest bridge:
  `packages/server/src/vite-static-export.ts` added the public combined export/manifest helper and
  the app-shell Vite subpath forwards it; starter, commerce, and docs export scripts consume that
  helper for SPEC §9.5 manifest-backed static export adoption.
  `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/api/app.test.ts`;
  `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs vp run export with the built stylesheet href|runs npm run static with the built stylesheet href|formats generated export task diagnostics"`;
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "documents the commerce app-shell|public commerce shell static output|vp run export|npm run static"`;
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs`;
  `pnpm exec tsc --noEmit --pretty false`;
  exact `pnpm exec vp check packages/server/src/vite-static-export.ts packages/server/src/api/app-shell/vite.ts packages/server/src/vite-build.test.ts packages/server/src/api/app.test.ts packages/create-jiso/templates/scripts/export-static.mjs packages/create-jiso/src/index.test.ts examples/commerce/scripts/export-static.mjs examples/commerce/src/app-shell.test.ts site/scripts/export-static.mjs site/scripts/app-shell.test.mjs plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round260 app-shell aggregate subpath deletion:
  `pnpm exec vitest --run packages/server/src/api/app.test.ts`;
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs`;
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts`;
  `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs the generated starter app-shell request and export proof|runs vp run export with the built stylesheet href|runs npm run static with the built stylesheet href|formats generated export task diagnostics"`;
  `pnpm exec tsc --noEmit --pretty false`;
  `pnpm run check:build`;
  exact `pnpm exec vp check packages/server/package.json packages/server/src/api/app.test.ts site/scripts/app-shell.test.mjs examples/commerce/src/app-shell.test.ts packages/create-jiso/src/index.test.ts plans/app-shell.md plans/codebase-quality-round2.md`.
- Round252 static document replay contraction:
  `pnpm exec vitest --run packages/server/src/static-export-document.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts`;
  `pnpm exec vitest --run packages/server/src`;
  `pnpm exec tsc --noEmit --pretty false`;
  `pnpm run check:build`;
  exact `pnpm exec vp check packages/server/src/static-export-document.ts packages/server/src/static-export-document.test.ts plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round253 static-export result boundary:
  `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/static-export-output.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/vite-build.test.ts packages/server/src/api/app.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`;
  `pnpm run check:build`;
  exact `pnpm exec vp check packages/server/src/static-export-headers.ts packages/server/src/static-export-result.ts packages/server/src/static-export-types.ts packages/server/src/static-export-document.ts packages/server/src/static-export-output.ts packages/server/src/vite-static-export.ts packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts packages/server/src/api/app-shell/static-export.ts packages/server/src/api/app.test.ts plans/app-shell.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`.
- Round254 docs-site route-manifest export adoption:
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs`;
  `pnpm run check:build`;
  `pnpm --filter @jiso/site run build`;
  `node site/scripts/export-static.mjs --skip-build --skip-gallery`;
  `pnpm exec tsc --noEmit --pretty false`;
  exact `pnpm exec vp check site/scripts/app-shell.mjs site/scripts/app-shell.test.mjs site/scripts/build.mjs plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round256 docs-site split-subpath export adoption:
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs`;
  `pnpm exec vitest --run packages/server/src/api/app.test.ts`;
  `pnpm run check:build`;
  `pnpm --filter @jiso/site run build`;
  `node site/scripts/export-static.mjs --skip-build --skip-gallery`;
  exact `pnpm exec vp check site/scripts/export-static.mjs site/scripts/app-shell.mjs site/scripts/app-shell.test.mjs plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round257 docs-site manifest/result consistency:
  `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts`;
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs`;
  `pnpm exec tsc --noEmit --pretty false`;
  `pnpm run check:build`;
  `pnpm --filter @jiso/site run build`;
  `node site/scripts/export-static.mjs --skip-build --skip-gallery`.
- Round258 static-export raw-text scanner:
  `pnpm exec vitest --run packages/server/src/static-export-document.test.ts packages/server/src/static-export.test.ts packages/server/src/static-export-replay.test.ts`;
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs`;
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "public commerce shell static output|vp run export|npm run static"`;
  `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "runs the generated starter app-shell request and export proof|runs .* with the built stylesheet href|formats generated export task diagnostics"`;
  `pnpm exec tsc --noEmit --pretty false`;
  `pnpm run check:build`;
  exact `pnpm exec vp check packages/server/src/static-export-document-refs.ts packages/server/src/static-export-document.test.ts packages/server/src/static-export.test.ts plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round267 app-shell dynamic export cleanup:
  `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/vite-dev.test.ts examples/commerce/src/app-shell.test.ts packages/create-jiso/src/index.test.ts -t "server app-shell public API barrels|documents the commerce app-shell dev, serve, and export command matrix|scaffolds real template files|runs the generated starter app-shell request and export proof|runs vp run export with the built stylesheet href|runs npm run static with the built stylesheet href|formats generated export task diagnostics"`;
  `pnpm exec tsc --noEmit --pretty false`;
  exact `pnpm exec vp check packages/server/src/app-guards.ts packages/server/src/api/app.test.ts packages/create-jiso/templates/scripts/export-static.mjs packages/create-jiso/src/index.test.ts examples/commerce/scripts/export-static.mjs examples/commerce/src/app-shell.test.ts plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round268 docs-site optional client-module directory cleanup:
  `site/scripts/app-shell.mjs` now treats an absent `public/c` directory as an empty docs-site
  client-module registry while preserving SPEC §9.5 route document replay, and
  `site/scripts/app-shell.test.mjs` proves manifest-backed docs export writes route documents with
  no `/c/` artifacts when the client-module directory is absent.
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs`;
  `pnpm exec vitest --run packages/server/src/api/app.test.ts site/scripts/app-shell.test.mjs examples/commerce/src/app-shell.test.ts packages/create-jiso/src/index.test.ts -t "server app-shell public API barrels|site app-shell export adoption|documents the commerce app-shell dev, serve, and export command matrix|public commerce shell static output|vp run export|npm run static|scaffolds real template files|runs the generated starter app-shell request and export proof|runs vp run export with the built stylesheet href|runs npm run static with the built stylesheet href|formats generated export task diagnostics"`;
  `pnpm exec tsc --noEmit --pretty false`;
  exact `pnpm exec vp check site/scripts/app-shell.mjs site/scripts/app-shell.test.mjs plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round270 static route-target plan closure:
  `packages/server/src/static-export-route-plan.ts` now rejects duplicate concrete route-document
  targets before SPEC §9.5 synthetic replay, covering normalized static routes, duplicate
  `staticPaths`, and collisions between explicit param route `staticPaths` and static routes.
  `packages/server/src/static-export.test.ts` proves duplicate route targets fail with FW229 before
  page replay, so app-shell export adoption no longer relies on later output-write conflict
  detection for route-document uniqueness.
  `pnpm exec vitest --run packages/server/src/static-export-route-plan.test.ts packages/server/src/static-export.test.ts`;
  `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/api/app.test.ts`;
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts site/scripts/app-shell.test.mjs`;
  `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs the generated starter app-shell request and export proof|serves the generated starter app-shell through|runs .* with the built stylesheet href|formats generated export task diagnostics"`;
  `pnpm exec tsc --noEmit --pretty false`;
  exact `pnpm exec vp check packages/server/src/static-export-route-plan.ts packages/server/src/static-export-route-plan.test.ts packages/server/src/static-export.test.ts plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round259 Vite stylesheet helper contraction:
  `pnpm exec vitest --run packages/server/src/vite-manifest.test.ts packages/server/src/vite.test.ts packages/server/src/api/app.test.ts`;
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs`;
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts`;
  `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs the generated starter app-shell request and export proof|runs vp run export with the built stylesheet href|runs npm run static with the built stylesheet href|formats generated export task diagnostics"`;
  `pnpm exec tsc --noEmit --pretty false`;
  `pnpm run check:build`;
  exact `pnpm exec vp check packages/server/src/vite-manifest.ts packages/server/src/vite-manifest.test.ts packages/server/src/vite.test.ts packages/server/src/api/app-shell/vite.ts packages/server/src/api/app.test.ts site/scripts/app-shell.test.mjs plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round262 app-shell response boundary and R6 sweep:
  `packages/server/src/static-export-response.ts` owns the shared route-document and `/c/` module
  replay response reader; `packages/server/src/static-export-document.ts` delegates response
  validation and keeps SPEC §9.5 synthetic replay/L0-L1/client-module artifact ownership; the stale
  client-module test filename was renamed to
  `packages/server/src/static-export-document-client-modules.test.ts`;
  `pnpm exec vitest --run packages/server/src/static-export-response.test.ts packages/server/src/static-export-document.test.ts packages/server/src/static-export-document-client-modules.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts packages/server/src/api/app.test.ts`;
  `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs the generated starter app-shell request and export proof|serves the generated starter app-shell through|runs .* with the built stylesheet href|formats generated export task diagnostics"`;
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts site/scripts/app-shell.test.mjs`;
  `pnpm exec tsc --noEmit --pretty false`;
  exact `pnpm exec vp check packages/server/src/static-export-response.ts packages/server/src/static-export-response.test.ts packages/server/src/static-export-document.ts packages/server/src/static-export-document.test.ts packages/server/src/static-export-document-client-modules.test.ts packages/server/src/static-export-replay.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export.ts packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts packages/server/src/api/app.test.ts examples/commerce/src/app-shell.test.ts site/scripts/app-shell.test.mjs packages/create-jiso/src/index.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`.
- Round263 app-shell request/client-module closure:
  `packages/server/src/static-export-request.ts` owns SPEC §9.5 synthetic GET construction for
  route-document paths and versioned `/c/` module hrefs, and
  `packages/server/src/static-export-client-modules.ts` owns discovered client-module replay,
  same-output-path dedupe, and FW229 query-version drift diagnostics. The stale document-level
  client-module replay compatibility export was deleted, and `plans/app-shell.md` now marks R6/R7
  closed with starter, commerce, and docs adoption evidence.
  `pnpm exec vitest --run packages/server/src/static-export-request.test.ts packages/server/src/static-export-document.test.ts packages/server/src/static-export-document-client-modules.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts`;
  `pnpm exec vitest --run packages/server/src`;
  `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs the generated starter app-shell request and export proof|serves the generated starter app-shell through|runs .* with the built stylesheet href|formats generated export task diagnostics"`;
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts`;
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs`;
  `pnpm exec tsc --noEmit --pretty false`;
  exact `pnpm exec vp check packages/server/src/static-export-request.ts packages/server/src/static-export-request.test.ts packages/server/src/static-export-client-modules.ts packages/server/src/static-export-document-client-modules.test.ts packages/server/src/static-export-document.ts packages/server/src/static-export-document.test.ts packages/server/src/static-export-replay.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts packages/create-jiso/src/index.test.ts examples/commerce/src/app-shell.test.ts site/scripts/app-shell.test.mjs plans/app-shell.md plans/codebase-quality-round2.md`.
- Round264 app-shell public boundary cleanup:
  `packages/server/src/index.ts` now type-exports `StaticExportCompileDiagnostic` directly from
  the static-export diagnostic owner, so the root type surface no longer depends on the app-shell
  static-export subpath alias. `packages/server/src/vite-manifest.ts` deleted the remaining
  private plural stylesheet helper while preserving the singular public helper used by
  starter/commerce/docs SPEC §9.5 export-task stylesheet evidence.
  `pnpm exec vitest --run packages/server/src/vite-manifest.test.ts packages/server/src/api/app.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`;
  `pnpm exec vitest --run packages/server/src/vite.test.ts packages/server/src/vite-build.test.ts`;
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts site/scripts/app-shell.test.mjs`;
  `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs the generated starter app-shell request and export proof|serves the generated starter app-shell through|runs .* with the built stylesheet href|formats generated export task diagnostics"`;
  exact `pnpm exec vp check packages/server/src/index.ts packages/server/src/vite-manifest.ts packages/server/src/vite-manifest.test.ts packages/server/src/api/app.test.ts plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round265 app-shell final cleanup:
  `site/scripts/app-shell.mjs` deleted the stale built aggregate
  `dist/server/src/api/app-shell/index.mjs` fallback/sentinel, and
  `packages/server/src/api/app.test.ts` now asserts the app-shell package export map is exactly
  the focused public subpaths rather than a match-object that could miss aggregate drift.
  `pnpm exec vitest --run packages/server/src/api/app.test.ts site/scripts/app-shell.test.mjs`;
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts`;
  exact `pnpm exec vp check packages/server/src/api/app.test.ts site/scripts/app-shell.mjs site/scripts/app-shell.test.mjs plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round266 app-shell dynamic app guard cleanup:
  `packages/server/src/app-guards.ts` owns the shared runtime `isJisoApp()` guard,
  `@jiso/server/app-shell/core` exports it for dynamic app-shell loaders, Vite dev reuses it, and
  starter/commerce export tasks deleted their local app-shape helpers.
  `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/vite-dev.test.ts`;
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "documents the commerce app-shell|public commerce shell static output|vp run export"`;
  `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs vp run export with the built stylesheet href|runs npm run static with the built stylesheet href|formats generated export task diagnostics"`;
  `pnpm exec vitest --run site/scripts/app-shell.test.mjs`;
  `pnpm exec tsc --noEmit --pretty false`;
  exact `pnpm exec vp check packages/server/src/app-guards.ts packages/server/src/api/app-shell/core.ts packages/server/src/vite-dev.ts packages/server/src/api/app.test.ts examples/commerce/scripts/export-static.mjs examples/commerce/src/app-shell.test.ts packages/create-jiso/templates/scripts/export-static.mjs packages/create-jiso/src/index.test.ts plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round287 app-shell public subpath value boundary:
  `packages/server/src/api/app.test.ts` now asserts exact runtime value-key lists for
  `@jiso/server/app-shell/client-modules`, `core`, `node`, `static-export`, and `vite`, so SPEC
  §9.5 R5/R6/R7 public consumers cannot regain aggregate compatibility helpers or unreviewed
  public values without a focused API failure.
  `pnpm exec vitest --run packages/server/src/api/app.test.ts`;

- Round251 commerce HTTP/static adoption:
  `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts`;
  exact `pnpm exec vp check examples/commerce/src/app-shell.test.ts plans/app-shell.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- Round250 Vite build-output static-export option boundary:
  `pnpm exec vitest --run packages/server/src/vite-static-export-options.test.ts packages/server/src/vite-build.test.ts packages/server/src/api/app.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`.
- `pnpm exec vitest --run packages/server/src/api/app.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm run check:build`
- `node --test --test-name-pattern "P1 compiler validates component-scoped IDREFs|P1 compiler validates static id uniqueness|P1 compiler validates HTML content-model parser stability|P1 compiler validates declared execution trigger names|P1 compiler validates residual fw-c and fw-deps stamps|P1 compiler emits FW311 update coverage facts|P1 compiler validates binding stamp expression drift|P1 compiler validates primitive composition attribute merges|P1 compiler validates fragment-target child hoisting failures|P3 typed routes validate navigation targets" tests/fw-check.node.mjs`
- `pnpm exec vp check packages/server/src/index.ts packages/server/src/api/app.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/api/app.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/api/app-shell/index.ts packages/server/src/api/app.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/static-export-options.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export-options.ts packages/server/src/static-export-options.test.ts packages/server/src/static-export-types.ts packages/server/src/static-export-replay.ts packages/server/src/api/app-shell/static-export.ts packages/server/src/api/app-shell/index.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/static-export-request.test.ts packages/server/src/static-export-response.test.ts packages/server/src/static-export-document.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export-request.ts packages/server/src/static-export-request.test.ts packages/server/src/static-export-response.ts packages/server/src/static-export-response.test.ts packages/server/src/static-export-document.ts packages/server/src/static-export-document.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/api/app-shell/index.ts packages/server/src/api/app.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/api/app.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest --run packages/server/src/api/app.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/static-export.test.ts packages/server/src/vite-static-export-options.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite-static-export-options.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export.ts packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts packages/server/src/vite-build.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `pnpm exec vp check packages/server/src/static-export-types.ts packages/server/src/static-export.ts packages/server/src/api/app-shell/static-export.ts packages/server/src/vite-build-assets.ts packages/server/src/vite-build-output.ts packages/server/src/vite-static-export-options.ts packages/server/src/vite-static-export.ts packages/server/src/api/app.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/server/src/app.test.ts packages/server/src/app-dispatch.test.ts packages/server/src/app-document.test.ts packages/server/src/api/app.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export-document.test.ts packages/server/src/static-export-request.test.ts packages/server/src/static-export-route-plan.test.ts packages/server/src/static-export.test.ts packages/server/src/vite-dev.test.ts packages/server/src/vite-plugin-build.test.ts packages/server/src/vite-static-export-options.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/app-types.ts packages/server/src/app.ts packages/server/src/app-request.ts packages/server/src/app-dispatch.ts packages/server/src/app-dispatch.test.ts packages/server/src/app-document.ts packages/server/src/app-mutation-request.ts packages/server/src/node.ts packages/server/src/static-export.ts packages/server/src/static-export-replay.ts packages/server/src/static-export-document.ts packages/server/src/static-export-request.ts packages/server/src/static-export-route-plan.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/static-export-document.test.ts packages/server/src/static-export-request.test.ts packages/server/src/vite-build.ts packages/server/src/vite-dev.ts packages/server/src/vite-plugin.ts packages/server/src/vite-plugin-build.ts packages/server/src/vite-static-export-options.ts packages/server/src/api/app-shell/core.ts packages/server/src/api/app.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/vite-static-export-options.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite-plugin-build.test.ts`
- `pnpm exec vp check packages/server/src/vite-static-export-options.ts packages/server/src/vite-static-export-options.test.ts packages/server/src/vite-build.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/vite-plugin-build.test.ts packages/server/src/vite.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/vite-client-module-output.ts packages/server/src/vite-build-output.ts packages/server/src/api/app-shell/vite.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts packages/server/src/vite-plugin-build.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/vite-build-output.ts packages/server/src/vite-build.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/static-export-output-targets.test.ts packages/server/src/static-export-output.test.ts`
- `pnpm exec vitest --run packages/server/src/static-export-output-targets.test.ts packages/server/src/static-export-output.test.ts packages/server/src/static-export.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export-output-targets.ts packages/server/src/static-export-output-targets.test.ts packages/server/src/static-export-output.ts packages/server/src/static-export-output.test.ts packages/server/src/static-export.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec vitest --run packages/create-jiso/src/index.test.ts`
- focused server/static-export/create-jiso tests for diagnostic seam, starter export, and static
  preview behavior
- `pnpm exec tsc --noEmit --pretty false`
- exact `pnpm exec vp check ... packages/server/src/... packages/create-jiso/... IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/static-export-diagnostics.test.ts packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export-diagnostics.ts packages/server/src/static-export-types.ts packages/server/src/static-export.ts packages/server/src/static-export-diagnostics.test.ts packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/api/app.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "runs .* with the built stylesheet href|scaffolds real template files"`
- `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts`
- `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "documents the commerce app-shell|delegates Vite dev middleware|wires .* public commerce shell static output"`
- `pnpm exec vitest --run packages/server/src/api/app.test.ts -t "server app-shell public API barrels"`
- `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "documents the commerce app-shell|public commerce shell static output|static export"`
- `pnpm exec vp check examples/commerce/src/app-shell.ts examples/commerce/src/app-shell.test.ts packages/server/src/api/app.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/server/src/static-export-document.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export-document.ts packages/server/src/static-export-client-modules.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/server/src/api/app.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/api/app-shell/static-export.ts packages/server/src/api/app.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

## Phase 6 - Verification Harness And Commerce

Current state: commerce source-truth tests use shared structured facts for graph, HTML,
query/fragment/key output, source-site provenance, app-shell command/export behavior, and
`fw-explain` query/mutation/page assertions. `@jiso/test` owns reusable fixture seams for generated
modules/source facts, fw-explain, TypeScript, fw-check output, source/project facts, commands,
starter templates, wire, static export output/result facts, touch graphs, graph
invalidation/consumer facts, and reusable HTML fragment field/key projections. Commerce
app/source-truth tests no longer own local
form-field, keyed-element, or generated-IR source-stamp projection helpers for currently covered
no-JS form, list identity, enhanced fragment, and committed-IR assertions. Shared header fixtures
now own response header value and Set-Cookie pair projection for commerce app/app-shell tests.
Shared `fw-explain` fixtures now own the commerce mutation/query optimistic matrix projection and
static-invalidation mismatch facts.
Shared graph fixtures now own checked-in graph artifact loading so commerce source-truth and
`fw-check` graph gates no longer parse commerce generated graph JSON locally. Shared graph fixtures
also own static behavior summaries for component targets, domains, routes, invalidations,
optimistic rows, and touch-graph keys. Shared HTML fragment fixtures now own selected-element
counts and named query JSON projections used by commerce app-shell tests. Shared `fw-explain`
fixtures now own endpoint and scope-audit assertion facts, so commerce source-truth tests no
longer parse those subjects and summaries locally. Shared generated-module fixtures now own
commerce authored/generated component source-pair loading and projection for the committed-IR
freshness gate, including exact compiler-output comparison and SPEC.md section 5.2 provenance, so
commerce app tests no longer reimplement generated artifact file-pair reads or settle for marker
presence.
Shared runtime fixtures now own pagehide optimism cleanup lifecycle and pending-stamp behavior
facts used by `tests/fw-check.node.mjs`, keeping that verification harness reusable without
changing commerce generated artifacts.
Shared graph fixtures now own generated graph artifact acceptance evidence consumed by both
commerce source-truth tests and the P4 fw-check gate, including emitted graph cleanliness,
source-derived touch provenance, and static graph behavior.
Shared verification fixtures now own the P9 verification-layer behavior fact used by
`tests/fw-check.node.mjs`, covering CSRF, harness mutation/query verification, DB verifier
diagnostics, structured SQL observation, and Pglite wrapped mutations through a public
`@jiso/test/verification-fixtures` seam.

- [ ] Remove remaining commerce-local fixture parsing that belongs in `@jiso/test`.
- [ ] Make opaque adapter objects either observable or explicitly documented as unobserved.
- [ ] Keep commerce generated artifacts honest: checked in, freshness-gated, and tied to source
      provenance rather than synthetic projections.

Latest evidence:

- Verification-layer fixture slice:
  `pnpm exec vitest --run packages/test/src/verification-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P9 verification layer evidence remains represented" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/verification-fixtures.ts packages/test/src/verification-fixtures.test.ts packages/test/src/package-exports.test.ts packages/test/package.json tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- `pnpm exec vitest --run packages/test/src/fw-explain-fixtures.test.ts packages/test/src/package-exports.test.ts`
- Generated graph artifact acceptance evidence fixture slice:
  `pnpm exec vitest --run packages/test/src/graph-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/source-truth.test.ts`;
  `pnpm exec vp run build`;
  targeted `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/graph-fixtures.ts packages/test/src/graph-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/source-truth.test.ts tests/fw-check.node.mjs`;
  `git diff --check`.
- `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`
- `pnpm run check:build`
- `node --test --test-name-pattern "P10 commerce graph assertions answer behavior mechanically|P10 commerce invalidation is expressed through graph facts|P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`
- `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`
- `pnpm exec vitest --run packages/test/src/fw-check-fixtures.test.ts packages/test/src/package-exports.test.ts`
- targeted `node --test --test-name-pattern ... tests/fw-check.node.mjs`
- `pnpm run check:build`
- `pnpm exec vitest --run packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run examples/commerce/src/app.test.ts examples/commerce/src/source-truth.test.ts`
- `node --test --test-name-pattern "P10 commerce graph assertions answer behavior mechanically|P10 commerce invalidation is expressed through graph facts|P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`
- exact `pnpm exec vp check packages/test/src/html-fragment.ts packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/app.test.ts examples/commerce/src/source-truth.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/test/src/headers.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run examples/commerce/src/app.test.ts examples/commerce/src/app-shell.test.ts -t "session|sign|cookie|auth|commerce app shell HTTP entry|renders SPEC 6.3 no-JS add-to-cart forms|renders a multipart receipt upload form"`
- exact `pnpm exec vp check packages/test/package.json packages/test/src/headers.ts packages/test/src/headers.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/app.test.ts examples/commerce/src/app-shell.test.ts`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run examples/commerce/src/app.test.ts -t "compiles TSX-authored components to committed IR through the fixpoint gate"`
- exact `pnpm exec vp check examples/commerce/src/app.test.ts packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src/graph-fixtures.test.ts packages/test/src/source-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`
- `pnpm run check:build`
- `node --test --test-name-pattern "P10 commerce graph assertions answer behavior mechanically|P10 commerce invalidation is expressed through graph facts|P4 commerce touch graph is a committed generated artifact|D2 commerce validates keyed append and optimistic reorder|D4 commerce adopt-dont-invent features stay represented" tests/fw-check.node.mjs`
- `pnpm exec vitest --run packages/test/src/graph-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/source-truth.test.ts`
- `pnpm run check:build`
- `node --test --test-name-pattern "P10 commerce invalidation is expressed through graph facts|D2 commerce validates keyed append and optimistic reorder|P10 commerce graph assertions answer behavior mechanically|P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`
- exact `pnpm exec vp check packages/test/src/graph-fixtures.ts packages/test/src/graph-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/source-truth.test.ts tests/fw-check.node.mjs IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "serves shell routes|serves the app-shell surface|serves the commerce cart document|routes enhanced and no-JS commerce mutations|exports the public commerce shell|wires .* public commerce shell static output"`
- `pnpm run check:build`
- `node --test --test-name-pattern "D1 commerce enhanced fragments carry Tailwind stylesheet hints|P10 commerce graph assertions answer behavior mechanically" tests/fw-check.node.mjs`
- exact `pnpm exec vp check packages/test/src/html-fragment.ts packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/app-shell.test.ts plans/codebase-quality-round2.md IMPLEMENT_v1.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src/fw-explain-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`
- exact `pnpm exec vp check packages/test/src/fw-explain-fixtures.ts packages/test/src/fw-explain-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/source-truth.test.ts plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/test/src/command-fixtures.test.ts packages/test/src/source-fixtures.test.ts packages/test/src/package-exports.test.ts`
- exact `pnpm exec vp check tests/fw-check.node.mjs packages/test/src/command-fixtures.ts packages/test/src/command-fixtures.test.ts packages/test/src/source-fixtures.ts packages/test/src/source-fixtures.test.ts packages/test/src/package-exports.test.ts plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src/source-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm run check:build`
- `node --test --test-name-pattern "P3 Drizzle query facts include select shapes and instance keys" tests/fw-check.node.mjs`
- exact `pnpm exec vp check packages/test/src/source-fixtures.ts packages/test/src/source-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src/fw-export-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm run check:build`
- `node --test --test-name-pattern "D10 seeded diagnostics gate Vite, static export, and MCP red-green surfaces" tests/fw-check.node.mjs`
- exact `pnpm exec vp check packages/test/src/fw-export-fixtures.ts packages/test/src/fw-export-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`
- `git diff --check`
- Generated component source-pair fixture slice:
  `pnpm exec vitest --run packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm exec vitest --run examples/commerce/src/app.test.ts -t "compiles TSX-authored components to committed IR through the fixpoint gate"`;
  `pnpm run check:build`;
  `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`.
- Committed commerce IR freshness fixture slice:
  `pnpm exec vitest --run packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm exec vitest --run examples/commerce/src/app.test.ts -t "compiles TSX-authored components to committed IR through the fixpoint gate"`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check --fix packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/app.test.ts plans/codebase-quality-round2.md`;
  exact `pnpm exec vp check packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/app.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- Runtime pagehide optimism cleanup fixture slice:
  `pnpm exec vitest --run packages/test/src/runtime-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P6 navigation bfcache optimism cleanup acceptance is represented" tests/fw-check.node.mjs`.
- Generated graph artifact acceptance fixture slice:
  `pnpm exec vitest --run packages/test/src/graph-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/source-truth.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/graph-fixtures.ts packages/test/src/graph-fixtures.test.ts tests/fw-check.node.mjs examples/commerce/src/source-truth.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.

## Phase 7 - Test Restructuring

Current state: runtime, server static export, compiler shared/model-pipeline, and `@jiso/test`
fixture tests have been split out of monoliths along module seams. Runtime query/apply/broadcast,
enhanced-submit, and delegated handler integration coverage now lives in focused runtime tests.
`tests/fw-check.node.mjs` is still large but increasingly delegates mechanics to package fixtures
and structured facts. Commerce app tests now consume shared `@jiso/test/html-fragment` form and
keyed-element projections and shared `@jiso/test/headers` response/cookie projections instead of
local helpers; commerce source-truth matrix projection now lives in
`@jiso/test/fw-explain-fixtures`; checked-in graph artifact loading now lives in
`@jiso/test/graph-fixtures`, along with graph static behavior projections consumed by
`tests/fw-check.node.mjs`. Commerce app-shell tests now consume shared `@jiso/test/html-fragment`
selected-element counts and named query JSON projections instead of local response-body/shell
parsing helpers. `fw-check` doc-gate rule-title canonicalization now lives in
`@jiso/test/markdown-fixtures`. The fw-check conformance gate now consumes shared source and command
fixtures for package manifest, acceptance script, Vite+ task, and pnpm-filter command facts. The
fw-check Drizzle gate now consumes shared source fixtures for query source bodies and structured
query/diagnostic/touch behavior projections. The D10 static export CLI assertions now consume
shared `@jiso/test/fw-export-fixtures` result facts instead of local stream, byte, and summary
checks. The D10 Vite diagnostic lowered-event assertion now consumes
`@jiso/test/diagnostic-output-fixtures` instead of parsing help text and generated handler hrefs
inside `tests/fw-check.node.mjs`. The P1 generated-module minifier, typed-param, and
render-equivalence assertions now consume shared `@jiso/test/generated-module-fixtures` behavior
facts instead of local fake-client invocation and render-projection mechanics. Commerce committed-IR
freshness tests now consume `@jiso/test/generated-module-fixtures` file-pair facts instead of
local generated/authored source reads, and the fixture now compares committed IR to caller-provided
compiler output while asserting fixpoint/render-equivalence hooks.
The P6 pagehide optimism cleanup gate now consumes `@jiso/test/runtime-fixtures` lifecycle and
pending-stamp behavior facts instead of local fake root and delayed fetch mechanics.
The P4 generated graph artifact acceptance gate now consumes
`@jiso/test/graph-fixtures` acceptance evidence facts in both `tests/fw-check.node.mjs` and
commerce source-truth tests, replacing duplicated local emitted-graph summary assertions while
keeping touch provenance and static graph behavior observable.
The P9 verification-layer gate now consumes `@jiso/test/verification-fixtures` behavior facts
instead of defining fake DB, verifier, assertion, SQL, and Pglite mechanics inside
`tests/fw-check.node.mjs`.
The P9 enhanced mutation verification gate now consumes `@jiso/test/runtime-fixtures` behavior facts instead of
defining fake DOM roots, broadcast capture, malformed header capture, and optimistic pending
element mechanics inside `tests/fw-check.node.mjs`.

- [ ] When touching a monolith test, move reusable mechanics into package fixtures or focused tests.
- [ ] Prefer structured assertions and shared fixtures over source-text or output-substring ledgers.
- [ ] Keep `plans/*` evidence terse: current status plus command list, not repeated history.

Latest evidence:

- Enhanced mutation runtime fixture slice:
  `pnpm exec vitest --run packages/test/src/runtime-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P9 verification layer evidence remains represented" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/runtime-fixtures.ts packages/test/src/runtime-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- Verification-layer fixture slice:
  `pnpm exec vitest --run packages/test/src/verification-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P9 verification layer evidence remains represented" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/verification-fixtures.ts packages/test/src/verification-fixtures.test.ts packages/test/src/package-exports.test.ts packages/test/package.json tests/fw-check.node.mjs plans/codebase-quality-round2.md`;
  `git diff --check`.
- `pnpm exec vitest --run packages/test/src/markdown-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run packages/test/src/command-fixtures.test.ts packages/test/src/source-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `node --test --test-name-pattern "Conformance suites are an explicit gate" tests/fw-check.node.mjs`
- exact `pnpm exec vp check tests/fw-check.node.mjs packages/test/src/command-fixtures.ts packages/test/src/command-fixtures.test.ts packages/test/src/source-fixtures.ts packages/test/src/source-fixtures.test.ts packages/test/src/package-exports.test.ts plans/codebase-quality-round2.md`
- `node --test --test-name-pattern "P10 normative docs cover the constitution and compiler hard rules" tests/fw-check.node.mjs`
- `pnpm exec vitest --run packages/test/src/source-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run packages/test/src/fw-export-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm run check:build`
- `node --test --test-name-pattern "D10 seeded diagnostics gate Vite, static export, and MCP red-green surfaces" tests/fw-check.node.mjs`
- exact `pnpm exec vp check packages/test/src/fw-export-fixtures.ts packages/test/src/fw-export-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm run check:build`
- `node --test --test-name-pattern "P3 Drizzle query facts include select shapes and instance keys" tests/fw-check.node.mjs`
- exact `pnpm exec vp check packages/test/src/source-fixtures.ts packages/test/src/source-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm run check:build`
- `node --test --test-name-pattern "P1 minifier name preservation evidence remains represented|P1 typed data param coercion remains represented|P1 render-equivalence gate remains represented" tests/fw-check.node.mjs`
- Committed commerce IR freshness fixture slice:
  `pnpm exec vitest --run packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm exec vitest --run examples/commerce/src/app.test.ts -t "compiles TSX-authored components to committed IR through the fixpoint gate"`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check --fix packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/app.test.ts plans/codebase-quality-round2.md`;
  exact `pnpm exec vp check packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/app.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- Runtime pagehide optimism cleanup fixture slice:
  `pnpm exec vitest --run packages/test/src/runtime-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P6 navigation bfcache optimism cleanup acceptance is represented" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check tests/fw-check.node.mjs packages/test/src/runtime-fixtures.ts packages/test/src/runtime-fixtures.test.ts packages/test/src/package-exports.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- Generated graph artifact acceptance fixture slice:
  `pnpm exec vitest --run packages/test/src/graph-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/source-truth.test.ts`;
  `pnpm run check:build`;
  targeted `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/graph-fixtures.ts packages/test/src/graph-fixtures.test.ts tests/fw-check.node.mjs examples/commerce/src/source-truth.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.
- Generated graph artifact acceptance evidence fixture slice:
  `pnpm exec vitest --run packages/test/src/graph-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/source-truth.test.ts`;
  `pnpm exec vp run build`;
  targeted `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check packages/test/src/graph-fixtures.ts packages/test/src/graph-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/source-truth.test.ts tests/fw-check.node.mjs`;
  `git diff --check`.

## Current Gates

Latest broad gate:

- `pnpm run check` passed after checkpoint `ebb1520`: inline loader check, 788
  formatted files, 688 lint/typechecked files, and 7 typechecked example/conformance projects.

Focused gates since that broad run:

- UI/gallery H2 number-field native form/input slice:
  `pnpm exec vitest --run packages/headless-ui/src/primitives/number-field.test.ts`;
  `pnpm exec vitest --run packages/ui/src/index.test.tsx -t number-field`;
  `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
  `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t number-field)`;
  exact `pnpm exec vp check packages/headless-ui/src/primitives/number-field.ts packages/headless-ui/src/primitives/number-field.test.ts packages/ui/src/number-field.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive/number-field-demo.tsx examples/gallery/src/generated/interactive/number-field-demo.tsx examples/gallery/src/generated/interactive/number-field-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- UI/gallery H2 field/fieldset native form slice:
  `pnpm exec vitest --run packages/headless-ui/src/primitives/field.test.ts`;
  `pnpm exec vitest --run packages/ui/src/index.test.tsx -t field`;
  `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
  `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive-gallery.test.ts`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t field)`;
  exact `pnpm exec vp check packages/headless-ui/src/primitives/field.ts packages/headless-ui/src/primitives/field.test.ts packages/ui/src/field.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive/field-demo.tsx examples/gallery/src/generated/interactive/field-demo.tsx examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- UI/gallery H2 toolbar roving focus slice:
  `pnpm exec vitest --run packages/headless-ui/src/primitives/toolbar.test.ts`;
  `pnpm exec vitest --run packages/ui/src/index.test.tsx -t toolbar`;
  `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
  `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t toolbar)`;
  exact `pnpm exec vp check packages/headless-ui/src/primitives/toolbar.ts packages/headless-ui/src/primitives/toolbar.test.ts packages/ui/src/index.test.tsx examples/gallery/src/interactive/toolbar-demo.tsx examples/gallery/src/generated/interactive/toolbar-demo.tsx examples/gallery/src/generated/interactive/toolbar-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- UI/gallery H2 tabs manual keyboard activation slice:
  `pnpm exec vitest --run packages/headless-ui/src/primitives/tabs.test.ts`;
  `pnpm exec vitest --run packages/ui/src/index.test.tsx -t tabs`;
  `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t tabs)`;
  exact `pnpm exec vp check packages/headless-ui/src/primitives/tabs.ts packages/headless-ui/src/primitives/tabs.test.ts packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive/tabs-demo.tsx examples/gallery/src/generated/interactive/tabs-demo.tsx examples/gallery/src/generated/interactive/tabs-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- UI/gallery H2 tabs activation no-trap/manual roving slice:
  `pnpm exec vitest --run packages/headless-ui/src/primitives/tabs.test.ts`;
  `pnpm exec vitest --run packages/ui/src/index.test.tsx -t tabs`;
  `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
  `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t tabs)`;
  exact `pnpm exec vp check packages/headless-ui/src/primitives/tabs.ts packages/headless-ui/src/primitives/tabs.test.ts packages/ui/src/index.test.tsx examples/gallery/src/interactive/tabs-demo.tsx examples/gallery/src/generated/interactive/tabs-demo.tsx examples/gallery/src/generated/interactive/tabs-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- UI/gallery H3 menubar keyboard slice:
  `pnpm exec vitest --run packages/headless-ui/src/primitives/menubar.test.ts`;
  `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts)`;
  `pnpm exec vitest --run packages/ui/src/index.test.tsx -t menubar`;
  exact `pnpm exec vp check packages/headless-ui/src/primitives/menubar.ts packages/headless-ui/src/primitives/menubar.test.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/index.ts examples/gallery/src/interactive/menubar-demo.tsx examples/gallery/src/generated/interactive/menubar-demo.tsx examples/gallery/src/generated/interactive/menubar-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`;
  `git diff --check`.
- UI/gallery H3 menu-keyboard slice:
  `pnpm exec vitest --run packages/headless-ui/src/primitives/dropdown-menu.test.ts packages/headless-ui/src/primitives/context-menu.test.ts`;
  `pnpm exec vitest --run examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.test.ts`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts)`;
  exact `pnpm exec vp check packages/headless-ui/src/primitives/dropdown-menu.ts packages/headless-ui/src/primitives/dropdown-menu.test.ts packages/headless-ui/src/primitives/context-menu.ts packages/headless-ui/src/primitives/context-menu.test.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/index.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.tsx examples/gallery/src/interactive/dropdown-menu-demo.tsx examples/gallery/src/interactive/context-menu-demo.tsx examples/gallery/src/generated/interactive/dropdown-menu-demo.tsx examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js examples/gallery/src/generated/interactive/context-menu-demo.tsx examples/gallery/src/generated/interactive/context-menu-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- UI/gallery H3 select native boolean slice:
  `pnpm exec vitest --run packages/headless-ui/src/primitives/select.test.ts`;
  `pnpm exec vitest --run packages/ui/src/index.test.tsx -t select`;
  `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive-gallery.test.ts`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t select)`;
  exact `pnpm exec vp check packages/headless-ui/src/primitives/select.ts packages/headless-ui/src/primitives/select.test.ts packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`;
  `git diff --check`.
- UI/gallery H3 command canceled-close/keyboarding slice:
  `pnpm exec vitest --run packages/headless-ui/src/primitives/command.test.ts`;
  `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t command)`;
  exact `pnpm exec vp check packages/headless-ui/src/primitives/command.ts packages/headless-ui/src/primitives/command.test.ts examples/gallery/src/interactive/command-demo.tsx examples/gallery/src/generated/interactive/command-demo.tsx examples/gallery/src/generated/interactive/command-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`;
  `git diff --check`.
- UI/gallery H3 slider step-state slice:
  `pnpm exec vitest --run packages/headless-ui/src/primitives/slider.test.ts`;
  `pnpm exec vitest --run packages/ui/src/index.test.tsx -t slider`;
  `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t slider)`;
  exact `pnpm exec vp check packages/headless-ui/src/primitives/slider.ts packages/headless-ui/src/primitives/slider.test.ts examples/gallery/src/interactive/slider-demo.tsx examples/gallery/src/generated/interactive/slider-demo.tsx examples/gallery/src/generated/interactive/slider-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- UI/gallery H3 combobox/autocomplete Enter selection slice:
  `pnpm exec vitest --run packages/headless-ui/src/primitives/combobox.test.ts packages/headless-ui/src/primitives/autocomplete.test.ts`;
  `pnpm exec vitest --run packages/ui/src/index.test.tsx -t "combobox|autocomplete"`;
  `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "combobox|autocomplete")`;
  exact `pnpm exec vp check packages/headless-ui/src/primitives/combobox.ts packages/headless-ui/src/primitives/combobox.test.ts packages/headless-ui/src/primitives/autocomplete.ts packages/headless-ui/src/primitives/autocomplete.test.ts examples/gallery/src/interactive/combobox-demo.tsx examples/gallery/src/interactive/autocomplete-demo.tsx examples/gallery/src/generated/interactive/combobox-demo.tsx examples/gallery/src/generated/interactive/combobox-demo.client.js examples/gallery/src/generated/interactive/autocomplete-demo.tsx examples/gallery/src/generated/interactive/autocomplete-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- UI/gallery H3 combobox/autocomplete native form slice:
  `pnpm exec vitest --run packages/headless-ui/src/primitives/autocomplete.test.ts packages/headless-ui/src/primitives/combobox.test.ts`;
  `pnpm exec vitest --run packages/ui/src/index.test.tsx -t "autocomplete|combobox"`;
  `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
  `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive-gallery.test.ts`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "combobox|autocomplete")`;
  `pnpm exec tsc -p examples/gallery/tsconfig.json --noEmit`;
  `pnpm exec vp check`;
  `git diff --check`.
- UI/gallery H2 radio-group native form slice:
  `pnpm exec vitest --run packages/headless-ui/src/primitives/radio-group.test.ts`;
  `pnpm exec vitest --run packages/ui/src/index.test.tsx -t radio-group`;
  `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
  `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive-gallery.test.ts`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t radio-group)`;
  exact `pnpm exec vp check packages/headless-ui/src/primitives/radio-group.ts packages/headless-ui/src/primitives/radio-group.test.ts packages/ui/src/radio-group.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive/radio-group-demo.tsx examples/gallery/src/generated/interactive/radio-group-demo.tsx examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- UI/gallery H2 toggle-group keyboard/focus slice:
  `pnpm exec vitest --run packages/headless-ui/src/primitives/toggle-group.test.ts`;
  `pnpm exec vitest --run packages/ui/src/index.test.tsx -t toggle-group`;
  `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
  `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t toggle-group)`;
  exact `pnpm exec vp check packages/headless-ui/src/primitives/toggle-group.ts packages/headless-ui/src/primitives/toggle-group.test.ts packages/ui/src/index.test.tsx examples/gallery/src/interactive/toggle-group-demo.tsx examples/gallery/src/generated/interactive/toggle-group-demo.tsx examples/gallery/src/generated/interactive/toggle-group-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- Runtime body apply closure:
  `pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts packages/runtime/src/mutation-apply.test.ts packages/runtime/src/apply-deferred-stream.test.ts packages/runtime/src/broadcast.test.ts`;
  `pnpm exec vitest --run packages/runtime/src`;
  `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`;
  `pnpm --filter @jiso/runtime run check:inline-loader`;
  `pnpm exec tsc --noEmit --pretty false`.
- Runtime failure output parser closure:
  `pnpm exec vitest --run packages/runtime/src/mutation-failure.test.ts packages/runtime/src/submit-context.test.ts`;
  `pnpm exec vitest --run packages/runtime/src`;
  `pnpm run check:inline-loader`.
- Harness fixture parser-seam slice:
  `pnpm exec vitest --run packages/test/src/command-fixtures.test.ts packages/test/src/diagnostic-output-fixtures.test.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  `node --test --test-name-pattern "S1 production build proves the compiler 1:1 emit contract|Conformance suites are an explicit gate" tests/fw-check.node.mjs`;
  `pnpm exec vitest --run examples/commerce/src/app.test.ts -t "compiles TSX-authored components to committed IR through the fixpoint gate"`;
  exact `pnpm exec vp check tests/fw-check.node.mjs examples/commerce/src/app.test.ts packages/test/src/command-fixtures.ts packages/test/src/command-fixtures.test.ts packages/test/src/diagnostic-output-fixtures.ts packages/test/src/diagnostic-output-fixtures.test.ts packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- Diagnostic-output lowered event projection slice:
  `pnpm exec vitest --run packages/test/src/diagnostic-output-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm exec vp run build`;
  `node --test --test-name-pattern "D10 seeded diagnostics gate Vite, static export, and MCP red-green surfaces" tests/fw-check.node.mjs`;
  exact `pnpm exec vp check tests/fw-check.node.mjs packages/test/src/diagnostic-output-fixtures.ts packages/test/src/diagnostic-output-fixtures.test.ts packages/test/src/package-exports.test.ts plans/codebase-quality-round2.md`;
  `git diff --check`.

Stale but useful broad references:

- `pnpm run test` previously passed from the then-current file tree: 193 files, 1942 tests.
- `pnpm run test:browser` previously passed: Chromium runtime browser suite, 11 tests.
- `pnpm run test:conformance` previously passed, including Drizzle pinned conformance.

## Integration Queue

- [ ] Integrate active worker branches one at a time with focused gates before each checkpoint.
- [ ] Refill toward five large-slice worker lanes when disjoint ownership and capacity allow.
