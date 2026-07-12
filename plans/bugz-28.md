# Security Bug Ledger (`bugz-28`)

**Date:** 2026-07-11

**Scope:** Findings from the adversarial remediation pass run after `bugz-27` began landing. Each
item survived an executable exploit-shaped reproduction plus an independent source/test cross-check.
This is an active closure ledger; `SPEC.md` remains normative.

## Severity summary

| Severity | Count | Items  |
| -------- | ----: | ------ |
| Critical |    76 | C1-C76 |
| High     |    35 | H1-H35 |
| Medium   |    10 | M1-M10 |

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

- [ ] **C17 - Mutable task identifiers collapse queued identity and expired-lease authority.**
      `packages/server/src/task-queue.ts`
  - Replacing `Date.now` and `Math.random` with constants made two distinct memory-queue enqueues
    receive the same job id, so the second task silently replaced the first queued task and args.
    The same replacements repeated a lease token after expiry/reaping; a stale worker using the same
    owner then successfully marked the later lease complete.
  - **Acceptance:** job ids and per-claim lease fences use boot-pinned, semantically verified
    cryptographic entropy with at least 128 random bits; queue lookup, iteration, coalescing, claim,
    heartbeat, completion, retry, and reaping use exact pinned controls, and neither late nor
    import-order poison can overwrite a sibling job or reuse expired worker authority.
  - **Reopened evidence:** a selective pre-import `randomBytes` wrapper delegates both 16-byte boot
    probes, then returns known bytes for the first real call. The current task membrane accepts it and
    mints the predictable identity `job_6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b`; second-use replay
    detection cannot protect the first job or lease authority.

- [ ] **C18 - Mutable command-argument iteration can replace reviewed privileged execution.**
      `packages/server/src/command.ts`
  - `cmd()` froze the reviewed Node argv, but `runCommand()` later spread it through the live
    `Array.prototype[Symbol.iterator]`. A selective late iterator returned attacker `-e` source for
    that exact frozen array, and the real shell-free command door executed `substituted` instead of
    the reviewed program arguments.
  - **Acceptance:** allowlist lookup, program/argv construction and immutable snapshots, exact argv
    cloning, `execFile` identity, execution options, callback settlement, output conversion, and
    Promise controls are boot-pinned and semantically checked; late/import-order poison cannot alter
    any byte passed to the privileged process sink while genuine allowlisted commands still run.
  - **Reopened evidence:** a selective pre-import `execFile` wrapper includes the exact native-source
    strings required by the current self-check, delegates every ordinary call, and substitutes only
    the reviewed proof command. `runCommand()` accepts the controls and executes
    `ATTACKER-CODE-EXECUTED` instead of `SAFE`.

- [ ] **C19 - A synchronized Node crypto replacement can force AES-GCM IV reuse.**
      `packages/server/src/confidential-at-rest.ts`
  - Replacing CommonJS `node:crypto.randomBytes` with a constant function and calling
    `syncBuiltinESMExports()` updated the live ESM binding consumed by `encryptAtRest()`. Two distinct
    plaintexts under the same key/AAD then serialized the same 96-bit IV, violating GCM's nonce
    uniqueness requirement and endangering both confidentiality and authenticity.
  - **Acceptance:** random/cipher function identities, 96-bit IV generation and non-repetition
    controls, key/AAD/plaintext byte snapshots, cipher method dispatch, tag/ciphertext assembly, and
    envelope encoding use boot-pinned, semantically verified controls; late synchronized builtins and
    hostile pre-import sources cannot repeat an IV or return a branded non-authenticated envelope.
  - **Reopened evidence:** a selectively honest `randomBytes` wrapper delegates the two 32-byte
    boot probes but returns a known first 12-byte application IV. The current membrane accepts it
    and emits the predictable `a2tra2tra2tra2tr` IV; the replay window resets with the process and
    therefore does not prevent cross-restart nonce reuse under the same key.

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

- [ ] **C21 - Predictable pre-import entropy forges authenticated rendered-HTML markers.**
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
  - **Reopened evidence:** a selective pre-import `crypto.getRandomValues` delegates the membrane's
    12-byte control but returns known bytes for the real 32-byte marker key. The current full renderer
    accepts the resulting forged v2 HMAC marker and emits raw attacker SVG.

- [ ] **C22 - Predictable pre-import response entropy collapses upload object authority.**
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
  - **Reopened evidence:** a selectively honest `randomBytes` wrapper delegates both 32-byte boot
    probes and returns known bytes only for the first real 16-byte request. The current public upload
    path mints the predictable key
    `avatars/6b6b6b6b-6b6b-4b6b-ab6b-6b6b6b6b6b6b`; detecting its second repetition is too late to
    protect the first authority.

- [x] **C23 - Mutable static-route planning publishes guarded session content.**
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
  - **Evidence:** the 134-test integrated build/static-export matrix passes; the independent route
    iterator proof now throws KV229 before writing guarded account content.

- [x] **C24 - Mutable artifact staging replaces reviewed immutable client modules.**
      `packages/server/src/{output-staging,vite-client-module-output}.ts`
  - The output manifest hashed a reviewed safe client module, but staging later used the live
    `entries.map()` result without hashing the staged bytes. A selective replacement supplied
    attacker JavaScript only to the staging callback, and the real app-shell writer committed it
    under the reviewed immutable `/c/__v/build-1/account.client.js` target.
  - **Acceptance:** entry/source/content snapshots, target and manifest construction, hashing,
    changed/stale detection, staging traversal, copy/write, pre-commit revalidation, rename, cleanup,
    filesystem/path controls, and Promise settlement use boot-pinned exact operations; committed
    bytes must match their reviewed manifest hash and cannot be substituted after validation.
  - **Evidence:** the same matrix passes; the independent staging substitution proof commits only the
    manifest-reviewed safe client source.

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

- [x] **C26 - Mutable SRI finalization replaces a safe static document after rendering.**
      `packages/server/src/{static-export-sri,static-export}.ts`
  - A route installed a selective late `Array.prototype.map` that stayed inert through safe page
    rendering, then substituted a raw event-bearing document for the private `/index.html` artifact
    during SRI finalization. Real `exportStaticApp()` returned and wrote the executable HTML after
    the framework output choke; the unpoisoned export retained only the safe body.
  - **Acceptance:** artifact/asset/module snapshots, integrity hashing, opening-tag and attribute
    parsing, first-party URL resolution, replacement offsets/assembly, final artifact traversal, and
    publication use boot-pinned exact controls; SRI decoration cannot add or replace rendered bytes,
    and the final committed document is bound to the reviewed post-choke artifact.
  - **Evidence:** the same matrix passes; the independent finalization proof writes the reviewed safe
    document rather than the post-choke event-bearing substitute.

