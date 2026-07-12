# Security Bug Ledger (`bugz-28`)

**Date:** 2026-07-11

**Scope:** Findings from the adversarial remediation pass run after `bugz-27` began landing. Each
item survived an executable exploit-shaped reproduction plus an independent source/test cross-check.
This is an active closure ledger; `SPEC.md` remains normative.

## Severity summary

| Severity | Count | Items |
| -------- | ----: | ----- |
| Critical |    16 | C1-C16 |
| High     |    25 | H1-H25 |
| Medium   |     9 | M1-M9 |

## Critical

- [x] **C1 - A late `Array.prototype.map` override can mint an authenticated raw-SQL recipe.**
      `packages/core/src/internal/sql-safety.ts`, `packages/drizzle/src/runtime.ts`
  - Selective overrides replaced Kovo's private pinned chunks, identifier text, and `staticSql`
    template text with `DELETE ...`. An own empty `Symbol.iterator` on `sql.join` parts also made
    metadata omit a nested `sql.raw` while the pinned recipe retained it; every managed snapshot
    returned `ok: true` with attacker SQL and no values.
  - **Evidence:** the 234-test core/browser/output matrix passes; independent SQL, identifier,
    `staticSql`, and custom-iterator exploit proofs now retain safe text or fail closed.

- [x] **C2 - Mutable egress classification intrinsics can waive private-network SSRF policy.**
      `packages/server/src/{egress,egress-undici}.ts`
  - With the default empty policy, a selective late `Array.prototype.some` override made
    `evaluateEgress` admit `127.0.0.1`; adjacent mutable host-normalization operations can classify
    different bytes than the per-hop transport ultimately dials.
  - **Evidence:** the 88-test egress/Undici/redirect/bootstrap/intrinsic matrix passes, including
    real fetch, host-swap, forged-cache, late-poison, and import-order fail-closed regressions.

- [x] **C3 - Mutable path-containment prototypes escape the framework output filesystem root.**
      `packages/core/src/{storage,internal/filesystem}.ts`
  - Selective late `String.prototype.startsWith` and `Array.prototype.includes` overrides made the
    real output boundary write `../outside/escaped.txt` outside its pinned root; storage key
    normalization uses adjacent mutable segment controls.
  - **Evidence:** the 37-test filesystem/storage/intrinsic matrix passes; the independent real outside
    write proof now throws before touching the sentinel, with safe writes preserved.

- [x] **C4 - Mutable Math controls can authenticate a forged HMAC signature.**
      `packages/core/src/verifier.ts`
  - Setting `Math.max` to return zero made the constant-time equality loop compare no bytes and
    accept an invalid equal-length signature; mutable `Math.floor`/`Math.abs` also defeated timestamp
    tolerance.
  - **Evidence:** the 234-test matrix rejects real forged equal-length signatures and stale events
    under Math/Number/String/RegExp poison while preserving a valid HMAC control.

- [x] **C5 - A mutable typed-array iterator can make unequal secrets compare equal.**
      `packages/core/src/secret.ts`
  - Replacing `Uint8Array.prototype[Symbol.iterator]` with an empty iterator made `Secret.equals()`
    accept any same-kind unequal secret; mutable encoder/view controls affected the compared bytes.
  - **Evidence:** the 87-test scalar route/handler/secret matrix passes with captured encoders/views,
    indexed constant-time comparison, unequal string/byte poison regressions, and equal controls.

- [x] **C6 - A mutable CSRF token parser can substitute a cached victim token.**
      `packages/server/src/csrf.ts`
  - A selective late `String.prototype.split` override returned the parts of a genuine cached victim
    token while validating the unrelated submitted string `v1.attacker.attacker`; synchronizer-token
    validation returned true for the victim session.
  - **Evidence:** the 259-test response-security matrix pins token minting/parsing, base64url bytes,
    active-key lookup, randomness, Buffer, hash, and purpose controls; the independent cached-token
    substitution proof rejects under hostile late `split`, while genuine rotation remains green.

- [x] **C7 - Mutable route normalization can select a different route authority.**
      `packages/core/src/internal/route-pattern.ts`
  - After warming the route cache, a selective late `String.prototype.replace` rewrote request
    `/public` to canonical `/admin`; mutable encoding also admitted authority-forming href bytes.
  - **Evidence:** the 87-test scalar matrix keeps `/public` bound to its original route under poison,
    pins encoding controls, and emits null-prototype parameter records.

