# Secure Framework 2 - Additional Hardening Audit

**Date:** 2026-06-24
**Status:** Active follow-up ledger
**Scope:** Additional security ideas found after auditing `plans/secure-framework.md`, `SPEC.md`,
the current codebase, and five parallel worktree probes. This file supplements, but does not
replace, the remaining follow-ups in `plans/secure-framework.md`.

## Baseline

- `SPEC.md` remains the normative behavior source. Relevant anchors: Prime Principle and
  construction-first security in §2, contextual output safety in §5.2, capability/egress/CSRF
  policy in §6.6, mutation/query wire in §9, replay in §10, and build-token cache safety in §14.
- Existing `plans/secure-framework.md` items are not repeated here unless this audit found a
  narrower, additional bypass class. Do not use this ledger to close the old plan's remaining
  items: KV429 runtime CAS, KV433 managed read-only handles/interprocedural summaries,
  capability download routes, Trusted Types inline-loader routing, producer explain output,
  `staticExportPathOverride` trust kind, and KV434 non-literal-pattern lint remain owned there.
- Main worktree production files were not edited during this audit. Parallel probes ran in sibling
  worktrees and used scratch tests only.

## Tier 0 - By-Construction Gaps

- [ ] Make SQL allowlists static by construction, not request-controlled.
  - Evidence: `packages/drizzle/src/static.ts:661` and `:724` only prove that an allow array exists;
    `packages/core/src/internal/sql-safety.ts:96` and `:106` then accept runtime values with
    `allow.includes(value)`.
  - Probe: data explorer showed `sql.allow(input.dir, [input.dir])` and
    `sql.identifier(input.table, { allow: [input.table] })` emitted zero KV422 diagnostics.
  - Acceptance: `kovo check` rejects allow entries derived from request/input values unless they
    resolve to schema facts, literal tuples, or a branded server-owned allowlist.

- [ ] Inspect every `sql.join(...)` part instead of treating the wrapper as inherently safe.
  - Evidence: `packages/drizzle/src/static.ts:664` returns safe for `sql.join(...)`.
  - Probe: data explorer showed `sql.join([input.clause])` emitted zero KV422 diagnostics.
  - Acceptance: static analysis recursively checks joined values for request-derived text, raw SQL,
    identifiers, and allowed fragments.

- [ ] Scope `owns()` guard suppression to the exact domain/key it proves.
  - Evidence: `packages/cli/src/graph-output.ts:2104` and `:2119` suppress owner-domain findings by
    surface name instead of matching the guarded domain/key against each read/write fact.
  - Probe: a query reading `account` and `invoice` passed KV414 with only `owns:account`.
  - Acceptance: KV414 remains open for every owner domain not covered by a matching guard,
    including mixed-domain query and mutation surfaces.

- [ ] Replace name-based privileged helper recognition with source-identity provenance.
  - Evidence: `packages/drizzle/src/static/derivation.ts:1091` and
    `packages/drizzle/src/static/symbol-provenance.ts:183`/`:323` allow helper names to launder
    provenance.
  - Probe: local fake `adminAssign()` and shadowed summarized helpers suppressed KV438.
  - Acceptance: KV438 escapes require import/source identity from the framework-owned helper or a
    compiler-attested summary, not just a callee name.

- [ ] Expand `adminAssign` audit records beyond `{ reason }`.
  - Evidence: `packages/server/src/write-governance.ts:55` records only the reason string.
  - Acceptance: audit records include callsite or producer, table/domain, column set, source
    provenance, actor/session when available, and an explain-graph edge.

- [ ] Require version bump/update proof when KV429 is discharged by a version predicate.
  - Evidence: `packages/drizzle/src/static/derivation.ts:1296` treats equality on a declared version
    column as sufficient.
  - Probe: a version-guarded update that never increments the version emitted zero KV429 facts.
  - Acceptance: static proof requires both compare-and-set predicate and mutation of the same
    version column, or keeps KV429 open for runtime CAS handling in the original plan.