- [x] **C27 - Inherited Vite manifest fields publish unlisted server-private files.**
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
  - **Evidence:** the same matrix passes; the independent inherited-field proof emits no private
    manifest file.

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

- [x] **C36 - Mutable replay-response headers publish server-only file bytes as HTML.**
      `packages/server/src/{static-export-response,static-export-replay,static-export}.ts`
  - A route returned a genuine attachment containing a database password, then selectively replaced
    `Headers.prototype.get` so static replay hid only `Content-Disposition` and reported `text/html`.
    Real export accepted status 200 and wrote the file bytes to public `/private-report/index.html`;
    the unpoisoned route fails KV229.
  - **Acceptance:** response/status/header/body identity, header getters and exact snapshots,
    content-disposition/type/outcome classification, document-protocol scanning, diagnostics, and
    artifact publication use boot-pinned controls; file/stream/redirect/error outcomes cannot be
    reclassified as a route document under late/import-order poison.
  - **Evidence:** the same matrix passes; the independent header proof now throws KV229 for the
    attachment and never writes its secret body.

- [x] **C37 - Mutable Vite source containment publishes files outside the dist root.**
      `packages/server/src/{vite-manifest,vite-build-assets,static-export}.ts`
  - A normal manifest `file: "../server-secret.env"` is rejected. Selective late `Array.some`
    replacement bypassed unsafe-segment validation and `String.startsWith` replacement forged the
    final dist-root containment check; after restoring both, real static export copied the sibling
    `DATABASE_PASSWORD` file into public `/server-secret.env`.
  - **Acceptance:** manifest file segments, decoding, normalization, dist/output roots, URL/path
    conversion, relative/absolute containment, source descriptors, and asset copy inputs use boot-
    pinned exact controls; encoded/plain traversal, separator aliases, symlinks, and late/import-
    order poison cannot escape the trusted source root even when the destination remains confined.
  - **Evidence:** the same matrix passes; the independent traversal proof rejects the sibling secret
    before any public copy.

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

- [x] **C41 - Mutable static-export diagnostic filtering discards KV426 before publication.**
      `packages/server/src/{static-export-diagnostics,static-export}.ts`
  - The export gate used the live `Array.prototype.filter` to select error diagnostics. A selective
    replacement returned an empty list for a real KV426 trusted-HTML violation, so export continued
    and published the raw event-bearing HTML that the diagnostic was meant to block.
  - **Acceptance:** compiler diagnostic carriers, code/severity lookup, source locations, error
    selection, formatting, and handoff to export use boot-pinned dense own-data snapshots; malformed,
    omitted, inherited, or mutation-obscured diagnostics fail closed before any artifact write.
  - **Evidence:** the same matrix passes; the independent selective-filter proof retains the exact
    blocking KV426 diagnostic.

- [ ] **C42 - Mutable compiler-Vite diagnostic filtering emits code despite KV435.**
      `packages/compiler/src/vite.ts`
  - A selective late `Array.prototype.filter` removed the real KV435 secret-query error inside the
    Vite transform gate. The transform returned emitted server/client code instead of throwing, so a
    confidentiality diagnostic could be bypassed on the production compilation path.
  - **Acceptance:** compiler results, diagnostic arrays and fields, severity classification,
    callbacks, error collection, emitted-file traversal, and transform return/throw decisions use one
    boot-pinned exact snapshot; any ambiguous error diagnostic prevents emitted code from escaping.

- [x] **C43 - Mutable secret-read metadata returns a declared secret column unboxed.**
      `packages/server/src/secret-read-boundary.ts`
  - A selective late `Set.prototype.has` replacement hid the concrete `secrets.classified` origin
    only while SQLite provenance was classified. `createSecretBoxingReadDb(...).select()` then
    returned the raw `victim-secret` scalar instead of a runtime `Secret` box.
  - **Acceptance:** read metadata, query/SQL carriers, SQLite origin descriptors, selected fields,
    secret table/column membership, boundary merging, row traversal, and boxing consume boot-pinned
    dense snapshots; ambiguous or poisoned provenance boxes conservatively and never releases raw
    secret material.
  - **Evidence:** the 103-test secret/guard/session matrix plus server dist+DTS and classifier/TCB/
    security gates pass; the independent selective Set proof now returns a runtime `Secret` box.

- [x] **C44 - Mutable guard-chain classifiers and iterators skip every authorization guard.**
      `packages/server/src/{access,guards}.ts`
  - Selective private-array iterators made both `guards.all(denyA, denyB)` and `runGuardChain()` run
    zero guards and return allow. Independently, replacing live `Array.isArray` only for the
    snapshotted access decision made `runAccessDecisionGuards()` classify a real deny chain as a
    structured no-guard decision and return allow.
  - **Acceptance:** composition-time and execution-time guard carriers are dense immutable own-data
    snapshots; array/classifier decisions, audit projection, exact indexed traversal, await/settle,
    and denial normalization use boot-pinned controls, and any ambiguous chain denies rather than
    becoming public access.
  - **Evidence:** the same matrix and gates pass; all three independent `guards.all`,
    `runGuardChain`, and access-decision classifier proofs now execute the deny guard.

- [x] **C45 - Inherited session-provider envelope fields attach an attacker admin principal.**
      `packages/server/src/{guards,auth-principal}.ts`
  - A provider returned a plain victim/member session whose prototype supplied inherited `value`
    and `setCookies`. The lifecycle misclassified it as an envelope, attached the inherited
    attacker/admin value, forwarded a forged session cookie, and made the real admin role guard pass.
  - **Acceptance:** provider settlement and envelope discrimination require a plain exact own-data
    carrier; value/session/user/roles and cookie arrays are independently snapshotted and validated,
    inherited/accessor/proxy-unstable or malformed fields fail closed, and only the framework-owned
    settled session snapshot can establish principal authority.
  - **Evidence:** the same matrix and gates pass; the independent inherited-envelope proof retains
    the victim/member session, denies the admin guard, and forwards no forged cookie.

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

