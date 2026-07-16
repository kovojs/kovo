# Security Bug Ledger (`bugz-32`)

**Date:** 2026-07-16

**Baseline:** `c7d9aa11d748c293bf86c3fdff969c578e23a0cb` (`origin/main` when this
ledger was synthesized; the reproduced `fdc83e096` runtime/browser baseline has no intervening
changes in the affected source files).

**Scope:** Fresh deploy-adapter, endpoint-lifecycle, and browser-enhancement findings beyond the
prior ledgers. Runtime candidates were independently reproduced in a six-test worktree matrix;
browser candidates were exercised through the real modular runtime, generated inline runtime, and
Chromium, then independently reviewed. Open `bugz-31` C1-C3 and intrinsic-poisoning variants are
deliberately excluded. No production code changed.

## Severity summary

| Severity | Families | Items |
| -------- | -------: | ----- |
| High     |        1 | H1    |
| Medium   |        5 | M1-M5 |

The recurring failure is boundary metadata that Kovo knows how to validate but does not bind to the
platform or browser primitive that actually supplied it.

## High

- [ ] **H1 - The Vercel preset loses platform-authenticated client IP and HTTPS provenance.**
      `packages/server/src/{build.ts:1044-1091,build.ts:1150-1181,build.ts:1519-1534,build.ts:1665-1695,app-load-shed.ts:1026-1041}`
  - The generated function converts Vercel's bridged Node request with
    `nodeRequestToWebRequest(nodeRequest, {}, nodeResponse)`. The bridge's loopback peer becomes the
    trusted per-IP identity, while platform-forwarded client IP and scheme remain ordinary headers
    that the default adapter intentionally ignores.
  - **Verified:** two requests carrying distinct Vercel `X-Forwarded-For` clients shared the same
    loopback bucket: the first mutation passed and the second received 429. Separately, an external
    HTTPS request represented as bridge HTTP plus `X-Forwarded-Proto: https` was reconstructed as
    HTTP; a legitimate HTTPS `Origin` plus valid CSRF token received 422 and the response omitted
    HSTS. Explicit `trustedProxy`/native-HTTPS controls admitted both clients and returned 200 with
    the secure-request posture.
  - **SPEC conflict:** §6.6 and §9.1 require the CSRF Origin floor and request security facts to
    fail closed on the actual external request, while §9.5 requires the default coarse limiter to
    enforce a real per-IP budget. Neither contract can use the internal bridge hop as the external
    client. This is distinct from `bugz-4` M10's forwarded-chain parsing bug: no attacker-selected
    hop is trusted here; the Vercel preset never converts authenticated platform facts into Kovo's
    trusted request metadata.
  - **Acceptance:** the Vercel adapter must derive client IP and scheme from Vercel-authenticated
    metadata, bind them as framework-owned request facts before dispatch, and prove distinct-client
    rate buckets plus external-HTTPS CSRF/HSTS behavior. Direct Node deployments must continue to
    ignore spoofable forwarded headers unless explicitly configured.

## Medium

- [ ] **M1 - Enhanced mutation dispatch ignores submitter `formaction`/`formmethod` and can run the
      destructive base mutation instead of the native preview action.**
      `packages/browser/src/{mutation-submit.ts:85-107,mutation-submit.ts:135-139,mutation-form.ts:28-33,mutation-fetch.ts:121-155,inline-loader-build.ts:1423-1451,inline-loader-build.ts:2235-2272}`;
      `packages/compiler/src/emit/server-emit-shared.ts:513-534`
  - Both runtimes use the submitter only while constructing `FormData`, then dispatch with the base
    form's action/method. The compiler accepts submitter overrides inside a typed enhanced mutation,
    and bootstrap fallback uses `form.submit()`, which also discards submitter semantics.
  - **Verified:** a typed base `POST /_m/delete` form with valid CSRF/idempotency fields and a
    nameless Preview button carrying `formaction="/preview" formmethod="get"` performed native
    `GET /preview?...` without the loader. The generated inline runtime instead POSTed the destructive
    base mutation with a valid token and fresh `Kovo-Idem`; the modular path did the same, and its
    fetch-failure fallback also discarded the effective submitter target.
  - **SPEC conflict:** §6.3 makes a typed mutation form a real emitted form, §7 defines L2 as a
    progressive enhancement over that form, and §9.1 requires the enhanced and no-JS paths to use
    the same endpoint/behavior. This is not `bugz-28` C210's poisoned native-submit sink: genuine,
    pristine browser submitter semantics are lost before transport selection.
  - **Acceptance:** reject or diagnose submitter action/method overrides in typed enhanced mutation
    forms, evaluate the submitter's effective action/method before intercepting any raw enhanced
    form, and preserve the submitter when falling back to native submission. Browser tests must prove
    Preview never invokes the base mutation with or without the loader.