- [ ] Fail closed on dynamic or spread `reads:` entries for opaque queries.
  - Evidence: `packages/drizzle/src/static/schema.ts:860` records static entries and drops dynamic
    spread entries.
  - Probe: `reads: [products, ...extraReads]` hid an `audit_logs` raw query read without a
    diagnostic.
  - Acceptance: non-static opaque-query `reads` entries produce KV410/KV406 until the full read set
    is statically known.

- [ ] Detect direct module-scope DB writes inside query loaders for KV433.
  - Evidence: `packages/drizzle/src/static/derivation.ts:1384` and
    `packages/drizzle/src/static/project-receivers.ts:230` discover loader/body-local receivers but
    miss module-scope `db.delete(...)` closed over by the loader.
  - Probe: a query loader closing over module-scope `db.delete` emitted zero KV433 facts.
  - Acceptance: direct module-scope Drizzle receivers used inside query loaders are treated as
    write receivers, independent of the old plan's imported-domain/interprocedural work.

- [ ] Require executable endpoint auth verifiers for any endpoint marked `verified`.
  - Evidence: `packages/server/src/endpoint.ts:33` allows auth declarations with only a name, while
    `packages/server/src/endpoint.ts:188` skips runtime verification when `verify` is absent.
  - Acceptance: access graph output does not classify name-only endpoint auth as verified unless it
    is explicitly marked audit-only and excluded from KV436 closure.

- [ ] Replace raw route file/stream response header maps with typed, reserved-header-aware sinks.
  - Evidence: `packages/server/src/response.ts:462`, `:479`, `:489`, and `:494` let
    `respond.file`/`respond.stream` caller headers override `Content-Disposition`, `Content-Type`,
    `X-Content-Type-Options`, and emit raw `Set-Cookie`.
  - Probe: server explorer produced an attachment SVG response overridden to `inline`, `sniff`, and
    a raw cookie.
  - Acceptance: file/stream APIs reserve framework safety headers, route cookies through typed
    cookie builders, and require audited escape hatches for dangerous overrides.

- [ ] Gate same-file serializable module constants before emitting them into client modules.
  - Evidence: `packages/compiler/src/lower/handlers.ts:226`/`:314` and
    `packages/compiler/src/emit/client.ts:129` permit same-file module constants in client output.
  - Probe: `packages/compiler/src/client-secret-capture.test.ts` currently accepts a serializable
    module constant capture.
  - Acceptance: KV437 or a new diagnostic covers same-file literal leaks that are not explicitly
    public/client-safe.

## Tier 1 - Runtime and Wire Defenses

- [ ] Enforce request body byte caps while reading streams, not only through `Content-Length`.
  - Evidence: `packages/server/src/app-load-shed.ts:135` checks only `Content-Length`; later
    consumers call `request.json()`, `request.formData()`, or `arrayBuffer()` in mutation,
    endpoint-verifier, and webhook paths.
  - Probe: server explorer showed a POST larger than `maxBodyBytes` reached the endpoint when
    `Content-Length` was absent.
  - Acceptance: adapter/request-shell installs a counted body reader shared by mutation, endpoint,
    webhook, and raw verification paths, and returns 413 before parsing when the stream exceeds
    the configured cap.

- [ ] Add a trusted-proxy boundary for forwarded client IP and scheme headers.
  - Evidence: `packages/server/src/app-load-shed.ts:165` falls back to `requestClientIp`, which reads
    forwarded headers by default; Node build URL construction also trusts `Host`/`X-Forwarded-Proto`
    in `packages/server/src/build.ts:690`.
  - Probe: server explorer bypassed a `max:1` per-IP limit by changing `X-Forwarded-For`.
  - Acceptance: forwarded headers are ignored unless an adapter supplies a trusted peer chain or
    app config names trusted proxies/hop count.

- [ ] Bind idempotency replay records to a canonical request fingerprint and mint fresh enhanced
  submit tokens per logical submit.
  - Evidence: browser enhanced submit prefers hidden `Kovo-Idem` in
    `packages/browser/src/mutation-fetch.ts:72` and inline loader code; server replay keys by
    scope+idem in `packages/server/src/replay.ts:384`.
  - Probe: wire explorer showed two posts with the same idem and different bodies replayed the
    first response and invoked the handler once.
  - Acceptance: same-idem/different-body returns a typed conflict, and enhanced submits update or
    replace the submitted idem token before each logical submission.

