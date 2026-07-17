# Security Bug Ledger (`bugz-33`)

**Date:** 2026-07-17

**Status:** Active remediation
**Baseline:** `4403ce7401760725836332aedb3031e1c0833cfe`

**Scope:** Fresh remotely reachable and framework-authority findings after `bugz-32`. Deliberate
same-realm application/dependency compromise is excluded under SPEC §6.6; the final pass instead
covered replay, adapters and parsers, CSRF/forms, cookies and redirects, SSRF, static/file sinks,
rendering, Better Auth, and managed SQL.

## Severity summary

| Severity | Open | Closed |
| -------- | ---: | -----: |
| High     |    1 |      8 |
| Medium   |    0 |     13 |
| Low      |    0 |      3 |

## High

- [x] **H1 - Durable replay truth could saturate for the process lifetime or revive after expiry
      cleanup and database-clock rollback.**
  - A total-row ceiling made sequential committed mutation/webhook traffic permanently exhaust the
    store; incomplete identity/schema coupling and expiry deletion could later admit an exact key
    again. Pre-watermark one-time capability rows had the same resurrection problem.
  - **Fixed:** `ba9c45fa0`, `df3ae1765`, and `f0966fe6f` use an exact
    `(surface, scope, idem)` key, separate 1,000-slot pending pools, authenticated mutation/webhook
    expiries, bounded committed cleanup, persisted per-surface watermarks, and a fail-closed v3
    capability cutover. Pending ambiguity never expires automatically.
  - **Evidence:** integrated Postgres/replay matrix 229/229; capability/route/Postgres matrix
    106/106. Follow-up `6457f772e` keeps optional posture probes inside a savepoint and audits the
    runtime login through a privileged posture client; the exact split-role Postgres probe and
    Postgres runtime/replay matrix passed 1/1 and 130/130.

- [x] **H2 - Configured mutation replay could be silently disabled, and asynchronous admission
      could cross the token horizon before handler execution.**
  - Missing `Kovo-Idem` skipped replay despite a configured store; `csrf:false` sessionless enhanced
    mutations resolved to a null scope and executed duplicates. Custom async get/reserve calls could
    also start fresh and finish stale.
  - **Fixed:** `1ad636afd` and `3b55e47c4` require canonical 24-hour tokens, reject missing tokens
    before store/handler access, length-frame sessionless mutation scope, recheck after async store
    work, abort late pre-handler reservations, and leave post-handler expiry ambiguity pending.
  - **Evidence:** integrated mutation/replay/browser matrix 158/158.

- [x] **H3 - Adapter-proven HTTPS mutations could emit credential cookies without `Secure`.**
  - A development-mode branch overrode trusted request-scheme evidence, allowing a credential cookie
    created on real HTTPS to be sent later over HTTP.
  - **Fixed:** `ac06de197` makes trusted HTTPS force `Secure`; genuine plain-HTTP development remains
    the explicit control.
  - **Evidence:** cookie/Node/mutation focused matrix 177/177.

- [x] **H4 - The package root exposed a raw task SQL adapter that could unwrap managed request DB
      authority.**
  - App code could turn a scoped managed handle into the framework queue's arbitrary SQL executor,
    escaping the reviewed managed-DB surface.
  - **Fixed:** `637c009df` keeps `createDurableTaskSqlExecutor` internal and directs operational
    status readers to an operator-only executor.
  - **Evidence:** API-surface assertions reject the root export.

- [x] **H5 - Packaged Better Auth credential mutations attached their protected key only after
      ordinary mutation construction.**
  - The late key assignment left the credential-bearing browser mutation on a generic handler
    construction path instead of binding the reviewed sign-in/sign-up/sign-out handler directly to
    its security identity.
  - **Fixed:** `7a9bd3717` constructs each packaged credential mutation with its final key and
    pinned Better Auth handler in one step.
  - **Evidence:** Better Auth/runtime-bootstrap focused tests and API/type checks passed at the
    integrated checkpoint.

- [x] **H6 - Request and parser work budgets were optional, disableable, or missing at remote
      ingress.**
  - Apps could disable rate/body limits, configured values had no hard maxima, raw URL/query work
    lacked adapter-wide ceilings, and body chunks, report chunks, replay keys, webhook shapes, and
    form/query entries exposed independent amplification paths.
  - **Fixed:** `b58de9321`, `493e7df45`, `8c643b92e`, `041cf3568`, `8a0d7dd23`, `72dfbd998`,
    `9decef0e6`, and `aec5517ad` impose finite mandatory defaults and hard maxima across direct,
    Node HTTP/1+HTTP/2, Vite, generated Node/Vercel, and Cloudflare paths.
  - **Evidence:** affected request/build/egress matrix 109/109 plus adapter URL-limit regressions.