- [ ] **M2 - The Cloudflare preset omits the platform client IP, silently disabling default per-IP
      load shedding.** `packages/server/src/{build.ts:1724-1795,app-load-shed.ts:1026-1065}`
  - The Worker passes the native `Request` directly to the app. Kovo has neither a peer-address
    binding nor a preset-owned extractor for direct Cloudflare-edge `CF-Connecting-IP`, while the
    safe generic default correctly refuses to trust arbitrary forwarded headers. The preset also
    does not distinguish direct edge ingress from same-zone Worker subrequests, where
    [Cloudflare documents](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip-in-worker-subrequests)
    that `CF-Connecting-IP` reflects Worker-mutable `x-real-ip`.
  - **Verified:** two requests with the same `CF-Connecting-IP` were both admitted under a one-request
    per-IP budget and allocated zero per-IP keys. Supplying an explicit `requestLimits.clientIp`
    extractor made the second request return 429.
  - **SPEC conflict:** §9.5 requires a default coarse per-IP budget ahead of dispatch. This is
    distinct from H1 because Cloudflare loses the dimension entirely rather than collapsing clients
    through a Node bridge, and from `bugz-4` M10 because the authenticated Cloudflare field is never
    parsed at all.
  - **Acceptance:** the Cloudflare preset must bind direct-edge platform-authenticated client IP as
    a private framework fact and prove same-client throttling/distinct-client separation without
    making raw `CF-Connecting-IP` trusted on non-Cloudflare adapters. Same-zone Worker subrequests
    must fail closed for user-IP limiting or receive a separate non-user identity that cannot be
    rotated through `x-real-ip`; direct-edge and subrequest cases need distinct regressions.

- [ ] **M3 - Endpoint CSRF and effect posture classify only four unsafe verbs and let nominally safe
      methods retain write/browser-state authority.**
      `packages/server/src/{app-dispatch.ts:111-151,app-dispatch.ts:191-215,csrf.ts:458-466,endpoint.ts:829-903,response-posture.ts:641-660}`;
      `packages/cli/src/graph-explain-format.ts:981`
  - `requiresCsrf()` knows only POST/PUT/PATCH/DELETE even though `EndpointMethod` accepts arbitrary
    strings, so state-changing extension methods such as MKCOL/PURGE skip the default check. At the
    other edge, a default-CSRF GET `endpoint({ db: true })` retains Authorization, receives a managed
    Writer through `ctx.actAs()`, and may emit `Set-Cookie`; the executable-verifier response gate
    runs only on `csrf:false`. The endpoint audit nevertheless prints `csrf=checked`.
  - **Verified:** MKCOL/PURGE handlers ran without a token while the otherwise-identical POST control
    returned 422. A GET endpoint wrote through its Writer and emitted browser state without an
    executed verifier. Kovo did strip Cookie, so this finding does **not** claim the old ambient-Cookie
    bypass from `bugz-3` L16.
  - **SPEC conflict:** §9.1 requires endpoint auth/CSRF/effect posture to remain explicit and §11.4
    defines the printed endpoint audit as the verification surface. A label of `checked` is false
    when the declared method bypasses the check, while the effect contract for nominally safe methods
    is currently underspecified. This is distinct from `bugz-28` H13's mutable method canonicalizer:
    exact pristine methods take the wrong policy branch.
  - **Acceptance:** first update `spec/09-wire-protocol.md` §9.1 with a closed safe-method/effect
    contract and `spec/11-verification.md` §11.4 with an audit vocabulary that distinguishes an
    executed CSRF check from the new safe-method posture. Then default unknown/custom methods to
    unsafe and CSRF-checked, make the normative safe set reader-only and browser-state-effect-free
    unless an executable verifier authorizes the effect, and replace the unconditional `checked`
    label with the vocabulary the updated SPEC defines. Cover custom verbs, GET/HEAD, Writer
    acquisition, retained Authorization, and `Set-Cookie` in runtime and audit tests.

