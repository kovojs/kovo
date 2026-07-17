# Security Bug Ledger (`bugz-33`)

**Date:** 2026-07-17

**Status:** Remediated; final exact-tip verification and publication pending
**Baseline:** `4403ce7401760725836332aedb3031e1c0833cfe`

**Scope:** Fresh remotely reachable and framework-authority findings after `bugz-32`. Deliberate
same-realm application/dependency compromise is excluded under SPEC §6.6; the final pass instead
covered replay, adapters and parsers, CSRF/forms, cookies and redirects, SSRF, static/file sinks,
rendering, Better Auth, and managed SQL.

## Severity summary

| Severity | Open | Closed |
| -------- | ---: | -----: |
| High     |    0 |     17 |
| Medium   |    0 |     20 |
| Low      |    0 |      4 |

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
  - **Fixed:** `13ad6f7c9` gives successful-callback adapter failures a framework-owned ambiguous
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

- [x] **H9 - Configured database authority leaked into process-global outbound networking.**
  - Registering a private Postgres endpoint admitted its host and port through the egress floor for
    ordinary global fetch, Node HTTP, and raw TCP. A remotely influenced generic egress sink could
    therefore reuse framework-granted database reachability without going through the managed
    Postgres driver boundary.
  - **Evidence:** with a private Postgres URL configured, generic process-global network primitives
    reached the same private host/port before the fix.
  - **Fixed:** `0bba77c20` binds each registered database endpoint to the exact framework-created
    node-postgres socket through module-private provenance. Generic fetch/HTTP/raw TCP remain
    subject to the private-network floor, and no package export exposes the socket mint
    (SPEC §6.6/§9.4/§9.5).
  - **Evidence:** egress/bootstrap/Postgres runtime matrix 192/192; real PostgreSQL 18 literal,
    hostname, reconnect, and TLS reconnect probes 2/2; all 11 classifier corpora plus egress, API,
    and TCB boundary gates passed.

- [x] **H10 - Sibling subdomains could shadow first-party Better Auth session cookies.**
  - HTTPS bindings used a `__Secure-` session-cookie name. A sibling subdomain could plant an older
    valid attacker session with `Domain=.example.com`; browser ordering sent it before the victim's
    host-only cookie, and Better Auth selected the first duplicate value.
  - **Evidence:** a real SQLite Better Auth lifecycle resolved a victim request as the attacker's
    account after victim sign-in when both same-name cookies were present.
  - **Fixed:** `18df63be8` configures fixed SQLite/Postgres bindings to mint and read exact
    `__Host-better-auth.*` names on HTTPS, with Secure, Path=/, HttpOnly, and no Domain. The browser
    therefore prevents sibling subdomains from planting the protected cookie name while Better
    Auth's read/write names remain aligned (SPEC §6.5/§6.6).
  - **Evidence:** real two-account SQLite login/read and legacy sibling-cookie control passed;
    Better Auth matrix 199/199 and combined auth/CSRF/replay/webhook matrix 297/297; dist, API, TCB,
    security-guarantee, wire, and mutation gates passed.

- [x] **H11 - Non-local Postgres credentials could travel without authenticated TLS.**
  - External runtime, admin, system, and CLI database URLs passed directly to pinned node-postgres.
    An absent/disabled SSL mode permitted cleartext, while `no-verify` and libpq-compatible
    `require` permitted encryption without authenticating the server. Runtime data and privileged
    provisioning credentials were therefore exposed to an on-path attacker.
  - **Evidence:** pinned pg connection parameters selected cleartext for absent/disabled modes and
    `rejectUnauthorized: false` for the unauthenticated modes; the real local TLS cluster accepted
    those weaker connections before the gate.
  - **Fixed:** `3b10df8cc` requires explicit canonical authority, identity, database, and port
    fields; exact `sslmode=verify-full` plus a DNS hostname for non-local carriers; and rejects
    ambient destination/identity fallback, malformed parser differentials, IP-literal TLS, and
    process-wide TLS verification disablement before pool construction (SPEC §6.6/§10.3).
  - **Evidence:** a seeded 1,191,520-URL differential found zero accepted carrier/posture
    mismatches; focused egress/Postgres/environment tests 184/184 and real Postgres/TLS probes 4/4
    passed with all 11 classifier corpora, API, docs, egress, and SPEC gates.

