# Security Bug Ledger (`bugz-28`)

**Date:** 2026-07-11

**Scope:** Findings from the adversarial remediation pass run after `bugz-27` began landing. Each
item survived an executable exploit-shaped reproduction plus an independent source/test cross-check.
This is an active closure ledger; `SPEC.md` remains normative.

## Severity summary

| Severity | Count | Items  |
| -------- | ----: | ------ |
| Critical |    46 | C1-C46 |
| High     |    29 | H1-H29 |
| Medium   |     9 | M1-M9  |

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

- [x] **C17 - Mutable task identifiers collapse queued identity and expired-lease authority.**
      `packages/server/src/task-queue.ts`
  - Replacing `Date.now` and `Math.random` with constants made two distinct memory-queue enqueues
    receive the same job id, so the second task silently replaced the first queued task and args.
    The same replacements repeated a lease token after expiry/reaping; a stale worker using the same
    owner then successfully marked the later lease complete.
  - **Acceptance:** job ids and per-claim lease fences use boot-pinned, semantically verified
    cryptographic entropy with at least 128 random bits; queue lookup, iteration, coalescing, claim,
    heartbeat, completion, retry, and reaping use exact pinned controls, and neither late nor
    import-order poison can overwrite a sibling job or reuse expired worker authority.
  - **Evidence:** the 66-test durable-task matrix plus server dist/DTS, import, and API gates pass;
    independent clock/RNG, stale-lease, registry cross-binding, and late synchronized-crypto proofs
    now retain distinct 128-bit identities and exact task dispatch.

- [x] **C18 - Mutable command-argument iteration can replace reviewed privileged execution.**
      `packages/server/src/command.ts`
  - `cmd()` froze the reviewed Node argv, but `runCommand()` later spread it through the live
    `Array.prototype[Symbol.iterator]`. A selective late iterator returned attacker `-e` source for
    that exact frozen array, and the real shell-free command door executed `substituted` instead of
    the reviewed program arguments.
  - **Acceptance:** allowlist lookup, program/argv construction and immutable snapshots, exact argv
    cloning, `execFile` identity, execution options, callback settlement, output conversion, and
    Promise controls are boot-pinned and semantically checked; late/import-order poison cannot alter
    any byte passed to the privileged process sink while genuine allowlisted commands still run.
  - **Evidence:** the 161-test command/crypto/entropy consumer matrix plus server dist/DTS and
    security gates pass; the independent iterator proof executes only the reviewed `reviewed` argv.

- [x] **C19 - A synchronized Node crypto replacement can force AES-GCM IV reuse.**
      `packages/server/src/confidential-at-rest.ts`
  - Replacing CommonJS `node:crypto.randomBytes` with a constant function and calling
    `syncBuiltinESMExports()` updated the live ESM binding consumed by `encryptAtRest()`. Two distinct
    plaintexts under the same key/AAD then serialized the same 96-bit IV, violating GCM's nonce
    uniqueness requirement and endangering both confidentiality and authenticity.
  - **Acceptance:** random/cipher function identities, 96-bit IV generation and non-repetition
    controls, key/AAD/plaintext byte snapshots, cipher method dispatch, tag/ciphertext assembly, and
    envelope encoding use boot-pinned, semantically verified controls; late synchronized builtins and
    hostile pre-import sources cannot repeat an IV or return a branded non-authenticated envelope.
  - **Evidence:** the same matrix covers bounded IV replay detection and staged hostile entropy;
    the independent synchronized-builtin proof now receives distinct 96-bit IVs.

- [x] **C20 - A public global bridge exposes the framework's raw-HTML mint.**
      `packages/core/src/index.ts`, `packages/server/src/jsx-runtime.ts`
  - Server JSX installation writes `{ renderHtml: renderedHtml }` to the predictable
    `Symbol.for('kovo.mutationFormHelperRenderContext')` global. Any evaluated app module can read
    that object and call `renderHtml('<img onerror=...>')`; `renderHtmlValue()` recognizes the result
    as framework-authored and emits the attacker markup byte-for-byte.
  - **Acceptance:** no public/global structural object exposes a generic rendered-HTML constructor,
    no `Symbol.for()` value acts as an output authority brand, and the cross-package form-helper
    bridge accepts only structured helper operations that reconstruct escaped output inside the
    server choke; app code cannot mint or launder arbitrary raw HTML through casts or global access.
  - **Evidence:** the 140-test focused JSX/form/output-authority matrix plus core/server dist+DTS and
    import/API/security gates pass; the independent global-mint proof can no longer obtain a generic
    raw-HTML constructor and its attacker markup stays escaped.