- [x] **H7 - Ambiguous transaction commit acknowledgements released mutation and webhook replay
      claims.**
  - A successful transaction callback followed by an adapter/COMMIT rejection was treated like a
    proven rollback. If the database committed before its acknowledgement was lost, a remote client
    or provider retry could execute the same write again.
  - **Fixed:** `5eae63679` gives successful-callback adapter failures a framework-owned ambiguous
    settlement signal. Mutation and webhook lifecycles retain the pending replay claim, while setup
    and callback failures still abort it for a safe retry.
  - **Evidence:** focused exactly-once/mutation/webhook replay matrix 138/138; server dist/DTS and
    API-surface checks passed.

- [x] **H8 - Transient authenticated webhook failures were committed as long-lived replay truth.**
  - A webhook handler returning `context.fail(...)` with status `429` or `500` rolled back its work
    but still settled the replay reservation with that response. Provider retries then replayed the
    cached failure for the full retention horizon instead of rerunning the handler.
  - **Evidence:** real signed webhook requests with an in-memory replay store reproduced
    `retry.replayed === true` for both transient statuses before the fix.
  - **Fixed:** `00a1f37d5` aborts replay reservations for retryable `429`/`500` handler outcomes while
    retaining deterministic `400`/`401`/`422` replay truth (SPEC §9.1.1/§10.3).
  - **Evidence:** signed sequential and durable concurrent duplicate/retry regressions passed in
    the webhook matrix 72/72; server dist, API, wire, security-guarantee, and mutation gates passed.

- [ ] **H9 - Configured database authority leaked into process-global outbound networking.**
  - Registering a private Postgres endpoint admitted its host and port through the egress floor for
    ordinary global fetch, Node HTTP, and raw TCP. A remotely influenced generic egress sink could
    therefore reuse framework-granted database reachability without going through the managed
    Postgres driver boundary.
  - **Evidence:** with a private Postgres URL configured, generic process-global network primitives
    reached the same private host/port before the fix.
  - **Open:** bind database egress authority to framework-created Postgres sockets, keep generic
    fetch/HTTP/TCP denied, and prove managed database connectivity still works across bootstrap and
    runtime paths (SPEC §6.6/§9.4/§9.5).

## Medium

- [x] **M1 - HTTP/2 `:authority` and a conflicting visible `Host` could describe different
      origins.**
  - Downstream request policy could observe the attacker-controlled `Host` even though HTTP/2 route
    authority came from `:authority`.
  - **Fixed:** `82dc47260` makes adapter-authenticated `:authority` replace the visible Host value.

- [x] **M2 - Encoded slash/backslash bytes bypassed generated static-file metadata denials.**
  - A raw target could select `_headers` or `kovo-static-manifest.json` through encoded separators
    before the normalized path reached the denylist.
  - **Fixed:** `be8213d19` denies encoded separators before static selection and keeps a sink-level
    metadata denial.
  - **Evidence:** generated Node/static build matrix 92/92.

- [x] **M3 - IANA special-purpose IPv6 space was classified as public egress.**
  - Addresses in `2001::/23` and `3fff::/20` could pass the SSRF public-address classifier.
  - **Fixed:** `be8213d19` adds conservative prefix/boundary classification from the IANA special
    registry.
  - **Evidence:** build/egress matrix 109/109 and classifier corpus 11/11.

- [x] **M4 - Replay-table posture ignored effective column-level grants.**
  - Revoking table privileges alone did not prove that reader/writer/runtime roles lacked direct
    column authority over replay truth.
  - **Fixed:** `a8695988e` audits and revokes table and column privileges; `df3ae1765` extends the
    exact ACL/posture proof to the reclamation watermark.

- [x] **M5 - HTML's reserved `_charset_` control could rewrite a framework-authored hidden field
      and collapse server identity.**
  - Browser submission semantics replaced the authored value, while lossy server identity handling
    could make the rewritten control collide with a trusted hidden input.
  - **Fixed:** `79fed8719`, `eb4c7c257`, `1d32b8f45`, and `39108181b` reject the reserved name across
    JSX, compiler static/spread lowering, and runtime form construction.
  - **Evidence:** compiler/runtime charset and form-authority matrix 265/265.

- [x] **M6 - Webhook replay identity was not bound to the authenticated provider-event horizon.**
  - A bare/timeless provider key could not distinguish an exact redelivery from key reuse and could
    retain truth forever; async verification, parsing, or settlement could cross expiry.
  - **Fixed:** `9431ecac2` and `36bdd64f7` require a framework-proven
    `{key, occurredAtMs, expiresAtMs}` identity, reject local receipt timestamps, conflict on changed
    facts, recheck at reservation/settlement, and preserve pending ambiguity.
  - **Evidence:** webhook/API matrix 72/72 and integrated replay matrix 229/229.

