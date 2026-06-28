# Papercuts 8

Created 2026-06-28. Source of truth remains `SPEC.md`; this ledger captures
framework, template, docs, and dev-tooling papercuts found during the third
exhaustive Kovo dogfood pass.

Meta-theme: core app gates are now green, but advanced surfaces still expose
skew between public authoring syntax, generated review artifacts, and runtime
behavior.

## Scope

Dogfooded linked local apps under `/Users/mini/kovo-dogfood-20260628d`:
`base-pristine`, `auth-session-cache`, `endpoints-webhooks-agent`,
`registry-ui-catalog`, `storage-multi-capability`, and
`streaming-deferred-mpa`.

The fresh baseline passed `pnpm run check`, `pnpm run test`, `pnpm run build:prod`,
and a dev HTTP smoke. Security/soundness findings from this pass are filed
separately in `plans/bugz-9.md`.

## Issues

### A. UI Copy-In / Registry

- [ ] **`kovo add` copies UI source that cannot pass the generated app check gate.** (high, dev-tooling/framework; found by `registry-ui-catalog`)
  - Observed behavior: running `kovo add` for
    button/card/command/combobox/select/table/dialog into `src/components/ui`
    succeeds, but the copied files are not clean under
    the generated app's `check` workflow. After formatting, `vp` still reports
    warnings in copied UI files, and `check:sound-subset` rejects copied
    `table.tsx` casts.
  - Root cause: `packages/cli/src/add-catalog.ts:116-135` returns raw transformed
    vendored source, `packages/cli/src/commands/compile.ts:272` writes it
    directly, and the generated starter scanner recursively checks all `src`
    files, including vendored UI.
  - Why it matters: the documented copy-in workflow leaves a normal app unable
    to run its standard generated validation command without manually editing
    framework-supplied files.
  - Repro evidence: in
    `/Users/mini/kovo-dogfood-20260628d/registry-ui-catalog`,
    `pnpm exec vp check src/components/ui/*.tsx` reports copied-file warnings,
    and `node scripts/check-sound-subset.mjs` fails on
    `src/components/ui/table.tsx` unchecked casts.
  - Acceptance: copied UI components are formatted and sound-subset-compatible
    for generated apps, or copied sources are excluded by an explicit, reviewed
    generated gate policy.

- [ ] **`kovo add` becomes non-idempotent after the app formatter touches copied source.** (med, dev-tooling/framework; found by `registry-ui-catalog`)
  - Observed behavior: after formatting copied `button.tsx`, rerunning
    `kovo add button --out src/components/ui` fails with `reason=would-overwrite`
    instead of `SKIP`.
  - Root cause: `packages/cli/src/commands/compile.ts:257-269` compares the
    target file to the raw registry source byte-for-byte, while the registry
    source is not normalized to the app formatter output.
  - Why it matters: following the generated formatter advice makes future
    component retries/upgrades look destructive.
  - Repro evidence: in
    `/Users/mini/kovo-dogfood-20260628d/registry-ui-catalog`,
    `pnpm exec kovo add button --out src/components/ui` returned
    `ERROR button ... reason=would-overwrite` after formatter-normalized source
    existed.
  - Acceptance: `kovo add` idempotency is based on the same normalized source
    shape it writes/checks, or it has a safe upgrade/diff mode for formatted
    copies.

- [ ] **Dev SSR renders nested copied Card children as `[object Promise]` while production is clean.** (med, framework/dev-tooling; found by `registry-ui-catalog`)
  - Observed behavior: a public `/catalog` route using copied
    `<Card><Button /></Card>` and nested copied command/combobox/select parts
    renders literal `[object Promise]` in dev SSR; production node output renders
    the same route cleanly.
  - Root cause: copied `card.tsx` passes async JSX children through directly, and
    the dev JSX runtime awaits component render results only after the component
    render path (`packages/server/src/jsx-runtime.ts:569-587`), creating dev/prod
    skew for ordinary nested composition.
  - Why it matters: app authors see broken HTML during the primary dev loop even
    when deploy output is correct.
  - Repro evidence: in `registry-ui-catalog`, the worker observed
    `curl /catalog | rg '\\[object Promise\\]'` matching in dev and no matches
    from the production node server after `pnpm run build:prod`.
  - Acceptance: dev SSR awaits or renders copied UI component children with the
    same semantics as the production compiler path.

