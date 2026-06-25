# Secure Framework 3 - Additional Security Capability Audit

**Date:** 2026-06-25
**Status:** Active follow-up ledger
**Scope:** Additional framework security ideas found after re-reading `plans/secure-framework.md`,
`plans/secure-framework-2.md`, `plans/runtime-backstops.md`, representative compiler/runtime/server/browser
code, and current supply-chain/build surfaces.

## Baseline

- `SPEC.md` remains the normative source of truth. This plan catalogs additional hardening ideas only.
- Do not use this ledger to duplicate the still-owned `plans/secure-framework.md` follow-ups: KV429
  runtime CAS/version primitives, KV433 managed read-only handles and interprocedural summaries,
  capability download routes plus `ctx.signUrl`, Trusted Types inline-loader routing, producer
  explain output, `staticExportPathOverride`, and KV434 compiler-side non-literal-pattern lint.
- Do not reopen completed `plans/secure-framework-2.md` items unless a narrower bypass class is named
  here. That plan already covers SQL/static analyzer hardening, replay/request-limit work, trusted
  proxy, endpoint posture verification, mutation/query no-store posture, client import URL guards,
  route response reserved headers, deployment header parity, and supply-chain release-input checks.
- Do not duplicate active compiler audit items in `plans/compiler-better.md`, recursive publicness work
  in the API cleanup/audit plans, or the completed runtime sink backstop baseline in
  `plans/runtime-backstops.md`.

## Tier 0 - Runtime And Wire Floors

- [x] **Centralize framework-generated system response posture.**
  - Evidence: pre-dispatch 429 and 413 responses are built directly in
    `packages/server/src/app-load-shed.ts:98` and carry only `Content-Type` plus optional
    `Retry-After` (`packages/server/src/app-load-shed.ts:109`, `packages/server/src/app-load-shed.ts:153`).
    `handleAppRequest()` also creates bare normalization redirects and stream-limit 413s at
    `packages/server/src/app-request.ts:30` and `packages/server/src/app-request.ts:46`.
  - Work: add one helper for framework-owned 3xx/4xx/5xx system responses so mutation/query surfaces
    inherit `Cache-Control: private, no-store`, `Vary: Cookie`, build-token, and security headers when
    appropriate before dispatch, including body-limit, rate-limit, and normalization paths.
  - Acceptance: tests prove `/_m` and `/_q` pre-dispatch 413/429 responses keep the same private
    posture as post-dispatch mutation/query responses without weakening static asset/document caching.
  - Verified 2026-06-25: `packages/server/src/app-system-response.ts` centralizes reserved system
    response posture; `pnpm test packages/server/src/app.test.ts` proves `/_m` and `/_q` 413/429
    stamping, reserved normalization redirect stamping, and no cache/build-token bleed into route
    normalization redirects. `pnpm run check:imports` passes for the new module.

- [ ] **Bound app-level rate limiter key cardinality.**
  - Evidence: app rate state is two unbounded `Map<string, RateBucket>` stores
    (`packages/server/src/app-load-shed.ts:25`), keys are inserted on every request
    (`packages/server/src/app-load-shed.ts:217`), and `appRateState()` creates persistent per-app maps
    (`packages/server/src/app-load-shed.ts:232`). Buckets age out logically, but there is no global
    sweep or max distinct-key cap.
  - Work: add bounded LRU/window pruning and a conservative `maxKeys` default for per-IP and scoped
    request-limit maps. Treat attacker-controlled trusted-proxy or `clientIp()` cardinality as a DoS
    input, not just a rate-limit input.
  - Acceptance: tests drive thousands of distinct IP keys across windows and assert bounded memory
    growth plus preserved retry-after behavior for active buckets.

- [ ] **Sanitize browser `Kovo-Reauth` directives before navigation.**
  - Evidence: modular mutation fetch follows any 401 `Kovo-Reauth` header with `location.assign`
    (`packages/browser/src/mutation-fetch.ts:100`, `packages/browser/src/mutation-fetch.ts:127`), and
    the generated inline path does the same at `packages/browser/src/inline-loader-build.ts:867`.
    The server's normal guard path emits a sanitized login location, but the browser sink still trusts
    a raw response header.
  - Work: route `Kovo-Reauth` through the same same-origin/single-leading-slash redirect sanitizer used
    by server auth redirects, and fail closed to reload or `/` when the directive is external,
    protocol-relative, backslash-prefixed, or malformed.
  - Acceptance: browser and inline-loader tests cover malicious absolute, protocol-relative, backslash,
    encoded-control, and safe path-only `Kovo-Reauth` values.

