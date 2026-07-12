# Bug Ledger (`bugz-26`)

**Date:** 2026-07-11

**Scope:** Security-first adversarial dogfood and regression sweep of Kovo at `main` HEAD
`d7ff2a27161760896cf828b37b9d19fd584e3ef3`, using root `SPEC.md` and its incorporated
sub-specifications as the contract. Previously known issue families were eligible when the current
tree still reproduced them.

**Method:** A real locally linked SQLite starter was exercised in development and production mode;
three parallel subsystem finders covered server/runtime, compiler/output, and the data TCB; every
carried finding was challenged by an independent skeptic with exploit-shaped and negative-control
tests in throwaway worktrees; a second browser/deploy-skew finder and a final completeness critic
then searched the uncovered surfaces. All proof worktrees were removed. This ledger records current
state, not the temporary proof files.

## Severity summary

| Severity | Count | Items  |
| -------- | ----: | ------ |
| High     |     6 | H1-H6  |
| Medium   |    11 | M1-M11 |
| Low      |     2 | L1-L2  |

The dominant pattern is mutable or lossy proof currency: Kovo validates one value or identity, then
a later sink consumes mutable bytes, a weaker serialization, a reconstructed object, or a transport
hop that was not part of the original decision.

## High

- [x] **H1 - Framework-minted privileged output carriers re-read mutable public fields, allowing
      attacker markup or denied URL schemes after the trust decision.**
      `packages/browser/src/security-output.ts:62-90,132-210`,
      `packages/server/src/html.ts:35-66,111-116`,
      `packages/core/src/internal/sink-policy.ts:150-212,487-500`
  - Genuine `TrustedHtml`, `TrustedUrl`, and JSX/`RenderedHtml` objects are recorded only by identity
    in a private `WeakSet`. `Object.assign`, `Reflect.set`, or an ordinary property write can replace
    `.value`/`.html` while the witness remains valid.
  - **Observed:** strict TypeScript accepted mutation of genuine carriers. Real SSR emitted an
    attacker `<script>`/event-bearing fragment and a `javascript:` URL; plain lookalikes and plain
    strings were still escaped or neutralized. A component that mutates a JSX result's `.html` from
    `post.body` compiled with no KV426 and emitted raw markup.
  - **Impact:** direct XSS/output-sink bypass. CSP remains defense in depth and is not Kovo's output
    safety proof.
  - **SPEC:** sections 4.8, 5.2 rule 11, and 6.6 classify-and-pin require sinks to consume the exact
    validated value, not later bytes read from a mutable wrapper.
  - **Acceptance:** pin immutable private snapshots (not public fields) for `TrustedHtml`,
    `TrustedUrl`, `safeRichHtml`, `BrowserTrustedHTML` content, and server `RenderedHtml`; freeze
    wrappers; harden internal `FragmentHtml`/`RenderedFragmentHtml` carriers in the same sweep.
    Assignment, `Object.assign`, `Reflect.set`, `defineProperty`, and a mutable nested source must
    either throw or leave the originally pinned safe bytes at every real sink.
  - **Evidence:** the source-aliased browser/core/server/compiler suite passes 146 tests; four
    declaration builds and the sink-policy, security-brand, classifier, verdict-routing, and
    37-mutant security gates pass.

- [x] **H2 - `createApp()` retains a mutable structured `DocumentConfig`, so request code can inject
      raw document-head/body markup after app closure.**
      `packages/server/src/document-structured.ts:19-22,81-120,261-311`,
      `packages/server/src/app.ts:278-287`, `packages/server/src/app-snapshot.ts:269-302`,
      `packages/server/src/document-core.ts:786-810`
  - A genuine document config is WeakSet-marked but mutable. `normalizeAppDocumentOptions()` stores
    the same object, and the closed app snapshots registries but not the document's arrays, attrs,
    or CSP metadata.
  - **Observed:** a route read an attacker header, replaced the genuine config's `head` array, and a
    real route render emitted the supplied `<script>` verbatim even though the top-level app was
    frozen.
  - **Impact:** request-driven raw head/body injection and XSS through a supposedly structured,
    closed application aggregate.
  - **SPEC:** sections 6.6 and 9.5 require app assembly to snapshot and close load-bearing
    declarations before requests execute.
  - **Acceptance:** reconstruct from stable own data descriptors and deep-freeze the document config,
    head/body arrays, shell attrs, and CSP arrays during `createApp()`; later mutation of the
    original config or nodes must not change output, and getters/proxies must not be re-read.
  - **Evidence:** `pnpm exec vitest --run packages/server/src/document.test.ts
packages/server/src/app-document.test.ts packages/server/src/app.test.ts` (144 tests) proves
    constructor sealing, app-time reconstruction, CSP input isolation, and accessor rejection.

