# Papercuts 11

Created 2026-06-28. Source of truth remains `SPEC.md`; this ledger captures
framework, starter, docs, and dev-tooling papercuts found while dogfooding a
fresh linked local Kovo build after `plans/bugz-10.md` and
`plans/papercuts-10.md` were fixed.

## Scope

Dogfooded linked local apps under `/Users/mini/kovo-dogfood-20260628f`:
`base-pristine`, `auth-storage-regression`, `ui-copyin-full-catalog`,
`streaming-query-live`, `endpoints-webhooks-access`, and
`prod-export-route-files`.

The baseline app passed first-run `pnpm run test`, `pnpm run check`,
`pnpm run build:prod`, and a dev HTTP smoke. Auth/storage regressions from
`plans/bugz-10.md` were specifically rechecked and not reproduced. No
security/soundness findings were carried forward into a `bugz` ledger from
this pass.

## Issues

### A. UI Copy-In And Starter Gates

- [ ] **`kovo add` copied UI source leaves required package dependencies uninstalled.** (med, dev-tooling; found by `ui-copyin-full-catalog`)
  - Observed behavior: copied dependency-using UI components typechecked only
    after manually adding `@kovojs/headless-ui` and `@kovojs/icons`; the CLI
    printed install hints but left the app in a failing post-command state.
  - Root cause: `packages/cli/src/commands/compile.ts:309` and
    `packages/cli/src/commands/compile.ts:315` report dependencies, while
    `packages/cli/src/add-catalog.ts:122` returns metadata without updating
    the app manifest or otherwise making the dependency step automatic.
  - Why it matters: the copy-in UI workflow should produce a runnable app, or a
    command sequence whose next action is exact and local-link safe.
  - Repro evidence: in `ui-copyin-full-catalog`, `pnpm exec kovo add ...`
    followed by `pnpm exec tsc --noEmit --pretty false` failed until the two
    packages were installed manually.
  - Acceptance: the copy-in command either updates/install required packages or
    emits an exact follow-up command that is covered by a CLI test and leaves a
    fresh linked app typecheckable.

- [ ] **Vendored `PassThroughOptions` is stale and rejects copied checkbox/radio/switch props.** (med, dev-tooling; found by `ui-copyin-full-catalog`)
  - Observed behavior: copied checkbox/radio/switch source failed typecheck
    after installing dependencies because the vendored helper type lacked
    `island` and `bindings`.
  - Root cause: `packages/cli/src/add-catalog.ts:480` inlines
    `PassThroughOptions` that no longer matches the canonical helper at
    `packages/ui/src/pass-through.ts:63`.
  - Why it matters: framework-supplied copied source should not drift from the
    UI package helper it mirrors.
  - Repro evidence: `ui-copyin-full-catalog` still produced TypeScript errors
    in copied checkbox/radio/switch components after package dependencies were
    installed.
  - Acceptance: the vendored helper is generated from or kept equivalent to the
    canonical helper, with copy-in tests for `island` and `bindings`.

- [ ] **Copied child-forwarding UI components render `[object Promise]` in dev.** (high, framework; found by `ui-copyin-full-catalog`)
  - Observed behavior: dev `/catalog` returned HTTP 200 with eight literal
    `[object Promise]` occurrences from copied Breadcrumb/Tabs/Card nested
    children; the production build for the same page had zero occurrences.
  - Root cause: copied children-forwarding components render `props.children`
    directly into dev HTML; dev stringification in `packages/server/src/html.ts:97`
    can still see promised child slots even though `packages/server/src/jsx-runtime.ts:573`
    knows how to resolve promise-aware JSX children.
  - Why it matters: SPEC §4.5 treats children as render-time composition, and
    the dev loop is the first surface authors use to validate copied UI.
  - Repro evidence: `rg -n '\\[object Promise\\]' /tmp/kovo-catalog-dev.html
    /tmp/kovo-catalog-prod.html` matched only the dev response.
  - Acceptance: dev and production render nested copied UI children without
    literal promise strings, with coverage for Breadcrumb/Tabs/Card-style child
    forwarding.

- [ ] **Generated sound-subset script flags JSX prose containing `as HTML` as an unchecked cast.** (low, template; found by `ui-copyin-full-catalog`)
  - Observed behavior: starter `scripts/check-sound-subset.mjs` reported a
    violation for ordinary JSX text that included the phrase `as HTML`.
  - Root cause: the generated script scans raw source text with a broad regex
    around line 24 instead of parsing TypeScript/JSX or skipping string/JSX text
    tokens.
  - Why it matters: the starter's honesty-boundary check should catch unsafe
    casts without making prose copy brittle.
  - Repro evidence: adding JSX prose containing `as HTML` made `pnpm run check`
    fail even though no TypeScript assertion was present.
  - Acceptance: the generated check ignores string and JSX text content while
    still catching real unchecked `as` casts.