### B. Streaming / Deferred

- [x] **Streaming JSX attributes are missing from public JSX types.** (med, framework; found by `streaming-deferred-mpa`)
  - Observed behavior: `<form enhance stream>` and
    `<p streamText="assistant:latest">` fail `tsc` until the app adds a local JSX
    module augmentation.
  - Root cause: `packages/server/src/jsx-runtime.ts:760` defines
    `JSX.HtmlAttributes` but omits `stream` and `streamText`, while compiler
    support exists in `packages/compiler/src/emit/server-emit-shared.ts` and
    `packages/compiler/src/emit/mutation-form.ts`.
  - Why it matters: the public streaming/deferred syntax is not type-usable in a
    strict scaffolded TS app without app-local framework type patches.
  - Repro evidence: in `streaming-deferred-mpa`, `pnpm exec tsc --noEmit` failed
    before local augmentation with `TS2322: Property 'stream' does not exist` and
    `TS2322: Property 'streamText' does not exist`.
  - Acceptance: Kovo's JSX namespace exposes the public streaming attributes with
    the same names accepted by the compiler.
  - Evidence: 2026-06-28 `pnpm exec vitest run packages/server/src/jsx-runtime.test.ts packages/server/src/jsx-runtime-types.test.ts packages/server/src/static-export-response.test.ts` passed after `packages/server/src/jsx-runtime.ts` added `stream` / `streamText` JSX attributes.

- [x] **Served streaming forms keep raw `stream` and never emit `data-mutation-stream`.** (high, framework; found by `streaming-deferred-mpa`)
  - Observed behavior: dev and production route HTML render
    `<form ... enhance stream ... data-mutation="mutations/send-message">` with
    no `data-mutation-stream`, so the browser loader uses the buffered mutation
    path.
  - Root cause: `packages/server/src/jsx-runtime.ts:338-342` adds
    `method`/`action`/`data-mutation` for mutation forms but not
    `data-mutation-stream`, while `packages/browser/src/inline-loader-build.ts:952`
    enables streaming only when `data-mutation-stream` exists.
  - Why it matters: an author writes the documented streaming form shape, but real
    browser submissions do not send `Kovo-Stream: true`.
  - Repro evidence: first-hand in `streaming-deferred-mpa`, both the production
    server on port 5291 and dev server on 5292 served forms with raw `stream` and
    no `data-mutation-stream`.
  - Acceptance: authored streaming mutation forms lower to
    `data-mutation-stream="true"` wherever enhanced mutation forms are rendered.
  - Evidence: 2026-06-28 `pnpm exec vitest run packages/server/src/jsx-runtime.test.ts packages/server/src/jsx-runtime-types.test.ts packages/server/src/static-export-response.test.ts` passed with direct JSX form lowering coverage, and `pnpm --filter @kovojs/browser exec vitest run src/inline-loader-enhanced-submit.test.ts src/inline-loader-build.test.ts` passed.

- [x] **Production node output leaves raw `streamText` instead of runtime-visible `data-stream-text`.** (high, framework; found by `streaming-deferred-mpa`)
  - Observed behavior: dev served `<p data-stream-text="assistant:latest">`, but
    production node output served `<p streamText="assistant:latest">`; the browser
    runtime searches only for `[data-stream-text="..."]`.
  - Root cause: `packages/compiler/src/emit/server-render.ts:110` wires the
    stream-text lowering for one render path, but production node rendering falls
    back to generic JSX attribute emission in `packages/server/src/jsx-runtime.ts`.
  - Why it matters: streamed text chunks can target a selector that production
    never emits, making streamed assistant text disappear.
  - Repro evidence: first-hand in `streaming-deferred-mpa`, the production route
    on port 5291 showed raw `streamText`, while the dev route on port 5292 showed
    `data-stream-text`.
  - Acceptance: all production and dev render paths lower `streamText` to
    `data-stream-text` consistently.
  - Evidence: 2026-06-28 `pnpm exec vitest run packages/server/src/jsx-runtime.test.ts packages/server/src/jsx-runtime-types.test.ts packages/server/src/static-export-response.test.ts` passed with `streamText` lowering coverage; `pnpm --filter @kovojs/compiler exec vitest run src/stamps.test.ts` preserved compiler lowering coverage.