- [x] **H3 - KV426 follows an ordinary carrier's clean initializer and ignores later property
      writes that load query/request data before `trustedHtml()` or `trustedUrl()`.**
      `packages/compiler/src/validate/trusted-html-provenance.ts:638-720`
  - `classifyMemberRoot()` resolves `carrier.body`/`carrier.href` through the declaration initializer
    but models no intervening assignments.
  - **Observed:** a type-valid component initialized `{ body: '<b>safe</b>', href: '/safe' }`, then
    assigned `post.body`/`post.href`. It compiled with zero KV426, preserved the writes in emitted
    server source, and rendered attacker HTML plus `javascript:`. Direct-query controls emitted two
    KV426 diagnostics; an actually static carrier stayed green.
  - **Impact:** direct XSS/output-sink bypass without mutating a trusted wrapper; a fresh genuine
    wrapper is constructed around laundered data.
  - **SPEC:** sections 4.8, 5.2 rule 10, 9.1, and KV426 require provenance to reach the final trust
    constructor argument.
  - **Acceptance:** make the forward provenance model assignment/dominance-aware for direct and
    computed property writes, aliases, destructuring, `Object.assign`, `Reflect.set`,
    `defineProperty`, branches, and escaped/cross-file carriers; fail closed when mutation cannot be
    disproved, with HTML and URL positive/negative controls.
  - **Evidence:** `packages/compiler/src/trusted-html-provenance.test.ts` passes within the
    source-aliased 146-test integration run, including alias, branch, computed, reflection,
    definition, escape, imported-carrier, and post-sink controls.

- [x] **H4 - Same-build enhanced navigation can install a new principal's document while retaining
      the old BroadcastChannel principal closure.**
      `packages/browser/src/enhanced-navigation.ts:142-208`,
      `packages/browser/src/inline-loader-build.ts:784-802`
  - Enhanced navigation checks origin, content type, and build token, then morphs the fetched head
    including a new `kovo-session` meta. The inline loader captured the old fingerprint once at page
    load and never compares it with the next document.
  - **Observed:** after enhanced navigation from session A to a same-build session B document,
    current-session-B envelopes were rejected while a stale session-A private fragment was accepted
    into B's DOM in Chromium, Firefox, and WebKit.
  - **Impact:** cross-principal content disclosure/corruption during fast account switching or a
    session change in another tab.
  - **SPEC:** wire protocol section 9.3 requires every receiver to compare against the current
    identity and retire the channel on any identity transition.
  - **Acceptance:** compare old and fetched `kovo-session` fingerprints, including present/missing
    transitions, before any head/body apply. On mismatch, close/retire the old runtime and force a
    hard navigation. Preserve the existing build-drift and mutation-transition controls.
  - **Evidence:** browser-worker unit and full-engine matrices pass 709 and 273 tests respectively;
    the integrated parser/navigation/stream suite passes 194 tests and the focused
    Chromium/Firefox/WebKit recovery suite passes 21 tests.