### B. Query And Static Analysis

- [ ] **External object-form non-Drizzle output schemas still fail through component-local aliases.** (med, framework; found by `streaming-query-live`)
  - Observed behavior: `directoryAlias.summary.total`,
    `statsAlias.totals.notes`, and `directoryAlias.summary.featuredId` failed
    KV302 even though the imported object-form queries declared matching output
    schemas.
  - Root cause: `componentLocalQueryShapeFacts` in
    `packages/compiler/src/vite.ts:677-696` can alias only shape facts that were
    already extracted for the current compilation unit; external object-form
    query modules such as `src/dogfood-queries.ts` did not contribute facts.
  - Why it matters: SPEC §4.8 / §10.2 make query output schemas the binding
    contract, and ordinary apps factor queries into separate modules.
  - Repro evidence: in `streaming-query-live-repro`, restoring the valid
    `data-bind` paths and running `pnpm run build:prod` reproduced the three
    KV302 diagnostics.
  - Acceptance: object-form query output facts survive imported query aliases,
    with a focused build test using an external query module.

- [ ] **Aliased public `query` imports skip source-derived key assignment.** (med, framework; found by `streaming-query-live`)
  - Observed behavior: `import { query as defineQuery } from '@kovojs/server'`
    followed by `defineQuery({ ... })` built to runtime failure:
    `createApp() received query({ ... }) before the compiler assigned its
    source-derived key.`
  - Root cause: `packages/compiler/src/compile.ts:976-982` requires the local
    import name to be exactly `query`, and
    `packages/compiler/src/source-derived-lowering.ts:88-104` matches call
    expressions by identifier text `query` / `query.elevated`.
  - Why it matters: normal TypeScript import aliasing should not bypass a
    compiler-owned identity assignment required by SPEC §5.2 production
    preflight.
  - Repro evidence: the registered aliased query in `streaming-query-live`
    passed authoring but failed during build evaluation with the missing-key
    assertion.
  - Acceptance: source-derived query lowering tracks imported local bindings,
    including aliases, with regression coverage for `query as defineQuery`.

- [ ] **SQL sink detector treats any `.exec(...)` call as a KV422 sink.** (med, framework; found by `ui-copyin-full-catalog`)
  - Observed behavior: copied `safe-url.ts` failed `build:prod` because
    `schemePattern.exec(stripped)` was treated as an unsafe SQL sink.
  - Root cause: `packages/drizzle/src/static.ts:1273-1279` recognizes `.exec`
    by property name alone, so `RegExp.prototype.exec` in
    `packages/ui/src/safe-url.ts:17` is classified like a database execute
    method.
  - Why it matters: copy-in UI should not trip data-layer security diagnostics
    for ordinary string validation code.
  - Repro evidence: `ui-copyin-full-catalog` `pnpm run build:prod` produced
    KV422 at the copied `safe-url.ts` regexp call.
  - Acceptance: KV422 continues to catch database execute calls while excluding
    obvious `RegExp#exec` calls, with focused static-analysis coverage.

### C. Static Export And Response Semantics

- [ ] **Static export turns a route `redirect()` into a 200 HTML file containing `[object Object]`.** (high, framework; found by `prod-export-route-files`)
  - Observed behavior: `dist/export-skip/redirect-doc/index.html` contained
    `[object Object]`, while a production server control for the same route
    returned `303 Location: /export`.
  - Root cause: `packages/server/src/static-export-response.ts:28` accepts any
    200 HTML response, and `packages/server/src/route.ts:1301-1310` recognizes
    redirects only when they carry the blessed sink witness minted by
    `packages/core/src/index.ts:505-512`.
  - Why it matters: static export should fail closed for non-exportable route
    outcomes instead of writing corrupt artifacts.
  - Repro evidence: `rg '\\[object Object\\]' dist/export-skip/redirect-doc/index.html`
    matched the exported file; the production server returned the correct 303.
  - Acceptance: route redirects during static export are either followed or
    reported as non-exportable, never serialized as object text.