- [ ] **Make the CSRF Origin floor strict and default-on for unsafe real requests.**
  - Evidence: the CSRF floor deliberately allows `Sec-Fetch-Site: same-site` or `none` when `Origin`
    is absent (`packages/server/src/csrf.ts:156`, `packages/server/src/csrf.ts:164`,
    `packages/server/src/csrf.ts:180`). Tests codify that compatibility behavior in
    `packages/server/src/csrf.test.ts:384`.
  - Work: remove the compatibility fallback. Any unsafe real `Request` protected by the CSRF floor
    must carry a usable `Origin` matching the request origin or `trustedOrigins`; `Sec-Fetch-Site`
    is never an allow signal without `Origin`. Keep direct plain-object `runMutation` request shapes
    outside this browser-header floor.
  - Acceptance: mutation and endpoint CSRF tests reject missing, empty, `null`, same-site/no-Origin,
    and `none`/no-Origin unsafe requests even with a valid token; same-origin and trusted-origin
    unsafe requests still require and validate the synchronizer token.

- [ ] **Support CSRF secret rotation without dropping valid in-flight forms.**
  - Evidence: `CsrfOptions` accepts one `secret` string (`packages/server/src/csrf.ts:20`), and token
    minting is a raw HMAC over the binding with no key id or previous-secret window
    (`packages/server/src/csrf.ts:326`).
  - Work: allow `{ current, previous }` or key-id based CSRF secrets, emit new tokens with the active
    key, verify within a bounded previous-key window, and document deploy rotation.
  - Acceptance: tests show old forms survive one configured rotation window, stale keys fail after the
    window, and weak/missing production secrets still refuse boot through the existing env policy.

- [ ] **Drain runtime sink security events instead of discarding them.**
  - Evidence: the shared sink policy creates structured `KV236` events
    (`packages/core/src/internal/sink-policy.ts:250`, `packages/core/src/internal/sink-policy.ts:260`),
    but server/browser call sites consume only `action`/`value` and drop `decision.event`
    (`packages/server/src/html.ts:146`, `packages/browser/src/security-output.ts:154`,
    `packages/browser/src/security-output.ts:165`, `packages/browser/src/query-bindings.ts:672`).
  - Work: add a small runtime event drain for blocked sink writes: dev console/report hook,
    testable callback, or `kovo explain` runtime summary input. Keep payloads redacted.
  - Acceptance: tests prove blocked URL/srcset/CSS/raw-HTML/event writes emit exactly one redacted
    event per blocked write in dev/test and do not leak attacker-controlled values.

## Tier 1 - Browser Sink Parity

- [ ] **Generate the inline fragment sanitizer from the shared sink policy, or prove byte-level parity.**
  - Evidence: `response-fragment-apply.ts` still carries local mini-sanitizer functions for fragment
    adoption (`packages/browser/src/response-fragment-apply.ts:153`, `packages/browser/src/response-fragment-apply.ts:173`,
    `packages/browser/src/response-fragment-apply.ts:184`, `packages/browser/src/response-fragment-apply.ts:193`),
    while the shared decision table lives in `packages/core/src/internal/sink-policy.ts:44` through
    `packages/core/src/internal/sink-policy.ts:157`. The file also documents that Trusted Types routing
    for inline loader HTML sinks remains a separate deferred path (`packages/browser/src/response-fragment-apply.ts:3`).
  - Work: either generate the inline helper's URL/srcset/CSS/raw-HTML decisions from the shared policy
    at build time, or add a parity test corpus that compares every generated inline sanitizer decision
    against `decideRuntimeAttributeWrite()`.
  - Acceptance: adversarial cases for `srcset` commas, `imagesrcset`, CSS text, mixed-case raw HTML,
    `xlink:href`, and obfuscated schemes pass identically in server, modular browser, and extracted
    inline-loader paths.

- [ ] **Separate Trusted Types inline routing from sanitizer parity and track both gates independently.**
  - Evidence: `packages/server/src/csp.ts:220` keeps `require-trusted-types-for 'script'` opt-in because
    internal browser sinks are not all routed through the framework policy yet, and
    `packages/browser/src/response-fragment-apply.ts:9` names the extracted inline fragment sinks.
  - Work: add a dedicated status/test gate that fails if sanitizer parity regresses, even before the
    older Trusted Types inline-loader routing item is complete. This prevents "TT not done yet" from
    hiding policy drift in the generated inline helper.
  - Acceptance: `check:inline-loader` or a companion gate fails on any sanitizer policy drift without
    requiring Chromium Trusted Types support.

## Tier 2 - Raw Escape Hatches And Operator Controls