- [ ] Treat build-token mismatch or missing response token as a whole-response miss.
  - Evidence: `SPEC.md` §14 says token mismatch must not apply deltas, reads, or fragment merges;
    `packages/browser/src/apply-mutation-response.ts:51`/`:104` still applies full chunks on skew,
    and `:99` accepts missing response tokens when the page has a token.
  - Probe: wire/compiler explorers confirmed current tests accept full chunk application or
    no-token delta application.
  - Acceptance: mutation, broadcast, `/_q`, and streaming inline paths reject or refetch on missing
    or mismatched build tokens before applying any fragment, query, or text chunk.

- [ ] Sign or attest `Kovo-Live-Targets` component/props descriptors.
  - Evidence: browser serializes descriptors from DOM attributes in
    `packages/browser/src/mutation-targets.ts:47`; server parses component/props in
    `packages/server/src/mutation-wire.ts:439`, renders by component in
    `packages/server/src/mutation/targets.ts:214`, and derives query inputs from those props at
    `:378`.
  - Acceptance: component id and props are server-minted, HMAC-bound to the render-plan token and
    document/session, or stored in a server-side descriptor ledger; unattested descriptors are
    dropped before query execution.

- [ ] Intercept enhanced forms only for same-origin `/_m/` POST mutation targets.
  - Evidence: `packages/browser/src/mutation-form.ts:4` selects any enhanced/data-mutation form,
    `packages/browser/src/mutation-submit.ts:81` prevents default before eligibility checks, and
    `packages/browser/src/mutation-fetch.ts:93` fetches the authored action/method.
  - Acceptance: runtime declines non-POST, cross-origin, or non-`/_m/` enhanced forms, and compiler
    rejects or normalizes authored mutation form methods.

- [ ] Stamp every mutation wire response and every `/_q` response with private no-store posture.
  - Evidence: enhanced mutation headers at `packages/server/src/mutation.ts:1174` lack explicit
    `Cache-Control`/`Vary`; `packages/server/src/query.ts:465` returns unknown-query 404 without
    the success-path private no-store headers.
  - Acceptance: 200/4xx/5xx enhanced mutation, broadcast, and all `/_q` responses carry
    `Cache-Control: private, no-store` and `Vary: Cookie` unless a stricter no-store posture is
    already present.

- [ ] Replace broadcast principal fingerprints with server-secret or opaque nonces.
  - Evidence: `packages/server/src/app-document.ts:167` emits `kovo-session`, `:197` falls back to
    request/session/user/first cookie, and `:220` hashes with short unsalted FNV-1a; browser
    filtering trusts equality in `packages/browser/src/broadcast.ts:143`.
  - Acceptance: cross-tab filtering uses an HMAC or random opaque nonce and does not derive
    principals from the first cookie fallback when no authenticated identity exists.

- [ ] Require webhook idempotency/replay posture for write-reaching webhooks.
  - Evidence: `packages/server/src/webhook.ts:110` makes idempotency optional, while the JSDoc
    claims the handler is idempotent by construction and replay code only runs when the declaration
    provides `idempotency`.
  - Acceptance: write-reaching webhook declarations require an idempotency key and replay store, or
    an explicit audited `replay: "none"`/pure-handler posture.

- [ ] Add runtime/dev verification for raw endpoint response posture declarations.
  - Evidence: `packages/server/src/endpoint.ts:10` declares response posture, but
    `packages/server/src/endpoint.ts:170` returns the handler response directly.
  - Acceptance: declared cache/body/app-owned safety posture is checked against actual headers and
    status in dev/check/runtime conformance, with typed builders for common safe responses.

- [ ] Disable default compression for private, no-store, cookie-bearing, or credentialed responses.
  - Evidence: Node compression in `packages/server/src/node.ts:138`/`:176` skips `no-transform` and
    existing encodings but not private/no-store, `Vary: Cookie`, or `Set-Cookie`.
  - Acceptance: compression is opt-in for sensitive responses or skipped automatically when cookie
    or private-cache posture is present.