- [x] **C21 - Predictable pre-import entropy forges authenticated rendered-HTML markers.**
      `packages/server/src/html.ts`
  - Replacing CommonJS `node:crypto.randomBytes` with known constant bytes and synchronizing the
    builtin ESM exports before importing the renderer made the private coercion-marker HMAC key
    predictable. An app-authored string carrying a correctly signed v2 marker then made
    `renderHtmlValue()` emit raw attacker markup instead of escaped text.
  - **Acceptance:** the coercion-marker secret uses boot-pinned, semantically verified
    cryptographic entropy; marker prefix/suffix discovery, slicing, alphabet checks, base64 decode,
    HMAC construction, comparison, recursion, and final text/raw assembly use exact pinned controls;
    hostile pre-import or late controls cannot forge a marker while genuine rendered composition
    remains byte-stable and bounded.
  - **Evidence:** the same focused matrix and build/gates pass; the independent pre-import constant-
    entropy proof can no longer forge an accepted marker and attacker text remains escaped.

- [x] **C22 - Predictable pre-import response entropy collapses upload object authority.**
      `packages/server/src/{response-security-intrinsics,upload-sniff,csrf,deferred-stream}.ts`
  - The shared response membrane accepted constant `randomBytes` and a constant valid-shaped v4
    `randomUUID` after CommonJS replacement plus `syncBuiltinESMExports()` before import. Two real
    `mintStorageKey('avatars')` calls then returned the same supposedly collision-free opaque key,
    allowing a later upload to overwrite or cross-bind the earlier object; the same source feeds
    no-JS replay identities, anonymous CSRF bindings, and deferred boundaries.
  - **Acceptance:** entropy function identities are boot-pinned and hostile synchronized/pre-import
    sources fail closed; every security identity uses the required random-bit floor and runtime
    non-repetition controls, including at least 128 random bits for no-JS idempotency; upload keys,
    anonymous bindings, replay identities, and stream boundaries cannot repeat or become predictable.
  - **Evidence:** the same focused matrix covers upload keys, anonymous CSRF, exact 128-bit no-JS
    identities, and deferred boundaries; the independent constant pre-import source fails closed.

- [ ] **C23 - Mutable static-route planning publishes guarded session content.**
      `packages/server/src/{static-export-route-plan,static-export-replay,static-export}.ts`
  - A selective late array iterator substituted an explicitly public clone only while
    `staticExportRoutePlan()` traversed `app.routes`, then restored normal iteration. Real replay
    subsequently matched the original guarded route, passed its session provider, and wrote
    `victim:server-only-account-token` into public `account/index.html`; the unpoisoned control
    rejects the same app with KV229.
  - **Acceptance:** app/route provenance, dense route snapshots, guard/access/session posture,
    concrete target planning, diagnostic suppression, replay matching, artifact collection, and
    final publication share boot-pinned exact identities; planning and replay cannot observe
    different declarations under late/import-order poison, and guarded/session content is never
    emitted to a static host.

- [ ] **C24 - Mutable artifact staging replaces reviewed immutable client modules.**
      `packages/server/src/{output-staging,vite-client-module-output}.ts`
  - The output manifest hashed a reviewed safe client module, but staging later used the live
    `entries.map()` result without hashing the staged bytes. A selective replacement supplied
    attacker JavaScript only to the staging callback, and the real app-shell writer committed it
    under the reviewed immutable `/c/__v/build-1/account.client.js` target.
  - **Acceptance:** entry/source/content snapshots, target and manifest construction, hashing,
    changed/stale detection, staging traversal, copy/write, pre-commit revalidation, rename, cleanup,
    filesystem/path controls, and Promise settlement use boot-pinned exact operations; committed
    bytes must match their reviewed manifest hash and cannot be substituted after validation.

- [ ] **C25 - Mutable compiler-cache hashing authenticates attacker compiler output.**
      `packages/compiler/src/{compile-cache,persistent-compile-cache,vite}.ts`
  - After a genuine safe cached `account.client.js` was replaced with attacker JavaScript, the
    normal cache reader correctly missed. Replacing CommonJS `node:crypto.createHash`, synchronizing
    ESM exports, and selectively returning the stored filename digest for the tampered JSON made the
    real persistent reader accept the attacker module; the Vite path returns such hits without
    recompilation or another output check.
  - The process-lifetime `CompileCache` shared the same flaw: selectively aliasing an unsafe source
    digest to a prior safe source returned the earlier emitted result without invoking the compiler.
  - **Acceptance:** cache-key/footprint narrowing, compiler identity, manifest/entry/blob parsing and
    own-data snapshots, path/ref validation, hashing and crypto methods, file reads/writes/renames,
    atomic temp identities, iteration, and Promise settlement use boot-pinned exact controls;
    late/import-order poison or disk tampering can only produce a cache miss, never trusted code.