- [x] **Missing streaming text targets are silently ignored by the browser runtime.** (med, framework; found by `streaming-deferred-mpa`)
  - Observed behavior: a streamed response targeting `assistant:missing` returned
    200 plus `<kovo-done>`, while the runtime skipped the absent target without
    marking failure or refetching.
  - Root cause: `packages/browser/src/inline-loader-build.ts:839-842` skips when
    `sft(x.target)` returns no element, and `packages/browser/src/inline-loader-build.ts:852-853`
    marks only previously seen targets as failed.
  - Why it matters: SPEC §9.1 expects missing stream targets to fail or recover;
    the current runtime can present a completed mutation while dropping content.
  - Repro evidence: in `streaming-deferred-mpa`, a manual enhanced POST with
    `Kovo-Stream: true` returned a fragment body containing
    `<kovo-text target="assistant:missing">...` followed by `<kovo-done>`.
  - Acceptance: missing streaming text targets trigger a visible failure,
    refetch, or other deterministic recovery rather than silent success.
  - Evidence: 2026-06-28 `pnpm --filter @kovojs/browser exec vitest run src/inline-loader-enhanced-submit.test.ts src/inline-loader-build.test.ts` passed with missing stream text target failure coverage.

- [x] **Static export reports a generic 500 for a public streaming/deferred route.** (low, dev-tooling; found by `streaming-deferred-mpa`)
  - Observed behavior: `kovo export --skip-non-exportable` reported
    `/streaming-deferred` as status 500, while the production node server served
    the same public route as 200.
  - Root cause: `packages/server/src/static-export-response.ts:26` collapses
    non-200 replay into generic KV229, and
    `packages/server/src/static-export-document.ts:52` emits actionable
    endpoint-ref diagnostics only after a successful replay body.
  - Why it matters: export/deploy checks hide the actual non-exportable cause for
    a valid dynamic route.
  - Repro evidence: in `streaming-deferred-mpa`,
    `pnpm exec kovo export ... --skip-non-exportable` printed
    `WARN KV229 route=/streaming-deferred ... returned status 500`.
  - Acceptance: static export emits the concrete exportability reason for
    streaming/deferred routes rather than an opaque replay 500.
  - Evidence: 2026-06-28 `pnpm exec vitest run packages/server/src/jsx-runtime.test.ts packages/server/src/jsx-runtime-types.test.ts packages/server/src/static-export-response.test.ts` passed with replayed HTML endpoint-ref diagnostics coverage.

### C. Query Shape / Bindings

- [ ] **Non-Drizzle query `output` schemas do not feed query binding shape validation.** (med, framework; found by `streaming-deferred-mpa`)
  - Observed behavior: a plain `query({ output: s.object(...) })` loads
    correctly, but bindings such as `status.summary` and `status.generatedAt`
    are rejected with KV302.
  - Root cause: `packages/compiler/src/validate/bindings.ts:44` validates
    against `componentQueryShapes`, `packages/compiler/src/vite.ts:504` passes
    only external query shape facts, and plain server query `output` schemas from
    `packages/server/src/query.ts` are not converted into shape facts; Drizzle has
    a separate extractor.
  - Why it matters: typed reads without Drizzle cannot use their declared output
    schemas for compiler-checked bindings.
  - Repro evidence: in `streaming-deferred-mpa`, `pnpm run test` failed with
    `KV302 data-bind path is not present in the declared query shape` for
    `status.summary` and `status.generatedAt`.
  - Acceptance: non-Drizzle query `output` schemas produce component query shape
    facts for binding validation.

### D. Storage / Capabilities