- [x] **M7 - Packaged Better Auth credential mutations bypass Better Auth's router rate limiter.**
  - The wrappers call `auth.api.signInEmail` and `auth.api.signUpEmail` directly. Better Auth 1.6.17
    applies its limiter at router ingress, so repeated remote credential attempts through Kovo never
    receive the router's `429`; a control sent through `auth.handler` does.
  - **Fixed:** `81807f30d` routes credential attempts through a captured Better Auth handler using a
    fresh synthetic POST, an allowlisted header bag, and only Kovo's lifecycle-resolved `clientIp`.
    It preserves routed `429` responses and throws on storage/provider `5xx` failures so replay
    reservations remain retryable. `cbc167db5` pins the reviewed credential rules to Kovo's atomic
    first-party limiter storage.
  - **Evidence:** Better Auth/SQLite/PGlite matrix 200/200; replay A5 429-abort regression 1/1; both
    package dist builds, API-surface, and TCB-boundary gates passed.

- [x] **M8 - Better Auth's database limiter admitted remotely unbounded persistent keys.**
  - Better Auth 1.6.17 creates a row for every fresh client-IP/path key before route resolution.
    Unique trusted identities on a fixed sign-in path and one identity requesting unique missing GET
    mount suffixes both grew the table. Fresh-key admission did not prune stale rows; revisiting one
    expired key instead launched an unbounded global deletion.
  - **Evidence:** a real SQLite repro grew 64 sign-in rows plus 64 distinct `404` mount-path rows,
    then admitted row 129 without pruning any stale row.
  - **Fixed:** `cbc167db5` replaces native runtime storage with exact POST-only credential rules,
    disables arbitrary mount-path keys, maps raw identities through a domain-separated secret HMAC
    into a fixed 65,536-bucket namespace, and consumes each bucket through one conditional
    database-clock upsert. Collisions aggregate attempts and therefore fail closed.
  - **Evidence:** real PostgreSQL two-consumer 20-way concurrency admitted 3 and denied 17 with one
    row/count 3 and no uniqueness error; independent multi-process SQLite produced the same 3/17
    result. Unknown, encoded, and GET mount paths produced zero limiter rows.

- [x] **M9 - Direct HTTP/2 peers could forge or suppress HTTPS transport posture with
      `:scheme`.**
  - The generic Node HTTP/2 conversion treated the request-target pseudo-header as trusted
    transport evidence. A cleartext h2c client could supply `:scheme: https`, while an encrypted
    peer could supply `:scheme: http`, changing request URLs and downstream cookie/HSTS/redirect
    posture without an authenticated proxy boundary.
  - **Evidence:** a real `http2.createServer()` h2c request reached the Kovo handler as
    `https://app.example/transport-proof`; the encrypted-socket control was downgraded to `http`.
  - **Fixed:** `4c4123764` derives direct-request scheme from socket encryption and admits
    forwarded/pseudo-header scheme only after explicit `trustedProxy` authentication, with parity
    in source and emitted Node/Vercel adapters (SPEC §9.5; RFC 9113 §8.3.1).
  - **Evidence:** Node/scheme/build matrix 97/97; cookie/CSRF/response-posture matrix 163/163;
    server dist, wire-output boundary, and API-surface gates passed.

- [x] **M10 - Trusted-proxy scheme resolution selected the attacker-nearest list member.**
  - Generic Node consumed the first/raw `X-Forwarded-Proto` value. A proxy that preserved or
    appended to an inbound chain therefore let a remote leftmost value override the closest trusted
    hop, forging or suppressing HTTPS request, cookie, HSTS, callback, and redirect posture.
  - **Evidence:** real duplicate HTTP/1 headers arrived as `http, https` but resolved to `http`; an
    inverse `https, http` control falsely resolved to secure. Six new live/internal/emitted parity
    assertions failed before the fix while 93 existing controls passed.
  - **Fixed:** `0cf7a1e69` binds scheme to the exact trimmed rightmost hop across source Node,
    internal scheme, and emitted Node/Vercel paths. Invalid or empty terminal values throw instead
    of falling through to another HTTPS signal (SPEC §9.5).
  - **Evidence:** combined live/internal/emitted and security-consumer matrix 263/263; server dist,
    wire-output boundary, API-surface, and static/type gates passed.

- [x] **M11 - Scheme-bearing mutation targets could disagree across raw and WHATWG parsing.**
  - The raw reserved-mutation classifier hand-split absolute-form targets, while request assembly
    used the WHATWG URL parser. Node accepted extra authority slashes that made the first parser see
    a non-reserved path and the second normalize to `/_m/...`, crossing the canonical mutation
    boundary and enabling proxy/backend policy differentials.
  - **Evidence:** real HTTP/1 `POST http:////attacker.test/_m/a/b` returned `303` and invoked the
    mutation before the fix; live direct and emitted Node/Vercel parity controls failed too.
  - **Fixed:** `d074924ae` classifies scheme-bearing targets with the same WHATWG parser used by
    request assembly, rejects normalized reserved aliases and malformed absolute targets before
    dispatch, and preserves canonical origin-form mutation behavior (SPEC §6.6/§9.2/§9.5).
  - **Evidence:** direct/live/generated Node and Vercel target-parity matrix 95/95; wire-output
    boundary gate passed.