- [ ] **C26 - Mutable SRI finalization replaces a safe static document after rendering.**
      `packages/server/src/{static-export-sri,static-export}.ts`
  - A route installed a selective late `Array.prototype.map` that stayed inert through safe page
    rendering, then substituted a raw event-bearing document for the private `/index.html` artifact
    during SRI finalization. Real `exportStaticApp()` returned and wrote the executable HTML after
    the framework output choke; the unpoisoned export retained only the safe body.
  - **Acceptance:** artifact/asset/module snapshots, integrity hashing, opening-tag and attribute
    parsing, first-party URL resolution, replacement offsets/assembly, final artifact traversal, and
    publication use boot-pinned exact controls; SRI decoration cannot add or replace rendered bytes,
    and the final committed document is bound to the reviewed post-choke artifact.

- [ ] **C27 - Inherited Vite manifest fields publish unlisted server-private files.**
      `packages/server/src/{vite-manifest,vite-build-assets,static-export}.ts`
  - A genuine manifest contained only `{ "src/public.client.ts": {} }`, but a late non-enumerable
    `Object.prototype.file = "server/private-config.js"` made manifest validation accept the
    inherited path as an emitted public asset. After restoring the prototype, real static export
    copied that unlisted dist file into `/server/private-config.js`, disclosing a production database
    password; the unpolluted manifest yields no assets.
  - **Acceptance:** JSON parsing, record/key/chunk reconstruction, optional scalar/array fields,
    manifest traversal/resolution, dist-path normalization, asset mapping, and public copy inputs use
    boot-pinned own-data controls; inherited/accessor/proxy fields and late/import-order poison cannot
    add a public artifact or disclose an unlisted server/build file.

- [ ] **C28 - Mutable static-analysis cache hashing suppresses unsafe SQL findings.**
      `packages/server/src/internal/data-plane-static-analysis.ts`
  - Safe parameterized SQL was cached with zero findings, while the same-path
    `db.execute(sql.raw(input.id))` produced real KV422 findings with cache disabled. A synchronized
    selective `node:crypto.createHash` replacement returned the safe source digest only for the
    unsafe source; cache-enabled `staticDataPlaneBuildFacts()` then replayed the safe facts exactly
    and returned zero KV422 findings for the unsafe program.
  - **Acceptance:** source discovery/snapshots, analyzer identity/fingerprints, cache keys and paths,
    crypto function/method dispatch, cached JSON parsing and fact validation, in-memory lookup,
    filesystem operations, analyzer imports/results, and diagnostic projection use boot-pinned exact
    controls; poisoned or stale cache state can only miss/fail closed and cannot suppress a finding.

- [x] **C29 - Mutable mutation-form attribute assembly injects executable HTML.**
      `packages/server/src/jsx-runtime.ts`
  - A selective late `Array.prototype.join` recognized the internal mutation-form attribute array
    beginning with ` method="post"` and returned `><img onerror=...>` instead. The real JSX renderer
    inserted those raw bytes into the opening `<form>` tag, and `renderHtmlValue()` emitted the event
    handler without escaping.
  - **Acceptance:** mutation definition/key recognition, default method/action/data attributes,
    stream flags, key/CSRF/idem hidden fields, attribute escaping, and opening-tag assembly use
    boot-pinned exact controls; late/import-order poison cannot add markup or alter the form target,
    while authored overrides and ordinary mutation forms retain byte-stable behavior.
  - **Evidence:** the same focused matrix passes; the independent selective final-join proof retains
    the exact reviewed form attributes and emits no attacker element.

- [x] **C30 - Inherited request sessions bypass authentication and role guards.**
      `packages/server/src/{auth-principal,guards}.ts`
  - With `Object.prototype.session = { user: { id: "attacker", roles: ["admin"] } }`, a genuine
    `Request` carrying no own session was classified as a proven attacker principal. The real
    built-in `guards.authed()` and `guards.role("admin")` both passed; an explicit own null session
    correctly denies, showing inherited request state alone created the authority.
  - **Acceptance:** session/sessionId carrier presence and session/user/id/roles reads use boot-
    pinned own-data descriptors and exact snapshots; inherited, accessor-backed, proxy-unstable, or
    ambiguous carriers remain anonymous/unresolved and fail every built-in auth/role path under
    late/import-order pollution, while framework-attached own session outcomes remain compatible.
  - **Evidence:** the 73-test auth-principal/guard matrix plus server dist/DTS and classifier/security
    gates pass; the independent inherited-admin proof now remains anonymous and both guards deny.