- [ ] **ETag 304 for `respond.file` drops declared cache/security headers.** (med, framework; found by `prod-export-route-files`)
  - Observed behavior: conditional requests to a file response returned 304
    with only `ETag`, omitting the route-declared cache/security headers present
    on the full 200 response.
  - Root cause: `packages/server/src/response.ts:374-384` computes
    `routeOutcomeHeaders(outcome)` but returns a fresh 304 header bag containing
    only `ETag`; the full header assembly lives at
    `packages/server/src/response.ts:563-570`.
  - Why it matters: validators should not strip route posture headers from a
    cached file response.
  - Repro evidence: `prod-export-route-files` showed the 200 response contained
    the declared headers, while the matching `If-None-Match` request returned
    only `ETag`.
  - Acceptance: 304 file responses retain declared route headers where HTTP
    permits them, with a focused response test.

- [ ] **Static export reports generic 500 for public deferred/streaming routes.** (low, dev-tooling; found by `streaming-query-live`)
  - Observed behavior: attempting to statically export a public
    deferred/streaming route produced a generic 500-style failure instead of a
    concrete non-exportable-route diagnostic.
  - Root cause: `packages/server/src/static-export-response.ts:61` emits a
    generic non-200 diagnostic without naming the route outcome that makes the
    page unsuitable for static export.
  - Why it matters: authors need to distinguish framework crashes from expected
    dynamic-route export limits.
  - Repro evidence: `streaming-query-live` static export surfaced only the
    generic 500 path for a route intentionally using dynamic streaming behavior.
  - Acceptance: static export reports a precise non-exportable deferred/streaming
    route reason without changing runtime behavior.

### D. Webhook And Docs Ergonomics

- [ ] **Write webhooks without a replay store pass build/explain but 500 on signed delivery.** (med, framework; found by `endpoints-webhooks-access`)
  - Observed behavior: a webhook declared with `writes`, `idempotency`, and
    `recordChange()` but no `replayStore` passed build/explain, then failed at
    runtime on signed delivery.
  - Root cause: `packages/server/src/webhook.ts:556-564`
    `assertWebhookReplayPosture()` runs only after `recordChange()`, so the
    dead-on-arrival write webhook shape is not rejected by static posture
    checks.
  - Why it matters: SPEC §11.4 positions machine ingress as auditable before
    deployment; a write webhook that cannot accept its first valid delivery
    should fail earlier.
  - Repro evidence: `endpoints-webhooks-access` build/explain succeeded for the
    webhook, but the signed delivery path returned 500 once `recordChange()` was
    reached.
  - Acceptance: build/posture verification rejects write webhooks that require
    replay protection but omit `replayStore`, with a focused webhook test.

- [ ] **Getting-started docs show an incomplete endpoint-posture command.** (low, docs; found by `endpoints-webhooks-access`)
  - Observed behavior: docs show bare `kovo check endpoint-posture`, while the
    generated workflow and CLI examples require an explicit fixture path such as
    `.kovo/endpoint-posture.json`.
  - Root cause: `site/content/getting-started/installation.md:99-101` drifted
    from `packages/cli/src/commands-manifest.ts:137-139`.
  - Why it matters: first-run verification docs should match the generated
    starter command exactly.
  - Repro evidence: comparing the docs snippet with the CLI command manifest
    showed the missing fixture argument.
  - Acceptance: getting-started docs name the same endpoint-posture command
    shape generated by the starter.

## Refuted / Not Carried Forward

- `plans/bugz-10.md` auth/storage fixes were rechecked in
  `auth-storage-regression`: unauthenticated redirects carried
  `Cache-Control: private, no-store` and `Vary: Cookie`; server-sniffed
  `accept([...]).store()` rejected mismatched HTML bytes; `accept.unverified`
  remained the explicit escape hatch; mutation reauth, guarded query cache
  headers, rate-limit responses, storage downloads, and replay handling held.
- Live-target wire import merging, dev/prod streaming chunk behavior, and
  no-JS fallback behavior were rechecked and not carried forward.
- Public raw endpoint explain/access, verifier auth, default-CSRF JSON/form
  handling, cookie stripping, and write webhooks with a supplied replay store
  were rechecked and not carried forward.
- Production copied UI rendering did not reproduce the prior `[object Promise]`
  failure; this pass carries forward only the dev rendering variant.
- Static export file/not-found route behavior and production assets/modules were
  rechecked and not carried forward.

## Latest Verification

- `pnpm run test`, `pnpm run check`, `pnpm run build:prod` in
  `/Users/mini/kovo-dogfood-20260628f/base-pristine`: passed.
- Baseline dev smoke: `/` returned `303` with `Vary: Cookie`,
  `Cache-Control: private, no-store`, and `Location: /login?next=%2F`;
  `/api/health` returned `200 {"ok":true}`.
- First-hand reproductions recorded above were verified from the dogfood apps
  and source inspections before this ledger was written.