## Tier 2 - Browser Sink Parity

- [ ] Route inline-loader bound URL attributes through the shared safe-URL parser.
  - Evidence: `packages/browser/src/inline-loader-build.ts:181`/`:204` use a narrow
    `/^(javascript|data):/i` check, while modular binding uses `hasUnsafeUrlScheme` from
    `packages/core/src/internal/security-url.ts:29`.
  - Probe: compiler explorer found coverage only for literal `javascript:`, not control-character
    variants such as `java\tscript:`.
  - Acceptance: modular runtime and inline loader share one URL-scheme sanitizer and identical
    tests for controls, casing, and disallowed schemes.

- [ ] Enforce a runtime allowlist for handler and derive dynamic import URLs.
  - Evidence: `packages/browser/src/handlers.ts:145`, `packages/browser/src/query-bindings.ts:466`,
    and inline loader code import split `module#export` refs without same-origin/build-token or
    manifest membership checks.
  - Probe: inline delegated test can reach `import("data:text/javascript,...")` before failing on
    missing export.
  - Acceptance: dynamic imports are limited to same-origin Kovo client-module URLs for the active
    build token and compiler-emitted manifest; others fail closed before import.

- [ ] Reuse safe attribute sinks for fragment/morph attribute copying.
  - Evidence: `packages/browser/src/response-fragment-apply.ts:77`/`:140` and
    `packages/browser/src/morph.ts:319`/`:327` copy raw attributes with `setAttribute`.
  - Acceptance: fragment/morph application strips `on*`, `srcdoc`, and unsafe URL schemes using
    the same rules as `data-bind`, as a runtime kill switch for bad raw/trusted output.

- [ ] Remove compiler/browser URL parser drift.
  - Evidence: compiler CSS URL parsing in `packages/compiler/src/security/output-context.ts:424`
    duplicates the shared helper in `packages/core/src/internal/security-url.ts:18`.
  - Acceptance: compiler, browser, inline loader, and diagnostics import or generate from one
    shared URL-safety definition.

## Tier 3 - Adapter, Starter, Devtool, and Supply Chain

- [ ] Make generated Node/Vercel adapters share the hardened Node bridge or prove parity.
  - Evidence: generated adapter templates in `packages/server/src/build.ts:411`/`:423`/`:711`/`:723`
    duplicate response bridging, while `packages/server/src/node.ts` has dedicated `Set-Cookie` and
    stream-error handling.
  - Acceptance: generated adapters preserve multiple `Set-Cookie` headers, propagate aborts, handle
    mid-stream errors safely, and share body-limit behavior with the source Node adapter.

- [ ] Add deployment-preset static header parity checks.
  - Evidence: generated static serving in `packages/server/src/build.ts:595` sets cache and content
    type, but not the same CORP/nosniff/security posture proven in runtime client-module paths.
  - Acceptance: Node/Vercel/Cloudflare/static outputs have conformance tests for client modules,
    assets, HTML, and error responses with expected `nosniff`, CORP/CORS, cache, and cookie variance.

- [ ] Emit the SPEC §6.6 sound-subset policy in generated starters.
  - Evidence: starter templates lack their own `tsconfig`/lint policy, while current tests only
    inspect strict flags; starter code contains `as unknown as` casts.
  - Acceptance: generated apps include strict TypeScript and lint gates banning `any`,
    non-null assertions, and unchecked casts, or document any explicit starter-only escape.

- [ ] Fix starter anonymous CSRF so unauthenticated users use the framework-owned anonymous cookie.
  - Evidence: starter `sessionId` returns a constant anonymous id before auth, bypassing the
    anonymous-cookie binding path in `packages/server/src/csrf.ts:260`.
  - Acceptance: starter pre-auth CSRF tokens fail without the matching framework-owned anonymous
    cookie, and post-auth behavior remains session-bound.

- [ ] Replace starter `workspace:*` dependencies and add install reproducibility pins.
  - Evidence: `packages/create-kovo/templates/package.json` and `package.sqlite.json` render
    monorepo-only `workspace:*` specs and do not include a starter `packageManager` pin.
  - Acceptance: published starters resolve public package versions, include a package-manager pin,
    and have a smoke test outside the monorepo.