- [x] **C47 - Mutable component-root stamp replacement injects raw executable markup.**
      `packages/server/src/component-root-stamps.ts`
  - A query-backed component root with existing `kovo-c`/`kovo-deps` attributes reached the live
    `String.prototype.replace` used after attribute validation and escaping. A selective replacement
    substituted `><img onerror=...>` bytes, and the final stamped `RenderedHtml` emitted them raw.
  - **Acceptance:** component/option/query/prop metadata, dependency tokens, attribute parsing and
    replacement, target/props serialization, attestation inputs, and final root assembly consume
    boot-pinned dense own-data snapshots; token and visible descriptors bind the same exact values,
    and no late/import-order intrinsic replacement can add bytes after escaping.
  - **Evidence:** the 130-test component/route/layout stamp matrix and server dist+DTS build pass; the
    independent post-escape replacement proof retains the reviewed root and emits no attacker bytes.

- [x] **C48 - Mutable route/layout stamp replacement injects raw executable markup.**
      `packages/server/src/route.ts`
  - A compiled route page returned a reviewed rendered root with an existing navigation stamp. The
    route stamp sink called live `String.prototype.replace` after escaping; a selective replacement
    substituted `><img onerror=...>` and `renderRoutePageResponse()` published the raw handler.
  - **Acceptance:** compiled navigation/layout metadata, rendered-root parsing, dependency tokens,
    attribute lookup/replacement, and final opening-tag assembly use boot-pinned dense snapshots;
    page/region/layout stamps cannot add or replace post-choke bytes under late/import-order poison.
  - **Evidence:** the same matrix and build pass; the independent route-page replacement proof keeps
    the exact navigation stamp and emits no raw event-bearing markup.

- [x] **C49 - Mutable render-tree composition replaces escaped output at a trusted HTML sink.**
      `packages/server/src/render-tree.ts`
  - `renderTree()` escaped a literal text node and then concatenated its final parts through the live
    `Array.prototype.join`. A selective late replacement returned raw event-bearing markup, which the
    documented `trustedHtml(renderTree(...))` handoff emitted verbatim.
  - **Acceptance:** AST traversal, asynchronous component settlement, text output, and final
    composition use boot-pinned exact controls and dense own-data snapshots; no mutable application-
    realm intrinsic can add or replace bytes after escaping.
  - **Evidence:** the 32-test render-tree/double-escape matrix and server dist+DTS build pass; the
    independent late-join proof retains the exact escaped `safe-marker` bytes.

- [x] **C50 - Structural and mutable render registries dispatch unapproved components.**
      `packages/server/src/render-tree.ts`
  - The claimed closed registry was only a public structural object containing a public `Map`.
    Forging that shape or selectively replacing `Map.prototype.get` dispatched an event-bearing
    component absent from the reviewed registry input.
  - **Acceptance:** `renderRegistry()` proves component provenance, snapshots stable own-data entries,
    and mints a module-private registry witness; `renderTree()` dispatches only through that private
    immutable snapshot and rejects structural forgeries or ambiguous registry input.
  - **Evidence:** the same matrix/build pass with public-map mutation, late `Map.get`, forged registry,
    accessor entry, forged component, isomorphic component, cyclic AST, and depth-bound regressions;
    both independent unapproved-dispatch proofs now fail closed.

- [x] **C51 - Mutable XML parser controls retag untrusted input as an approved component.**
      `packages/server/src/render-tree.ts`
  - A selective late `String.prototype.slice` replacement changed the parsed tag from `evil` to
    `approved`. The closed registry then rendered the approved component even though those tag bytes
    never appeared in the untrusted source.
  - **Acceptance:** source scanning, name/entity decoding, parser state, node construction, and
    registry lookup consume boot-pinned exact values; late/import-order intrinsic replacement cannot
    retag, add, or remove source structure before dispatch.
  - **Evidence:** the same matrix/build pass with late slice, duplicate/prototype-named attribute,
    source/depth/attribute bounds, and parser exactness coverage; the independent retag proof
    leaves `<evil/>` unknown and emits no registered component output.

- [x] **C52 - Mutable static-export protocol decoding suppresses server-only markup diagnostics.**
      `packages/server/src/{static-export-protocol,static-export-document-refs,static-export}.ts`
  - Selective late string/collection replacements hid a browser-decoded `/_m/` mutation target from
    the KV229 scan. Static export then accepted a document whose encoded markup becomes a live
    server-only form endpoint in the browser.
  - **Acceptance:** entity decoding, marker extraction/classification, document reference snapshots,
    diagnostic formation, and the publish gate use boot-pinned exact controls; encoded or literal
    server endpoint/deferred markers always prevent every artifact write under late/import-order
    poison.
  - **Evidence:** the integrated matrix's real export regression keeps encoded `&#47;_m&#47;...`
    blocked by KV229 and proves no page is written under selective string/set poison.

- [x] **C53 - Mutable client-module inventory traversal publishes an unreferenced privileged module.**
      `packages/server/src/{static-export-document-refs,static-export-client-modules,static-export}.ts`
  - A selective late `Set.prototype.add` expanded the referenced-module set with a registered but
    unreferenced admin module. Real export wrote that executable module and its internal token into
    the public output even though no reviewed document referenced it.
  - **Acceptance:** registered and referenced module carriers, set membership/insertion, replay,
    source lookup, output targets, and final inventory traversal use boot-pinned dense snapshots;
    export writes exactly the client modules referenced by the accepted document and no others.
  - **Evidence:** the integrated real-export regression emits only the referenced public module and
    runtime; the registered unreferenced admin module and internal token remain absent.

- [x] **C54 - A mutable webhook verifier pin turns reviewed signed ingress into unsigned execution.**
      `packages/server/src/webhook.ts`
  - `webhook()` called the live `Object.defineProperty` to pin `definition.verify`, then retained that
    same public definition as runtime authority. A selective no-op replacement left the field
    writable; after declaration it was changed from a rejecting custom verifier to `'none'`. The
    endpoint still advertised pinned custom auth metadata, but a real unsigned request returned 200
    and executed the handler.
  - **Acceptance:** definition fields, verifier identity/configuration, schema, handler, idempotency,
    replay store, transaction, writes, and access posture are snapshotted through boot-pinned stable
    own-data controls at declaration; endpoint audit/auth metadata and dispatch consume one immutable
    witnessed authority snapshot, and post-construction mutation or late/import-order poison cannot
    waive verification or change executable/write posture.
  - **Evidence:** the 242-test webhook/app/endpoint/request matrix and server dist+DTS build pass; the
    independent full-app no-op pin proof now retains the rejecting custom verifier, returns 401 to
    the unsigned request, and never runs the handler after both definition and verifier mutation.