- [x] **M12 - HTTP/1 Host authority could disagree across raw-header and WHATWG parsing.**
  - Node accepts delimiter-bearing Host values such as `victim.example@evil.example` and
    `victim.example/ignored`. Kovo preserved that raw Host for application policy while WHATWG URL
    construction interpreted userinfo or path semantics, producing a different request authority;
    generated static selection could also run before any authority parse.
  - **Evidence:** a real HTTP/1 socket reached the handler with divergent raw Host and request URL;
    HTTP/2 rejects the same delimiters at its transport parser.
  - **Fixed:** `1ee903917` preserves raw Host occurrence count, requires exactly one syntactically
    valid scalar authority before URL construction, static selection, or handler loading, and keeps
    HTTP/2 `:authority` precedence plus valid hostname/port, bracketed-IPv6, and HTTP/1.0 controls
    (SPEC §9.5).
  - **Evidence:** real-wire/live/generated Node and Vercel authority matrix 97/97; broader
    adapter/mutation/CSRF/cookie/posture matrix 244/244; server dist, wire, API, and VP gates passed.

- [x] **M13 - Trusted proxy schemes silently coerced malformed values to HTTP.**
  - With `trustedProxy` enabled, present noncanonical `:scheme` values were read through a generic
    header helper and every value other than exact `https` became `http`. A malformed trusted field
    could therefore suppress secure-cookie and HSTS posture rather than fail closed.
  - **Evidence:** real h2c `:scheme: javascript` reached the handler as an HTTP URL; an encrypted
    carrier with the same present-invalid field was also downgraded. Vercel's edge XFP path had the
    equivalent present-invalid fallback.
  - **Fixed:** `403cdaa11` fail-closes present-invalid HTTP/2 pseudo-schemes and Vercel edge XFP,
    normalizes valid pseudo-scheme casing, preserves the closest-hop XFP rule, and keeps live and
    emitted adapters in parity (SPEC §9.5).
  - **Evidence:** Node/request-scheme/build matrix 106/106; cookie/CSRF/response-posture/document
    matrix 163/163; server dist, wire, API, and VP gates passed.

## Low

- [x] **L1 - The Vercel preset copied framework metadata files into the public static root.**
  - `_headers` and `kovo-static-manifest.json` disclosed internal deploy/header metadata even though
    the runtime did not need them as public assets.
  - **Fixed:** `82dc47260` omits both files from the Vercel static output. Follow-up `8753ea9b7`
    closes the same disclosure in Cloudflare static and mixed builds while retaining the reserved
    `_headers` deploy artifact.
  - **Evidence:** Cloudflare build and static-output matrices 53/53 and 22/22.

- [x] **L2 - Durable task-status filters and result breadth lacked tight operational bounds.**
  - An exposed operator/status endpoint could request overly broad scans or oversized status data.
  - **Fixed:** `774d22ef0` bounds filters, limits, identifiers, and returned task data.

- [x] **L3 - Built-in production HTTPS 403/404/500 documents omitted HSTS.**
  - Normal and configured error documents preserved adapter-proven HTTPS, but the built-in fallback
    renderer discarded that fact.
  - **Fixed:** `5fb6221e6` threads trusted scheme posture into built-in error rendering while keeping
    production-HTTPS-only HSTS behavior.
  - **Evidence:** integrated document/app-document matrix 96/96 and wire-output boundary gate.

## Latest verification

- Mutation/replay/browser focused matrix: 158/158.
- Ambiguous-settlement exactly-once/mutation/webhook replay matrix: 138/138.
- Durable Postgres/webhook/replay focused matrix: 229/229.
- Capability/route/Postgres focused matrix: 106/106.
- Document/app-document focused matrix: 96/96.
- Normalized raw-target Node/build parity matrix: 95/95; wire-output boundary gate passed.
- Host-authority live/generated matrix: 97/97; wire-output boundary gate passed.
- Trusted-scheme live/generated matrix: 106/106; wire-output boundary gate passed.
- Webhook signed replay/retry matrix: 72/72; wire-output boundary gate passed.
- Better Auth/SQLite/PGlite matrix: 200/200; real PostgreSQL and multi-process SQLite concurrency
  each admitted 3/20 with one row; replay 429-abort regression, dist, API, and TCB gates passed.
- Final exact-tip remote-boundary review remains open until H9 lands and the parallel fresh passes
  find no new remotely reachable issue.