- [x] **H12 - SVG SMIL transfer attributes could animate a link into a JavaScript URL.**
  - Server JSX and browser fragment/live-binding sinks treated SVG `<animate>`/`<set>` transfer
    attributes as ordinary text. Remotely controlled `attributeName="href"` combined with
    `values`/`to` could materialize a `javascript:` URL on an ancestor SVG link after Kovo's initial
    render-time URL check; activating that link executed attacker script.
  - **Evidence:** a real Chromium reproduction changed the ancestor SVG `<a>` target through SMIL
    and set an attacker-controlled DOM marker on activation. CSP could mask the execution, but the
    contextual-output guarantee cannot delegate this sink proof to CSP (SPEC §4.8/§5.2).
  - **Fixed:** `0c63d004c` disables generic SVG SMIL execution primitives at compiler and server
    render time, then inerts them before fragment adoption or live-binding updates (SPEC
    §4.8/§5.2 rule 10).
  - **Evidence:** focused compiler/runtime matrix 165/165; response-fragment exploit regressions
    42/42 across Chromium, Firefox, and WebKit; all 11 classifier corpora plus inline-artifact,
    API-surface, SPEC, and fail-closed gates passed at the integrated checkpoint.

- [x] **H13 - Windows environment snapshotting could silently disable security posture.**
  - Windows main-thread environment lookups are case-insensitive, but Kovo copied the enumerated
    operator spelling into a case-sensitive null-prototype snapshot. Mixed-case names such as
    `node_env` or `node_tls_reject_unauthorized` could therefore be honored by Node or the platform
    while Kovo missed the corresponding uppercase production/TLS control.
  - **Evidence:** Node's Windows environment contract and libuv enumeration preserve this
    case-folding/spelling differential; the current snapshot performs only exact own-key lookup
    after pinning (SPEC §6.6 operator-environment trust root).
  - **Fixed:** `3b10df8cc` preserves original operator spellings while giving the boot-pinned
    server environment Windows-equivalent lookup and fail-closed case-collision detection.
  - **Evidence:** platform-independent mixed-case production/TLS posture regressions 5/5 passed;
    M16 separately tracks the two CLI-owned invocation snapshots discovered by the post-fix audit.

- [x] **H14 - Route response headers could desynchronize keep-alive HTTP responses.**
  - `respond.file()`/`respond.stream()` accepted caller-supplied `Content-Length` and hop-by-hop
    fields, while the final Web-to-Node adapter streamed the actual body unchanged. A remotely
    derived header bag could therefore make a proxy/cache parse different response boundaries from
    Kovo's origin connection.
  - **Evidence:** a real Node keep-alive reproduction emitted `Content-Length: 0`, then
    `HELLOHTTP/1.1 200...` for two pipelined requests on the same socket. Kovo's typed-header sink
    inventory promises framework-owned response framing (SPEC §6.6/§9.5/§10.3 C9).
  - **Fixed:** `97871d177` reserves framing and hop-by-hop fields across structured, raw, static,
    generated, Node, Vercel, HTTP/1, and HTTP/2 response paths; framework-owned framing is added
    only after app metadata passes KV415.
  - **Evidence:** focused route/static/generated/wire matrix 216/216, all 12 security-classifier
    corpora, API-surface, and real pipelined response-boundary regressions passed.

- [x] **H15 - Structured route responses bypassed KV415's typed header-name allowlist.**
  - `respond.file()` and `respond.stream()` accepted an arbitrary `Record<string, string>` even
    though SPEC §9.1 and KV415 require structured app response channels to reject names outside a
    typed allowlist. An app that routes remotely derived names into this advertised safe sink can
    therefore emit deployment-sensitive control metadata such as proxy internal-redirect or CORS
    fields; raw endpoints are the explicit arbitrary end-to-end header escape instead.
  - **Evidence:** dynamic `X-Accel-Redirect`, CORS, `X-Audit`, and `X-Trace-Id` names survive route
    outcome construction today, while existing tests pin custom structured names as accepted.
  - **Fixed:** `bc58cf53c` limits direct `respond.file()`/`respond.stream()` and configured
    error-shell metadata to `Cache-Control`, `Last-Modified`, and `Vary` at both the public type and
    case-insensitive runtime boundary. Dedicated fields keep their named APIs; raw endpoints and
    operator static metadata retain arbitrary end-to-end names behind H14's transport floor.
  - **Evidence:** focused response/header matrix 447/447 and all 13 classifier corpora passed. A
    separate production replay-store provenance trace found no remote path for choosing stored
    header names; production accepts only the ACL-audited framework Postgres store.