- [x] **C8 - Mutable module-reference parsing can swap a privileged handler export.**
      `packages/core/src/internal/module-ref.ts`, `packages/browser/src/{handler-context,handlers}.ts`
  - Poisoned split/slice/last-index operations replaced compiler-authored `#pass` with a different
    privileged export in the same otherwise allowed module.
  - **Evidence:** the 87-test scalar matrix pins exact module/export bytes and proves only `pass`
    executes under late and import-order poison controls.

- [x] **C9 - Inherited Better Auth envelope fields can forge the lifecycle principal.**
      `packages/better-auth/src/session.ts`
  - Polluting `Object.prototype.response` and `.headers` made a plain genuine Better Auth session
    look like the framework's response envelope, replacing the mapped request session with an
    attacker-supplied user, roles, and session identifier plus a forged Set-Cookie value.
  - **Evidence:** the 51-test Better Auth matrix requires exact own-data envelope fields, maps the
    provider's genuine bare session under inherited pollution, and forwards cookies only from a
    validated framework-shaped envelope.

- [x] **C10 - Mutable capability-token controls can forge signed storage claims.**
      `packages/server/src/capability-url.ts`
  - A selective late `TextEncoder.prototype.encode` override reduced canonical signing payloads to
    empty bytes while preserving the outer JSON payload. A genuine token minted for `public.pdf`
    then retained a valid signature after its payload key was rewritten to `private.pdf`, and the
    real verifier returned `ok: true` for the substituted storage authority.
  - The same independent proof set rolled `Date.now` back to accept an expired bearer and replaced
    `Map.prototype.has` to consume a one-time token twice.
  - **Acceptance:** exact claims, canonical bytes, payload/base64 parsing, signature bytes, clock,
    nonce generation, and replay Map/TTL use boot-pinned, semantically checked controls; late and
    import-order poison cannot substitute key/method/scope/audience, extend expiry, or reuse a
    one-time token, while genuine scoped/rotated tokens retain round-trip behavior.
  - **Evidence:** the 77-test capability/intrinsic matrix passes; independent signature-byte, clock,
    and replay-map exploit proofs now reject the forged, expired, and reused tokens.

- [x] **C11 - A storage download endpoint retains mutable signing authority after construction.**
      `packages/server/src/capability-route.ts`
  - Mutating the original `createStorageDownloadEndpoint(options).secret` from the victim key to an
    attacker key after construction made a newly attacker-signed URL pass the real verify-before-read
    sink and return the existing `private.pdf` bytes with status 200.
  - **Acceptance:** snapshot and pin secret/keyring, storage, scope, replay store, clock, stored-file
    posture, signer defaults, and base-path facts at endpoint/context construction; later mutation,
    getters/proxies, and scalar/URL collection poison cannot replace the authority or make request
    derivation disagree with the exact key read from storage.
  - **Evidence:** the same 77-test matrix passes; the independent post-construction secret swap now
    receives the uniform 404 and cannot read the victim object.

- [x] **C12 - Mutable FormData traversal can substitute a cached victim CSRF token.**
      `packages/server/src/{untrusted-request-body,schema}.ts`
  - A real cross-origin-safe POST containing only `v1.attacker.attacker` was parsed after a selective
    late `FormData.prototype.entries` override substituted a cached genuine victim token. The
    untrusted carrier wrapped those forged values and `validateCsrfToken()` returned true for the
    victim session despite never receiving the genuine token bytes.
  - **Acceptance:** Request/header/body/clone methods, content-type classification, JSON decoding,
    FormData identity and traversal, recursive tagging/reveal, and record construction use
    boot-pinned, semantically checked exact-value controls; late/import-order poison cannot replace
    CSRF or schema input bytes while genuine JSON/form/multipart parsing remains intact.
  - **Evidence:** the 255-test request/body/schema/CSRF/dispatch matrix passes; the independent
    cached-token substitution proof now rejects the forged body, with exact JSON/urlencoded/
    multipart byte parsing and hostile import-order regressions covered.