- [x] **H5 - A genuine parameterized Kovo SQL object can be mutated into raw attacker SQL while
      retaining the witness that bypasses KV422.**
      `packages/drizzle/src/runtime.ts:116-194`,
      `packages/core/src/internal/sql-safety.ts:17-107,274-346,483-500`
  - Kovo stamps the mutable third-party Drizzle object by identity, then the managed execution choke
    reconstructs SQL later from its current public `queryChunks`. Replacing or mutating those chunks
    does not revoke the private witness.
  - **Observed:** request-derived `Object.assign(statement, { queryChunks: ... })` produced zero
    KV422; strict TypeScript accepted both property and nested mutation without casts. A real PGlite
    `managedDb(..., 'write')` executed the injected raw `DELETE` and removed both rows. Unbranded
    lookalikes and managed-read execution were rejected, while shallow-freezing the outer object did
    not protect nested chunks.
  - **Impact:** SQL injection/arbitrary writes within an available managed write capability, despite
    using an initially safe tagged template and no `sql.raw`/`trustedSql` escape.
  - **SPEC:** sections 6.6 and 10.2/10.3 C9/C15 require the DB sink to execute the exact
    classified-and-pinned parameterized statement.
  - **Acceptance:** capture a recursive, module-private immutable SQL recipe when Kovo constructs or
    composes a tagged SQL value and reconstruct exclusively from it; never re-read public
    `queryChunks`, `.text`, `.sql`, or nested third-party chunks as trusted. Do not deep-freeze
    Drizzle objects. Cover property/nested mutation, nested branded SQL, strict TS/static KV422,
    actual write execution, read denial, unbranded controls, and post-snapshot isolation.
  - **Evidence:** the source-aliased core/Drizzle/server integration matrix passes 281 tests,
    including real PGlite pinned-write, read-denial, nested composition, post-snapshot mutation,
    strict carrier, and static KV422 controls; TCB, classifier, API, import, and 37-mutant security
    gates pass.

- [x] **H6 - The generated inline streaming mutation path ignores `Kovo-Build` and applies a
      foreign-build response.** `packages/browser/src/inline-loader-build.ts:904-918`,
      `packages/browser/src/apply-mutation-response.ts:174-178`
  - Buffered inline mutation apply calls the build-token gate; the streaming branch sends
    `response.body` directly to the incremental parser without reading the response build header.
  - **Observed:** on a build-old page, a build-new buffered fragment was rejected and read
    `Kovo-Build`; the equivalent complete streamed fragment applied and the streaming path never
    read the header. The modular streaming control rejected all foreign-build chunks. Chromium,
    Firefox, and WebKit reproduced the inline mismatch.
  - **Impact:** stale documents silently merge foreign render/query/text contracts after deploy,
    violating the central deploy-skew safety boundary.
  - **SPEC:** wire protocol section 9.1 and deploy-skew section 14 require mismatched payloads never
    to merge, including streaming fragments.
  - **Acceptance:** validate `Kovo-Build` before acquiring/reading the stream; on missing/mismatch,
    cancel the body and perform full GET/navigation recovery with zero fragment/query/text apply.
    Cover readable, minified/generated installer artifacts and all three browser engines.
  - **Evidence:** readable/minified/generated/extracted installer tests, inline generator check,
    194 integrated source tests, and the 21-test three-engine recovery suite pass with mismatch
    cancellation before stream acquisition and zero apply.

## Medium

- [ ] **M1 - `frameworkEgressFetch` enforces `allowDestinations` only on the initial origin, not on
      redirect hops.** `packages/server/src/egress.ts:983-1052`,
      `packages/server/src/egress-undici.ts:84-146`
  - Native fetch follows redirects after the helper's positive-origin check. The process transport
    floor rechecks IP class per hop but does not require the privileged-path destination allowlist.
  - **Observed:** an allowlisted origin returned 307 to a non-allowlisted public target. Direct target
    access was rejected, but the redirect delivered the POST body and `X-Api-Key`; `redirect: manual`
    did not. Native cross-origin `Authorization`/`Cookie` stripping remained intact.
  - **Impact:** an open/attacker-controlled redirect on an allowlisted service can exfiltrate task
    payloads or custom credentials. Private/metadata SSRF remains blocked.
  - **SPEC:** data-plane C9 and section 6.6 require the framework egress choke to own every
    privileged network target.
  - **Acceptance:** enforce exact positive origin plus resolved-IP posture on every bounded redirect
    hop, reject scheme/loop/max-hop drift, cover `Request` inputs and 307/308 bodies, and preserve
    native method and cross-origin sensitive-header semantics. Include direct, manual,
    allowed-to-allowed, and allowed-to-denied controls.