- [x] **H16 - A misbound authenticated CSRF session could collapse replay scope across users.**
  - Generic CSRF configuration treated an empty or missing `sessionId` as an anonymous browser
    binding even after Kovo had independently proved an authenticated principal. Mutation replay
    then preferred that anonymous binding over the proven principal, so two users sharing the
    stale CSRF cookie, token, idempotency key, and input could receive one another's cached response
    metadata instead of executing independently (SPEC §6.6/§10.3).
  - **Evidence:** a real sequential Alice-to-Bob mutation reproduced one handler call and replayed
    Alice's `Set-Cookie` response to Bob with both an omitted session id and an empty-string session
    id; both requests passed their own authenticated guard and returned `303`.
  - **Fixed:** `aa60ea172` rejects missing authenticated and malformed generic bindings,
    domain-separates anonymous/session credentials, and binds replay to the independently proven
    principal. `627af6e03` de-duplicates that principal, rejects mismatches, and caps every raw
    identity component before durable-store or handler access.
  - **Evidence:** Alice/Bob cross-account and maximum/oversized identity regressions passed in the
    combined exact-tip security matrix (378/378); maximum enhanced/no-JS raw scopes are
    3,158/3,163 code units under the 4,096-code-unit store ceiling.

- [x] **H17 - Public raw endpoint responses could cache and replay credential state.**
  - A verifier-authorized raw `GET` endpoint could declare and emit `Cache-Control: public` with
    `Set-Cookie`. Header finalization normalized the privileged cookie but did not make the response
    client-private, so a shared cache could serve the authenticated response and cookie to a later
    anonymous request without re-running the endpoint verifier. Cached `Clear-Site-Data` exposed the
    corresponding cross-client destructive replay (SPEC §6.6/§9.1).
  - **Evidence:** the exact dispatch path emitted a public normalized session cookie; a minimal
    shared-cache reproduction served it to the second anonymous request with status `200` while
    verifier calls remained at one instead of returning `401` on a second verifier call.
  - **Fixed:** `74c6787f3` stamps `private, no-store` plus `Vary: Cookie` at final structured/raw
    reconstruction whenever `Set-Cookie` or `Clear-Site-Data` is present, regardless of authored
    cache posture.
  - **Evidence:** the exact shared-cache dispatch regression now reaches the verifier twice and
    returns `401` without a cookie; focused integration tests passed 92/92 after integration, and
    all 13 classifier corpora plus response-boundary gates passed at the worker checkpoint.
  - **Follow-up fixed:** `9a5d59edd` applies the same floor to generic live/generated Node/Vercel
    adapters and rejects durable browser-state instructions from static export.
  - **Evidence:** the five residual live Node, emitted Node/Vercel, and static cases passed in the
    combined exact-tip matrix (378/378). Generated Cloudflare dynamic output has no public
    arbitrary-handler path and always uses the centrally finalized `createRequestHandler(app)`.

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

- [x] **M14 - Native HTTP/1.1 requests could reach Kovo without a Host authority.**
  - When an embedding Node server disabled its built-in Host requirement, a real HTTP/1.1 request
    without Host reached static/app dispatch with a synthesized loopback URL. The raw request and
    framework URL therefore disagreed about whether any authority had been supplied.
  - **Evidence:** `createServer({ requireHostHeader: false }, toNodeHandler(...))` returned `200`,
    invoked the handler, and exposed a loopback-origin URL for a raw Host-less HTTP/1.1 request.
  - **Fixed:** `d52cda8ba` requires authority whenever native wire evidence identifies HTTP/1.1 or
    newer, before static or app dispatch. Host-optional HTTP/1.0 and custom synthetic carriers
    without raw-wire evidence retain their documented fallback (SPEC §9.5).
  - **Evidence:** real-wire/live/generated Node matrix 99/99; server dist, wire, API, and VP gates
    passed.