- [ ] **C31 - Mutable build-source filtering suppresses every data-plane finding.**
      `packages/server/src/internal/data-plane-static-analysis.ts`,
      `packages/cli/src/commands/build-export.ts`
  - An evaluated app replaced `Array.prototype.filter` only for the real discovered source array
    containing `sql.raw(input.id)`. `staticDataPlaneBuildFacts()` analyzed an empty list, and the
    complete cache-disabled `kovo build --check` returned exit 0 with `CHECK ok preset=node`; the
    identical unpoisoned app fails with KV422.
  - **Acceptance:** source discovery, relevance decisions, dense own-data snapshots, analyzer input,
    fact/diagnostic traversal, graph construction, preflight classification, and final exit/output
    use boot-pinned exact controls; evaluated app code cannot omit, replace, or reorder a discovered
    source or suppress an error under late/import-order poison, with or without caches.

- [ ] **C32 - Mutable handler fingerprints bind safe authority facts to unsafe runtime code.**
      `packages/compiler/src/scan/parse.ts`, `packages/cli/src/commands/build-export.ts`
  - The SHA-256 handler fingerprint joins statically inspected authority facts to the runtime
    mutation. A synchronized selective `createHash` replacement gave a safe machine-signature
    handler and a Cookie-reading `csrf:false` handler one digest; the real cache-disabled build then
    treated the unsafe runtime handler as the safe same-key decoy and returned a green check instead
    of KV418.
  - **Acceptance:** handler extraction/transpilation, canonical AST construction, crypto function and
    method dispatch, fact grouping/deduplication, runtime function-source capture, exact mutation-key
    and fingerprint matching, and graph projection use boot-pinned exact controls; uninspectable or
    mismatched handlers remain ambient-authority-positive and cannot borrow a sibling proof.

- [x] **C33 - Mutable JSX element classifiers reopen executable text and refresh sinks.**
      `packages/server/src/jsx-runtime.ts`
  - Selective late `String.prototype.toLowerCase` replacements classified `script` as an ordinary
    element and `meta` as a non-refresh tag. An ordinary scalar child was then emitted verbatim as
    executable JavaScript, while `content="0;url=javascript:..."` survived on a refresh element.
  - **Acceptance:** tag/attribute names, executable-element classification, meta http-equiv/content
    pairing, scalar extraction, sink-event decisions, and final child/attribute composition use
    boot-pinned exact controls; aliases/case variants remain conservatively classified and poison
    cannot emit untrusted script/style text or an executable refresh navigation.
  - **Evidence:** the focused matrix passes; independent script/meta classifier proofs now drop
    untrusted executable text and refresh content under the same selective replacements.

- [x] **C34 - Nested or promised JSX children bypass executable-element provenance checks.**
      `packages/server/src/jsx-runtime.ts`
  - The script/style choke inspected only direct scalar children. Wrapping the same app/request
    JavaScript string in a one-element array or `Promise.resolve()` bypassed classification, and the
    real renderer emitted it verbatim inside `<script>` after traversal or settlement.
  - **Acceptance:** executable-element children are recursively classified across dense arrays,
    nested JSX, iterables, function components, and Promise settlement with bounded depth/cardinality;
    only explicitly framework-trusted executable text may survive, and async/nested carriers cannot
    launder ordinary values into script or style bytes.
  - **Evidence:** the focused matrix passes; independent array- and Promise-wrapped script proofs now
    emit an empty executable element instead of laundering ordinary strings.

- [x] **C35 - Mutable JSX props traversal fabricates a live meta redirect.**
      `packages/server/src/jsx-runtime.ts`
  - Selective late `Object.entries` fabrication on an otherwise empty props object supplied
    `http-equiv=refresh` plus attacker `content`. The content classifier re-read the original empty
    props, missed the fabricated pair, and emitted a live `javascript:` refresh target.
  - **Acceptance:** JSX props become one dense own-data snapshot before any classification; name,
    value, pair-dependent sink decisions, contextual escaping, and emission consume that same
    snapshot, while inherited/accessor/proxy/fabricated entries fail closed under late/import-order
    poison and cannot add an attribute absent from the authored carrier.
  - **Evidence:** the focused matrix passes; the independent fabricated-entries proof now renders the
    original empty meta element and cannot introduce a refresh target.

- [ ] **C36 - Mutable replay-response headers publish server-only file bytes as HTML.**
      `packages/server/src/{static-export-response,static-export-replay,static-export}.ts`
  - A route returned a genuine attachment containing a database password, then selectively replaced
    `Headers.prototype.get` so static replay hid only `Content-Disposition` and reported `text/html`.
    Real export accepted status 200 and wrote the file bytes to public `/private-report/index.html`;
    the unpoisoned route fails KV229.
  - **Acceptance:** response/status/header/body identity, header getters and exact snapshots,
    content-disposition/type/outcome classification, document-protocol scanning, diagnostics, and
    artifact publication use boot-pinned controls; file/stream/redirect/error outcomes cannot be
    reclassified as a route document under late/import-order poison.

