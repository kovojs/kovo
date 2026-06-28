# Papercuts 10

Created 2026-06-28. Source of truth remains `SPEC.md`; this ledger captures
framework, starter, and tooling papercuts found while dogfooding advanced Kovo
surfaces after `plans/papercuts-9.md` was fixed.

## Scope

Dogfooded linked local apps under `/Users/mini/kovo-dogfood-20260628e`:
`base-pristine-fixed`, `streaming-query-deferred`,
`endpoints-webhooks-posture`, and `ui-registry-rich-composition`, plus the
security-focused apps referenced from `plans/bugz-10.md`.

The baseline app passed first-run `pnpm run test`, `pnpm run check`,
`pnpm run build:prod`, and a dev HTTP smoke. Security/soundness defects from
the same pass are filed in `plans/bugz-10.md`.

## Issues

### A. Query / Live Target Build Path

- [x] **Object-form non-Drizzle query output schemas fail KV302 when the component uses a local query alias.** (med, framework; found by `streaming-query-deferred`)
  - Observed behavior: `query({ output: s.object(...) })` exported as
    `statusQuery`, then bound in a component as `queries: { status:
statusQuery }`, failed `build:prod` with KV302 for valid
    `status.summary`, `status.generatedAt`, and `status.totals.streams`
    bindings.
  - Root cause: `packages/server/src/vite.ts:872-891` keys object-form query
    output facts by exported variable name, while
    `packages/compiler/src/validate/bindings.ts:44-56` validates `data-bind`
    paths against the component-local query option name.
  - Why it matters: SPEC §4.8 / §10.2 make query output shape the UI data
    contract. Natural component-local aliases are a normal authoring pattern,
    and this is a variant of the non-Drizzle output-schema fix from
    `plans/papercuts-8.md`.
  - Repro evidence: in `streaming-query-deferred`, `pnpm run build:prod`
    reported KV302 for `status.summary`, `status.generatedAt`, and
    `status.totals.streams` even though those fields exist in the declared
    output schema.
  - Acceptance: output-shape facts are associated with component-local query
    bindings, not only exported variable names, with a focused build test for an
    object-form query alias.
  - Evidence: 2026-06-28 `pnpm exec vitest run
    packages/compiler/src/compile-component.test.ts
    packages/server/src/vite-data-plane-gate.test.ts` passed with object-form
    query alias output-shape coverage.

- [x] **Live-target renderer emission skips required imports when the lowered module already imports `@kovojs/server/internal/wire`.** (high, framework; found by `streaming-query-deferred`)
  - Observed behavior: a query-backed component with streaming mutation forms
    failed build evaluation with `registerGeneratedLiveTargetRenderer is not
defined`.
  - Root cause: `packages/compiler/src/emit/live-target-renderers.ts:39-45`
    treats any import from `@kovojs/server/internal/wire` as satisfying the
    live-target renderer import. A lowered module that already imported only
    `assignDerivedQueryKey` skipped adding `componentLiveTargetRenderer` and
    `registerGeneratedLiveTargetRenderer`, then emitted calls to both names.
  - Why it matters: SPEC §5.2 production preflight should not fail because two
    compiler features need different named imports from the same internal module.
  - Repro evidence: in `streaming-query-deferred`, `pnpm run check` failed with
    `ERROR registerGeneratedLiveTargetRenderer is not defined`; the lowered
    source already imported `{ assignDerivedQueryKey as
__kovoAssignDerivedQueryKey }` from the wire module.
  - Acceptance: live-target renderer emission adds or merges the exact required
    named imports, with coverage for an existing wire import that lacks those
    names.
  - Evidence: 2026-06-28 `pnpm exec vitest run
    packages/compiler/src/compile-component.test.ts
    packages/server/src/vite-data-plane-gate.test.ts` passed with live-target
    renderer wire-import merge coverage.

### B. Copied UI Composition

- [x] **Copied `Card` renders nested rich children as literal `[object Promise]` in dev and production.** (high, framework; found by `ui-registry-rich-composition`)
  - Observed behavior: a public `/catalog` route using copied
    `<Card><div><Table>...</Table></div></Card>` returned HTTP 200 but rendered
    a literal `[object Promise]` inside the card body in both dev and production.
  - Root cause: `packages/ui/src/card.tsx:14-16` types `children` as `string`
    and `packages/ui/src/card.tsx:46-50` renders `props.children` directly. The
    server runtime can resolve promise-like JSX children, but the copied UI
    primitive treats projected JSX as a plain prop string.
  - Why it matters: SPEC §4.5 defines children as render-time HTML composition.
    The primary copy-in UI workflow visibly corrupts ordinary nested component
    composition.
  - Repro evidence: in `ui-registry-rich-composition`, `curl
http://127.0.0.1:5274/catalog` against the production server returned
    `HTTP/1.1 200` and `rg '\\[object Promise\\]'` matched the response.
  - Acceptance: copied `Card` accepts and renders rich JSX/HTML children without
    literal promise strings, with dev and production coverage.
  - Evidence: 2026-06-28 `pnpm exec vitest --run
    packages/ui/src/card.stylex.test.tsx packages/cli/src/index.kovo-add.test.ts
    packages/ui/src/copy-in.test.ts` passed with nested Card/Table children
    rendering without `[object Promise]`.