- [x] **C13 - Colliding nested PostgreSQL savepoints can commit writes from a failed scope.**
      `packages/server/src/postgres-runtime.ts`
  - Replacing `Date.now` and `Math.random` with constants gave an outer and inner nested transaction
    the same savepoint name. After the inner failure was caught, PostgreSQL retained its duplicate
    marker; the outer rollback targeted that newer marker, and a real PGlite execution committed the
    write made inside the supposedly rolled-back outer scope.
  - **Acceptance:** every nested transaction on one physical client gets a framework-private,
    collision-free identifier independent of mutable clocks/RNG/string prototypes; savepoint SQL has
    a fixed grammar, and caught inner failures cannot shadow outer release/rollback ownership under
    late or import-order poison.
  - **Evidence:** the 81-test PostgreSQL/runtime matrix passes; the independent real-PGlite collision
    proof now leaves the table empty after the outer rollback under constant clock/RNG replacements.

- [x] **C14 - Mutable storage codec controls can cross-bind a filesystem object key.**
      `packages/core/src/{storage,internal/filesystem-intrinsics}.ts`
  - Selective late `TextEncoder.prototype.encode` mapped an attacker logical key onto the victim's
    physical SHA-256 slot, while a late `TextDecoder.prototype.decode` replacement forged the
    exact-key sidecar ownership record. A real filesystem storage `get(attacker)` then returned the
    victim blob bytes and labeled them with the attacker key.
  - **Acceptance:** logical-key UTF-8 bytes, sidecar encode/decode/JSON, exact metadata validation,
    physical-key derivation, and every get/stat/stream/delete/put ownership decision use boot-pinned,
    semantically checked controls; late/import-order poison cannot alias keys or forge sidecar truth.
  - **Evidence:** the 30-test storage/filesystem-codec matrix passes; the independent real-filesystem
    exploit now returns no attacker object while the victim bytes remain available under their key.

- [x] **C15 - Mutable canonical JSON serialization can replace validated durable-task arguments.**
      `packages/core/src/json-clone.ts`, `packages/server/src/task-queue.ts`
  - A selective late `JSON.stringify` replacement recognized the already-validated victim task
    arguments and substituted an attacker principal plus a destructive operation. The real
    PostgreSQL queue adapter placed those forged JSON bytes in its parameterized `_kovo_jobs` write.
  - **Acceptance:** JSON shape validation/canonicalization, final serialization, UTF-8 byte length,
    and task queue argument cloning consume pinned exact values and fail closed on unsupported data;
    late/import-order JSON/encoder/number/collection poison cannot replace validated arguments or
    undercount bounded canonical data.
  - **Evidence:** the 42-test canonical-JSON/security-witness/task-queue matrix passes; the independent
    serialized-argument replacement proof now writes the exact validated victim operation/principal.

- [x] **C16 - Mutable wire-JSON controls can replace reconstructed query truth.**
      `packages/core/src/internal/wire-json.ts`
  - A selective late `JSON.stringify` replacement recognized a safe normalized query result and
    replaced it with an admin-bearing record containing a server-only token. The canonical wire
    encoder returned those injected bytes even though they were absent from the classified value.
  - **Acceptance:** secret/untrusted classification, Date/bigint tagging, array/object traversal,
    own-data reconstruction, canonical serialization, tagged-value parse/revival, and diagnostics use
    boot-pinned controls; late/import-order poison cannot add, remove, or replace client-wire truth.
  - **Evidence:** the 33-test wire-JSON/TCB/query-HTML matrix passes; the independent serializer
    replacement proof now emits only the classified `{ count: 1 }` truth.

## High

- [x] **H1 - Mutable String/Array/RegExp prototypes bypass server and browser output chokes.**
      `packages/server/src/{html,renderable,route}.ts`,
      `packages/browser/src/security-output.ts`, `packages/core/src/internal/sink-policy.ts`
  - Independent proofs made an array child and scalar emit raw `<img onerror>`, admitted a dynamic
    `x><img ...` attribute name, and classified an original `javascript:` URL as allowed.
  - **Evidence:** the 234-test output matrix passes; independent scalar, array-child, dynamic-name,
    and `javascript:` exploit proofs now escape, reject, or neutralize their original bytes.

- [x] **H2 - PostgreSQL live posture can be fooled by public/temp privilege-oracle shadows.**
      `packages/server/src/postgres-runtime.ts`
  - A runtime login with real schema/database creation authority installed shadow
    `has_schema_privilege`/`has_database_privilege` functions and obtained a green posture report.
  - **Evidence:** the 97-test PostgreSQL matrix passes with catalog/temp shadows, one-snapshot
    posture, and forced audit-query failure controls.