- [ ] **C37 - Mutable Vite source containment publishes files outside the dist root.**
      `packages/server/src/{vite-manifest,vite-build-assets,static-export}.ts`
  - A normal manifest `file: "../server-secret.env"` is rejected. Selective late `Array.some`
    replacement bypassed unsafe-segment validation and `String.startsWith` replacement forged the
    final dist-root containment check; after restoring both, real static export copied the sibling
    `DATABASE_PASSWORD` file into public `/server-secret.env`.
  - **Acceptance:** manifest file segments, decoding, normalization, dist/output roots, URL/path
    conversion, relative/absolute containment, source descriptors, and asset copy inputs use boot-
    pinned exact controls; encoded/plain traversal, separator aliases, symlinks, and late/import-
    order poison cannot escape the trusted source root even when the destination remains confined.

- [x] **C38 - Runtime JSX tag strings inject raw element syntax.**
      `packages/server/src/jsx-runtime.ts`
  - An app-controlled tag string containing spaces, attributes, and quotes was interpolated directly
    into both opening and closing tags, producing an executable event handler without passing through
    attribute validation or contextual escaping.
  - **Evidence:** the 140-test focused matrix passes; the independent dynamic-tag proof now fails
    closed and emits no attacker-controlled element bytes.

- [x] **C39 - A mutable void-element classifier can create an unclosed executable element.**
      `packages/server/src/jsx-runtime.ts`
  - Replacing the private void-element `Set` classification made `script` omit its closing tag, so an
    ordinary following sibling became executable script text in the browser parser.
  - **Evidence:** the focused matrix passes; the independent classifier proof retains `</script>` and
    leaves the following text outside the executable element.

- [x] **C40 - Runtime component output and structural forgeries bypass raw-HTML authority.**
      `packages/core/src/index.ts`,
      `packages/server/src/{component-authority,component-render,jsx-runtime}.ts`
  - An ordinary runtime component string was treated as framework-authored HTML, and a structural
    object carrying a `definition.render` field could impersonate a component and return raw markup.
  - **Evidence:** the focused matrix plus core/server dist+DTS and public-API/security gates pass;
    ordinary component strings are escaped and the independent forged descriptor is rejected.

- [ ] **C41 - Mutable static-export diagnostic filtering discards KV426 before publication.**
      `packages/server/src/{static-export-diagnostics,static-export}.ts`
  - The export gate used the live `Array.prototype.filter` to select error diagnostics. A selective
    replacement returned an empty list for a real KV426 trusted-HTML violation, so export continued
    and published the raw event-bearing HTML that the diagnostic was meant to block.
  - **Acceptance:** compiler diagnostic carriers, code/severity lookup, source locations, error
    selection, formatting, and handoff to export use boot-pinned dense own-data snapshots; malformed,
    omitted, inherited, or mutation-obscured diagnostics fail closed before any artifact write.

- [ ] **C42 - Mutable compiler-Vite diagnostic filtering emits code despite KV435.**
      `packages/compiler/src/vite.ts`
  - A selective late `Array.prototype.filter` removed the real KV435 secret-query error inside the
    Vite transform gate. The transform returned emitted server/client code instead of throwing, so a
    confidentiality diagnostic could be bypassed on the production compilation path.
  - **Acceptance:** compiler results, diagnostic arrays and fields, severity classification,
    callbacks, error collection, emitted-file traversal, and transform return/throw decisions use one
    boot-pinned exact snapshot; any ambiguous error diagnostic prevents emitted code from escaping.

- [ ] **C43 - Mutable secret-read metadata returns a declared secret column unboxed.**
      `packages/server/src/secret-read-boundary.ts`
  - A selective late `Set.prototype.has` replacement hid the concrete `secrets.classified` origin
    only while SQLite provenance was classified. `createSecretBoxingReadDb(...).select()` then
    returned the raw `victim-secret` scalar instead of a runtime `Secret` box.
  - **Acceptance:** read metadata, query/SQL carriers, SQLite origin descriptors, selected fields,
    secret table/column membership, boundary merging, row traversal, and boxing consume boot-pinned
    dense snapshots; ambiguous or poisoned provenance boxes conservatively and never releases raw
    secret material.

- [ ] **C44 - Mutable guard-chain classifiers and iterators skip every authorization guard.**
      `packages/server/src/{access,guards}.ts`
  - Selective private-array iterators made both `guards.all(denyA, denyB)` and `runGuardChain()` run
    zero guards and return allow. Independently, replacing live `Array.isArray` only for the
    snapshotted access decision made `runAccessDecisionGuards()` classify a real deny chain as a
    structured no-guard decision and return allow.
  - **Acceptance:** composition-time and execution-time guard carriers are dense immutable own-data
    snapshots; array/classifier decisions, audit projection, exact indexed traversal, await/settle,
    and denial normalization use boot-pinned controls, and any ambiguous chain denies rather than
    becoming public access.

