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

- [x] Make SQL allowlists static by construction, not request-controlled.
  - Evidence: `20c0b4a4` plus
    `pnpm exec vitest --run packages/drizzle/src/sql-safety-static.test.ts` rejects
    request-derived `sql.allow(...)` / `sql.identifier(..., { allow })` entries.

- [x] Inspect every `sql.join(...)` part instead of treating the wrapper as inherently safe.
  - Evidence: `20c0b4a4` plus
    `pnpm exec vitest --run packages/drizzle/src/sql-safety-static.test.ts` covers
    request-derived `sql.join(...)` parts.

- [ ] Scope `owns()` guard suppression to the exact domain/key it proves.
  - Current evidence: `20c0b4a4` plus
    `pnpm exec vitest --run packages/cli/src/index.kovo-check.test.ts` now keeps KV414 open for
    mixed-domain surfaces not covered by a matching `owns()` domain.
  - Remaining gap: key-exact matching is still open because the graph fact shape does not yet carry
    the exact guarded owner key.

- [x] Replace name-based privileged helper recognition with source-identity provenance.
  - Evidence: `20c0b4a4` plus
    `pnpm exec vitest --run packages/drizzle/src/index.mass-assignment.test.ts` covers fake
    `adminAssign()` and shadowed summary-helper bypasses.

- [x] Expand `adminAssign` audit records beyond `{ reason }`.
  - Evidence: `20c0b4a4` plus
    `pnpm exec vitest --run packages/server/src/write-governance.test.ts` covers expanded
    governance audit metadata.

- [x] Require version bump/update proof when KV429 is discharged by a version predicate.
  - Evidence: `20c0b4a4` plus
    `pnpm exec vitest --run packages/drizzle/src/index.toctou-readonly.test.ts` covers
    version-predicate updates that fail to mutate the same version column.

- [x] Fail closed on dynamic or spread `reads:` entries for opaque queries.
  - Evidence: `20c0b4a4` plus
    `pnpm exec vitest --run packages/drizzle/src/index.query-shapes.test.ts` covers spread/dynamic
    opaque-query `reads:` entries.

- [x] Detect direct module-scope DB writes inside query loaders for KV433.
  - Evidence: `20c0b4a4` plus
    `pnpm exec vitest --run packages/drizzle/src/index.toctou-readonly.test.ts` covers
    module-scope Drizzle receivers used inside query loaders.

- [x] Require executable endpoint auth verifiers for any endpoint marked `verified`.
  - Evidence: `ec9967f8` plus
    `pnpm exec vitest --run packages/server/src/access-graph.test.ts packages/server/src/endpoint.test.ts`
    covers name-only endpoint auth as audit metadata and executable verifier enforcement.

- [x] Replace raw route file/stream response header maps with typed, reserved-header-aware sinks.
  - Evidence: `ec9967f8` plus
    `pnpm exec vitest --run packages/server/src/response.test.ts` covers reserved framework response
    headers and raw `Set-Cookie` filtering for route file/stream outcomes.

- [ ] Gate same-file serializable module constants before emitting them into client modules.
  - Evidence: `packages/compiler/src/lower/handlers.ts:226`/`:314` and
    `packages/compiler/src/emit/client.ts:129` permit same-file module constants in client output.
  - Probe: `packages/compiler/src/client-secret-capture.test.ts` currently accepts a serializable
    module constant capture.
  - Acceptance: KV437 or a new diagnostic covers same-file literal leaks that are not explicitly
    public/client-safe.

## Tier 1 - Runtime and Wire Defenses

- [x] Enforce request body byte caps while reading streams, not only through `Content-Length`.
  - Evidence: `ec9967f8` plus
    `pnpm exec vitest --run packages/server/src/app.test.ts packages/server/src/webhook.test.ts`
    covers counted request-body reads and 413 handling beyond `Content-Length`.

- [x] Add a trusted-proxy boundary for forwarded client IP and scheme headers.
  - Evidence: `ec9967f8` plus
    `pnpm exec vitest --run packages/server/src/app.test.ts packages/server/src/build.test.ts`
    covers forwarded IP/proto use only behind trusted-proxy opt-in.

- [ ] Bind idempotency replay records to a canonical request fingerprint and mint fresh enhanced
  submit tokens per logical submit.
  - Evidence: browser enhanced submit prefers hidden `Kovo-Idem` in
    `packages/browser/src/mutation-fetch.ts:72` and inline loader code; server replay keys by
    scope+idem in `packages/server/src/replay.ts:384`.
  - Probe: wire explorer showed two posts with the same idem and different bodies replayed the
    first response and invoked the handler once.
  - Acceptance: same-idem/different-body returns a typed conflict, and enhanced submits update or
    replace the submitted idem token before each logical submission.

- [x] Treat build-token mismatch or missing response token as a whole-response miss.
  - Evidence: `016cc57f` plus
    `pnpm exec vitest --run packages/browser/src/apply-mutation-response-delta.test.ts packages/browser/src/broadcast-replay.test.ts packages/browser/src/query-refetch.test.ts`
    covers mutation, broadcast, and typed-read token misses; `pnpm --filter @kovojs/browser run
    check:inline-loader` proves generated inline-loader parity.

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

