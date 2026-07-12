# Security Bug Ledger (`bugz-28`)

**Date:** 2026-07-11

**Scope:** Findings from the adversarial remediation pass run after `bugz-27` began landing. Each
item survived an executable exploit-shaped reproduction plus an independent source/test cross-check.
This is an active closure ledger; `SPEC.md` remains normative.

## Severity summary

| Severity | Count | Items |
| -------- | ----: | ----- |
| Critical |    11 | C1-C11 |
| High     |    15 | H1-H15 |
| Medium   |     8 | M1-M8 |

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

- [ ] **C6 - A mutable CSRF token parser can substitute a cached victim token.**
      `packages/server/src/csrf.ts`
  - A selective late `String.prototype.split` override returned the parts of a genuine cached victim
    token while validating the unrelated submitted string `v1.attacker.attacker`; synchronizer-token
    validation returned true for the victim session.
  - **Acceptance:** token minting/parsing, base64url validation, byte conversion, active-key lookup,
    and purpose selection use boot-pinned, semantically checked exact-byte operations; cached-token
    substitution rejects under hostile import order and late poison while genuine rotation works.

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

- [ ] **C10 - Mutable capability-token controls can forge signed storage claims.**
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

- [ ] **C11 - A storage download endpoint retains mutable signing authority after construction.**
      `packages/server/src/capability-route.ts`
  - Mutating the original `createStorageDownloadEndpoint(options).secret` from the victim key to an
    attacker key after construction made a newly attacker-signed URL pass the real verify-before-read
    sink and return the existing `private.pdf` bytes with status 200.
  - **Acceptance:** snapshot and pin secret/keyring, storage, scope, replay store, clock, stored-file
    posture, signer defaults, and base-path facts at endpoint/context construction; later mutation,
    getters/proxies, and scalar/URL collection poison cannot replace the authority or make request
    derivation disagree with the exact key read from storage.

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

- [ ] **H9 - Mutable document array operations can replace the complete response shell.**
      `packages/server/src/document-core.ts`
  - A selective late `Array.prototype.join` override on the final shell array replaced an otherwise
    safe `renderDocument()` result with a raw event-bearing document.
  - **Acceptance:** document parts, query scripts, CSP facts, and final/deferred shell assembly use
    boot-pinned, semantically checked traversal/concatenation over closed own-data arrays; hostile
    import-order and late-poison regressions retain the original shell bytes and matching CSP.

- [ ] **H10 - Mutable cookie scalar/collection controls permit raw Set-Cookie attribute injection.**
      `packages/server/src/cookies.ts`
  - A selective late `String.prototype.includes` override hid a semicolon in the declared Domain and
    made `serializeCookie()` emit attacker-supplied `Partitioned` attribute text; parser Map/Set and
    token/attribute controls have the same mutable dispatch surface.
  - **Acceptance:** cookie token/octet validation, prefix/floor decisions, parsing, attribute maps,
    and serialization use boot-pinned, semantically checked operations; semicolon/control injection
    and forged forwarded attributes fail closed under hostile import order and late poison.

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

- [ ] **M4 - Mutable diagnostic String/Array controls re-expose credentials and log injection.**
      `packages/server/src/{diagnostics,logging}.ts` and generated Node copies
  - Selective late `String.prototype.replaceAll` kept a full URL with userinfo, query secrets, and
    fragment in diagnostic text; selective `String.prototype.replace` preserved an attacker newline
    in the log-neutralization choke.
  - **Acceptance:** secret discovery, URL scrubbing, replacement, traversal, and control-character
    neutralization use boot-pinned, semantically checked operations in live and emitted paths; hostile
    import-order and late-poison tests keep credentials absent and each event on one line.

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

- [ ] **M7 - Mutable rate-limit state and clock controls reset enforced request windows.**
      `packages/server/src/{app-load-shed,guards}.ts`
  - A selective late `WeakMap.prototype.get` override made each request allocate fresh private
    per-app rate state; replacing `Date.now` with an advanced value expired the active bucket. In
    the independent proofs, a second mutation and a second global guard check stayed admitted under
    a configured maximum of one.
  - **Acceptance:** per-app/store/bucket operations, time reads, client-key parsing, numeric bounds,
    LRU eviction, and retry calculations use boot-pinned, semantically checked controls; late and
    import-order poison cannot reset windows, cross-bind clients, or exceed the configured key cap.

- [ ] **M8 - Mutable replay-store state and clock controls erase committed idempotency truth.**
      `packages/server/src/replay.ts`
  - Selective late `Map.prototype.get` hid a committed `(scope, idem)` response, and an advanced
    `Date.now` expired it immediately. Both independent proofs made the same token appear unused,
    reopening duplicate mutation execution; adjacent mutable capacity/iteration controls can also
    evade pending and settled memory bounds.
  - **Acceptance:** replay records, exact keys, pending/committed discrimination, generation fences,
    time reads, TTL, and capacity calculations use boot-pinned, semantically checked controls; late
    and import-order poison cannot hide/cross-bind records, expire fresh truth, or evade either cap.

## Latest verification

The remediation pass remains intentionally non-zero: C6, C10-C11, H9-H10, H15, M4, and M7-M8 are
active document/cookie/CSRF, capability, generated/live diagnostics, task, request-limit, and replay
fixes. Integrated evidence is green at
97 PostgreSQL, 88 egress, 37 filesystem/storage, 180 request-dispatch, 198 app/schema/document, 158
auth/response, 51 Better Auth, 86 crypto/replay, 234 output/compiler/core, and 87 scalar
route/handler/secret, and 18 password tests.
A complete fresh sweep of the final integrated tree is still required.