- [ ] **C45 - Inherited session-provider envelope fields attach an attacker admin principal.**
      `packages/server/src/{guards,auth-principal}.ts`
  - A provider returned a plain victim/member session whose prototype supplied inherited `value`
    and `setCookies`. The lifecycle misclassified it as an envelope, attached the inherited
    attacker/admin value, forwarded a forged session cookie, and made the real admin role guard pass.
  - **Acceptance:** provider settlement and envelope discrimination require a plain exact own-data
    carrier; value/session/user/roles and cookie arrays are independently snapshotted and validated,
    inherited/accessor/proxy-unstable or malformed fields fail closed, and only the framework-owned
    settled session snapshot can establish principal authority.

- [x] **C46 - Nested rendered JSX launders ordinary text into executable script bytes.**
      `packages/server/src/jsx-runtime.ts`
  - Wrapping an ordinary request string in a harmless rendered `<Fragment>` converted it to generic
    `RenderedHtml`. The executable-element choke rejected scalar strings but accepted that rendered
    carrier, emitting `globalThis...` verbatim inside `<script>` without `TrustedHtml` provenance.
  - **Acceptance:** executable-element recursion distinguishes direct explicit `TrustedHtml` from
    generic rendered markup at every scalar, array, Promise, fragment, and component boundary;
    ordinary text cannot gain script/style authority merely by passing through JSX composition.
  - **Evidence:** the 132-test JSX/component/form/output matrix and server dist+DTS build pass; the
    independent Fragment-laundering proof now emits an empty script while direct `TrustedHtml`
    remains the explicit reviewed escape.

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

- [x] **H15 - Mutable task-registry dispatch can execute a privileged sibling task.**
      `packages/server/src/{task-runner,task-queue}.ts`
  - A selective late `Map.prototype.get` override resolved an ordinary queued task key to a
    different privileged definition. The real runner parsed the ordinary job with the sibling
    schema, skipped the named task, and executed the privileged task body once.
  - **Acceptance:** task registry construction/lookup, claim filters, per-task concurrency,
    scheduling registration/lineage, and runner settlement use boot-pinned, semantically checked
    exact-key and collection controls; late/import-order poison cannot cross-bind definitions,
    jobs, principal context, or completion state.
  - **Evidence:** the same durable-task matrix and adjacent 140-test app/mutation matrix pass; the
    independent `Map.get` cross-binding proof runs only the exact ordinary task.

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

- [x] **H17 - Mutable response-header controls admit forbidden browser state and redirects.**
      `packages/server/src/{response,app-system-response}.ts`
  - Replacing `Set.prototype.has` made a real `respond.file()` outcome forward its app-supplied
    `Set-Cookie` through the reserved-header floor into the final Web Response. Selective
    `String.prototype.startsWith` also made `redirectLocationHeader('//evil.example/phish')` return
    the protocol-relative attacker target with no allowlist.
  - **Acceptance:** header-source identity/traversal, case folding, reserved names, multi-value
    cloning/merging, filename and control escaping, Location URL parsing/allowlist comparison, and
    final system-response header insertion use boot-pinned, semantically checked exact bytes; late
    and import-order poison cannot emit reserved Set-Cookie/content controls or an unapproved target.
  - **Evidence:** the full 3,035-test server suite and focused 98-test integration matrix pass; the
    independent reserved-Set-Cookie and protocol-relative Location proofs now drop or replace the
    hostile values with `/` under late collection/String/URL replacement.

- [x] **H18 - Mutable deferred-stream assembly can replace the complete document.**
      `packages/server/src/deferred-stream.ts`
  - A selective late `Array.prototype.join` override targeting the final array made
    `renderDeferredStream()` replace a safe shell, query/fragment chunks, boundary, cleanup script,
    and close bytes with a raw event-bearing document while retaining a nominal 200 response.
  - **Acceptance:** sync/live chunk traversal, priority sorting, boundary collision scanning,
    fragment/query serialization, CSP hash pairing, final assembly, TextEncoder/controller methods,
    and promise settlement use boot-pinned, semantically checked controls; late/import-order poison
    cannot replace/reorder bytes or desynchronize the emitted document from its CSP metadata.
  - **Evidence:** the same full/focused matrices plus dist, import, API, wire-output, guarantee,
    security-test-build, and single-choke gates pass; the independent final-join proof retains the
    safe shell, exact fragment, matching CSP scripts, boundary, and close bytes.