- [ ] Escape devtool HTML attribute sinks.
  - Evidence: `packages/devtool/src/render.mjs` has an escape helper but raw `href`, hidden input,
    and `on:visible` attribute interpolations fed partly by env/base/app values.
  - Probe: supply explorer produced attribute breakout strings through devtool inputs.
  - Acceptance: all devtool HTML text and attributes route through context-specific escapers, with a
    hostile-input regression test.

- [ ] Gate release publish on exact-commit CI success and pinned release tooling.
  - Evidence: `.github/workflows/release.yml` contains a TODO around status checks and installs a
    mutable `npm@latest`; `scripts/verify-release-input.mjs` validates ref/version but not required
    checks for `github.sha`.
  - Acceptance: release refuses to publish unless required checks passed for the exact commit, and
    release tooling versions are pinned or recorded in provenance metadata.

- [ ] Attest packed npm tarball content before publish.
  - Evidence: `scripts/build-publish.mjs`, `scripts/pack-public-packages.mjs`, and
    `scripts/publish-packed-packages.mjs` track package/version/tarball path but not sha512,
    file-list, manifest snapshot, or lifecycle-script policy.
  - Acceptance: publish manifest records tarball integrity, `tar -tf` file list, packed
    `package.json`, dependency versions, and rejects lifecycle scripts unless allowlisted.

- [ ] Add dependency audit and build-script policy gates.
  - Evidence: supply probe `pnpm audit --prod --json` found a current low `esbuild@0.27.3`
    advisory; root build-script approval currently allows only `better-sqlite3`.
  - Acceptance: CI/release runs an explicit severity-based dependency audit and verifies the
    approved-build-script list.

- [ ] Add source-hash attestation for `kovo add` vendored UI source.
  - Evidence: `packages/cli/src/add-catalog.ts` validates shape and IR markers, but copied TSX from
    installed `@kovojs/ui` is not checked against a Kovo-maintained component source hash manifest.
  - Acceptance: UI release emits per-component source hashes and `kovo add` reports/verifies the
    package version plus source hash before copying executable TSX.

- [ ] Add a pre-implementation security checklist for future SSE/EventSource/live channels.
  - Evidence: wire explorer found no production SSE/EventSource path today; future live channels
    would cross the same principal/cache/build-token boundary as broadcast and mutation streams.
  - Acceptance: any future live transport requires subscribe-time and per-push guards, no-store and
    same-origin CORS posture, build token on every event, and principal-bound channel identifiers.

## Parallel Probe Evidence

- Compiler/browser worktree: `/Users/mini/kovo-agent-sec-compiler`, branch
  `agent/sec-compiler-audit`; ran focused browser/compiler vitest probes.
- Server/runtime worktree: `/Users/mini/kovo-agent-sec-server`, branch `agent/sec-server-audit`;
  ran `pnpm exec vitest --run packages/server/src/__sec_server_audit.probe.test.ts` (3 passed).
- Data/static-analysis worktree: `/Users/mini/kovo-agent-sec-data`, branch `agent/sec-data-audit`;
  ran scratch Drizzle/CLI probes (8 passed) before removing scratch files.
- Supply/starter/devtool worktree: `/Users/mini/kovo-agent-sec-supply`, branch
  `agent/sec-supply-audit`; ran API/import checks and `pnpm audit --prod --json`.
- Wire protocol worktree: `/Users/mini/kovo-agent-sec-wire`, branch `agent/sec-wire-audit`; ran
  scratch replay/skew probes and existing focused browser tests.

## Latest Verification

- [x] Confirm main worktree production files remain untouched after writing this ledger.
  - Evidence: `git status --short` shows only `?? plans/secure-framework-2.md`.
- [x] Run `git diff --check`.
  - Evidence: `git add -N plans/secure-framework-2.md` followed by
    `git diff --check -- plans/secure-framework-2.md` produced no output; the intent marker was
    removed with `git reset -q -- plans/secure-framework-2.md`.
