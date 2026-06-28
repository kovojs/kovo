# Papercuts 12

Created 2026-06-28. Source of truth remains `SPEC.md`; this ledger captures
framework, starter, and dev-tooling papercuts found while dogfooding after
`plans/papercuts-11.md` was fixed.

## Scope

Dogfooded linked local apps under `/Users/mini/kovo-dogfood-20260628g`:
`base-pristine`, `ui-copyin-recheck`, `query-stream-export-recheck`, and
`drizzle-optimistic-style-recheck`, plus the security-focused apps referenced
from `plans/bugz-11.md`.

The baseline app passed first-run `pnpm run test`, `pnpm run check`,
`pnpm run build:prod`, and a dev HTTP smoke. Security/soundness defects from
the same pass are filed in `plans/bugz-11.md`.

## Issues

### A. Copied UI Workflow

- [ ] **Copied nested UI primitives still render literal `[object Promise]` in dev.** (high, framework; found by `ui-copyin-recheck`)
  - Observed behavior: dev `GET /catalog` returned HTTP 200 but the HTML
    contained 13 literal `[object Promise]` strings in Breadcrumb, Card, Tabs,
    Accordion, Dialog, and Toast child regions.
  - Root cause: copied components forward nested `props.children` directly
    through component props, including `packages/ui/src/card.tsx:46-50`,
    `packages/ui/src/breadcrumb.tsx:138-145`, and
    `packages/ui/src/tabs.tsx:237-245`. The server runtime is promise-aware at
    `packages/server/src/jsx-runtime.ts:573-607`, but the broad copied-component
    dev path still lets child promises reach text output.
  - Why it matters: SPEC §4.5 treats children as render-time composition. This
    is a visible regression/variant of the copied-child fixes in
    `plans/papercuts-10.md` and `plans/papercuts-11.md`.
  - Repro evidence:
    `/Users/mini/kovo-dogfood-20260628g/ui-copyin-recheck` dev curl wrote
    `/tmp/kovo-ui-copyin-dev.html`; `rg '\\[object Promise\\]'` found 13
    matches.
  - Acceptance: broad copied UI composition renders without literal promise
    strings in dev and production, with coverage beyond Card-only forwarding.

- [ ] **Full copied UI catalog makes production build time out or hang.** (high, dev-tooling; found by `ui-copyin-recheck`)
  - Observed behavior: after copying the broad UI catalog, `pnpm run check`
    failed during `build:prod` with `transport invoke timed out after 60000ms`;
    standalone `pnpm run build:prod` stayed active for several minutes and had
    to be stopped.
  - Root cause: the production build path evaluates the app through Kovo/Vite
    preflight and graph collection in `packages/cli/src/commands/build-export.ts:432-469`
    and `packages/cli/src/commands/build-export.ts:528-541`, but the timeout is
    surfaced as a raw Vite module-runner failure and no smaller Kovo diagnostic
    identifies the copied UI import/render bottleneck.
  - Why it matters: `kovo add` succeeds, `tsc` passes, and tests pass, but the
    deploy gate cannot complete for an app using Kovo's copied UI catalog.
  - Repro evidence:
    `/Users/mini/kovo-dogfood-20260628g/ui-copyin-recheck` `pnpm run check`
    timed out during `build:prod`; standalone `pnpm run build:prod` hung until
    stopped.
  - Acceptance: the broad copied UI catalog either builds within the production
    preflight budget or fails with a concrete diagnostic that names the
    problematic import/render path.

- [ ] **`kovo add` dependency insertion leaves `package.json` failing the starter formatter.** (med, dev-tooling; found by `ui-copyin-recheck`)
  - Observed behavior: immediately after `kovo add` installed
    `@kovojs/headless-ui` and `@kovojs/icons`, `pnpm run check` failed
    formatting on `package.json`.
  - Root cause: `packages/cli/src/commands/compile.ts:403-410` writes the
    modified manifest with plain `JSON.stringify`, and
    `packages/cli/src/commands/compile.ts:464-475` appends dependency keys
    without preserving the starter formatter's sorted dependency order.
  - Why it matters: the normal copy-in workflow mutates a generated app file and
    immediately makes the generated app's own check gate fail.
  - Repro evidence: fresh linked app, broad `pnpm exec kovo add ... --out
src/components/ui`, then `pnpm run check` reports `package.json`
    formatting.
  - Acceptance: `kovo add` writes formatter-stable manifest changes, with a CLI
    test covering inserted dependency order.