- [x] **H19 - Mutable mutation-wire assembly can replace an authenticated response body.**
      `packages/server/src/{mutation-wire,mutation/wire-response,mutation/targets}.ts`
  - A selective late `Array.prototype.join` override targeting the final query/fragment chunk array
    replaced a genuine successful mutation delta with an attacker-authored `<kovo-fragment>` carrying
    raw event markup. The result retained status 200 and the framework wire-body brand/path.
  - **Acceptance:** header/target parsing, exact renderer/query selection, change and principal-
    transition classification, JSON/control escaping, chunk traversal/ordering, final body assembly,
    and failure/reauth redirects use boot-pinned, semantically checked controls; poison cannot replace
    wire bytes, cross-bind targets, or suppress required build/session transition metadata.
  - **Evidence:** the 194-test mutation/wire/guard matrix and server dist/DTS build pass; the
    independent final-join proof retains the genuine authenticated query truth.

- [ ] **H20 - Mutable client-module and render-plan controls can cross-bind immutable code or
      collapse build truth.** `packages/server/src/{client-modules,loader-runtime-client-module,vite-build}.ts`,
      `packages/core/src/internal/render-plan-token.ts`
  - A selective late `Map.prototype.get` override made the immutable URL registered for
    `/c/public.client.js@v1` return status 200 with the exact source bytes registered for the
    privileged sibling module instead.
  - A completeness proof after the registry checkpoint selectively replaced the final render-plan
    `Array.join`; projected shapes with and without an `adminToken` field then produced the same
    fingerprint, suppressing the required deploy-skew token change.
  - The compiler's production content version also used 32-bit FNV-1a. Two fixed distinct valid
    JavaScript sources both hashed to `62a4c465`, so separate real registries produced the same
    immutable href and build token while resolving different executable bytes.
  - **Acceptance:** module/path/version normalization, exact registry keys, Map/version tracking,
    entries, collision-resistant full-source identity, build-token hash inputs/crypto, URL request
    parsing, and runtime-href registration use boot-pinned, semantically checked controls; neither
    chosen collisions nor late/import-order poison can cross-bind module bytes, forge an unchanged
    build token, or alias unversioned/out-of-registry paths.
  - **Evidence:** the 106-test client-module/static-export/app matrix, 31-test core/compiler/server
    render-plan matrix, core/server dist+dts builds, and import/API/wire-output gates pass. The two
    independent proofs now retain exact public module bytes and distinct fingerprints for projected
    shapes with versus without the privileged field under selective Map/final-join replacement.
  - **Reopened:** `vite-build.ts::sourceVersion()` still used the live ESM `createHash` binding and
    mutable hash methods. A synchronized selective replacement made two distinct executable module
    sources receive the same default version, immutable href, and app build token; source hashing and
    its build traversal must join the pinned client-module membrane before this item can close.

- [x] **H21 - Mutable schema-validator traversal can skip every declared refinement.**
      `packages/server/src/schema.ts`
  - A selective late `Array.prototype[Symbol.iterator]` override returned an empty iterator only for
    the private string-check array. A closed `s.string().email().pattern('^[a-z]+$')` schema then
    accepted and returned `not an email!` without running either refinement.
  - **Acceptance:** scalar/string/date/file refinements, control/regex/linear-pattern checks,
    collection and shape-budget traversal, file accept/sniff constraints, numeric parsing, and error
    path construction use boot-pinned, semantically checked operations; late/import-order poison
    cannot skip, replace, or reorder any declared validation while genuine inputs remain compatible.
  - **Evidence:** the 222-test schema/upload/request/mutation/app matrix and merged server dist+dts
    build pass; the independent empty-iterator proof now raises `Expected email` before the invalid
    value can reach a mutation handler, with hostile import-order and active/polyglot files covered.

- [x] **H22 - Mutable page-hint assembly can replace escaped hints with raw script.**
      `packages/server/src/hints.ts`
  - A selective late `Array.prototype.join` override targeting the final hint array replaced a safe
    compiler-versioned modulepreload with `<script src="/attacker.js"></script>`. The returned raw
    hint HTML carried no matching CSP metadata and is inserted into the framework document head.
  - **Acceptance:** stylesheet/module/i18n/speculation inputs, exact URL classification, CSS parsing,
    dedupe/order maps, escaping, CSP hashes, Early Hints, and final HTML/header assembly use
    boot-pinned, semantically checked controls; late/import-order poison cannot replace or reorder
    bytes, admit unsafe URLs/CSS, or desynchronize output from its CSP metadata.
  - **Evidence:** the same matrices and gates pass; the independent selective final-join proof emits
    only the escaped compiler-versioned modulepreload and no attacker script bytes.

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