- [x] Require webhook idempotency/replay posture for write-reaching webhooks.
  - Evidence: `ec9967f8` plus
    `pnpm exec vitest --run packages/server/src/webhook.test.ts` covers fail-closed replay posture
    for write-reaching webhooks.

- [x] Add runtime/dev verification for raw endpoint response posture declarations.
  - Evidence: `ec9967f8` plus
    `pnpm exec vitest --run packages/server/src/endpoint.test.ts` covers dev/opt-in runtime posture
    verification for raw endpoint responses.

- [x] Disable default compression for private, no-store, cookie-bearing, or credentialed responses.
  - Evidence: `ec9967f8` plus
    `pnpm exec vitest --run packages/server/src/node.test.ts` covers compression skips for private,
    no-store, cookie-bearing, and `Vary: Cookie` responses.

## Tier 2 - Browser Sink Parity

- [x] Route inline-loader bound URL attributes through the shared safe-URL parser.
  - Evidence: `016cc57f` plus
    `pnpm exec vitest --run packages/browser/src/inline-loader-security.test.ts packages/browser/src/security-output.test.ts`
    and `pnpm --filter @kovojs/browser run check:inline-loader`.

- [ ] Enforce a runtime allowlist for handler and derive dynamic import URLs.
  - Current evidence: `016cc57f` plus
    `pnpm exec vitest --run packages/browser/src/handlers.test.ts packages/browser/src/inline-loader-delegated.test.ts`
    rejects cross-origin/data URLs and build-token-mismatched versioned `/c/__v/...` URLs.
  - Remaining gap: compiler-emitted manifest membership is not yet available, so unversioned
    same-origin `/c/` module URLs are guarded by path/origin but not manifest membership.

- [x] Reuse safe attribute sinks for fragment/morph attribute copying.
  - Evidence: `016cc57f` plus
    `pnpm exec vitest --run packages/browser/src/response-fragment-apply.browser.test.ts`
    covers safe attribute handling during fragment/morph application.

- [x] Remove compiler/browser URL parser drift.
  - Evidence: `016cc57f` plus
    `pnpm --filter @kovojs/compiler exec vitest run src/output-context.test.ts src/server-emit-security.test.ts`
    covers compiler reuse of the shared URL-safety definition.

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

- [x] Emit the SPEC §6.6 sound-subset policy in generated starters.
  - Evidence: `e8565287` plus
    `pnpm exec vitest --run packages/create-kovo/src/index.test.ts` covers starter `tsconfig`,
    sound-subset script, and generated starter `node scripts/check-sound-subset.mjs`.

- [x] Fix starter anonymous CSRF so unauthenticated users use the framework-owned anonymous cookie.
  - Evidence: `e8565287` plus
    `pnpm exec vitest --run packages/create-kovo/src/index.test.ts` covers pre-auth anonymous CSRF
    cookie binding in generated starters.

- [x] Replace starter `workspace:*` dependencies and add install reproducibility pins.
  - Evidence: `e8565287` plus
    `pnpm exec vitest --run packages/create-kovo/src/index.test.ts` covers package-version
    substitution and starter `packageManager` rendering.

- [x] Escape devtool HTML attribute sinks.
  - Evidence: `e8565287` plus
    `pnpm exec vitest --run packages/devtool/src/render.test.mjs` covers hostile attribute input in
    the devtool renderer.

- [x] Gate release publish on exact-commit CI success and pinned release tooling.
  - Evidence: `e8565287` plus
    `SKIP_NPM_PUBLISHED_CHECK=1 node scripts/verify-release-input.mjs 0.1.1`, `node --check
    scripts/verify-release-input.mjs`, and inspected `.github/workflows/release.yml` using pinned
    npm and `vp exec pnpm` commands per `rules/github-workflows.md`.

- [ ] Attest packed npm tarball content before publish.
  - Current evidence: `e8565287` adds sha512/file-list/packed-manifest/lifecycle attestation to
    pack/publish scripts; `node --check scripts/pack-public-packages.mjs` and
    `node --check scripts/publish-packed-packages.mjs` passed.
  - Remaining gap: `pnpm run check:publish` / real tarball packing has not been run in this
    integration session, so the end-to-end tarball claim is not yet fully verified.

- [x] Add dependency audit and build-script policy gates.
  - Evidence: `e8565287` plus `pnpm run check:supply-chain` and
    `pnpm exec vitest --run scripts/supply-chain-gates.test.mjs` cover severity-gated
    `pnpm audit --prod` and approved build-script policy.

- [x] Add source-hash attestation for `kovo add` vendored UI source.
  - Evidence: `e8565287` plus
    `pnpm exec vitest --run packages/cli/src/index.kovo-add.test.ts` covers UI source-hash
    verification before copying vendored TSX.

- [x] Add a pre-implementation security checklist for future SSE/EventSource/live channels.
  - Evidence: `e8565287` adds `rules/live-transport-security.md`; inspected rule covers
    subscribe-time/per-push guards, no-store/same-origin posture, build tokens, and
    principal-bound channel identifiers.

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