- [x] **C55 - Sanitized rich HTML can mint Kovo state and client-module execution authority.**
      `packages/browser/src/{security-output,query-bindings,dynamic-import-url,stream-text}.ts`
  - `safeRichHtml()` retained every `data-*` attribute, including `data-bind`, stream renderer
    controls, and `data-kovo-module-allowlist`. A real three-engine CMS fragment read a victim-local
    private state field into the attacker node, self-authorized an otherwise forbidden private client
    module, dispatched its renderer, and reached raw DOM output.
  - **Acceptance:** the sanitizer strips the complete reserved Kovo control/stamp vocabulary from
    untrusted rich markup while preserving ordinary inert `data-*`; sanitized bytes cannot create
    bindings, stream dispatch, module allowlists, handlers, morph targets, or any other framework
    authority under casing, namespace, or encoding aliases.
  - **Evidence:** the integrated 191-test browser/server source matrix and full 303-test
    Chromium/Firefox/WebKit suite pass; reserved binding, stream-renderer, module-allowlist, state,
    and mutation controls are stripped while inert CMS `data-*` remains.

- [x] **C56 - Mutable live-property classification turns a safe binding into `innerHTML` XSS.**
      `packages/browser/src/bind-prop.ts`
  - The compiler-emitted `data-bind-prop:open` path used live/inherited Object and String operations
    to resolve its closed allowlist. Selective late prototype pollution reclassified `open` as
    `innerHTML`; Chromium, Firefox, and WebKit all parsed the supplied image and executed `onerror`.
  - **Acceptance:** property normalization, exact allowlist lookup, coercion, and final assignment use
    boot-pinned own-data controls over one closed mapping; inherited/accessor/prototype mutation and
    late/import-order poison cannot select any property outside the reviewed live-property set.
  - **Evidence:** the same integrated source/three-engine matrices keep `open` bound to the exact
    reviewed boolean property and never assign `innerHTML` under inherited, late, or generated-inline
    allowlist mutation.

- [x] **C57 - Mutable fragment byte extraction replaces witnessed HTML with document authority.**
      `packages/browser/src/{wire-response-scanner,apply-mutation-response,morph,response-fragment-apply}.ts`
  - Selective late `String.slice` replaced safe inline fragment bytes before the rendered-fragment
    carrier was minted; independently, late `String.trim` replaced bytes after witnessed unwrap in
    modular morph. Both real three-engine paths inserted `<base href="https://attacker.example/">`
    and changed `document.baseURI` for subsequent relative requests.
  - **Acceptance:** wire tokenization, offsets, exact substring extraction, carrier mint/unwrap,
    normalization, template parsing, and morph insertion use one boot-pinned byte snapshot; no
    mutable intrinsic runs between authority validation and the final DOM sink, and ambiguous bytes
    fail closed without changing the document.
  - **Evidence:** the 191-test source matrix plus 303-test real-browser suite cover modular,
    generated-inline, streamed, private-witness, morph/template, and fetched live-target paths; the
    original base-URL substitutions and adjacent scanner/array poisons retain exact safe bytes or
    fail closed in all three engines.

- [ ] **C58 - Mutable secret-expression iteration releases unboxed confidential database values.**
      `packages/server/src/secret-read-boundary.ts`
  - After `createSecretBoxingReadDb()` pinned the generated secret metadata, a late
    `Array.prototype.every = () => true` replacement made a real derived expression over a secret
    column classify as safe without visiting that column. With an opaque SQLite result origin, the
    managed read boundary returned `victim-secret` as an ordinary string instead of a `Secret` box.
  - **Acceptance:** selected-field traversal, nested SQL-chunk classification, raw SQL text recovery,
    secret-table detection, and safe-expression grammar decisions use boot-pinned collection,
    string, and RegExp controls over framework-owned snapshots; late/import-order mutation cannot
    skip a secret source or turn an opaque expression into a safe verdict, while proven public
    expressions remain unboxed.

- [ ] **C59 - Mutable managed-builder traversal admits unreviewed raw SQL at the database sink.**
      `packages/server/src/sql-safe-handle.ts`
  - After `managedDb(raw, 'write')` installed the KV422 choke, a late `Array.prototype.map`
    replacement returned the original builder arguments without invoking the raw-SQL classifier. A
    genuine untrusted `@kovojs/drizzle` `sql.raw('(select classified from secrets)')` carrier reached
    the underlying builder instead of throwing before the sink.
  - **Acceptance:** builder arguments/callback results, native Drizzle carrier provenance,
    descriptor traversal, ambiguous-method statement detection, and direct write/read table
    classification use boot-pinned collection, reflection, string, and RegExp controls over exact
    snapshots; late/import-order mutation cannot skip nested raw SQL or change the classified bytes
    delivered to the adapter, while reviewed parameterized/static/trusted carriers remain usable.

- [ ] **C60 - Mutable SQL-table extraction hides an undeclared destructive write target.**
      `packages/server/src/sql-write-allowlist.ts`
  - A selective late `Array.prototype.map` replacement hid the second parsed QName in
    `TRUNCATE TABLE allowed, victim_accounts`. The managed writer was declared only for `allowed`,
    but the exact trusted statement reached the underlying `query` sink instead of raising KV406
    for `victim_accounts`.
  - **Acceptance:** SQLite normalization, parser AST traversal, nested statement/function-call
    discovery, target collection/deduplication, and table-name comparison use boot-pinned collection,
    reflection, string, and RegExp controls over one exact parsed snapshot; late/import-order
    mutation cannot omit a direct, nested, CTE, compound, or schema-qualified write target, while
    proven reads and fully declared writes retain their existing verdicts.