- [x] **H25 - The shipped inline loader can mint predictable mutation replay identifiers.**
      `packages/browser/src/{inline-loader-build,inline-loader,mutation-response}.ts`
  - The emitted `ci` helper falls back from `crypto.randomUUID` to `Date.now` plus a realm-local
    counter, violating the normative 128-bit cryptographic `Kovo-Idem` floor whenever random UUIDs
    are unavailable. Its live method lookup also lets a late replacement force a constant token,
    unlike the modular runtime's cryptographic `getRandomValues` fallback.
  - **Acceptance:** modular and emitted mutation submission share boot-pinned, semantically checked
    cryptographic sources, require at least 128 random bits, fail closed without one, and never use a
    clock/counter fallback; late/import-order crypto replacement cannot repeat or predict the token.
  - **Evidence:** 100 focused modular/generated-loader tests, inline artifact parity, and the browser
    dist+dts build pass; the four shipped inline variants retain pinned 128-bit bytes after live
    crypto replacement and reject hostile constant sources instead of consulting a clock.

- [x] **H26 - Mutable JSX form-helper replacement can inject raw executable response bytes.**
      `packages/server/src/{jsx-context,jsx-runtime}.ts`
  - Deferred `<FieldError>` output is first represented by a framework-private comment and then
    expanded inside a rendered `<form>`. A selective late `String.prototype.replace` recognized that
    comment and returned raw `<img onerror=...>` bytes; the framework wrapped the result as rendered
    HTML, so the event handler reached the response without output escaping.
  - **Acceptance:** request-local helper tokens and ids, registry construction/lookup/deletion,
    placeholder detection/parsing/assembly, exact helper kind/props binding, async render isolation,
    final form composition, and cryptographic token minting use boot-pinned semantically checked
    controls; late/import-order poison cannot add raw bytes or cross-bind one helper/form to another.
  - **Evidence:** the 140-test focused matrix passes; the independent selective replacement proof
    cannot replace the structured helper operation with attacker markup.

- [ ] **H27 - Truncated CSS hashes alias distinct deploy assets.**
      `packages/compiler/src/css.ts`
  - CSS split chunks truncated SHA-256 to 32 bits. Two fixed distinct valid CSS sources both emitted
    the real `/assets/base-36fabc25.css` path even though their complete bytes and CSP hashes differ,
    defeating the asset path's cache-busting/content-identity role across deployments.
  - **Acceptance:** CSS chunk identity uses a collision-resistant source digest with enough bits for
    immutable deployment identity, and manifest/href generation, CSP hashes, static output, and
    delivery accounting consume the same exact byte snapshot; fixed collision regressions produce
    distinct paths without weakening ordinary deterministic builds.

- [ ] **H28 - Mutable static-header storage injects deployable Set-Cookie.**
      `packages/server/src/{static-export-headers,static-export-output}.ts`
  - The static header sink validated `x-frame-options: DENY`, then committed it through live
    `Map.prototype.set`. A selective replacement stored `set-cookie: kovo_session=attacker-fixed`
    instead; the real export artifact retained it and the deployable `_headers` sidecar emitted it
    for the route, bypassing the explicit no-cookie static channel.
  - **Acceptance:** header source traversal, name/value normalization, reserved-name checks,
    append/set storage, exact map snapshots, sorting/serialization, fallback intersection, and
    sidecar assembly use boot-pinned controls; validation and commit consume the same key/value, and
    late/import-order poison cannot introduce Set-Cookie, Kovo-reserved, or control-bearing headers.

- [ ] **H29 - Inherited client IP state rotates per-IP rate-limit buckets.**
      `packages/server/src/guards.ts`
  - With no own `clientIp`, an inherited `Object.prototype.clientIp` was accepted as framework-
    resolved identity. Changing the inherited value between calls admitted two requests under
    `max: 1` by assigning each to a fresh bucket.
  - **Acceptance:** per-IP guards accept only a framework-owned own-data client-IP snapshot attached
    by the trusted request shell; inherited/accessor/proxy-unstable, blank, or unproven identities
    fail loud, and late mutation cannot rotate or cross-bind an established bucket.

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

The remediation pass remains intentionally non-zero: C23-C28, C31-C32, C36-C37, C41-C45, H20, and
H27-H29 are active compiler-cache, static-analysis, static-export, guard/session, and build-output
fixes.
Integrated
evidence is
green at
97 PostgreSQL, 88 egress, 37 filesystem/storage, 180 request-dispatch, 198 app/schema/document, 158
auth/response, 51 Better Auth, 86 crypto/replay, 234 output/compiler/core, and 87 scalar
route/handler/secret, and 18 password tests.
A complete fresh sweep of the final integrated tree is still required.