- [ ] **M4 - Both enhanced mutation runtimes send the browser fragment in `Kovo-Current-Url`, and
      the server exposes it to handlers and some fallback redirects.**
      `packages/browser/src/{mutation-fetch.ts:121-140,inline-loader-build.ts:1423-1447}`;
      `packages/server/src/{app-mutation-request.ts:404-428,app-document.ts:614-617,mutation-wire.ts:947-955}`
  - Both clients serialize `location.href` rather than origin/path/query. The server accepts the
    same-origin value with its hash, uses it as mutation current/source URL, and exposes the unchanged
    header to ordinary mutation code. When Referer is missing or unusable, the default redirect also
    falls back to that hash-bearing current URL. Live-target attestation canonicalization strips the
    fragment, so a fragment-bearing request still verifies.
  - **Verified:** real Chromium sent `#access_token=...` in the enhanced header while the native
    Referer omitted it, and the mutation handler read the exact secret-bearing value. Separately, a
    synthetic/custom no-JS request with no usable Referer produced a default 303
    `Location: /settings#...`. A normal request with usable Referer prefers that Referer, and the
    official enhanced path consumes a fragment response rather than this PRG redirect; the direct
    handler disclosure remains unconditional on those redirect preconditions.
  - **SPEC conflict:** §9.1 explicitly defines the canonical source-document URL as origin, path,
    and query, **never the fragment**. This is distinct from prior URL-redaction findings: the client
    actively promotes browser-only fragment data onto the HTTP wire.
  - **Acceptance:** strip `hash` before either runtime emits `Kovo-Current-Url`, reject or normalize
    fragment-bearing values at server ingress as defense in depth, and prove OAuth/history/inherited
    hashes never reach a handler, attestation input, or redirect.

- [ ] **M5 - The inline loader enhances external/non-mutation forms, while both mutation runtimes
      trust foreign or wrong-media responses inside the app origin.**
      `packages/browser/src/{mutation-form.ts:43-61,mutation-fetch.ts:151-245,navigation-security-intrinsics.ts:2459-2469,inline-loader-build.ts:1120-1190,inline-loader-build.ts:1423-1451,inline-loader-build.ts:1548-1561}`;
      `packages/compiler/src/{emit/server-emit-shared.ts:197-245,emit/server-emit-shared.ts:513-534,emit/mutation-form.ts:426-493}`
  - The modular runtime limits enhancement to same-origin POST `/_m/` forms; the inline runtime
    intercepts every form carrying an enhancement marker. The compiler accepts raw enhanced
    non-mutation/external actions. After a request is admitted, **both** modular and inline response
    paths consume Kovo response vocabulary without requiring the final response URL to remain
    same-origin or the response to carry the mutation media type; the modular response membrane
    already snapshots URL and headers, so the missing validation is not a carrier limitation.
  - **Verified:** with an explicitly permitted CSP `connect-src` and CORS-open receiver, a pristine
    compiled external form POSTed the full current URL, target/dependency/live-attestation/props
    metadata, form target, fresh idempotency value, and body to another origin. A Kovo-shaped foreign
    response from a matching public build was sanitized and then applied as attacker-selected UI/DOM
    inside the app origin. No cookies crossed origin and no script execution was demonstrated;
    default CSP or a denied CORS preflight blocks this path, so impact is Medium.
  - **SPEC conflict:** §7 limits L2 to mutations, §9.1 defines the enhanced wire as `POST /_m/<key>`,
    and the full server response is the authority for mutation reconciliation. This is distinct from
    `bugz-28` H23's intrinsic-poisoned enhanced navigation: the generated pristine mutation loader
    omits the modular initial-form eligibility gate, while both pristine mutation runtimes omit the
    final-response origin/media gates.
  - **Acceptance:** share the modular same-origin `POST /_m/` initial-form predicate with the
    generated/bootstrap path; compiler lowering must reject raw `enhance` without typed mutation
    ownership and typed external/non-mutation overrides. Independently, both modular and inline
    response paths must require the final response URL to remain same-origin and the exact mutation
    media type before consuming any Kovo vocabulary, with native form fallback for ineligible forms.

## Duplicate and control review

- Prior ledgers were searched for submitter overrides, external enhancement, `Kovo-Current-Url`,
  deploy-adapter client IP/scheme binding, custom endpoint verbs, and safe-method effects. The nearest
  closed items are identified under each finding; none covers the same pristine root cause.
- Default CSP/CORS, explicit trusted-proxy/client-IP configuration, native Referer behavior, Cookie
  stripping, POST CSRF rejection, and modular same-origin mutation eligibility were exercised as
  controls and constrain the rankings above.

## Verification methodology

- Runtime findings: independent six-test reproduction against real server/build paths at
  `fdc83e096`; affected files are byte-identical at the `c7d9aa11d` ledger baseline.
- Browser findings: four browser/compiler reproductions, one server reproduction, two controls, and
  a real-browser public-build control; an independent skeptic re-derived all three Medium claims in
  a separate throwaway worktree. The repro worktrees were removed, and no test or production change
  is retained by this ledger.