- [x] **Multiple storage endpoints make route `ctx.signUrl` mint an unmounted default URL.** (med, framework; found by `storage-multi-capability`)
  - Observed behavior: an app with several `createStorageDownloadEndpoint` mounts
    rendered a route-context signed URL under `/_kovo/storage/...`, which 404ed;
    a manually created signer for `/private-downloads` returned 200 for the same
    stored object.
  - Root cause: `packages/server/src/app-document.ts:220-225` returns a storage
    base path only when exactly one storage endpoint exists; otherwise
    `packages/server/src/app-document.ts:60` calls `createSignUrl` without a
    `basePath`, and `packages/server/src/capability-route.ts:155` defaults to
    `/_kovo/storage`.
  - Why it matters: the papercuts-7 custom-basePath fix composes only for a single
    mounted storage endpoint; multi-storage apps must bypass route `ctx.signUrl`.
  - Repro evidence: in `storage-multi-capability`, the worker observed
    `ctx-url=/_kovo/storage/...` returning 404 and
    `manual-url=/private-downloads/...` returning 200 with the expected
    downloaded file.
  - Acceptance: `ctx.signUrl` exposes or derives an unambiguous base path for
    multi-storage apps, or it fails early with a diagnostic requiring explicit
    endpoint selection.
  - Evidence: 2026-06-28 `pnpm exec vitest --run packages/server/src/capability-route.test.ts packages/server/src/response.test.ts packages/server/src/schema.test.ts` passed with ambiguous multi-endpoint `ctx.signUrl` diagnostic coverage.

- [x] **Stored-file metadata can override sanitized filename metadata and crash downloads.** (med, framework; found by `storage-multi-capability`)
  - Observed behavior: an `s.file().store({ metadata })` hook returning a
    filename containing CR/LF stored successfully, and the later capability
    download returned a 500 instead of a sanitized filename or controlled
    validation failure.
  - Root cause: `packages/server/src/schema.ts:554-557` writes sanitized filename
    metadata before spreading app metadata over it; `packages/server/src/response.ts:345`
    reads `object.metadata?.filename`; `packages/server/src/response.ts:593-594`
    escapes only quote/backslash for `Content-Disposition`.
  - Why it matters: Kovo owns the stored-file-to-header sink. App metadata should
    not be able to overwrite the framework-sanitized filename and turn a valid
    object into a 500 at download time.
  - Repro evidence: in `storage-multi-capability`, uploading a file with
    metadata filename `dogfood.txt\\r\\nX-Kovo-Dogfood: injected` succeeded, and
    the unsafe download returned HTTP 500.
  - Acceptance: stored filename metadata is reserved or sanitized after metadata
    merge, and header serialization rejects/normalizes control characters before
    response construction.
  - Evidence: 2026-06-28 `pnpm exec vitest --run packages/server/src/capability-route.test.ts packages/server/src/response.test.ts packages/server/src/schema.test.ts` passed with stored filename reservation and `Content-Disposition` control-character normalization coverage.

- [x] **One-time signed URLs are mintable without a replay store but are permanently unusable.** (low, dev-tooling; found by `storage-multi-capability`)
  - Observed behavior: a `oneTime` URL minted for an endpoint without
    `replayStore` returned the same generic 404 as expired/replayed/bad tokens on
    first use.
  - Root cause: `packages/server/src/capability-url.ts:302-305` fails closed when
    `oneTime` is true and no replay store exists, but `createSignUrl` can mint
    such tokens independently of endpoint configuration.
  - Why it matters: the security behavior is fail-closed, but authors get a dead
    link and no build/dev diagnostic.
  - Repro evidence: in `storage-multi-capability`, curling a
    `/no-replay-downloads/...` one-time URL returned 404 with private no-store
    headers.
  - Acceptance: one-time minting is coupled to an endpoint replay store or emits a
    clear development/build diagnostic when no matching store can verify it.
  - Evidence: 2026-06-28 `pnpm exec vitest --run packages/server/src/capability-route.test.ts packages/server/src/response.test.ts packages/server/src/schema.test.ts` passed with one-time signer replay-store enforcement coverage.

