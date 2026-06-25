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

- [x] Scope `owns()` guard suppression to the exact domain/key it proves.
  - Evidence: `27af365d` plus integrated
    `pnpm exec vitest --run packages/drizzle/src/index.scope-audits.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-explain.test.ts`
    covers exact `domain + key` suppression and same-domain/different-key KV414 retention.

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

- [x] Gate same-file serializable module constants before emitting them into client modules.
  - Evidence: `ac72cb19` plus integrated
    `pnpm exec vitest --run packages/compiler/src/client-secret-capture.test.ts packages/core/src/diagnostics.test.ts packages/compiler/src/diagnostic-coverage-matrix.test.ts`
    covers KV437 for same-file serializable constants unless explicitly `publishToClient(...)`
    justified, and lowering withholds blocked constants from emitted client modules.

## Tier 1 - Runtime and Wire Defenses

- [x] Enforce request body byte caps while reading streams, not only through `Content-Length`.
  - Evidence: `ec9967f8` plus
    `pnpm exec vitest --run packages/server/src/app.test.ts packages/server/src/webhook.test.ts`
    covers counted request-body reads and 413 handling beyond `Content-Length`.

- [x] Add a trusted-proxy boundary for forwarded client IP and scheme headers.
  - Evidence: `ec9967f8` plus
    `pnpm exec vitest --run packages/server/src/app.test.ts packages/server/src/build.test.ts`
    covers forwarded IP/proto use only behind trusted-proxy opt-in.

- [x] Bind idempotency replay records to a canonical request fingerprint and mint fresh enhanced
  submit tokens per logical submit.
  - Evidence: `3537a49f` plus integrated
    `pnpm exec vitest --run packages/browser/src/inline-loader-enhanced-submit.test.ts packages/browser/src/loader-enhanced-mutation-submit.test.ts packages/browser/src/mutation-fetch.test.ts packages/browser/src/mutation-form.test.ts packages/browser/src/mutation-submit.test.ts packages/server/src/replay.test.ts packages/server/src/mutation-endpoint.test.ts`
    covers fresh enhanced-submit idempotency tokens and same-idem/different-body replay conflicts.

- [x] Treat build-token mismatch or missing response token as a whole-response miss.
  - Evidence: `016cc57f` plus
    `pnpm exec vitest --run packages/browser/src/apply-mutation-response-delta.test.ts packages/browser/src/broadcast-replay.test.ts packages/browser/src/query-refetch.test.ts`
    covers mutation, broadcast, and typed-read token misses; `pnpm --filter @kovojs/browser run
    check:inline-loader` proves generated inline-loader parity.

- [x] Sign or attest `Kovo-Live-Targets` component/props descriptors.
  - Evidence: `3537a49f` plus integrated
    `pnpm exec vitest --run packages/browser/src/mutation-targets.test.ts packages/server/src/app-document.test.ts packages/server/src/mutation-wire.test.ts packages/server/src/mutation.test.ts`
    covers JSX `kovo-live-token` stamping, DOM forwarding, server-side HMAC verification, and
    dropping unattested descriptors before query execution.

- [x] Intercept enhanced forms only for same-origin `/_m/` POST mutation targets.
  - Evidence: `3537a49f` plus integrated
    `pnpm exec vitest --run packages/browser/src/mutation-form.test.ts packages/browser/src/mutation-fetch.test.ts packages/browser/src/mutation-submit.test.ts packages/browser/src/inline-loader-enhanced-submit.test.ts`
    covers declining non-POST, cross-origin, and non-`/_m/` enhanced forms before interception.

- [x] Stamp every mutation wire response and every `/_q` response with private no-store posture.
  - Evidence: `3537a49f` plus integrated
    `pnpm exec vitest --run packages/server/src/app-mutation-request.test.ts packages/server/src/mutation-response.test.ts packages/server/src/mutation-wire.test.ts packages/server/src/query-endpoint.test.ts`
    covers enhanced mutation, broadcast, and typed-read success/error cache posture.

- [x] Replace broadcast principal fingerprints with server-secret or opaque nonces.
  - Evidence: `3537a49f` plus integrated
    `pnpm exec vitest --run packages/server/src/app-document.test.ts packages/browser/src/broadcast-replay.test.ts`
    covers server-secret HMAC session fingerprints and removal of the first-cookie fallback.

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