- [x] **H3 - PostgreSQL app DDL executes attacker shadows with provisioner authority.**
      `packages/server/src/postgres-runtime.ts`
  - A pre-existing writer-created `public.lower(text)` intercepted reviewed seed and migration SQL
    when provisioning explicitly placed `public` before `pg_catalog`.
  - **Evidence:** the 97-test PostgreSQL matrix executes genuine `lower()` in seed and migration
    exploit controls while proving unqualified app objects still land in `public`.

- [x] **H4 - No-login PostgreSQL role closure can retain role-administration authority.**
      `packages/server/src/postgres-runtime.ts`
  - Reader/writer closure admitted `CREATEROLE`, predefined privileged roles, and `ADMIN OPTION`
    whenever no runtime login role was configured.
  - **Evidence:** the 97-test PostgreSQL matrix rolls back CREATEROLE, predefined-role, privileged
    framework-role, and ADMIN OPTION closures with and without an explicit runtime login.

- [x] **H5 - Post-closure schema and crypto method mutation can replace validation or proof bytes.**
      `packages/server/src/{app-snapshot,schema,app-document,confidential-at-rest,mutation-wire,replay}.ts`,
      `packages/core/src/verifier.ts`
  - Retained custom/composite schema methods could become permissive after `createApp`; adjacent
    late crypto/subtle/cipher method poison could forge output/attestation proofs or observe secrets.
  - **Evidence:** app/schema/document (198), crypto/replay/provenance (86), and core verifier/output
    (234) matrices pass post-closure schema and late cipher/SubtleCrypto/HMAC poison regressions.

- [x] **H6 - Mutable RegExp/String controls reopen ambiguous reserved Node request targets.**
      `packages/server/src/{node,build}.ts`
  - A selective late `RegExp.prototype.test` override disabled only the percent-encoded separator
    detector and admitted `/_m/a/%2f/b` through the live Node conversion boundary; the generated
    Node/Vercel copies use the same mutable parsing controls.
  - **Evidence:** live and emitted target lexing use indexed exact-byte operations; encoded
    separators, dot segments, slash/backslash aliases, and absolute forms stay rejected under late
    poison while canonical targets retain their configured authority. The independent
    `/_m/a/%2f/b` RegExp poison proof now throws before Web Request construction.

- [x] **H7 - Mutable redirect string controls reopen Better Auth protocol-relative redirects.**
      `packages/better-auth/src/internal/credential.ts`
  - A selective late `String.prototype.startsWith` override made `redirectPath` return
    `//evil.example/phish` instead of its same-origin fallback; the mutation then emits that result as
    its post-login redirect.
  - **Evidence:** the 51-test Better Auth matrix uses pinned exact-byte control, leading-slash, and
    authority checks; absolute, protocol-relative, backslash, and control-bearing targets retain the
    fallback under late/import-order poison. The independent `//evil.example/phish` proof now returns
    `/` rather than the attacker target.

- [x] **H8 - Mutable storage Map controls can cross logical object identities.**
      `packages/core/src/storage.ts`
  - A selective late `Map.prototype.get` override made an attacker logical key read a different
    victim object's body from memory storage.
  - **Evidence:** the 37-test filesystem/storage/intrinsic matrix passes with pinned map operations,
    exact logical-key controls, late-poison isolation, and import-order fail-closed coverage.

- [x] **H9 - Mutable document array operations can replace the complete response shell.**
      `packages/server/src/{document-core,document-structured}.ts`
  - A selective late `Array.prototype.join` override on the final shell array replaced an otherwise
    safe `renderDocument()` result with a raw event-bearing document.
  - **Evidence:** the 262-test response/document matrix pins structured attributes/nodes, raw-text
    scripts, document parts, query scripts, CSP hashes/facts, and final shell assembly. Independent
    whole-document and same-origin-script `Array.join` proofs retain the original safe bytes under
    late poison and import-order failure controls.

- [x] **H10 - Mutable cookie scalar/collection controls permit raw Set-Cookie attribute injection.**
      `packages/server/src/cookies.ts`
  - A selective late `String.prototype.includes` override hid a semicolon in the declared Domain and
    made `serializeCookie()` emit attacker-supplied `Partitioned` attribute text; parser Map/Set and
    token/attribute controls have the same mutable dispatch surface.
  - **Evidence:** the 259-test response-security matrix pins cookie token/octet validation,
    prefix/floor decisions, parsing, attribute maps, and serialization; the independent injected
    Domain proof throws under late `includes` poison and forged forwarded attributes fail closed.