- [ ] **C61 - Mutable compiler provenance traversal suppresses request-derived raw-HTML errors.**
      `packages/compiler/src/validate/trusted-html-provenance.ts`
  - A selective late `Array.prototype.map` replacement returned no provenance facts for a
    TypeScript template-span array. The real compiler then treated
    ``trustedHtml(`<p>${request.body}</p>`)`` as locally clean, emitted no KV426 diagnostic, and
    allowed request-controlled raw HTML through the trusted escape instead of blocking the build.
  - **Acceptance:** render-binding discovery, alias/mutation tracking, expression/object/array/
    template traversal, trust-sink resolution, and diagnostic collection use boot-pinned
    collection/reflection/string controls over the parsed AST; late/import-order mutation cannot
    erase request/query/unprovable provenance or a blocking diagnostic, while static literals and
    explicit audited reasons retain their intended verdicts.

- [ ] **C62 - Mutable confidentiality traversal suppresses secret query-wire errors.**
      `packages/compiler/src/validate/confidentiality.ts`
  - A selective late `Array.prototype.flatMap` replacement erased the component query-name
    traversal. The real compiler emitted no KV435 diagnostic for a declared query shape containing
    `{ kind: 'secret', shape: 'string' }`, allowing the secret field to remain on the client query
    wire instead of blocking the build.
  - **Acceptance:** component query-name collection, missing-fact diagnostics, recursive shape/
    wrapper/object/array traversal, path assembly, and final diagnostic collection use boot-pinned
    collection/reflection/string controls over immutable shape facts; late/import-order mutation
    cannot erase a secret/table-row path or missing production fact, while explicitly revealed and
    public scalar shapes retain their intended verdicts.

- [ ] **C63 - Mutable compiler validator dispatch erases every blocking security diagnostic.**
      `packages/compiler/src/validate/pipeline.ts`
  - `collectCompilerDiagnostics()` dispatched the complete validator registry through live
    `Array.prototype.flatMap`. A selective late replacement returned an empty result for that
    registry, so the real compiler emitted no KV236 diagnostic for a literal
    `dangerouslySetInnerHTML` XSS sink—and likewise skipped every other validator in one step.
  - **Acceptance:** validator registry construction/order, invocation, result shape validation,
    diagnostic accumulation, and returned diagnostics use boot-pinned collection/reflection
    controls; late/import-order mutation cannot skip, replace, reorder, or erase any validator or
    blocking result, and a malformed/throwing validator fails the compile closed rather than
    yielding a partial green result.

- [ ] **C64 - Mutable request-stream reads substitute authenticated mutation body bytes.**
      `packages/server/src/app-load-shed.ts`
  - The pre-dispatch limited-body reader called live `ReadableStream.getReader`, reader
    `read`/`cancel`, collection, typed-array, and Promise controls before the hardened request parser.
    A selective late reader substitution changed an oversized body into `safe` (413 became 200);
    more critically, it replaced an invalid submitted CSRF token with a cached genuine victim token
    plus `action=delete-account`, and the real protected mutation handler executed.
  - **Acceptance:** request body acquisition, stream locking, chunk reads, byte accounting,
    cancellation/error propagation, typed-array reconstruction, and the exact `Request` handed to
    parsing use boot-pinned semantically checked controls over one immutable byte snapshot;
    late/import-order mutation cannot substitute/truncate/expand bytes, bypass 413, or turn an
    invalid CSRF mutation into handler execution, while genuine bounded streaming bodies retain
    backpressure and cancellation behavior.

- [ ] **C65 - Mutable client-capture analysis publishes a server secret import into browser code.**
      `packages/compiler/src/validate/client-capture.ts`
  - A stateful late `Array.prototype.filter` replacement skipped the unsafe-use classification for
    each handler-capture analysis while preserving the later referenced-import pass. The real
    compiler emitted no KV437 and generated a client module that literally imported
    `STRIPE_SECRET_KEY` from `../../config/secrets` and passed it to client code.
  - **Acceptance:** import/module-constant discovery, handler capture/use classification, shadowing,
    publish-to-client escape verification, blocked/referenced set construction, diagnostic output,
    and the lowering allowlist consume the same immutable boot-pinned analysis snapshot;
    late/import-order mutation cannot disagree between diagnostic and emission passes or publish any
    unreviewed value-position capture, while callee-only and explicitly published values retain the
    documented behavior.

- [ ] **C66 - Mutable output-context lookup suppresses dynamic script RAWTEXT errors.**
      `packages/compiler/src/security/output-context.ts`
  - A selective late `Array.prototype.find` replacement hid the matching JSX expression model for
    a real `<script>{cfg.inline}</script>` child. The compiler then emitted no KV236 diagnostic
    for query-controlled bytes in JavaScript RAWTEXT, where ordinary HTML text escaping is not a
    correct encoder.
  - **Acceptance:** JSX element/expression matching, direct-child and attribute/spread/primitive
    traversal, trusted-brand identity, URL/style/event/raw-HTML sink classification, and diagnostic
    collection use boot-pinned collection/string/RegExp controls over one typed model snapshot;
    late/import-order mutation cannot hide or reclassify a RAWTEXT/output sink, while static literal
    text and genuine reviewed trusted values retain their documented behavior.

- [ ] **C67 - Endpoint authentication verifies different body bytes than the handler executes.**
      `packages/server/src/endpoint.ts`
  - `runEndpointAuth()` read the verifier body through live `Request.prototype.arrayBuffer`. In a
    full public `createRequestHandler` proof, a custom verifier accepted only `signed-safe` while the
    submitted body was `dangerous`; late and pre-import reader substitutions supplied `signed-safe`
    only to auth, after which the handler read and executed `dangerous` and returned 200 instead of
    the control 401. Separately, selective live `Headers.prototype.get` substitution made endpoint
    and webhook verifiers see `accepted` while their handlers received the actual `attacker` header;
    both public request-handler paths changed from the control 401 to 200 and executed.
  - **Acceptance:** ingress method/URL/headers/body, size limiting, executable verifier input,
    CSRF/schema parsing, and handler reconstruction consume one framework-owned immutable request
    snapshot through boot-pinned semantically checked readers; no late/import-order mutation or
    clone/body-use ordering can make auth approve different bytes from those dispatched, across
    custom and HMAC verifier paths, including endpoint and webhook header authentication.