- [x] **M2 - Dynamic `mutationResponses` resolvers execute before CSRF, schema, replay, guards, and
      the mutation handler; runtime policy can also replace pinned CSRF posture.**
      `packages/server/src/app-mutation-request.ts:69-103`,
      `packages/server/src/app-types.ts:346-389`
  - The response callback receives revealed raw input plus the full lifecycle request before the
    normative mutation machine runs, despite its API contract saying it applies after handler
    success/failure.
  - **Observed:** cross-origin/no-token, schema-invalid, and guard-denied requests all ran the
    type-valid resolver while the handler stayed blocked. A JavaScript/cast resolver returning
    runtime `{ csrf: false }` additionally executed a forged write with the already-loaded victim
    session; the strict typed surface does not admit that value.
  - **Impact:** forged requests can trigger callback side effects, and out-of-subset runtime values
    can disable CSRF after ambient session resolution.
  - **SPEC:** sections 6.6 and 10.3 require CSRF -> schema -> guards -> replay/handler ordering and a
    security posture fixed before request data is consumed.
  - **Acceptance:** remove CSRF from response policy and reject runtime overrides; keep pre-gate
    response configuration static; invoke dynamic resolution only from a framework-minted
    post-lifecycle outcome after validation, authorization, and handler/transaction completion.
    No resolver runs for CSRF/schema/guard/replay failures.
  - **Evidence:** the focused eight-file mutation/replay suite passes 226 tests, including forged
    CSRF, schema, guard, replay-shed, static-snapshot, and runtime-override regressions;
    `pnpm --filter @kovojs/server run build:dist` and `pnpm run check:api-surface` pass.

- [x] **M3 - Failed or non-complete streaming mutations leave progressively applied fragments
      authoritative in the DOM.** `packages/browser/src/apply-mutation-response.ts:196-303`,
      `packages/browser/src/mutation-submit.ts:228-230`,
      `packages/browser/src/inline-loader-build.ts:705-760,904-918`
  - The modular runtime snapshots and rolls back query values but progressively morphs fragments
    without a rollback/refetch guarantee. The inline runtime can resolve `<kovo-done reason="error">`
    after pending chunks drain without producing form failure UI.
  - **Observed:** an errored stream restored the prior query but left an
    `UNCONFIRMED-PRIVILEGED` fragment in place; the inline three-browser proof also left the partial
    fragment with no `kovo-error`. A complete terminator retained the confirmed fragment control.
  - **Impact:** failed/aborted mutation output can appear as durable server truth and drive incorrect
    or security-sensitive user decisions.
  - **SPEC:** wire protocol sections 9.1/9.2 say progressive output is not authority and failure must
    visibly fail, refetch, or navigate rather than preserve partial truth.
  - **Acceptance:** every error/abort/non-complete terminator must synchronously retire partial
    output and guarantee a hard reload/refetch (or a proven full DOM rollback) before returning;
    inline runtime must reject rather than resolve an error terminator. Preserve successful-stream
    controls across all browser engines.
  - **Evidence:** modular and generated inline recovery regressions pass in the 194-test integrated
    suite and the 21-test Chromium/Firefox/WebKit run, covering error, abort, missing-done,
    post-error terminator laundering, and successful replace/append/prepend controls.

- [ ] **M4 - Case-insensitive filesystem storage collapses case-distinct logical keys, breaking
      object-exact capability binding.** `packages/core/src/storage.ts:164-285,408-430`,
      `packages/server/src/capability-route.ts:317-350`
  - Memory/S3 use exact string keys, while the filesystem adapter maps the logical key directly to
    a host path. Common macOS/Windows filesystems alias case and other host-equivalent spellings.
  - **Observed:** bytes stored only at `Tenant/Victim.txt` were returned by filesystem get and a
    capability signed only for `tenant/victim.txt`; the memory backend and memory-backed endpoint
    returned missing/404 for the same lowercase key/token.
  - **Impact:** cross-object/cross-tenant read when an attacker can obtain a capability for a
    host-equivalent spelling. The behavior is platform-conditioned.
  - **SPEC:** section 6.6 requires a capability for object A never to dereference object B, and
    storage parity requires backend-independent key identity.
  - **Acceptance:** encode logical UTF-8 keys into case/normalization-stable physical names and store
    plus verify the exact logical key; cover get/stat/stream/put/delete and sidecars, Unicode
    normalization, Windows trailing-dot/space/reserved names, and memory/S3 parity.