### E. Endpoint / Webhook Tooling

- [ ] **Endpoint posture CI can pass while newly declared endpoints are completely unobserved.** (med, template/dev-tooling; found by `endpoints-webhooks-agent` and `storage-multi-capability`)
  - Observed behavior: after adding raw endpoints, webhooks, and storage
    endpoints, generated `pnpm run check` still passed with
    `.kovo/endpoint-posture.json` containing only `GET /api/health`.
  - Root cause: `packages/create-kovo/templates/src/endpoint-posture.test.ts:20-24`
    records only `healthEndpointPosture()` and `kovo check endpoint-posture`
    validates supplied facts without reconciling them against the built endpoint
    graph.
  - Why it matters: endpoint posture is a review surface; generated CI can give
    false confidence while new machine-ingress endpoints have no runtime posture
    observation.
  - Repro evidence: first-hand in both `endpoints-webhooks-agent` and
    `storage-multi-capability`, `.kovo/endpoint-posture.json` contained only
    `GET /api/health`, while `kovo explain --endpoints dist/.kovo/graph.json`
    listed multiple additional endpoints.
  - Acceptance: generated posture checks enumerate declared app endpoints or
    `kovo check endpoint-posture` reports declared endpoints with missing
    observations.

- [ ] **Default-CSRF `text/plain` endpoints have no valid token carrier and fail with bare CSRF.** (low, framework/docs; found by `endpoints-webhooks-agent`)
  - Observed behavior: a default-CSRF `endpoint()` with text body posture returned
    422 even when the request carried same-origin `Origin`, the anonymous CSRF
    cookie, and a valid token string in the text body; JSON/form controls passed.
  - Root cause: `packages/server/src/app-dispatch.ts` parses CSRF tokens from
    JSON/form carriers, while unsupported body modes collapse to an empty token
    input and a bare `CSRF` response.
  - Why it matters: raw endpoints are advertised for raw HTTP control, but
    non-form/non-JSON unsafe body modes have no documented token carrier or
    diagnostic.
  - Repro evidence: in `endpoints-webhooks-agent`, `curl` with
    `Content-Type: text/plain`, valid cookie, and same-origin headers returned
    `HTTP/1.1 422 Unprocessable Entity` body `CSRF`; JSON control returned 200.
  - Acceptance: document the supported CSRF carriers for endpoint body modes or
    add a safe header/query token carrier with clear diagnostics.

- [ ] **Machine-ingress endpoint audit drops `auth: none` justification from the endpoint row.** (low, dev-tooling; found by `endpoints-webhooks-agent`)
  - Observed behavior: an `auth: none` endpoint with justification
    `public uptime probe` prints as `auth=none` in `kovo explain --endpoints`; the
    justification appears only in `kovo explain --access`.
  - Root cause: `packages/cli/src/graph-output.ts:2052` renders endpoint auth as
    a reduced string for the ENDPOINTS table.
  - Why it matters: SPEC §11.4 positions endpoint explain as the main
    machine-ingress review table; unauthenticated ingress should show its reason
    in the same row.
  - Repro evidence: in `endpoints-webhooks-agent`,
    `pnpm exec kovo explain --endpoints dist/.kovo/graph.json` printed
    `auth=none`, while `pnpm exec kovo explain --access ...` separately printed
    the justification.
  - Acceptance: endpoint explain includes auth justifications inline for
    unauthenticated/custom verifier decisions.

- [ ] **Webhook guide example destructures a nonexistent `db` from handler context.** (low, docs; found by `endpoints-webhooks-agent`)
  - Observed behavior: the endpoints/webhooks guide shows
    `async handler(event, { db })`, but `WebhookHandlerContext` exposes `tx`,
    `rawBody`, `request`, `fail`, and `recordChange`, not `db`.
  - Root cause: `site/content/guides/endpoints-webhooks.md` is stale relative to
    `packages/server/src/webhook.ts` public types.
  - Why it matters: copied docs code fails typecheck before authors reach the
    actual transaction/recordChange model.
  - Repro evidence: compiling a scratch copy of the guide snippet produced
    `TS2339: Property 'db' does not exist on type 'WebhookHandlerContext<...>'`.
  - Acceptance: guide examples use the current webhook context shape and mention
    `tx` / `recordChange` explicitly.