- [x] Enforce a runtime allowlist for handler and derive dynamic import URLs.
  - Evidence: `ac72cb19` plus integrated
    `pnpm exec vitest --run packages/browser/src/dynamic-import-url.test.ts packages/browser/src/handlers.test.ts packages/browser/src/loader.test.ts packages/compiler/src/emit/bootstrap.test.ts packages/compiler/src/emit/bootstrap-runtime-contract.test.ts`
    covers same-origin/build-token checks, explicit `allowedClientModuleUrls`, modulepreload
    discovery, and loader runtime contract wiring.

- [x] Reuse safe attribute sinks for fragment/morph attribute copying.
  - Evidence: `016cc57f` plus
    `pnpm exec vitest --run packages/browser/src/response-fragment-apply.browser.test.ts`
    covers safe attribute handling during fragment/morph application.

- [x] Remove compiler/browser URL parser drift.
  - Evidence: `016cc57f` plus
    `pnpm --filter @kovojs/compiler exec vitest run src/output-context.test.ts src/server-emit-security.test.ts`
    covers compiler reuse of the shared URL-safety definition.

## Tier 3 - Adapter, Starter, Devtool, and Supply Chain

- [x] Make generated Node/Vercel adapters share the hardened Node bridge or prove parity.
  - Evidence: `2d45809b` plus integrated
    `pnpm exec vitest --run packages/server/src/build.test.ts packages/server/src/node.test.ts`
    covers generated Node/Vercel parity for multiple `Set-Cookie`, abort propagation,
    pseudo-header filtering, committed stream errors, and request-limit behavior.

- [x] Add deployment-preset static header parity checks.
  - Evidence: `2d45809b` plus integrated
    `pnpm exec vitest --run packages/server/src/build.test.ts packages/server/src/node.test.ts`
    covers Node, Vercel, Cloudflare, and static-only preset output headers for client modules,
    assets, HTML, and static errors.

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

- [x] Attest packed npm tarball content before publish.
  - Evidence: `e8565287` plus integration commands `pnpm run check:publish`,
    `node scripts/pack-public-packages.mjs`, and
    `node scripts/publish-packed-packages.mjs --dry-run --tag secure-framework-2` built public
    package dist targets, packed 13 tarballs, and reverified sha512/file-list/manifest
    attestations before the dry-run publish step.

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

- [x] Run integrated server/data/browser/wire focused suites after merging delegated slices.
  - Evidence: latest passing commands include server boundary tests
    (`packages/server/src/app.test.ts packages/server/src/response.test.ts packages/server/src/access-graph.test.ts packages/server/src/endpoint.test.ts packages/server/src/webhook.test.ts packages/server/src/node.test.ts packages/server/src/build.test.ts`),
    Drizzle/CLI governance tests, browser inline-loader generation, browser sink tests, compiler
    output-security tests, and the 18-file mutation/live-target/replay suite.
- [x] Run remaining post-merge focused implementation checks.
  - Evidence: `pnpm exec vitest --run packages/browser/src/dynamic-import-url.test.ts packages/browser/src/handlers.test.ts packages/browser/src/loader.test.ts packages/compiler/src/client-secret-capture.test.ts packages/core/src/diagnostics.test.ts packages/compiler/src/diagnostic-coverage-matrix.test.ts packages/compiler/src/emit/bootstrap.test.ts packages/compiler/src/emit/bootstrap-runtime-contract.test.ts`,
    `pnpm exec vitest --run packages/server/src/build.test.ts packages/server/src/node.test.ts`,
    and `pnpm exec vitest --run packages/drizzle/src/index.scope-audits.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-explain.test.ts`.
- [x] Run supply-chain publish and tarball attestation checks.
  - Evidence: `pnpm run check:supply-chain`, `pnpm run check:publish`,
    `node scripts/pack-public-packages.mjs`, and
    `node scripts/publish-packed-packages.mjs --dry-run --tag secure-framework-2`.
- [x] Run package boundary and source hygiene gates.
  - Evidence: `vp check --no-fmt`, `pnpm run check:api-surface`, `pnpm run check:imports`, and
    `git diff --check`.