- [x] **M15 - Normal Node request completion falsely aborted the Web request signal.**
  - The adapter mapped every `IncomingMessage` `close` event to `Request.signal.abort()`, but Node
    emits `close` after a normally consumed request body. A valid remote POST could therefore mark
    itself aborted before downstream fetch/database work and trigger cancellation paths intended
    only for client disconnects.
  - **Evidence:** a real POST body was read successfully, then the handler observed
    `signal.aborted === true` both immediately and after a delay despite normal client completion.
  - **Fixed:** `eb11cfcb4` treats request `close` as an abort only when native completion evidence is
    false; explicit request aborts and socket closes remain unconditional (SPEC §9.5).
  - **Evidence:** real HTTP/1+h2 normal-body, client-destroy, and live/emitted complete/incomplete
    close matrix 101/101; server dist, wire, API, and VP gates passed.

- [x] **M16 - Windows CLI environment snapshots could retarget database commands by omission.**
  - The supported CLI runner and its direct-dispatch fallback copied Windows environment entries
    into case-sensitive null-prototype records. Mixed-case `KOVO_DATABASE_URL`,
    `KOVO_ADMIN_DATABASE_URL`, `KOVO_RUNTIME_DATABASE_URL`, or `KOVO_DB_DRIVER` spellings that the
    host accepts could therefore disappear from `kovo db` authority resolution, causing a command
    to fail or select its local/default posture instead of the operator's intended database.
  - **Evidence:** a platform-independent injected-source reproduction made every uppercase CLI
    lookup miss mixed-case operator keys even though Windows resolves those names
    case-insensitively (SPEC §6.6 operator-environment trust root).
  - **Fixed:** `50bbebfec` routes both command-entry snapshots through one invocation-environment
    classifier with Windows-equivalent case-folded lookup and fail-closed collision refusal while
    preserving non-Windows spelling semantics (SPEC §6.6).
  - **Evidence:** exact-tip CLI/create-kovo matrix 162/162; all 16 C13 corpora passed.

- [x] **M17 - Invalid CLI database-driver authority silently selected local PGlite.**
  - CLI target selection recognized the supported driver strings but let every other defined
    `KOVO_DB_DRIVER` value fall through automatic target detection. With no database URL, an
    operator typo therefore became an explicit PGlite override instead of matching server boot's
    fail-closed driver validation (SPEC §6.6).
  - **Evidence:** `KOVO_DB_DRIVER=bogus kovo db check` reported `DRIVER pglite` and selected a local
    data directory rather than rejecting the invalid authority before target access.
  - **Fixed:** `d40bf8363` centralizes exact CLI driver parsing and rejects every defined unsupported
    value across check, generate, migrate, and provision before target selection (SPEC §6.6).
  - **Evidence:** exact-tip CLI/create-kovo matrix 162/162; all 16 C13 corpora passed.

- [x] **M18 - Trusted-proxy client ports split one IP across per-IP rate-limit buckets.**
  - The built-in trusted-proxy resolver returned the complete rightmost RFC 7239 `Forwarded for=`
    node as `req.clientIp`. A standards-conforming proxy may append the client's ephemeral source
    port, so reconnecting gave one remote address a fresh shell and lifecycle limiter key (SPEC
    §9.5).
  - **Evidence:** a real front proxy emitted the same IPv6 address with ports 47011 then 47012; a
    `max: 1` mutation returned `[303, 303]` and ran twice, while the stable-port control returned
    `[303, 429]` and ran once. Global work budgets remained enforced.
  - **Fixed:** `abab70b96` canonicalizes all six built-in IPv4/IPv6 carrier forms to one
    address-only identity, strips only valid optional ports, maps IPv4-mapped IPv6, and rejects
    malformed or obfuscated nodes while leaving explicit callback keys opaque (SPEC §9.5).
  - **Evidence:** integrated request-state/shell/guard/real-proxy matrix 54/54; the generated
    production Node six-carrier regression passed 1/1; all 16 C13 corpora passed.