- [x] **M5 - The public auth name `kovo-capability-url` acts as a forgeable password for a green
      endpoint access audit even though runtime executes no verifier.**
      `packages/server/src/access-graph.ts:194-202`, `packages/server/src/endpoint.ts:562-580`,
      `packages/server/src/capability-route.ts:385-404`
  - Audit special-cases the string name used by the framework-owned self-verifying storage route.
    Any app endpoint can copy that name; name-only auth intentionally has no executable `verify`.
  - **Observed:** the forged endpoint produced `decision: verified`, `kovoCheck` OK, and anonymous
    `200` handler execution. An ordinary name emitted KV436; the genuine capability endpoint
    rejected an unsigned request.
  - **Impact:** a deliberate or accidental reserved string turns an unauthenticated endpoint into a
    green audited machine ingress.
  - **SPEC:** sections 2, 9.1, 10.2, and 11.4 require executable default-deny ingress verification.
  - **Acceptance:** use a module-private, non-copyable endpoint identity that survives app snapshot
    and closed-app derivation; bundle duplication/HMR must preserve it through canonical snapshot
    copying or fail closed, never become green. Generic name-only auth must fail KV436 and runtime
    dispatch. Do not rely on a discoverable/copyable symbol.
  - **Evidence:** the 163-test endpoint/access/capability integration suite proves a copied magic
    name is KV436-missing and runtime 401 with zero handler calls, while the genuine private witness
    survives `createApp()` canonicalization and rejects unsigned access as 404; server declaration
    build, API-surface, and security-guarantee gates pass.

- [ ] **M6 - PostgreSQL posture accepts corrupted framework owner policies and unexpected
      permissive policies that OR open cross-tenant access.**
      `packages/server/src/postgres-runtime.ts:918-1013,3651-3664`
  - The live posture checks only that expected policy names exist; it ignores schema, roles,
    command, permissiveness, `USING`, `WITH CHECK`, and additional policies.
  - **Observed:** a production-equivalent external-DB boot stayed green after replacing
    `kovo_owner_scope` with allow-all and after adding a second permissive allow-all policy. A real
    U1 runtime read and updated U2 rows. Pristine/removal controls restored isolation or emitted
    `KV433_OWNER_POLICY`.
  - **Impact:** migration/catalog drift defeats framework-owned RLS confidentiality and integrity.
  - **SPEC:** data-plane section 10.3 C10 and verification section 11.2 require the live engine door
    to bind both reads and writes to the current principal.
  - **Acceptance:** schema-qualify and exactly verify the allowed policy set, roles, command,
    permissiveness, `USING`, and `WITH CHECK`; reject extras. Cover duplicate table names across
    schemas, partitions, PUBLIC, and role membership.

- [ ] **M7 - A CHECK constraint's custom operator hides its SECURITY INVOKER implementation from
      PostgreSQL attached-code closure, enabling a secret oracle.**
      `packages/server/src/postgres-runtime.ts:1244-1254,1533-1540`
  - Closure follows `pg_constraint -> pg_proc` but not `pg_constraint -> pg_operator -> pg_proc`;
    the routine backstop covers only SECURITY DEFINER functions.
  - **Observed:** an owner table denied direct secret SELECT, yet an invoker function behind a custom
    CHECK operator revealed the secret's first character through update success/failure while
    posture stayed green. A direct-function CHECK correctly emitted `KV433_ATTACHED_CODE`.
  - **Impact:** custom migration code can turn non-selectable credential fields into response/error
    oracles.
  - **SPEC:** data-plane section 10.3 requires CHECK/domain and other app-role-reachable attached
    code to resolve safe or fail closed.
  - **Acceptance:** compute a recursive executable dependency closure including operator `oprcode`
    and intermediary operators/casts across CHECK/domain/exclusion/index/policy expressions; retain
    built-in negative controls and the direct-function control.