### F. Auth UX

- [x] **Session-expired CSRF-protected mutation submits return 422 CSRF instead of the reauth flow.** (med, framework; found by `auth-session-cache`)
  - Observed behavior: after rendering an authenticated add-contact form and then
    logging out, reusing that specific form token returned enhanced/no-JS 422 CSRF
    responses instead of SPEC §6.5's enhanced 401 `Kovo-Reauth` or no-JS 303 login
    redirect.
  - Root cause: `packages/server/src/mutation.ts:324-343` validates CSRF before
    resolving session lifecycle and guards at `packages/server/src/mutation.ts:367-384`;
    reauth mapping exists only after guard failure.
  - Why it matters: session expiry between render and submit is a normal auth
    lifecycle case; the current behavior fails closed but gives users a generic
    CSRF error and bypasses the intended loader reauth directive.
  - Repro evidence: in `auth-session-cache`, the worker logged in, extracted the
    specific add-contact CSRF, signed out, and reposted that token; enhanced
    response was `422` with `data-error-code="CSRF"`, and no-JS response was
    `422` with no `Location` / `Kovo-Reauth`.
  - Acceptance: stale session-bound form submits route through the unauthenticated
    mutation reauth behavior instead of surfacing a generic CSRF failure when the
    token belonged to the previous authenticated render.
  - Evidence: 2026-06-28 `./node_modules/.bin/vitest run packages/server/src/guards.test.ts packages/server/src/route-query-guards.test.ts` passed with enhanced 401 `Kovo-Reauth` and no-JS 303 login redirect coverage for stale session-bound mutation CSRF.

## Refuted / Not Carried Forward

- Fresh linked baseline: `base-pristine` passed `check`, `test`, `build:prod`,
  and dev HTTP smoke.
- Papercuts-7 storage fixes held for the single-endpoint case: normal stored
  upload filename metadata was sanitized and used as a download filename, and
  custom storage `basePath` works when there is one mounted storage endpoint.
- Papercuts-6 headless ID ownership held in the UI catalog path when explicit
  `listboxId`/`id` values were supplied.
- `kovo add` missing dependency messaging is improved: it prints a clear
  `DEPENDENCIES status=missing` line for `@kovojs/headless-ui` / `@kovojs/icons`.
- Better Auth / Drizzle peer warnings during linked installs remain known starter
  noise and were not carried as fresh findings.
- The generated starter now wires top-level CSRF, so the old default-CSRF endpoint
  dead-end from `papercut-super-2` was not reproduced.
- Guarded query unauthenticated redirects are stamped with private/no-store and
  `Vary: Cookie`; this pass found the analogous route non-OK gap instead.

## Latest Verification

- 2026-06-28 in `/Users/mini/kovo`: `pnpm run check` passed before this dogfood
  pass began; `pnpm install` was rerun afterward to repair link-local dependency
  state.
- 2026-06-28 in `/Users/mini/kovo-dogfood-20260628d/base-pristine`:
  `pnpm run check`, `pnpm run test`, `pnpm run build:prod`, and a dev HTTP smoke
  passed.
- 2026-06-28 first-hand repros from the main agent confirmed the UI copy-in
  sound-subset/idempotency failures, endpoint-posture blind spot, streaming form
  and `streamText` lowering gaps, and route/no-JS mutation header-floor gaps.
- 2026-06-28 in `/Users/mini/kovo-bugz9-papercuts8-20260628-101516`:
  storage and streaming focused suites plus `git diff --check` and
  `pnpm run check:vp` passed after the first two implementation merges.
- 2026-06-28 in `/Users/mini/kovo-bugz9-papercuts8-20260628-101516`: auth
  focused tests plus `git diff --check` and `pnpm run check:vp` passed after the
  stale-session reauth implementation merge.