- [x] **H11 - Mutable dynamic-import URL controls escape compiler module authority.**
      `packages/browser/src/{dynamic-import-url,dom-like}.ts`
  - Poisoned String/RegExp/URL getters admitted same-origin non-`/c/` source paths or made missing
    manifest entries appear allowed, enabling import outside the compiler-declared module set.
  - **Evidence:** the 87-test scalar matrix rejects `/admin/upload` and missing `/c/` modules under
    poison while preserving the exact genuine manifest entry.

- [x] **H12 - Mutable registry traversal can cross-bind request keys to sibling authority.**
      `packages/server/src/{app-request,app-mutation-request,query,registry-facts,shell}.ts`
  - Selective `Array.prototype.find`/`some`/`map`/`flatMap` overrides could resolve a protected
    mutation, query, endpoint, or live-target key through a public or CSRF-exempt sibling and could
    make dispatch facts disagree with the exact registry entry named by the request.
  - **Evidence:** the 180-test request-dispatch matrix uses dense own-array traversal, exact-key
    lookup, and pinned Map/Set facts; protected mutation/query/endpoint and live-target sibling
    poison controls now reject or retain the named declaration without executing the wrong handler.

- [x] **H13 - Mutable request-method canonicalization can waive CSRF or open write dispatch.**
      `packages/server/src/{app-dispatch,app-mutation-request,shell,request-method}.ts`
  - Selective `String.prototype.toUpperCase` overrides mapped unsafe endpoint POST to GET before the
    CSRF decision, mapped GET to POST at the mutation boundary, and changed the GET/HEAD-only query
    channel classification.
  - **Evidence:** the same 180-test request-dispatch matrix pins exact ASCII GET/HEAD/POST/PUT/PATCH/
    DELETE classification across mutation, query, endpoint matching, method-allow, and CSRF gates.

- [x] **H14 - Mutable Better Auth response and cookie controls can forge credential success.**
      `packages/better-auth/src/{internal/credential,internal/trusted-plaintext}.ts`
  - Selective Array/Header/RegExp/Date and native Response getter overrides turned a provider 500,
    a cookie-free 200, or an expired/deleting cookie into a successful sign-in with attacker-chosen
    session evidence; adjacent redirect, cookie splitting, and touch merging shared mutable controls.
  - **Evidence:** the 51-test Better Auth matrix pins native response status/header identity, exact
    Set-Cookie bytes and clearing semantics, two-factor state, redirect bytes, and registry touches;
    failed or cookie-free provider responses remain typed failures under late/import-order poison.

- [ ] **H15 - Mutable task-registry dispatch can execute a privileged sibling task.**
      `packages/server/src/{task-runner,task-queue}.ts`
  - A selective late `Map.prototype.get` override resolved an ordinary queued task key to a
    different privileged definition. The real runner parsed the ordinary job with the sibling
    schema, skipped the named task, and executed the privileged task body once.
  - **Acceptance:** task registry construction/lookup, claim filters, per-task concurrency,
    scheduling registration and lineage, queue identities, and lease transitions use boot-pinned,
    semantically checked exact-key and collection controls; late/import-order poison cannot
    cross-bind definitions, jobs, principal context, or completion state.

- [x] **H16 - Mutable guard redirect controls reopen protocol-relative login targets.**
      `packages/server/src/guards.ts`
  - Selective late `String.prototype.startsWith` plus a replacement global `URL` constructor made
    `sanitizeNext('//evil.example/phish')` return the attacker target instead of `/`, violating the
    value handed to default and custom unauthenticated redirect flows.
  - **Acceptance:** raw/final target checks, URL construction/getters, route matching, query/hash
    stripping, and login URL assembly use boot-pinned, semantically checked exact-byte controls;
    protocol-relative, backslash, scheme, normalized-authority, and control-bearing targets retain
    the safe fallback under late and import-order poison.
  - **Evidence:** the 158-test app/guard/request-state matrix passes; the independent late-poison
    protocol-relative proof now receives `/`, and all three rate-window bypass proofs fail closed.

- [ ] **H17 - Mutable response-header controls admit forbidden browser state and redirects.**
      `packages/server/src/{response,app-system-response}.ts`
  - Replacing `Set.prototype.has` made a real `respond.file()` outcome forward its app-supplied
    `Set-Cookie` through the reserved-header floor into the final Web Response. Selective
    `String.prototype.startsWith` also made `redirectLocationHeader('//evil.example/phish')` return
    the protocol-relative attacker target with no allowlist.
  - **Acceptance:** header-source identity/traversal, case folding, reserved names, multi-value
    cloning/merging, filename and control escaping, Location URL parsing/allowlist comparison, and
    final system-response header insertion use boot-pinned, semantically checked exact bytes; late
    and import-order poison cannot emit reserved Set-Cookie/content controls or an unapproved target.