- [ ] **C68 - Mutable managed-DB allowlists admit undeclared writes and confidential reads.**
      `packages/server/src/managed-db.ts`
  - Selective late and pre-import `Set.prototype.has` replacements bypassed KV406 through the
    public composed `kovoDeclaredWriteDbHandle` + `managedDb(..., 'write')` path. A real
    `createSqliteAppRuntimeDb`/better-sqlite3 proof inserted the undeclared victim row; independently,
    public `readonlyDb.rawRead` plus the real SQLite authorizer returned `victim-secret` from an
    undeclared owner table instead of rejecting the observed table.
  - **Acceptance:** declared/observed/owner/admin table sets, normalization, policy/options/hook
    snapshots, engine-authorizer callbacks, rawRead/crossOwnerRead declarations, and final execution
    routing use boot-pinned collection/reflection/string controls over framework-owned immutable
    facts; late/import-order or caller-carrier mutation cannot admit any undeclared table, while
    fully declared reads/writes retain their existing behavior.

- [ ] **C69 - Finite pre-import self-probes accept selectively honest intrinsic impostors.**
      `packages/{core,compiler,server}/src/**/*intrinsics*.ts`
  - Source-text likeness and finite positive/negative vectors are not provenance. Selective wrappers
    can include the expected native-body strings, delegate only probe inputs, and alter authority
    inputs by byte value, size, receiver, call count, or path. Current executable proofs reopen
    rendered-HTML HMAC, GCM IV, and upload entropy guarantees; independent compiler proofs alias
    SHA-256 cache/module/CSS identities and omit an unsafe source directory while every intrinsic
    self-check reports sound.
  - **Acceptance:** establish the compiler/runtime TCB before any app/plugin evaluation or move
    authority computation to a genuinely isolated pristine service/realm with a fail-closed RPC
    contract; never accept Function source text or a finite semantic corpus as native provenance.
    Hash collisions must not authenticate cache entries (store and compare full canonical identity),
    and the first—not merely the second—entropy/identity result must remain unpredictable and exact.
    Selective lookalike pre-import tests must cover input-, size-, receiver-, call-count-, and
    path-specific wrappers plus process restarts.

- [x] **C70 - Authored runtime poisoning escapes the emitted Node static-file root.**
      `packages/server/src/build.ts` (`nodeServerSource`)
  - The generated Node wrapper continued to use live `globalThis.URL`,
    `String.prototype.startsWith`, decoding, path, collection, header, and body controls after it
    dynamically loaded the authored handler. A selective handler replacement preserved ordinary
    requests but returned the raw encoded traversal pathname and made both `containsPath` checks
    succeed. A second real HTTP request for `/assets/%2e%2e/%2e%2e/secret.txt` received a real file
    outside the emitted `client/` root with HTTP 200.
  - **Acceptance:** the emitted wrapper captures and validates every URL/path/decode/string/
    collection/header/filesystem/body control before the first handler import; static target
    parsing reconstructs one exact relative path, both lexical and realpath confinement consume
    pinned operations, and response emission cannot re-read mutable realm controls. The executable
    two-request regression must keep the outside marker byte-for-byte absent under selective
    constructor, receiver, path, and call-order replacements.
  - Evidence: `packages/server/src/build.test.ts` real-HTTP poison-first traversal regression and
    the 30-test preset matrix retain confinement under selective URL/path receiver replacements.

- [x] **C71 - Mutable source serialization compiles attacker code into deploy artifacts.**
      `packages/{cli,server}/src/{commands/build-export,build,internal/runtime-registry-wire}.ts`
  - Build and preset generators interpolated late `Function.prototype.toString`, `JSON.stringify`,
    and RegExp stringification results directly into executable JavaScript after authored app/config/
    plugin evaluation. A selective Function replacement returned attacker source only for
    `generatedNodeDiagnosticFactory`; `node().emit()` produced a green `server.mjs` containing
    `ATTACKER-CODE-RAN`, which executes at server startup. The same sink family can inject through
    stylesheet/runtime-registry/header JSON and immutable-asset pattern serialization across Node,
    Vercel, and Cloudflare artifacts.
  - **Acceptance:** generated JavaScript uses only reviewed literal source plus boot-pinned canonical
    serialization captured before caller code; no live function/RegExp source coercion or JSON
    serializer participates after that boundary. Every interpolated value is reconstructed as data,
    the complete generated module is parsed before output, and artifact identity binds its exact
    bytes. Selective serializer tests must target each input shape and prove attacker syntax/side
    effects are absent from emitted source and startup across all three presets.
  - Evidence: `vp test run packages/server/src/{build-security-intrinsics,build}.test.ts --config
vitest.bugz.config.ts` passes 32 tests; the all-preset late JSON/Function/RegExp poison proof
    syntax-checks every generated module, validates exact SHA-256 manifests, and imports Node,
    Vercel, and Cloudflare output without the attacker marker.

- [x] **C72 - Mutable final Response getters substitute attacker output after rendering.**
      `packages/server/src/{node,build}.ts` (`writeWebResponseToNode`, `nodeAdapterRuntimeSource`)
  - The source and emitted Node/Vercel adapters captured `Headers` but re-read
    `response.headers`, `status`, `statusText`, and `body` through live Response prototype getters
    after authored handler execution. A selective replacement targeting only the real safe Response
    changed a real HTTP result from status 200/plain `SAFE-RESPONSE` into status 201, attacker HTML,
    and an attacker `Set-Cookie` header after every framework output choke had completed.
  - **Acceptance:** capture the native Response accessors before authored code, read every field once
    into one framework-owned exact snapshot, clone/pin the full multi-value header bag, and drive
    compression, early hints, status/head, body/null/stream selection, and Node writes only from that
    snapshot. Source and emitted adapters must share the same contract and real-HTTP regressions must
    prove selective getter/body/header substitutions cannot alter any wire byte.
  - Evidence: source and emitted real-HTTP Response getter poison regressions in
    `packages/server/src/{node,build}.test.ts` retain status 200, plain safe bytes, and no attacker
    `Set-Cookie`; the shared Node/Vercel adapter is exercised by the preset matrix.