- [ ] **M8 - Mutation replay fingerprints omit upload bytes, so different same-metadata files
      silently replay the first result under one idempotency token.**
      `packages/server/src/replay.ts:527-577`
  - Upload canonicalization includes only filename, size, and MIME type.
  - **Observed:** `AAAA` and `BBBB` uploads with the same name/type/size and the same principal/idem
    both returned success while the handler ran once; a different-size control conflicted.
  - **Impact:** stale response replay and silent loss/misattribution of an upload mutation.
  - **SPEC:** wire/data-plane sections 9.1 and 10.3 require different input under one token to
    conflict, never replay.
  - **Acceptance:** asynchronously digest actual bytes plus field multiplicity/order/metadata under
    request size bounds without consuming handler data; identical bytes replay, any byte change
    conflicts, and digest failure fails closed.

- [x] **M9 - Render-plan query-shape serialization has chosen-prefix delimiter collisions, so a
      changed projected field set can keep the same fingerprint, client href, and build token.**
      `packages/compiler/src/compile.ts:1472-1500`,
      `packages/core/src/internal/render-plan-token.ts:25-36`
  - Unescaped field/query names and shape strings are concatenated with `:`, `,`, and newline.
  - **Observed:** `{ a: 'string', b: 'string' }` and `{ 'a:string,b': 'string' }` produced the same
    shape string, fingerprint, versioned client href, and registry build token with no KV416. A
    conventional field rename moved the token, and the real Drizzle extractor accepts the quoted
    alias.
  - **Impact:** a stale client can treat a foreign render contract as its own and silently apply
    incompatible response truth.
  - **SPEC:** sections 5.2.1, 5.2.2, and 14 require every projected shape change to move the opaque
    contract token.
  - **Acceptance:** use a tagged canonical/length-prefixed structural encoding at both shape and
    query-name layers; cover nested delimiter/control/Unicode keys and an actual old-document/new-
    server deploy-skew integration, not only hash-unit tests.
  - **Evidence:** the source-aliased compiler/core/server render-plan suite passes 90 tests,
    including the formerly colliding shapes through compiled hrefs, old document tokens, and new
    server query/mutation response tokens; three declaration builds and API/security gates pass.

- [ ] **M10 - Valid capability bearer query values are logged verbatim when a verified storage read
      fails.** `packages/server/src/capability-route.ts:323-350`,
      `packages/server/src/app-request.ts:85-89`, `packages/server/src/diagnostics.ts:68-78`,
      `packages/server/src/vite-dev.ts:1240-1249`, `packages/server/src/build.ts:952-960`
  - Default app diagnostics and Vite dev log the full request URL; the generated Node outer logger
    independently preserves raw query strings.
  - **Observed:** after a valid `kovo-cap` passed verification, a throwing storage backend returned
    500 and both default/Vite logs contained the exact token. A tampered token returned 404, never
    read storage, and logged nothing.
  - **Impact:** log readers can replay a still-live reusable bearer after backend failure. Requires
    log access and an unexpired/unconsumed token.
  - **SPEC:** section 6.6 treats capability URLs as bearer credentials and requires log leakage to
    be mitigated at framework-owned observability sinks.
  - **Acceptance:** centralize diagnostic URL sanitization before default stderr, app `onError`, dev,
    and generated Node logs; preserve pathname plus query-key names only, never values. Cover
    capability, OAuth/reset, encoded, duplicate, and case-variant sensitive parameters, and ensure
    errors cannot reintroduce the raw URL.