- [ ] **Add reserved-header posture for raw endpoints.**
  - Evidence: `runEndpoint()` returns the handler's raw `Response` after posture assertion
    (`packages/server/src/endpoint.ts:170`), and the current dev/opt-in assertion checks cache,
    body kind, and content type only (`packages/server/src/endpoint.ts:263`). Route file/stream
    outcomes already filter reserved headers such as `set-cookie`, `content-type`, and
    `x-content-type-options` (`packages/server/src/response.ts:489`).
  - Work: extend `EndpointResponsePosture` with reserved/protocol header declarations, or add a
    default dev/CI assertion that flags raw endpoint writes to framework protocol headers
    (`Kovo-*`), security headers, `Set-Cookie`, and redirects unless explicitly declared.
  - Acceptance: endpoint tests cover accidental `Kovo-Reauth`, `Kovo-Build`, `Kovo-Changes`,
    `Set-Cookie`, `Location`, and CSP overrides with precise diagnostics and a documented opt-out for
    legitimate machine endpoints.

- [ ] **Promote endpoint posture verification into a first-class CI/starter gate.**
  - Evidence: endpoint posture verification is skipped outside development unless
    `KOVO_VERIFY_ENDPOINT_POSTURE=1` is set (`packages/server/src/endpoint.ts:267`), so production and
    most CI runs can silently miss posture drift unless the operator knows the env knob.
  - Work: wire `kovo check` and generated starters to run endpoint posture verification against
    declared endpoint examples or fixture requests, and document when runtime-only verification is the
    right tool.
  - Acceptance: starter `check` fails on a mismatched raw endpoint cache/body/content-type/header
    posture without requiring a live production request.

- [ ] **Harden egress floor propagation and tamper detection.**
  - Evidence: the egress bootstrap honestly documents residual fail-open holes: same-process re-patching,
    worker/child-process boundaries, per-fetch dispatcher bypass, and provider shape drift
    (`packages/server/src/egress-bootstrap.ts:30`). The net layer repeats worker and same-process
    limitations at `packages/server/src/egress.ts:507`.
  - Work: add adapter/starter self-probes for workers and child processes, tamper detection for
    `net.Socket.prototype.connect` and undici global dispatcher changes after install, and a documented
    hardening mode that freezes or warns on transport monkeypatch changes.
  - Acceptance: tests simulate worker bootstrap omission, late `setGlobalDispatcher`, and late
    `net.connect` re-patching; each produces a loud failure or warning without claiming sandbox-level
    protection.

## Tier 3 - Filesystem, Static Export, And Supply Chain

- [ ] **Make static export writes symlink/race aware.**
  - Evidence: static export validates parent directories and target directories with `lstat`
    (`packages/server/src/static-export-output.ts:318`), writes into a staging root, then commits with
    `rename()` into final targets (`packages/server/src/static-export-output.ts:387`). Path traversal
    is handled in `static-export-output-targets.ts`, but symlink parents and time-of-check/time-of-use
    swaps are a separate local-filesystem class.
  - Work: add tests for symlinked output parents, symlinked targets, and target swaps between preflight
    and commit. Use `realpath`/`lstat` revalidation, no-follow writes where Node supports them, or a
    documented refusal to write into symlinked output trees.
  - Acceptance: export either rejects symlinked/swap targets with KV229 or proves it replaces only the
    symlink itself; stale-route pruning must not follow symlinks outside the output root.

- [ ] **Add a publish tarball content security gate.**
  - Evidence: `scripts/build-publish.mjs` builds every public package and verifies `publishConfig`
    targets exist (`scripts/build-publish.mjs:199`), but it does not inspect the final `pnpm pack`
    file list or payload contents. Package `files` entries limit tarballs to `dist`, while the root
    `tsconfig.json` still enables declaration maps (`tsconfig.json:5`).
  - Work: add a `check:pack-security` gate that runs `pnpm pack --json` for public packages and rejects
    `.env`, tests, fixtures, source maps/declaration maps with absolute paths, unexpected source files,
    oversized generated blobs, and known secret patterns.
  - Acceptance: gate snapshots each public tarball's files, proves every exported target exists in the
    tarball, and includes negative fixtures for leaked `.env`, absolute local paths, and high-entropy
    secret-like strings.

- [ ] **Normalize static-export asset/header policy through a shared header sink.**
  - Evidence: static asset headers are converted with `new Headers(asset.headers)` and sorted in
    `packages/server/src/static-export-output.ts:398`, while general header/cookie control-character
    validation lives elsewhere, for example `packages/server/src/cookies.ts:432`.
  - Work: create a shared response-header sink for static export assets, route outcomes, endpoint
    posture checks, and deployment manifests. It should reject control characters, normalize casing,
    and optionally flag static-export `Set-Cookie` or protocol headers.
  - Acceptance: static export and route/endpoint tests share the same header corpus for CRLF, invalid
    names, duplicate security headers, `Set-Cookie`, and framework-reserved `Kovo-*` headers.

## Latest Verification

- `rg -n "^- \[[ x]\]" plans/secure-framework-3.md` reports 14 open task-list items.
- `git diff --no-index --check /dev/null plans/secure-framework-3.md` emitted no whitespace
  diagnostics. Exit status is nonzero only because `/dev/null` and the new file differ.