- [x] **`kovo add tabs` copies a TSX file that imports an uncopied sibling type module.** (med, dev-tooling; found by `ui-registry-rich-composition`)
  - Observed behavior: `kovo add tabs --out src/components/ui-tabs-repro`
    succeeded, but the app could not typecheck because copied `tabs.tsx` imports
    `./navigation-types.js`, which was not copied.
  - Root cause: `packages/ui/src/tabs.tsx:13` imports
    `./navigation-types.js`, but `packages/cli/src/add-catalog.ts` and
    `packages/cli/src/commands/compile.ts:252-276` copy only the requested
    component entry source.
  - Why it matters: a documented copy-in component leaves the generated app
    broken immediately after a successful CLI command.
  - Repro evidence: in `ui-registry-rich-composition`, `pnpm exec kovo add tabs
--out src/components/ui-tabs-repro && pnpm exec tsc --noEmit --pretty false`
    produced `TS2307: Cannot find module './navigation-types.js'`.
  - Acceptance: `kovo add tabs` either vendors required sibling type modules or
    rewrites the copied source to depend only on copied/public imports.
  - Evidence: 2026-06-28 `pnpm exec vitest --run
    packages/ui/src/card.stylex.test.tsx packages/cli/src/index.kovo-add.test.ts
    packages/ui/src/copy-in.test.ts` passed with `kovo add tabs` copying
    `navigation-types.ts`.

- [x] **Freshly copied UI source still fails the generated formatter gate.** (med, dev-tooling; found by `ui-registry-rich-composition`)
  - Observed behavior: after copying button/card/table/command/combobox/select/
    dialog/badge/alert/popover, the first `pnpm run check` failed on formatter
    issues in framework-supplied copied files; `vp check --fix` made the gate
    pass.
  - Root cause: `packages/cli/src/commands/compile.ts:257-276` normalizes only
    for overwrite comparison but writes `entry.source` directly, and
    `packages/cli/src/add-catalog.ts:111-136` returns vendored source rather
    than app-formatter output.
  - Why it matters: the normal copy-in workflow makes the starter's own check
    command fail until authors format framework-owned files. This is a regression
    variant of the formatter/idempotency work in `plans/papercuts-8.md`.
  - Repro evidence: in `ui-registry-rich-composition`, immediate `pnpm run check`
    after copy-in reported formatting issues for copied UI files; after `pnpm
exec vp check --fix`, `pnpm run check` passed and `kovo add` remained
    idempotent.
  - Acceptance: copied UI files land formatter-stable for the generated app, and
    idempotency remains stable after the formatter.
  - Evidence: 2026-06-28 `pnpm exec vitest --run
    packages/ui/src/card.stylex.test.tsx packages/cli/src/index.kovo-add.test.ts
    packages/ui/src/copy-in.test.ts` passed with canonicalized vendored source
    and copy-in idempotency coverage.

### C. Endpoint Explain Ergonomics

- [x] **Endpoint explain hides `publicAccess(...)` justification on raw endpoints.** (low, dev-tooling; found by `endpoints-webhooks-posture`)
  - Observed behavior: default-CSRF raw endpoints declared `access:
publicAccess(...)` and passed build/access checks, but `kovo explain
--endpoints` printed `auth=-` with no public justification; `kovo explain
--access` separately showed the public decision and justification.
  - Root cause: `packages/cli/src/commands/build-export.ts:753-770` preserves
    `endpoint.access`, but `packages/cli/src/graph-output.ts:1842-1850` renders
    only `endpointAuth(...)`; `endpointAuth` at
    `packages/cli/src/graph-output.ts:2077-2082` ignores access decisions.
  - Why it matters: SPEC §11.4 positions endpoint explain as the stable
    machine-ingress audit. Security reviewers should see intentional public
    ingress justification on the endpoint row, not only in a second access view.
  - Repro evidence: in `endpoints-webhooks-posture`, `pnpm exec kovo explain
--endpoints dist/.kovo/graph.json | rg '/api/echo-(json|form|text)'`
    printed `auth=- csrf=checked`; `kovo explain --access` printed
    `decision=public ... justification=...`.
  - Acceptance: endpoint explain rows surface `publicAccess(...)` decisions and
    justifications for raw endpoints without regressing `auth=none:<reason>`.
  - Evidence: 2026-06-28 `pnpm exec vitest run
    packages/cli/src/index.kovo-explain.test.ts` passed with
    `auth=public:<justification>` endpoint explain coverage.

## Refuted / Not Carried Forward

- Streaming JSX attribute types, `data-mutation-stream` emission, production
  `streamText` lowering, missing stream-target runtime handling, static export
  diagnostics, and dev/prod streaming chunks were rechecked and were not carried
  forward.
- Webhook write auditing, endpoint posture observation, explicit `auth: none`
  justifications, docs webhook shapes, default-CSRF JSON/form endpoints, cookie
  stripping on `csrf:false`, and webhook replay smoke were rechecked and were not
  carried forward.
- Copied UI sound-subset, `kovo add` idempotency after formatting, and id-less
  `SelectItem` behavior were rechecked and were not carried forward.

## Latest Verification

- `pnpm run test`, `pnpm run check`, `pnpm run build:prod` in the fresh fixed
  baseline app passed before fan-out.
- `curl http://127.0.0.1:5274/catalog` in
  `ui-registry-rich-composition`: reproduced a production 200 response
  containing literal `[object Promise]`.
- Worker gates across `streaming-query-deferred`, `endpoints-webhooks-posture`,
  and `ui-registry-rich-composition` supplied the command-level reproductions
  recorded under each issue.