- [ ] **C73 - Vite plugin evaluation precedes the compiler/data-plane trust root.**
      `packages/server/src/vite.ts` and the supported development runner
  - The Vite plugin did not load compiler and server data-plane intrinsics until its
    `configResolved` hook. Authored config modules, plugin modules, and every earlier `config` hook
    therefore ran first and could install selectively honest hash, iterator, reflection, or path
    impostors before the compiler captured its controls. Loading the server root during request
    dispatch is later still and cannot repair the already-poisoned compiler instance.
  - **Acceptance:** the supported Vite development runner establishes the exact compiler and
    data-plane security profile before evaluating the authored config or any plugin module/hook,
    including under Vite SSR module instantiation. A real `vp dev` poison-first regression must
    prove a caller plugin cannot alias an identity, omit an unsafe input, or suppress a blocking
    diagnostic while ordinary HMR and SSR retain their behavior.

- [ ] **C74 - CLI build/export evaluate authored Vite graphs before exact-graph bootstrap.**
      `packages/cli/src/commands/{build,build-export}.ts`
  - Build permitted the authored Vite config/plugins to execute before the server build profile in
    the `ssr.noExternal` graph. Export additionally loaded the app and server root with
    `Promise.all`, so the app could win evaluation. A native CLI preload does not protect a separate
    Vite-instantiated copy of compiler/server modules.
  - **Acceptance:** build and export disable undeclared config/plugin evaluation where the command
    does not require it, then sequentially load the complete compiler/server profile inside the
    exact SSR graph before the app entry. Real CLI poison-first regressions must cover config hooks,
    module-graph duplication, and app/server races and prove emitted bytes and blocking diagnostics
    remain exact.

- [x] **C75 - Mutable Node response writers replace pinned output at the native transport.**
      `packages/server/src/{node,build}.ts`
  - The source and emitted Node/Vercel adapters pinned the Web `Response` fields but invoked live
    `ServerResponse.prototype.writeHead`, `end`, `writeEarlyHints`, and `destroy` controls after the
    authored handler returned. A handler can therefore preserve every framework classification and
    snapshot, then substitute attacker status, headers, cookies, or body at the final native write.
  - **Acceptance:** capture the complete Node response transport before authored evaluation, choose
    any host-owned per-instance test/embedding overrides before dispatch, and invoke every head,
    interim-header, body, termination, and abort operation only through that pinned transport.
    Source, generated Node, and Vercel real-HTTP regressions must prove selective prototype and
    per-call replacements cannot change any wire byte or convert a failed write into a clean 200.
  - Evidence: source, emitted Node, and Vercel real-HTTP transport-poison tests in
    `packages/server/src/{node,build}.test.ts` retain exact safe status/headers/body; the mid-stream
    failure proof remains an aborted transfer rather than a clean attacker-controlled 200.

- [x] **C76 - Mutable Node request bridging substitutes authenticated network bytes.**
      `packages/server/src/{node,build}.ts`
  - After an app had evaluated, subsequent Node requests were converted through live
    `Object.entries`, Array/iterator, String, `Readable.toWeb`, AbortController, and request-property
    controls. A first request could selectively rewrite the next request's own `Origin`, Cookie,
    authorization, method, or body while the framework believed it was classifying transport bytes;
    the source and generated adapters shared the same bridge.
  - **Acceptance:** snapshot the raw method/target/version/header bag, request stream, disconnect
    signal, and trusted-origin inputs through boot-pinned Node/Web controls before authored dispatch;
    reconstruct one Request from that exact snapshot and retain it for all verifier/handler sinks.
    Two-request source, emitted Node, and Vercel regressions must prove selective entry/iterator/
    constructor/body/property replacements cannot turn a cross-origin or unauthenticated wire
    request into an admitted one.
  - Evidence: `vp test run packages/server/src/{node,build}.test.ts --config vitest.bugz.config.ts`
    passes 64 source/emitted real-HTTP and HTTP/2 tests, including CSRF Origin, body/constructor,
    native getter, Node output, and Vercel output poison-first regressions; `packages/server` `vp run
build:dist` passes.

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
  - **Remaining:** the server Vite source-version path now pins full source identity and the
    independent synchronized-crypto proof produces distinct hrefs. The core/compiler 32-bit FNV
    collision remains open, so this combined item cannot close yet.

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

- [x] **H28 - Mutable static-header storage injects deployable Set-Cookie.**
      `packages/server/src/{static-export-headers,static-export-output}.ts`
  - The static header sink validated `x-frame-options: DENY`, then committed it through live
    `Map.prototype.set`. A selective replacement stored `set-cookie: kovo_session=attacker-fixed`
    instead; the real export artifact retained it and the deployable `_headers` sidecar emitted it
    for the route, bypassing the explicit no-cookie static channel.
  - **Acceptance:** header source traversal, name/value normalization, reserved-name checks,
    append/set storage, exact map snapshots, sorting/serialization, fallback intersection, and
    sidecar assembly use boot-pinned controls; validation and commit consume the same key/value, and
    late/import-order poison cannot introduce Set-Cookie, Kovo-reserved, or control-bearing headers.
  - **Evidence:** the integrated matrix passes; the independent Map substitution proof retains the
    reviewed X-Frame-Options header and emits no Set-Cookie in either artifact metadata or `_headers`.

- [x] **H29 - Inherited client IP state rotates per-IP rate-limit buckets.**
      `packages/server/src/guards.ts`
  - With no own `clientIp`, an inherited `Object.prototype.clientIp` was accepted as framework-
    resolved identity. Changing the inherited value between calls admitted two requests under
    `max: 1` by assigning each to a fresh bucket.
  - **Acceptance:** per-IP guards accept only a framework-owned own-data client-IP snapshot attached
    by the trusted request shell; inherited/accessor/proxy-unstable, blank, or unproven identities
    fail loud, and late mutation cannot rotate or cross-bind an established bucket.
  - **Evidence:** the same matrix and gates pass; the independent inherited-IP proof now fails loud
    before allocating any attacker-selected bucket.

- [x] **H30 - Mutable Vite-dev HMR injection replaces a reviewed document with raw script.**
      `packages/server/src/vite-dev.ts`
  - After a Node app-shell handler returned a safe HTML document, dev HMR injection used live
    `String.prototype.replace` on `</head>`. A selective replacement returned only an attacker
    `<script>` body, which the real Vite middleware served as the document response.
  - **Acceptance:** response/content-type classification, fragment exclusion, HMR-script presence,
    closing-head location, slicing, and final document assembly use boot-pinned controls; evaluated
    app code cannot replace or add post-choke bytes during dev middleware injection.
  - **Evidence:** the 21-test Vite-dev matrix and touched-file format/lint/type check pass; the
    independent real-middleware proof now retains the reviewed document and inserts only Kovo's
    fixed HMR module before `</head>` under the same selective replacement.