- [ ] **H18 - Mutable deferred-stream assembly can replace the complete document.**
      `packages/server/src/deferred-stream.ts`
  - A selective late `Array.prototype.join` override targeting the final array made
    `renderDeferredStream()` replace a safe shell, query/fragment chunks, boundary, cleanup script,
    and close bytes with a raw event-bearing document while retaining a nominal 200 response.
  - **Acceptance:** sync/live chunk traversal, priority sorting, boundary collision scanning,
    fragment/query serialization, CSP hash pairing, final assembly, TextEncoder/controller methods,
    and promise settlement use boot-pinned, semantically checked controls; late/import-order poison
    cannot replace/reorder bytes or desynchronize the emitted document from its CSP metadata.

- [ ] **H19 - Mutable mutation-wire assembly can replace an authenticated response body.**
      `packages/server/src/{mutation-wire,mutation/wire-response,mutation/targets}.ts`
  - A selective late `Array.prototype.join` override targeting the final query/fragment chunk array
    replaced a genuine successful mutation delta with an attacker-authored `<kovo-fragment>` carrying
    raw event markup. The result retained status 200 and the framework wire-body brand/path.
  - **Acceptance:** header/target parsing, exact renderer/query selection, change and principal-
    transition classification, JSON/control escaping, chunk traversal/ordering, final body assembly,
    and failure/reauth redirects use boot-pinned, semantically checked controls; poison cannot replace
    wire bytes, cross-bind targets, or suppress required build/session transition metadata.

- [ ] **H20 - Mutable client-module registry lookup can serve a privileged sibling's code.**
      `packages/server/src/{client-modules,loader-runtime-client-module}.ts`
  - A selective late `Map.prototype.get` override made the immutable URL registered for
    `/c/public.client.js@v1` return status 200 with the exact source bytes registered for the
    privileged sibling module instead.
  - **Acceptance:** module/path/version normalization, exact registry keys, Map/version tracking,
    entries, build-token hash inputs/crypto, URL request parsing, and runtime-href registration use
    boot-pinned, semantically checked controls; late/import-order poison cannot cross-bind module
    bytes, forge an unchanged build token, or alias unversioned/out-of-registry paths.

- [ ] **H21 - Mutable schema-validator traversal can skip every declared refinement.**
      `packages/server/src/schema.ts`
  - A selective late `Array.prototype[Symbol.iterator]` override returned an empty iterator only for
    the private string-check array. A closed `s.string().email().pattern('^[a-z]+$')` schema then
    accepted and returned `not an email!` without running either refinement.
  - **Acceptance:** scalar/string/date/file refinements, control/regex/linear-pattern checks,
    collection and shape-budget traversal, file accept/sniff constraints, numeric parsing, and error
    path construction use boot-pinned, semantically checked operations; late/import-order poison
    cannot skip, replace, or reorder any declared validation while genuine inputs remain compatible.

- [ ] **H22 - Mutable page-hint assembly can replace escaped hints with raw script.**
      `packages/server/src/hints.ts`
  - A selective late `Array.prototype.join` override targeting the final hint array replaced a safe
    compiler-versioned modulepreload with `<script src="/attacker.js"></script>`. The returned raw
    hint HTML carried no matching CSP metadata and is inserted into the framework document head.
  - **Acceptance:** stylesheet/module/i18n/speculation inputs, exact URL classification, CSS parsing,
    dedupe/order maps, escaping, CSP hashes, Early Hints, and final HTML/header assembly use
    boot-pinned, semantically checked controls; late/import-order poison cannot replace or reorder
    bytes, admit unsafe URLs/CSS, or desynchronize output from its CSP metadata.

- [x] **H23 - Mutable enhanced-navigation URL controls apply cross-origin HTML in the live realm.**
      `packages/browser/src/enhanced-navigation.ts` and the emitted inline loader
  - Replacing `URL.prototype.origin` after runtime installation made a real navigation accept an
    `https://evil.example` HTML response as same-origin, pass its build/session checks, replace the
    body, and enter script replay instead of falling back to a hard navigation.
  - **Acceptance:** requested/final URL construction and immutable origin/path facts, response URL
    and content-type reads, build/session stamps, document parsing, mutation ordering, hard-navigation
    fallback, and the emitted inline-loader closure use boot-pinned, semantically checked controls;
    late/import-order poison cannot apply cross-origin or non-HTML bytes to the current document.
  - **Evidence:** 175 focused Node tests and 162 three-engine browser tests pass; the independent
    cross-origin origin-getter proof falls back without replacing the body or replaying scripts.