- [ ] **Copied UI helper warnings still flood generated app checks.** (low, dev-tooling; found by `ui-copyin-recheck` and `drizzle-optimistic-style-recheck`)
  - Observed behavior: after formatting, `vp check` reported dozens of warnings
    from copied files, including unused `bindingProps` in copied Command and
    Combobox and table stringification warnings.
  - Root cause: `packages/cli/src/add-catalog.ts:553` injects broad
    pass-through support including `bindingProps` into copied files that do not
    use it; table stringification helpers at `packages/ui/src/table.tsx:88-110`
    and `packages/ui/src/table.tsx:328-333` also trip the generated app warning
    profile.
  - Why it matters: generated framework-owned source creates warning noise that
    obscures real app warnings.
  - Repro evidence:
    `/Users/mini/kovo-dogfood-20260628g/drizzle-optimistic-style-recheck`
    `pnpm exec kovo add command combobox && pnpm run check` passed but reported
    copied-file unused-helper warnings; the full UI catalog reported 34
    warnings.
  - Acceptance: copied UI files are warning-clean under the generated starter
    check profile.

### B. Query / Streaming Build Paths

- [ ] **Aliased object-form non-Drizzle query output schemas do not feed binding validation.** (med, framework; found by `query-stream-export-recheck`)
  - Observed behavior: `import { query as defineQuery }` and
    `defineQuery.elevated(...)` failed `build:prod` with KV302 for valid paths
    declared by `output: s.object(...)`: `leads.summary.newest`,
    `leads.summary.total`, `audit.count`, and `audit.lastTouched`.
  - Root cause: `packages/server/src/vite.ts:848` /
    `packages/server/src/vite.ts:997` extract output-schema query shape facts
    through `isQueryCallee(...)`, which accepts only literal `query` and
    `query.elevated`, not import aliases.
  - Why it matters: this regresses the non-Drizzle output-schema shape path when
    authors use normal TypeScript import aliasing.
  - Repro evidence:
    `/Users/mini/kovo-dogfood-20260628g/query-stream-export-recheck`
    `pnpm run check` failed with KV302 until only the aliased query import was
    changed back to unaliased `query`.
  - Acceptance: output-schema fact extraction resolves public `query` import
    aliases, with a focused `query as defineQuery` test.

- [ ] **Streaming mutation `stream.query(...)` is misclassified as a SQL sink.** (med, framework; found by `query-stream-export-recheck`)
  - Observed behavior: `kovo build` failed with KV422 for
    `yield stream.query({ name, value })`, reporting `query() receives
unknown-provenance SQL text`.
  - Root cause: `packages/drizzle/src/static.ts:1273` treats any property call
    named `.query(...)` as a SQL sink; the receiver classification around
    `packages/drizzle/src/static.ts:804` does not exclude Kovo streaming helpers.
  - Why it matters: the public streaming mutation API cannot emit query-truth
    chunks in production builds even though it is not a SQL sink.
  - Repro evidence:
    `/Users/mini/kovo-dogfood-20260628g/query-stream-export-recheck`
    `pnpm run build:prod` failed until the `stream.query(...)` yield was
    removed.
  - Acceptance: KV422 continues to catch real database `.query(...)` calls while
    excluding Kovo `stream.query(...)`, with focused static-analysis coverage.

### C. Static Export Diagnostics

- [ ] **Static export still collapses an interactive `/` route to generic KV229 replay 500.** (low, dev-tooling; found by `query-stream-export-recheck`)
  - Observed behavior: `kovo export --skip-non-exportable` emitted a concrete
    KV229 for `/export-blocked/:id`, but `/` reported only `returned status
500` instead of the deferred/streaming or mutation endpoint reason.
  - Root cause: `packages/server/src/static-export-response.ts:37-52` falls
    back to generic status diagnostics when source replay returns a 500 body
    without detectable endpoint refs/deferred markers, even though dev/prod for
    the same route return 200 with `<kovo-defer>`, `--kovo-boundary`,
    `<kovo-fragment>`, and `/_m/` markers.
  - Why it matters: authors need to distinguish framework crashes from expected
    dynamic-route export limits.
  - Repro evidence:
    `/Users/mini/kovo-dogfood-20260628g/query-stream-export-recheck`
    `pnpm exec kovo export ./src/app.tsx --skip-non-exportable` reported
    generic KV229 replay status 500 for `/`.
  - Acceptance: source export replay reports a concrete non-exportable cause or
    the actual render exception, not only generic replay status 500.

## Refuted / Not Carried Forward

- `kovo add` dependency installation and local `link:` preservation worked:
  copied UI dependencies were added as linked specs and `tsc --noEmit` passed.
- Vendored `PassThroughOptions.island` / `bindings`, copy-in idempotency,
  `safe-url.ts` `RegExp#exec` KV422, source-derived query keys, live-target wire
  imports, streaming form/text lowering, no-JS fallback, webhook replay posture,
  file/stream static export diagnostics, file 304 headers, and real SQL sink
  detection were rechecked and not carried forward.

## Latest Verification

- `pnpm run test`, `pnpm run check`, `pnpm run build:prod`, and dev HTTP smoke
  passed in `/Users/mini/kovo-dogfood-20260628g/base-pristine`.
- Worker gates across `ui-copyin-recheck`, `query-stream-export-recheck`, and
  `drizzle-optimistic-style-recheck` supplied the command-level reproductions
  recorded under each issue.