- [x] **H31 - Mutable navigation equality retains revoked privileged segment content.**
      `packages/browser/src/enhanced-navigation.ts`
  - Enhanced navigation compared cloned segment `outerHTML` through the live DOM getter. A selective
    replacement made changed same-build/same-session page segments appear equal; all three engines
    advanced history while retaining `PRIVILEGED-OLD` and dropping the incoming `ACCESS-REVOKED`
    content.
  - **Acceptance:** fetched/current segment identity and equality consume stable framework-owned
    snapshots with boot-pinned DOM/string controls; changed or ambiguous segments morph/replace (or
    fail closed to full navigation), and prototype poisoning cannot preserve stale privileged DOM.
  - **Evidence:** full Chromium/Firefox/WebKit runs pass late and pre-initialization selective
    `outerHTML`/`cloneNode` regressions, Kovo-shaped intrinsic self-controls, changed-segment
    replacement, and fetched live-target reconstruction; revoked content is not retained.

- [ ] **H32 - Mutable query-result capping publishes unbounded attacker-expanded responses.**
      `packages/server/src/query.ts`
  - The API4 result ceiling used live `Array.isArray`, `slice`, `map`, `push`, WeakMap, and object
    traversal. Selective late mutation made a real `renderQueryEndpointResponse()` publish row 101
    without the `QUERY_LIST_LIMIT` warning; independently, one source row expanded to 10,000 rows
    after the cap decision.
  - **Acceptance:** result shape recognition, graph/cycle traversal, list truncation, reconstruction,
    amplification accounting, and warning emission use boot-pinned collection/reflection controls
    over one bounded framework-owned snapshot; late/import-order mutation cannot exceed the API4
    list/depth/node/byte ceilings or suppress the corresponding warning, while in-bound results
    retain their wire shape.

- [x] **H33 - Authored Cloudflare handler initialization can suppress static security headers.**
      `packages/server/src/build.ts` (`cloudflareWorkerSource`)
  - The emitted Worker statically imported the authored handler before initializing its wrapper,
    then applied cache/CORP/nosniff/error policy through live URL, String, Headers, Object, and
    Response controls. A handler top-level replacement of `Headers.prototype.set` selectively
    dropped `X-Content-Type-Options`; a real ASSETS response was returned without `nosniff`.
  - **Acceptance:** the Worker captures its complete static-policy control set before dynamically
    importing the handler, classifies one pinned request URL/method, reconstructs policy headers
    without live caller-controlled iteration or setters, and returns an exact response under
    selective late constructor/prototype replacements. The emitted-worker regression must retain
    the full client-module, immutable/revalidating asset, document, and error header matrices.
  - Evidence: the emitted-worker top-level `Headers.set` poison regression in
    `packages/server/src/build.test.ts` retains the complete static security-header matrix; the
    30-test preset suite passes.

- [ ] **H34 - The supported integration runner races fixture evaluation against bootstrap.**
      `packages/test/src/integration/boot-fixture.ts`
  - The fixture app and server root were loaded concurrently through the same `ssr.noExternal`
    server. An authored fixture could evaluate first and poison the runner's server/compiler
    controls before their trust root existed, making conformance/security tests order-dependent.
  - **Acceptance:** load the complete server/compiler profile sequentially in the exact Vite SSR
    graph before the fixture entry. A poison-first fixture regression must prove app evaluation
    cannot influence captured controls while the normal integration suite retains its behavior.

- [x] **H35 - Mutable compression classification re-enables compression for secret responses.**
      `packages/server/src/node.ts`
  - The final Node adapter cloned the response but classified `Cache-Control`, `Vary: Cookie`,
    content types, and `Accept-Encoding` through live RegExp, String, Array, Map, Number, and Math
    controls after the authored handler returned. Selectively hiding the `cookie` token made the
    default adapter compress a cookie-varying response that its BREACH-style confidentiality floor
    had classified as sensitive.
  - **Acceptance:** sensitive-response, media-type, negotiation, and `Vary` parsing consume only
    boot-pinned scalar/collection controls over the exact response/request snapshots; malformed or
    ambiguous values fail closed to no compression. Late and import-order poison regressions must
    retain no compression for private, no-store, no-transform, Set-Cookie, and Vary-Cookie outputs
    while ordinary q-value negotiation remains exact.
  - Evidence: the 35-test Node adapter suite passes the late collection poison proof plus private,
    no-store, no-transform, Set-Cookie, Vary-Cookie, malformed q-value, and ordinary negotiation
    cases.

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

- [ ] **M10 - Mutable PostgreSQL SQL scanning admits app principal-control statements.**
      `packages/server/src/managed-db.ts`
  - Late and pre-import `RegExp.prototype.test` replacements made the public
    `createPostgresScopedClient` accept app SQL containing
    `pg_catalog.set_config('kovo.principal', ...)` after the framework established the request
    principal. The default real PGlite runtime still denied function execution through its revoked
    ACL, so this is a scanner-boundary failure with a separate engine defense rather than a proven
    default principal swap.
  - **Acceptance:** SQL comment/literal/identifier/statement scanning, command allowlists,
    transaction-control grammar, and framework-setting rejection use boot-pinned string/RegExp/Set
    controls over the exact query snapshot; late/import-order mutation cannot admit any spelling or
    schema qualification of `set_config`/role/session control, while genuine parameterized app SQL
    remains executable.

## Latest verification

The remediation pass remains intentionally non-zero: C17-C19, C21-C22, C25, C28, C31-C32, C42,
C58-C76, H20, H27, H32-H35, and M10 are active compiler-cache, static-analysis, server authority/output,
and immutable-output fixes. Integrated evidence is green at 97 PostgreSQL, 88 egress, 37
filesystem/storage, 180 request-dispatch, 198 app/schema/document, 158 auth/response, 51 Better Auth,
86 crypto/replay, 234 output/compiler/core, 87 scalar route/handler/secret, and 18 password tests. A
complete fresh sweep of the final integrated tree is still required.