- [x] **M19 - ASCII-case duplicate meta attributes bypassed the refresh navigation sink.**
  - The JSX runtime compared the `content` name case-insensitively but found its paired
    `http-equiv` value through only the exact `http-equiv`/`httpEquiv` object keys. HTML folds
    attribute names and honors the first duplicate, so a persisted/query-backed dynamic spread
    could supply attacker-first `HTTP-EQUIV="refresh"` and retain external refresh content (SPEC
    §4.8/§5.2).
  - **Evidence:** the ordinary compiler/plugin path emitted the live attacker-first pair with no
    KV236 diagnostic; Chromium, Firefox, and WebKit navigated to the external `/phish`, while the
    safe-first duplicate and canonical lowercase controls stayed on the app. `javascript:` and
    `data:` controls did not execute or navigate.
  - **Fixed:** `4ab3a577d` classifies the browser-effective first rendered `http-equiv` attribute
    with the same ASCII-case, ordering, omission, name, and value rules as HTML emission, so refresh
    content is removed across live and compiler paths (SPEC §5.2 rule 11).
  - **Evidence:** focused compiler/runtime/source-sink tests 135/135; the exact production plugin
    regression passed 6/6 across Chromium, Firefox, and WebKit; all 15 C13 corpora passed.

- [x] **M20 - Conflicting forwarded-header families could shadow a proxy-owned rate identity.**
  - With `trustedProxy: true`, the built-in resolver preferred `X-Forwarded-For` over
    `X-Real-IP` over RFC 7239 `Forwarded`. A proxy that authored only `Forwarded` but left an
    incoming `X-Forwarded-For` header intact therefore let a remote client rotate the higher-priority
    value while Kovo ignored the stable proxy-owned address (SPEC §9.5).
  - **Evidence:** with one stable `Forwarded: for=203.0.113.80`, changing only attacker-supplied XFF
    values changed `resolveRequestClientIp()` from `198.51.100.1` to `198.51.100.2`. The mandatory
    global budget remained enforced, but the per-IP shell and guard buckets could be split.
  - **Fixed:** `abab70b96` rejects multi-family client-IP authority as ambiguous, falls back to
    adapter peer/global admission, and strictly rejects malformed, duplicate, C0-bearing, or
    over-breadth RFC 7239 elements (SPEC §9.5).
  - **Evidence:** integrated conflicting-family/global-floor and bounded-parser regressions passed
    in the 54/54 focused matrix; all 16 C13 corpora passed.

## Low

- [x] **L4 - Stored upload filenames could preserve Unicode bidi spoofing into WebKit downloads.**
  - Upload filename sanitization removed paths and C0 controls but retained directional formatting
    controls in RFC 8187 `filename*`. A remote uploader could use U+202E to make a downloaded
    executable's trailing name appear reversed in WebKit download UX (SPEC §6.6/§9.1).
  - **Evidence:** the exact stored-file serializer emitted
    `filename*=UTF-8''invoice%E2%80%AEfdp.exe`; Playwright WebKit preserved U+202E in its suggested
    filename while Chromium and Firefox selected the ASCII fallback.
  - **Fixed:** `42d87bf46` replaces the complete Unicode bidi-control set at upload metadata
    ingestion and again at the shared live/generated Content-Disposition sink (SPEC §6.6/§9.1).
  - **Evidence:** focused upload/response/generated/source-sink matrix 145/145; Chromium, Firefox,
    and WebKit all report the neutralized `invoice_fdp.exe` suggested filename.

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
- Missing-authority real/live/generated matrix: 99/99; wire-output boundary gate passed.
- Request-signal completion/disconnect matrix: 101/101; wire-output boundary gate passed.
- Webhook signed replay/retry matrix: 72/72; wire-output boundary gate passed.
- Database socket-provenance matrix: 192/192 plus real PostgreSQL reconnect/TLS 2/2; classifier,
  egress, API, and TCB boundary gates passed.
- Better Auth host-cookie matrix: 199/199; combined auth/CSRF/replay/webhook matrix 297/297; dist,
  API, and TCB gates passed.
- Better Auth/SQLite/PGlite matrix: 200/200; real PostgreSQL and multi-process SQLite concurrency
  each admitted 3/20 with one row; replay 429-abort regression, dist, API, and TCB gates passed.
- Bidi filename live/generated/source-sink matrix: 145/145; three-engine download regression and
  the C13 classifier corpus passed.
- Meta-refresh live/compiler/source-sink matrix: 135/135; the production-plugin regression passed
  6/6 across Chromium, Firefox, and WebKit; all 15 C13 corpora passed.
- Trusted-client-IP live/real-proxy matrix: 54/54 plus generated production Node 1/1; all 16 C13
  corpora passed.
- Windows environment/database-driver CLI matrix: 162/162; all 16 exact-tip C13 corpora passed.
- Publication remains pending until the exact-tip broad gates, `origin/main` push, GitHub
  Actions/Pages monitoring, and post-green no-find pass complete.