- [x] **H24 - Mutable client reauthentication controls reopen a protocol-relative redirect.**
      `packages/browser/src/{reauth-directive,mutation-fetch}.ts` and the emitted inline loader
  - A selective late `String.prototype.startsWith` override made
    `sanitizeReauthDirective('//evil.example/phish')` return the attacker target instead of `/`;
    the enhanced 401 path hands that result directly to `location.assign()`. Separately, replacing
    `decodeURIComponent` made the successful-auth fallback accept `/\\evil.example/phish` and hand
    the browser-normalized cross-origin authority to the same sink.
  - **Acceptance:** response-header identity/reads, status classification, directive decode and exact
    path validation, redirect application, auth-success fallback, session transition retirement, and
    the emitted inline-loader closure use boot-pinned controls; late/import-order poison cannot
    navigate outside the current origin, suppress required retirement, or consume unclassified bytes.
  - **Evidence:** the same Node/browser matrix plus inline-loader parity passes; both independent
    protocol-relative and backslash-authority proofs route to `/` under late intrinsic replacement.

- [ ] **H25 - The shipped inline loader can mint predictable mutation replay identifiers.**
      `packages/browser/src/{inline-loader-build,inline-loader,mutation-response}.ts`
  - The emitted `ci` helper falls back from `crypto.randomUUID` to `Date.now` plus a realm-local
    counter, violating the normative 128-bit cryptographic `Kovo-Idem` floor whenever random UUIDs
    are unavailable. Its live method lookup also lets a late replacement force a constant token,
    unlike the modular runtime's cryptographic `getRandomValues` fallback.
  - **Acceptance:** modular and emitted mutation submission share boot-pinned, semantically checked
    cryptographic sources, require at least 128 random bits, fail closed without one, and never use a
    clock/counter fallback; late/import-order crypto replacement cannot repeat or predict the token.

## Medium

- [x] **M1 - The CSRF Origin floor dispatches through mutable Request/String/URL controls.**
      `packages/server/src/csrf.ts`
  - Replacing `globalThis.Request` after import or selectively mapping `POST` to `GET` through
    `String.prototype.toUpperCase` made a real cross-origin unsafe request skip the Origin floor.
  - **Evidence:** the 158-test auth/CSRF/endpoint/response matrix passes; both independent late
    Request replacement and selective POST-to-GET proofs now reject the cross-origin request.

- [x] **M2 - PostgreSQL provisioning rewrites undeclared external-role ACLs instead of rolling back.**
      `packages/server/src/postgres-runtime.ts`
  - An unsafe reachable shared role was silently stripped of grants, mutating authority outside the
    declared Kovo topology.
  - **Evidence:** the 97-test PostgreSQL matrix proves residual external authority aborts before
    revocation and the undeclared role retains its original ACL after rollback.

- [x] **M3 - Unicode-escaped PostgreSQL identifiers bypass the scoped-client session-control
      scanner.** `packages/server/src/managed-db.ts`
  - `U&"set_con\0066ig"` resolved to `set_config`, replaced the transaction principal, and updated
    another principal's RLS row when the routine ACL was deliberately permissive; default Kovo ACL
    revocation remains a separate floor.
  - **Evidence:** focused fake and real-PGlite principal-swap regressions pass; the scanner rejects
    the entire Unicode-escaped identifier syntax, including schema-qualified, six-digit, custom
    `UESCAPE`, and comment-adjacent variants, while benign non-ASCII identifiers retain coverage.

- [x] **M4 - Mutable diagnostic String/Array controls re-expose credentials and log injection.**
      `packages/server/src/{diagnostics,logging}.ts` and generated Node copies
  - Selective late `String.prototype.replaceAll` kept a full URL with userinfo, query secrets, and
    fragment in diagnostic text; selective `String.prototype.replace` preserved an attacker newline
    in the log-neutralization choke.
  - **Evidence:** the 46-test live diagnostics matrix plus the 174-test emitted Node/adapter/strict
    matrix pin secret discovery, URL/header/cookie scrubbing, descriptor traversal, replacement, and
    control neutralization. Live and closure-complete emitted paths retain useful sanitized detail,
    omit tagged/nested/request credentials, and keep each event on one line under combined poison.