- [x] **M11 - `RenderedHtml + string` composition retains every full rendered value forever in a
      process-global marker map.** `packages/server/src/html.ts:32-36,47-52,153-187`
  - Default-hint coercion creates a unique marker and inserts the full HTML into a global
    `Map<string,string>`. Marker resolution reads but never deletes, bounds, or scopes the entry.
  - **Observed:** a real public route using automatic-runtime-equivalent `innerJsx + ' tail'`
    returned correct marker-free HTML. With forced GC, an array-composition control retained about
    0.3 MB after 300 requests, while two successive 250-request coercion batches retained about
    9.6 MB and 9.3 MB (18.9 MB total) with the same continued slope.
  - **Impact:** repeated GETs to an affected route retain request-varying rendered payloads until OOM;
    default rate shedding slows but cannot bound lifetime growth.
  - **SPEC:** sections 6.6 and 9.5 require rendered-output plumbing and framework pre-dispatch
    availability state to remain bounded.
  - **Acceptance:** no process-global strong reference may survive a completed render. Use
    request/render-scoped marker storage with guaranteed cleanup (or another bounded stateless
    representation); forced-GC growth at N and 2N requests must stay near the array control while
    repeated-marker, nested-JSX, and single-escape correctness tests remain green.
  - **Evidence:** stateless authenticated marker regressions pass in the 146-test integration run;
    forced-GC batches retained 0.004 MB control, 0.078 MB for the first 250 coercions, and 0.023 MB
    for the second 250 (the reproduced vulnerable path retained about 9 MB per batch).

## Low

- [ ] **L1 - `csrf:false` mutation handlers receive the ambient Cookie header even though Kovo
      suppresses session resolution.** `packages/server/src/app-mutation-request.ts:46-65`,
      `packages/server/src/response-posture.ts:287-305`, `packages/core/src/graph.ts:1072-1082`
  - The mutation path omits `sessionProvider` but passes the original request instead of the
    ambient-authority-neutralized endpoint request view.
  - **Observed:** a same-site/cross-origin request exposed `sid=victim-session` directly and drove a
    simulated privileged write; the protected mutation returned 422 and the endpoint neutralizer
    removed Cookie. The handler's post-body `clone()` was unusable, so no clone-leak claim is carried.
  - **Impact:** explicit exemption plus manual Cookie trust can reintroduce ambient browser authority;
    default SameSite cookies reduce ordinary cross-site reachability.
  - **SPEC:** section 6.6 requires an exempt mutation not to ride ambient Cookie/session authority.
  - **Acceptance:** give exempt mutations a Cookie/session-neutralized request before body parsing,
    preserve the neutralization through usable clones, and extend KV418/static request provenance to
    raw Cookie reads. Preserve other non-ambient headers and protected-mutation behavior.

- [ ] **L2 - The memory replay store drops blessed redirect provenance, so a legitimate duplicate
      no-JS mutation navigates to `/` instead of its stored target.**
      `packages/server/src/mutation/no-js.ts:95-108`, `packages/server/src/replay.ts:584-591`
  - Store cloning copies body/headers/status but not the private redirect witness.
  - **Observed:** the first blessed 303 finalized to `/after-save`; its replay still held that string
    structurally but the final sink neutralized it to `/`. Handler dedupe worked, and an unblessed
    external-location control also stayed `/`.
  - **Impact:** fail-safe navigation/correctness regression, not an open redirect.
  - **SPEC:** sections 6.6 and 9.1 require provenance to survive audited persistence/reconstruction
    without blindly trusting stored headers.
  - **Acceptance:** preserve/reconstruct blessing only from a genuinely blessed source response and
    revalidate `Location`; arbitrary durable-store objects must remain unblessed. Cover unsafe
    external targets and multi-value response headers.

## Refuted or merged during this pass

- The installed esbuild advisory was not carried: Kovo does not invoke the affected standalone
  serve/servedir mode, and dependency presence alone did not establish a framework-reachable sink.
- Generic generated-Node raw-query logging is merged into M10 rather than counted twice.
- TrustedHtml/TrustedUrl and RenderedHtml mutation are one H1 root; internal FragmentHtml mutation is
  an H1 hardening acceptance item without a separate public exploit.
- All owner-policy body/role/command/permissiveness drift and additional permissive policies are one
  M6 live-posture failure.
- Runtime-login-only PostgreSQL table grants did not survive `SET ROLE` into app execution, and the
  explicit `rawRead()` function surface remained inside an engine read-only transaction; neither was
  carried.

## Latest verification

Discovery proofs were independently reproduced at the base SHA in throwaway worktrees. Production
fix evidence is recorded under each completed checkbox; broader integration gates remain pending.