- [x] **M5 - Mutable `Math.max` can disable the file-aware streamed-body ceiling.**
      `packages/server/src/app-request.ts`
  - Returning `Infinity` from a late `Math.max` override changed a finite mutation upload allowance
    into an unbounded pre-dispatch body read, bypassing the global resource floor before schema
    validation.
  - **Evidence:** the 180-test request-dispatch matrix computes the larger finite bound with scalar
    comparison; an oversized stream is cancelled with 413 and the mutation handler is not called
    under late `Math.max` poison.

- [x] **M6 - Mutable PHC parsing can authenticate a non-Argon2id password digest.**
      `packages/server/src/password.ts`
  - Selective late `String.prototype.startsWith`/`split` overrides substituted the structural facts
    of an Argon2id digest while the original Argon2i string reached `@node-rs/argon2`; both
    `isArgon2idPasswordDigest()` and `verifyPassword()` accepted the downgraded algorithm with
    `needsRehash: false`.
  - **Evidence:** the 18-test password matrix parses exact PHC bytes with pinned scalar/RegExp/
    Number/Map controls; Argon2i/Argon2d, malformed, duplicate, substituted, and import-order-poisoned
    strings fail closed while genuine Argon2id verify, rehash, and strong decoy cost remain intact.

- [x] **M7 - Mutable rate-limit state and clock controls reset enforced request windows.**
      `packages/server/src/{app-load-shed,guards}.ts`
  - A selective late `WeakMap.prototype.get` override made each request allocate fresh private
    per-app rate state; replacing `Date.now` with an advanced value expired the active bucket. In
    the independent proofs, a second mutation and a second global guard check stayed admitted under
    a configured maximum of one.
  - **Acceptance:** per-app/store/bucket operations, time reads, client-key parsing, numeric bounds,
    LRU eviction, and retry calculations use boot-pinned, semantically checked controls; late and
    import-order poison cannot reset windows, cross-bind clients, or exceed the configured key cap.
  - **Evidence:** the 158-test app/guard/request-state matrix passes; independent WeakMap and clock
    poison proofs retain the configured 429/rate-limited outcomes.

- [x] **M8 - Mutable replay-store state and clock controls erase committed idempotency truth.**
      `packages/server/src/replay.ts`
  - Selective late `Map.prototype.get` hid a committed `(scope, idem)` response, and an advanced
    `Date.now` expired it immediately. Both independent proofs made the same token appear unused,
    reopening duplicate mutation execution; adjacent mutable capacity/iteration controls can also
    evade pending and settled memory bounds.
  - **Acceptance:** replay records, exact keys, pending/committed discrimination, generation fences,
    time reads, TTL, and capacity calculations use boot-pinned, semantically checked controls; late
    and import-order poison cannot hide/cross-bind records, expire fresh truth, or evade either cap.
  - **Evidence:** the 90-test replay/webhook/request-state matrix passes; independent Map and clock
    poison proofs keep all three committed responses visible and refuse a second reservation.

- [x] **M9 - Mutable Reporting API URL controls persist credential-bearing paths.**
      `packages/server/src/reporting.ts`
  - Replacing the native `URL.prototype.origin` getter after import made a real security report store
    the complete reset/capability URL, including path and query secrets, in its supposedly redacted
    aggregate instead of retaining only the genuine origin.
  - **Acceptance:** request method/body bounds, decode/traversal, URL origin parsing, control/token
    normalization, report rate/cardinality state, keys, snapshots, and clocks use boot-pinned,
    semantically checked controls; late/import-order poison cannot persist path/query/userinfo secrets
    or evade the quiet bounded telemetry posture.
  - **Evidence:** the 94-test reporting/app/request-state matrix passes; the independent poisoned
    origin proof now stores only `https://example.test` and omits capability path/query bytes.

## Latest verification

The remediation pass remains intentionally non-zero: H15, H17-H22, and H25 are active response/
deferred/mutation/client output, task, schema, and replay-token fixes.
Integrated
evidence is
green at
97 PostgreSQL, 88 egress, 37 filesystem/storage, 180 request-dispatch, 198 app/schema/document, 158
auth/response, 51 Better Auth, 86 crypto/replay, 234 output/compiler/core, and 87 scalar
route/handler/secret, and 18 password tests.
A complete fresh sweep of the final integrated tree is still required.
