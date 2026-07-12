# Security Bug Ledger (`bugz-28`)

**Date:** 2026-07-11

**Scope:** Findings from the adversarial remediation pass run after `bugz-27` began landing. Each
item survived an executable exploit-shaped reproduction plus an independent source/test cross-check.
This is an active closure ledger; `SPEC.md` remains normative.

## Severity summary

| Severity | Count | Items   |
| -------- | ----: | ------- |
| Critical |   253 | C1-C253 |
| High     |    35 | H1-H35  |
| Medium   |    12 | M1-M12  |

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
  - **Reopened evidence:** a selective pre-import `randomBytes` wrapper delegates both 16-byte boot
    probes, then returns known bytes for the first real call. The current task membrane accepts it and
    mints the predictable identity `job_6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b`; second-use replay
    detection cannot protect the first job or lease authority.
  - Resolution evidence: the supported bootstrap now captures task entropy before the app graph;
    `security-bootstrap-selective.test.ts` proves the same length/call-selective first identity is
    unpredictable, and the 156-test entropy/command/output matrix passes queue and lease fences.

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
  - **Reopened evidence:** a selective pre-import `execFile` wrapper includes the exact native-source
    strings required by the current self-check, delegates every ordinary call, and substitutes only
    the reviewed proof command. `runCommand()` accepts the controls and executes
    `ATTACKER-CODE-EXECUTED` instead of `SAFE`.
  - Resolution evidence: the command-capable supported profile captures the sink before authored
    evaluation; the selective exact-argv `execFile` replacement proof returns only `SAFE`, and the
    156-test focused matrix passes genuine allowlisted execution and fail-closed controls.

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
  - **Reopened evidence:** a selectively honest `randomBytes` wrapper delegates the two 32-byte
    boot probes but returns a known first 12-byte application IV. The current membrane accepts it
    and emits the predictable `a2tra2tra2tra2tr` IV; the replay window resets with the process and
    therefore does not prevent cross-restart nonce reuse under the same key.
  - Resolution evidence: bootstrap-first capture precedes synchronized builtin mutation; the
    selective first 12-byte IV proof remains unpredictable and the confidential-at-rest suite
    passes synchronized replacement, non-repetition, byte snapshot, and envelope cases.

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
  - **Reopened evidence:** a selective pre-import `crypto.getRandomValues` delegates the membrane's
    12-byte control but returns known bytes for the real 32-byte marker key. The current full renderer
    accepts the resulting forged v2 HMAC marker and emits raw attacker SVG.
  - Resolution evidence: the supported server bootstrap captures capability entropy before the
    renderer/app graph; the same length-selective forged-marker proof remains escaped, direct
    corrupted pre-bootstrap controls fail closed, and the focused HTML/output matrix passes.

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
  - **Reopened evidence:** a selectively honest `randomBytes` wrapper delegates both 32-byte boot
    probes and returns known bytes only for the first real 16-byte request. The current public upload
    path mints the predictable key
    `avatars/6b6b6b6b-6b6b-4b6b-ab6b-6b6b6b6b6b6b`; detecting its second repetition is too late to
    protect the first authority.
  - Resolution evidence: bootstrap-first capture now precedes every supported app graph; the same
    first 16-byte selective upload proof is unpredictable, and the response/upload/CSRF/deferred
    suites pass required bit floors, non-repetition, and late synchronized builtin replacements.

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

- [x] **C25 - Mutable compiler-cache hashing authenticates attacker compiler output.**
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
  - **Evidence:** the 114-test compiler/cache/data-plane/build-order matrix rejects synchronized
    persistent-blob tampering and in-memory source-digest aliasing; poisoned state only misses.

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

- [x] **C28 - Mutable static-analysis cache hashing suppresses unsafe SQL findings.**
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
  - **Evidence:** the 114-test matrix retains KV422 for the unsafe same-path source under selective
    hash replacement and never replays the cached safe fact set.

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

- [x] **C31 - Mutable build-source filtering suppresses every data-plane finding.**
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
  - **Evidence:** the 114-test matrix includes the real cache-disabled source-filter proof; the
    poisoned build retains the unsafe source and fails with KV422 rather than emitting `CHECK ok`.

- [x] **C32 - Mutable handler fingerprints bind safe authority facts to unsafe runtime code.**
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
  - **Evidence:** the 114-test matrix keeps the unsafe Cookie-reading `csrf:false` handler distinct
    under synchronized hash/canonicalization poison and retains the blocking KV418 diagnostic.

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

- [x] **C42 - Mutable compiler-Vite diagnostic filtering emits code despite KV435.**
      `packages/compiler/src/vite.ts`
  - A selective late `Array.prototype.filter` removed the real KV435 secret-query error inside the
    Vite transform gate. The transform returned emitted server/client code instead of throwing, so a
    confidentiality diagnostic could be bypassed on the production compilation path.
  - **Acceptance:** compiler results, diagnostic arrays and fields, severity classification,
    callbacks, error collection, emitted-file traversal, and transform return/throw decisions use one
    boot-pinned exact snapshot; any ambiguous error diagnostic prevents emitted code from escaping.
  - **Evidence:** the 114-test matrix preserves the real KV435 error under selective diagnostic
    filtering and the Vite transform throws without returning server or client code.

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

- [x] **C58 - Mutable secret-expression iteration releases unboxed confidential database values.**
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
  - **Evidence:** the integrated 432-test managed/secret/app/Postgres matrix passes the real SQLite
    late-`Array.every` derived-secret proof; the result remains boxed and public expressions remain
    ordinary values.

- [x] **C59 - Mutable managed-builder traversal admits unreviewed raw SQL at the database sink.**
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
  - **Evidence:** the same 432-test matrix rejects the original late-map raw-SQL carrier before the
    adapter and covers nested Drizzle expressions, CTEs, relational builders, and unknown methods.

- [x] **C60 - Mutable SQL-table extraction hides an undeclared destructive write target.**
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
  - **Evidence:** the 128-test SQL allowlist/query/ingress matrix retains both targets in the exact
    selective-map `TRUNCATE allowed, victim_accounts` proof and raises KV406 for the victim table.

- [x] **C61 - Mutable compiler provenance traversal suppresses request-derived raw-HTML errors.**
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
  - **Evidence:** the 114-test matrix retains KV426 for the request-derived template under the exact
    selective provenance-map replacement while static reviewed HTML remains valid.

- [x] **C62 - Mutable confidentiality traversal suppresses secret query-wire errors.**
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
  - **Evidence:** the 114-test matrix retains the secret path and KV435 under the exact selective
    `flatMap` replacement, with explicitly revealed/public shapes still green.

- [x] **C63 - Mutable compiler validator dispatch erases every blocking security diagnostic.**
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
  - **Evidence:** the 114-test matrix invokes every pinned validator and retains the literal
    `dangerouslySetInnerHTML` KV236 diagnostic under registry-dispatch poison.

- [x] **C64 - Mutable request-stream reads substitute authenticated mutation body bytes.**
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
  - **Evidence:** the 9-test request-body/pre-import ingress matrix rejects the reader-substituted
    CSRF mutation and oversized-body bypass while retaining bounded stream and cancellation cases.

- [x] **C65 - Mutable client-capture analysis publishes a server secret import into browser code.**
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
  - **Evidence:** the 114-test matrix retains KV437 and emits no browser import of
    `STRIPE_SECRET_KEY` under the original stateful filter replacement.

- [x] **C66 - Mutable output-context lookup suppresses dynamic script RAWTEXT errors.**
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
  - **Evidence:** the 114-test matrix retains KV236 for the dynamic `<script>` child under the exact
    selective expression lookup replacement while static literal RAWTEXT remains supported.

- [x] **C67 - Endpoint authentication verifies different body bytes than the handler executes.**
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
  - **Evidence:** the 128-test ingress/endpoint/webhook matrix plus 9 pre-import/body tests keep the
    verifier and handler on the same exact body/header snapshot; both late and pre-import
    `signed-safe` substitutions remain 401 and do not execute the dangerous handler.

- [x] **C68 - Mutable managed-DB allowlists admit undeclared writes and confidential reads.**
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
  - **Evidence:** the 432-test managed/secret/app/Postgres matrix rejects the real poisoned-Set
    SQLite write/read proof; an independent file-backed replay confirms forged public hooks cannot
    expose the secret or insert the undeclared row.

- [x] **C69 - Finite pre-import self-probes accept selectively honest intrinsic impostors.**
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
  - **Evidence:** the compiler/cache/build-order matrix passes 114/114; runtime/compiler selective
    bootstrap proofs pass 8/8; and the real `kovo dev` suite passes 10/10 with two-process entropy
    and build identity checks under input/size/receiver/call-count/path-specific impostors.

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

- [x] **C73 - Vite plugin evaluation precedes the compiler/data-plane trust root.**
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
  - **Evidence:** `kovo dev` now preloads and locks the exact compiler/server profile before any
    optional config; the 10 CLI HTTP/process tests and 27 server Vite/data-plane tests pass under
    poisoned config, plugin, Promise, collection, resolver, and environment controls.

- [x] **C74 - CLI build/export evaluate authored Vite graphs before exact-graph bootstrap.**
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
  - **Evidence:** the 114-test compiler/cache/data-plane/build-order matrix proves build/export ignore
    undeclared throwing Vite config and preload the exact graph sequentially; CLI dist/DTS builds.

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

- [x] **C77 - Drizzle relational queries bypass the managed secret-read boundary.**
      `packages/server/src/secret-read-boundary.ts`
  - `createSecretBoxingReadDb()` governs callable top-level builder methods but returned the
    non-function `db.query` namespace unchanged. A real better-sqlite3 database wrapped around
    `drizzle({ client, relations })` therefore let `db.query.secrets.findMany()` return the ordinary
    `{ classified: 'victim-secret' }` row with a raw string instead of a `SecretValue`.
  - **Acceptance:** recursively snapshot and govern relational query namespaces, table builders,
    terminal methods, prepared/placeholder execution, nested relation output, and exact SQL/origin
    metadata; every secret-bearing relational result is boxed or fails closed, and no non-function
    namespace can escape the read boundary merely because it was reached through a property.
  - **Evidence:** the 27-test real better-sqlite3/PGlite boundary suite plus an independent
    cross-engine precision pass box secret fields across direct, nested, extras, sync, and prepared
    terminals while preserving public fields and correct findFirst/findMany result shapes. The
    separately reproduced raw relational session escape is tracked as C86.

- [x] **C78 - Mutable response-policy closure replaces reviewed mutation failure HTML.**
      `packages/server/src/app-mutation-responses.ts`
  - A selective ambient `Object.freeze` replacement captured the normalized response policy during
    `createApp()`, returned it unfrozen, and later replaced its reviewed `renderFailurePage`. A real
    invalid no-JS mutation then returned raw attacker `<img onerror=...>` bytes in the 422 document
    instead of the safe compiler-reviewed page, despite the aggregate claiming to be closed.
  - **Acceptance:** policy registry traversal, supported-field checks, stable descriptor reads,
    nested renderer/stylesheet arrays, redirect snapshots, object/array construction, and every
    freeze use boot-pinned semantically checked controls; late/import-order collection or Object
    poison cannot retain or mutate any post-validation output authority.
  - **Evidence:** the 21-test app-mutation response matrix passes; an independent worktree rerun of
    the raw failure-page exploit plus adjacent Object/Reflect/Array/Set poison cannot capture the
    policy, retains the safe 422 page, rejects unknown/CSRF fields, and keeps every nested snapshot
    frozen.

- [x] **C79 - Parameter-bearing prepared reads skip secret classification.**
      `packages/server/src/secret-read-boundary.ts`
  - The managed read proxy treated a terminal as classifiable only when invoked with zero arguments.
    A real Drizzle better-sqlite3 prepared select invoked as `prepared.all({})` therefore inherited an
    empty boundary; an aliased `secrets.classified AS derived` result returned the ordinary raw
    string because the empty boundary did not know the alias. Placeholder-bearing `get` and
    positional `values` share the leak; `execute` currently boxes only through a later thenable path
    and still needs an explicit exact-snapshot regression at the same boundary.
  - **Acceptance:** every prepared terminal classifies and executes one exact SQL/parameter snapshot
    regardless of argument count, or fails closed to deep secret boxing; placeholder values cannot
    turn a terminal into an ordinary chain method or desynchronize column origins from execution.
  - **Evidence:** the same real-engine matrix covers parameter-bearing all/get/values/execute and
    relational prepare/execute; aliases and secret fields are boxed, public-only projections remain
    public, and genuine thenable/result semantics are retained.

- [x] **C80 - SQLite relational `sync()` is an unclassified read terminal.**
      `packages/server/src/secret-read-boundary.ts`
  - The managed read terminal allowlist omitted Drizzle's supported relational
    `.sync(placeholderValues)`. A real better-sqlite3 query that excluded the physical secret column
    but exposed `classified AS derived` through `extras` returned the raw derived string through
    `sync({})`; recursively wrapping `db.query` alone would therefore leave this second escape.
  - **Acceptance:** recognize `sync` as a terminal, bind its placeholder values to one exact SQL and
    origin snapshot, deep-box aliases/nested relations, and fail closed when exact classification is
    unavailable; the terminal cannot inherit an empty boundary merely because it is synchronous.
  - **Evidence:** real better-sqlite3 `sync({})` extras/alias coverage in the 27-test boundary suite
    returns boxed secret-derived values; the independent full-file rerun passes.

- [x] **C81 - Mutable URLSearchParams iteration substitutes guarded query capability bytes.**
      `packages/server/src/{query,request-body-intrinsics}.ts`
  - A selective late `URLSearchParams.prototype[Symbol.iterator]` replacement changed the submitted
    `attacker-submitted` token into a cached valid victim capability before schema validation and
    guards. The real typed-read endpoint returned status 200 with `victim-account` even though those
    bytes were absent from the request carrier.
  - **Acceptance:** native URLSearchParams detection, entry iteration, iterator settlement, record
    and generic-pair traversal, duplicate handling, query-string reconstruction, and guard-failure
    current URLs consume one bounded exact snapshot through boot-pinned controls; late/import-order
    poison cannot substitute or cross-bind any query key/value while genuine repeated parameters
    retain their existing schema behavior.
  - **Evidence:** 47 focused query/input tests plus an independent cached-capability, stateful generic
    iterable, dense-array, and native URLSearchParams poison matrix keep the attacker bytes bound to
    schema, guards, loader, and current URL; the server distribution build passes.

- [x] **C82 - Mutable route search carriers substitute cached capability bytes.**
      `packages/server/src/{app-document,request-body-intrinsics}.ts`
  - A late `URL.prototype.searchParams` getter and `URLSearchParams.prototype[Symbol.iterator]`
    replacement changed a route request's submitted `attacker-submitted` token into a cached victim
    capability before route search validation. The real document rendered `victim-account` even
    though those authority bytes were absent from the request URL.
  - **Acceptance:** route search extraction consumes the same bounded native URL snapshot selected
    at ingress, uses boot-pinned getter/iterator controls and exact dense entries, and cannot be
    cross-bound through late URL or URLSearchParams prototype replacement.
  - **Evidence:** 55 focused ingress/document/query tests and an independent combined global URL,
    Request URL, URL searchParams, entries, and iterator-next poison matrix retain only the submitted
    attacker token; no cached victim capability reaches validation or rendering.

- [x] **C83 - The authorization census exposes an unclassified relational read namespace.**
      `packages/server/src/managed-db.ts`
  - `createAuthorizationCensusDb()` returned the raw Drizzle `db.query` namespace. A census that was
    allowed to inspect one table could therefore call an unclassified table's relational
    `findMany()` successfully instead of failing closed with KV414.
  - **Acceptance:** census proxies recursively govern relational namespaces and every terminal from
    one immutable table-identity snapshot; undeclared relational reads fail with KV414 while
    declared read enumeration retains its exact observed-table evidence.
  - **Evidence:** the integrated managed matrix passes 153/153; an independent five-case
    reflection/TOCTOU suite confirms raw and relational namespace descriptors cannot expose or
    inject an undeclared terminal.

- [x] **C84 - Mutable URL and Request method controls cross-bind ingress authority.**
      `packages/server/src/{app-request,app-dispatch,app-document,request-body-intrinsics}.ts`
  - Replacing the global `URL` constructor after handler construction rewrote a real request for
    `/public?token=attacker` into `/capability?token=victim`; the real route returned
    `victim-account`. A late `Request.prototype.method` getter could likewise present an unsafe POST
    as GET to route matching, CSRF/method enforcement, or response finalization.
  - **Acceptance:** native Request URL/method accessors, URL construction, URL component accessors,
    dispatch, normalization, CSRF method checks, and response method posture share one boot-pinned
    ingress snapshot; no late global/prototype replacement can change the selected route, authority
    bytes, allowed method, or response semantics.
  - **Evidence:** the 249-test independent app/CSRF/carrier/posture matrix keeps a post-snapshot
    OPTIONS/GET request out of a state-changing mutation, refuses route/HSTS/document-channel
    substitution, and retains exact method/URL semantics through lifecycle carriers and finalization.

- [x] **C85 - Managed replica handles expose raw primary and replica databases.**
      `packages/server/src/managed-db.ts`
  - Drizzle `withReplicas()` attaches `$primary` and `$replicas` handles. The managed write proxy
    returned those properties raw, so an allowlist-limited handle could execute a cross-table
    `DELETE` through `$primary.execute()` without KV422; replica handles escaped the same boundary.
  - **Acceptance:** primary/replica namespaces are recursively wrapped with the identical immutable
    posture and allowlists, or rejected when their exact authority cannot be preserved; no attached
    Drizzle database handle can bypass table or SQL governance through a non-builder property.
  - **Evidence:** the 153-test managed matrix and independent reflection replay reject `$primary`,
    `$replicas`, descriptor lookup, and nested unknown-callable escapes before any sink executes.

- [x] **C86 - Relational builders expose a raw Drizzle session with write authority.**
      `packages/server/src/secret-read-boundary.ts`
  - A managed read handle recursively wrapped relational terminal methods but exposed the builder's
    internal `session` property. With a real better-sqlite3 database, authored code reached
    `db.query.victims.session.run(sql.raw('DELETE ...'))`; the delete executed without any read-only,
    table-allowlist, or SQL-provenance rejection.
  - **Acceptance:** relational builder property access is default-deny outside the explicitly
    governed query surface; no adapter/session/dialect/raw database handle escapes through own,
    inherited, symbol, reflected, or attached properties, while supported relational terminals
    retain correct dialect semantics.
  - **Evidence:** the same managed matrix and independent real relational replay keep `session`
    absent from own keys/descriptors, reject injection, and leave the victim SQLite row intact.

- [x] **C87 - An authored Vite alias replaces the trusted dev app-shell integration.**
      `packages/{cli,server}/src`
  - The secured `kovo dev` runner bootstrapped before authored config, but its trusted plugin later
    called `server.ssrLoadModule('@kovojs/server/internal/app-shell-vite')`. An authored
    `resolve.alias` redirected that bare specifier to an attacker module; real HTTP returned
    `<main data-attacker>ALIASED FRAMEWORK</main>` from attacker-installed middleware instead of the
    reviewed app shell.
  - **Acceptance:** the bootstrapped exact physical framework graph supplies the dev integration to
    the first-party plugin by closed identity; authored aliases, resolvers, plugins, SSR externalize
    rules, or virtual modules cannot replace any compiler/data-plane/server trust-root export after
    bootstrap.
  - **Evidence:** default dev evaluates no authored Vite config; explicit config is descriptor-
    restricted to client `resolveId`/`load`/`transform` hooks and listen scalars. The 10-test real CLI
    suite rejects `@kovojs`, `node:crypto`, and `vite-plus` aliases plus unknown/future authority
    hooks, while the 27-test server matrix retains the exact app-shell/data-plane graph.

- [x] **C88 - Mutable endpoint cloning cross-binds `actAs()` database authority.**
      `packages/server/src/endpoint.ts`
  - `requestWithEndpointPrincipalPosture()` called live `request.clone()` and
    `Object.defineProperty()` after endpoint code began. A handler replaced `Request.prototype.clone`
    so `ctx.actAs('machine-principal')` gave the DB provider a cached victim Request carrying
    `sid=victim`; late Headers and property-definition controls could also substitute browser or
    principal authority at the same sink.
  - **Evidence:** the full endpoint path now invokes the captured Request clone, pins the cloned
    Request/Headers surface, and installs posture through witnessed definition; the exact clone,
    cookie-getter, and principal-property substitution regression gives the provider no cookie and
    the requested machine principal.

- [x] **C89 - Array species hooks rewrite guard-approved lifecycle session values.**
      `packages/server/src/request-carrier.ts`
  - Deep-closed session arrays owned captured native methods and private iterators, but still
    inherited the live `array.constructor`. A selective constructor getter returned an attacker
    `Symbol.species`; the species Proxy rewrote index zero while `pinnedRoles.map(...)` constructed
    its result, changing the guard-approved `member` role into `admin` for later handler code.
  - **Acceptance:** every handler-visible operation on lifecycle arrays, including species-creating
    map/filter/slice/concat/flat families, is bound to immutable framework-owned construction and
    exact own elements; inherited constructor/species/prototype mutation cannot replace values.
  - **Evidence:** an independent handler-visible replay chains
    `.map().filter().slice().concat().flat()` and spread under constructor/species plus derived-array
    iterator poisoning; the exact approved `member` role survives and the case passes 1/1.

- [x] **C90 - Mutable lifecycle attachment makes authenticated documents shared-cacheable.**
      `packages/server/src/{route,app-document}.ts`
  - An unguarded route resolved a plain authenticated session and rendered private content, then
    route code selectively made live `Object.defineProperty` ignore the framework's
    `lifecycleRequest` attachment. Document finalization fell back to the anonymous raw request,
    omitted both `Cache-Control: no-store` and `Vary: Cookie`, and exposed the per-principal page to
    shared-cache replay.
  - **Evidence:** lifecycle attachment now uses the boot-captured definition witness; the exact
    no-op attack retains the resolved principal signal and the authenticated document remains
    `no-store` with `Vary: Cookie` across the 61-test document/route matrix.

- [x] **C91 - Mutable database-handle attachment removes engine security wrappers.**
      `packages/server/src/{sqlite-runtime,postgres-runtime}.ts`
  - SQLite and request-scoped Postgres runtimes attached their module-private readonly and
    declared-write factories through live `Object.defineProperty`. A selective no-op left the raw
    application database without the wrapper factories, so later `managedDb()` resolution could
    fall back to a generic handle without the runtime's secret metadata and engine authorizer.
  - **Evidence:** SQLite and Postgres now register read/write factories in a module-private witnessed
    registry rather than reflective symbols. The independent file-backed SQLite three-effect proof
    retains secret boxing, rejects the forged writer, and leaves the undeclared row absent; the
    Postgres runtime matrix passes all 80 tests through the same private resolution path.

- [x] **C92 - Authenticated route boundary documents lose their private cache posture.**
      `packages/server/src/{route,app-document}.ts`
  - Resolved lifecycle evidence was attached to successful route outcomes but not to `error` or
    `notFound` boundary responses. An unguarded authenticated boundary rendered
    `victim-account`, then document finalization fell back to the anonymous raw request and emitted
    neither `Cache-Control` nor `Vary`; both private boundary bodies were shared-cacheable.
  - **Acceptance:** every response branch after lifecycle resolution carries the exact principal
    evidence into document cache classification, including validation, guard, error/notFound
    boundary, redirect, and render-failure paths; authenticated content always remains private and
    no-store.
  - **Evidence:** independent authenticated `notFound`/`error` proofs pass 2/2 with `no-store` and
    `Vary: Cookie`; adjacent validation, redirect, renderer-failure, and route-semantics cases pass
    3/3, with the broader boundary document selection at 11/11.

- [x] **C93 - Mutable database URL parsing grants runtime privileges to the wrong role.**
      `packages/server/src/postgres-runtime.ts`
  - `runtimeLoginRoleFromDatabaseUrl()` used the live global `URL` constructor and
    `decodeURIComponent` before provisioning. A selective replacement changed the configured
    `victim_runtime_login` username into `attacker_runtime_login`; real PGlite provisioning granted
    the attacker role `EXECUTE` on `pg_catalog.set_config` while the configured victim received
    nothing.
  - **Acceptance:** runtime/admin/system URL identity, decoded role name, membership grants, function
    ACLs, and posture checks share one boot-pinned exact URL snapshot; late constructor/accessor/
    decode replacement cannot redirect any provisioned privilege.
  - **Evidence:** the exact late URL/identifier replacement remains bound to the configured runtime
    role in the 12-test PostgreSQL intrinsic-security matrix.

- [x] **C94 - Route code substitutes a session cookie at document finalization.**
      `packages/server/src/app-document.ts`
  - After a session provider had supplied the genuine refresh cookie, route page code replaced
    `Array.prototype[Symbol.iterator]`. The later framework loop consumed an attacker array instead
    of its private collector and emitted `sid=attacker-substituted` through the reserved
    `Set-Cookie` sink, replacing the provider's `sid=genuine-session`.
  - **Acceptance:** session-provider and CSRF cookies are stored as immutable exact entries and
    traversed only through bounded witnessed indices; route renderers cannot add, remove, mutate,
    reorder, or substitute any credential header through collection/prototype changes.
  - **Evidence:** the independent 134-test document/CSRF/cookie/posture matrix retains only the
    provider's genuine cookie under the exact iterator substitution; both session-provider and CSRF
    collectors use frozen null-prototype entries and witnessed indexed finalization.

- [x] **C95 - Mutable authority-root filtering preserves runtime schema-creation power.**
      `packages/server/src/postgres-runtime.ts`
  - PostgreSQL provisioning built both its audited app-role roots and CREATE/TEMP revocation list
    through live `Array.prototype.filter`. A selective filter omitted only
    `victim_runtime_login`; real PGlite migration succeeded while that runtime role retained
    effective `CREATE` on schema `public`, and the closure audit inspected only reader/writer.
  - **Acceptance:** configured and catalog-discovered authority roots, deduplication, assumable-role
    expansion, revocation grantees, schema/database rows, and post-revocation verification use one
    exact descriptor-snapshotted identity set; no collection substitution can omit an app-reachable
    role or object.
  - **Evidence:** authority-root/revocation traversal contains no live collection dispatch; the exact
    creation-authority and full six-root CREATE/TEMP posture proofs pass in the focused PostgreSQL
    matrices.

- [x] **C96 - Mutable column filtering grants readers a declared secret.**
      `packages/server/src/postgres-runtime.ts`
  - Reader/writer/admin grant synthesis used live column `map/filter/map` chains. A selective filter
    preserved `secretNote` in the public-column list; real PGlite migration committed and
    `kovo_reader` received effective `SELECT(secretNote)` despite the Kovo secret declaration.
  - **Acceptance:** exact schema columns and secret metadata are descriptor-snapshotted once; every
    reader/writer/admin grant is built by bounded indexed traversal with captured membership and SQL
    emission, and a secret-derived column can never enter a public grant.
  - **Evidence:** grant synthesis contains no live collection dispatch; the reader raw-read and
    writer engine secret-column denial proofs pass with the authority-root posture case (3/3).

- [x] **C97 - Mutable policy traversal hides an extra permissive RLS policy.**
      `packages/server/src/postgres-runtime.ts`
  - After ordinary provisioning, an extra `attacker_allow_all` permissive SELECT policy for
    `kovo_reader` was installed. A selective live policy-row filter returned an empty unexpected
    set; `checkPostgresAppDbPosture()` reported `{ ok: true, issues: [] }` instead of KV433_POLICY_SET.
  - **Acceptance:** catalog policy rows, expected names/roles, set equality, AST normalization, key
    order, and issue accumulation use captured descriptor-first controls; every missing, altered, or
    additional permissive/restrictive policy makes posture fail closed.
  - **Evidence:** extra-PUBLIC-policy and one-shot Proxy row-count regressions remain failing posture
    in the 12-test PostgreSQL intrinsic-security matrix.

- [x] **C98 - Mutable RLS policy assembly installs an allow-all owner policy.**
      `packages/server/src/postgres-runtime.ts`
  - A selective one-shot `Array.prototype.join` replacement targeted only the generated
    `CREATE POLICY kovo_owner_scope` statement, returned `USING (true) WITH CHECK (true)`, and
    self-restored during that call. Real PGlite provisioning resolved successfully, after which the
    ordinary `u1` runtime query returned both the `u1` and `u2` rows.
  - **Acceptance:** protected-table iteration, policy identity/roles/predicates, SQL fragments, final
    statement assembly, execution, and posture readback use one descriptor-snapshotted exact policy
    plan through boot-captured operations; no late or one-shot collection replacement can widen an
    installed predicate, and the provisioner must verify the committed AST before returning ready.
  - **Evidence:** the exact one-shot policy `Array.join` replay installs only the reviewed owner
    predicate in the 12-test PostgreSQL intrinsic-security matrix.

- [x] **C99 - A time-varying schema snapshot omits RLS from a tenant-owned table.**
      `packages/server/src/postgres-runtime.ts`
  - A one-shot schema `Proxy.ownKeys` trap hid one owner table only during
    `postgresTablesFromSchema()`, then self-restored. Boot continued from a visible reference table;
    seed SQL created/populated the hidden table, grants exposed it, and an ordinary `u1` runtime
    query returned both the `u1` and `u2` rows because no owner policy had been installed.
  - **Acceptance:** reject Proxy-backed/accessor schema and option carriers through a non-trappable
    host proof, or accept only a private framework-generated nominal schema carrier; the first view
    cannot be treated as authenticated merely because it is reused. Capture the proven complete
    graph once as a dense immutable snapshot, then reuse it for DDL, migration, metadata, owner/RLS,
    grants, relation wiring, and request-time Drizzle construction. Any unstable view fails before
    seed, migration, or provisioner SQL executes.
  - **Evidence:** the exact first-use `Proxy.ownKeys` schema is rejected before SQL, while a genuine
    immutable ESM namespace snapshot passes and a changing live binding fails.

- [x] **C100 - Mutable migration normalization executes injected provisioner SQL.**
      `packages/server/src/postgres-runtime.ts`
  - A selective one-shot `Array.prototype.map` replacement injected an extra privileged statement
    while `normalizePostgresMigrations()` processed an otherwise reviewed migration list, then
    self-restored. Real `migratePostgresAppDb()` returned `posture.ok=true` and the unreviewed table
    remained durably present afterward.
  - **Acceptance:** migration arrays, entry fields, identifiers, SQL carriers, checksums, ordering,
    applied-state comparison, execution, and posture inputs derive from one immutable descriptor-
    first snapshot through boot-captured operations. The exact reviewed bytes/checksum must bind the
    statements executed under provisioner authority, and injected, accessor-backed, sparse, or
    time-varying migration state must fail before any transaction writes.
  - **Evidence:** the exact one-shot migration `Array.map` replay executes only reviewed bytes in the
    12-test PostgreSQL intrinsic-security matrix.

- [x] **C101 - Proxy-backed catalog rows hide live PostgreSQL posture drift.**
      `packages/server/src/postgres-runtime.ts`
  - A self-disabling Proxy around a real driver-returned rows carrier hid the trailing extra
    permissive policy for the audit's repeated length reads. The same database changed from a
    failing `KV433_POLICY_SET` posture report to `{ ok: true, issues: [] }` even though the attacker
    policy remained installed.
  - **Acceptance:** every driver result and row used for role, privilege, schema, relation, policy,
    grant, migration, or posture authority is rejected when Proxy/accessor-backed, then reconstructed
    once as a bounded dense own-data snapshot before any traversal. No driver carrier can present a
    different row count, identity, or field value across audit phases; ambiguity fails posture closed.
  - **Evidence:** the real-driver one-shot Proxy row-length regression retains the unexpected policy
    and fails posture in the focused 12-test matrix.

- [x] **C102 - Mutable query-parameter iteration cross-binds an audited admin read.**
      `packages/server/src/postgres-runtime.ts`
  - A selective generic array iterator targeted the exact one-element parameter array `['u1']`,
    substituted `u2` only while the runtime spread parameters into the driver, and self-restored.
    The admin-guarded `crossOwnerRead` was reviewed and audited for owner `u1` but returned `u2`'s
    row; admin RLS intentionally permits that cross-owner access and therefore could not reject the
    authority split.
  - **Acceptance:** SQL text, dense parameter values, owner/read declarations, proven principal,
    audit fact, and driver execution derive from one immutable descriptor-first query snapshot.
    Read, privileged-read, and admin/cross-owner clients never dispatch a caller or ambient iterator,
    and an unstable/sparse/accessor/Proxy parameter carrier fails before query or audit execution.
  - **Evidence:** the exact one-shot parameter iterator replay returns the reviewed owner row and
    preserves its matching audit fact in the 12-test PostgreSQL intrinsic-security matrix.

- [x] **C103 - Mutable default validation-failure assembly injects executable HTML.**
      `packages/server/src/mutation/failure-html.ts`
  - The built-in 422 renderer escaped each validation issue, then assembled the trusted fragment
    through ambient `issues.map(...).join('')`. A selective one-shot `Array.prototype.join`
    replacement returned raw `<img onerror=...>` bytes; both
    `renderDefaultFailureFragmentContent()` and the complete `renderDefaultFailurePage()` emitted
    the executable event markup.
  - **Acceptance:** validation issues, paths/messages, escaped list entries, fragment/page shell, and
    final trusted-HTML construction use bounded dense snapshots and boot-captured scalar/collection
    operations. No late or one-shot intrinsic replacement can add markup after escaping, and the
    complete mutation 422 response must pass the same final HTML choke as ordinary documents.
  - **Evidence:** the exact final-join fragment/page attacks stay escaped in the 5-test failure-HTML
    and streaming-output security matrix.

- [x] **C104 - Mutable streaming mutation encoding and replay assembly inject executable HTML.**
      `packages/server/src/mutation/streaming.ts`
  - After awaiting an app-authored stream generator, the real renderer invoked live
    `TextEncoder.prototype.encode(line)`. A one-shot selective replacement changed a safe
    `stream.text` event into attacker `<kovo-fragment><img onerror=...>` bytes on the live 200 stream;
    the following `<kovo-done>` encoded normally after self-restoration.
  - Independently, ambient buffered `push/join` left the live stream safe but committed attacker
    fragment bytes as idempotency replay truth, so the next request with the same replay key served
    executable bytes that had never appeared in the original response.
  - **Acceptance:** event validation, HTML escaping, line/frame construction, UTF-8 encoding, stream
    enqueue, buffered replay accumulation, replay fingerprint/commit, and subsequent replay consume
    one boot-pinned exact byte sequence. No app callback runs before a live encoder/collection sink;
    the first response bytes and committed replay bytes must be identical and pass the same output
    choke under late, one-shot, and post-yield intrinsic replacement.
  - **Evidence:** late encoder and replay-buffer substitutions retain identical reviewed live/replay
    bytes in the same focused 5-test matrix.

- [x] **C105 - Mutable Drizzle dialect rendering installs an allow-all authorization policy.**
      `packages/server/src/postgres-runtime.ts`
  - A one-shot `PgDialect.prototype.sqlToQuery` replacement targeted only the second rendering of an
    exact custom authorization predicate, returned `true`, and self-restored. Real provisioning
    resolved successfully, installed the widened RLS policy, and an ordinary `u1` query returned
    both the `u1` and `u2` rows.
  - **Acceptance:** capture and validate the exact Drizzle dialect renderer before authored code,
    invoke it only through witnessed receiver binding, and snapshot the rendered SQL/parameters once
    for policy identity, DDL execution, and committed-AST posture readback. No late prototype,
    instance, getter, or one-shot renderer replacement can change a custom predicate after review.
  - **Evidence:** the exact one-shot late `PgDialect.sqlToQuery` replay commits the reviewed custom
    predicate in the 12-test PostgreSQL intrinsic-security matrix.

- [x] **C106 - Mutable PostgreSQL policy parsing authenticates an allow-all predicate.**
      `packages/server/src/postgres-runtime.ts`
  - A selective replacement of the cached `pgsql-ast-parser.parse` method rewrote only the two real
    `USING (true)` / `WITH CHECK (true)` parses into the expected owner predicate AST and
    self-restored on the second hit. The genuine drift report changed from false to
    `{ ok: true, issues: [] }` while the allow-all policy remained installed.
  - **Acceptance:** capture and validate the exact parser function before authored code, invoke it
    through witnessed binding, and normalize one immutable AST snapshot for expected policy,
    catalog readback, equality, and diagnostics. No late module/object/prototype/parser replacement
    can make different SQL bytes share an authorization verdict.
  - **Evidence:** the exact late parser substitution cannot authenticate the installed allow-all AST
    in the 12-test PostgreSQL intrinsic-security matrix.

- [x] **C107 - Mutable browser stream decoding substitutes executable mutation fragments.**
      `packages/browser/src/apply-mutation-response.ts`, generated inline mutation runtime
  - The browser constructed `new TextDecoder()` and later called live `decoder.decode()` after
    authored modules could run. A one-shot prototype replacement changed a safe server stream into
    attacker `<kovo-fragment><img onerror=...><kovo-done>` bytes; the real parser and morph path
    applied the attacker HTML. The generated inline-loader runtime contains the same live decoder.
  - **Acceptance:** source and generated browser runtimes capture/validate decoder construction and
    decode before authored code, bind each exact byte chunk to one decoded scalar snapshot, and feed
    only that snapshot into framing, fragment parsing, sanitization, and morphing. Late decoder/
    typed-array/stream replacement cannot alter any parsed byte, and source/generated parity is
    proven in all supported engines.
  - **Evidence:** exact late decoder and `getReader` stream substitution replays stay inert 6/6 in
    Chromium, Firefox, and WebKit; the full source/generated browser matrix passes 399/399 with
    pinned read/cancel/release/locked controls and byte snapshots.

- [x] **C108 - Mutable final DOM commit changes a sanitized node into executable markup.**
      `packages/browser/src/{morph,response-fragment-apply}.ts`
  - After the incoming node had passed sanitization, the tag-mismatch morph path invoked live
    `Element.prototype.replaceWith`. A selective replacement mutated that approved node to add a
    broken-image `onerror`, self-restored, then called native `replaceWith`; Chromium, Firefox, and
    WebKit all executed the handler through the real mutation-response runtime.
  - **Acceptance:** capture and validate every final DOM mutation method before authored code and
    invoke it through the reviewed receiver with an immutable sanitized node/attribute/text plan.
    No callback or live DOM method may run between last validation and commit; source and generated
    morph implementations must prove the exact three-engine exploit remains inert.
  - **Evidence:** 60/60 three-engine regressions cover replace/append/prepend/keyed reconciliation,
    traversal/attribute omission, dynamic script substitution, and scalar sanitizer poison; the full
    browser matrix passes 375/375 plus inline, Trusted Types, build, API, and import gates.

- [x] **C109 - Mutable PGlite transaction dispatch rewrites a committed RLS policy.**
      `packages/server/src/postgres-runtime.ts`
  - A one-shot `PGlite.prototype.transaction` wrapper captured the genuine transaction client and
    replaced only its `exec` for the owner-policy `CREATE POLICY`, committing `USING (true)` before
    self-restoring. The outer client `exec` hook never fired because privileged DDL runs on the
    transaction object; runtime readiness resolved and `u1` read both tenant rows.
  - **Acceptance:** capture and validate the driver transaction method before authored code, invoke
    it with witnessed receiver binding, and descriptor-snapshot the exact transaction-local
    `exec/query/transaction` methods before callbacks or SQL execute. Outer and nested client
    dispatch must consume the same reviewed SQL/policy plan; prototype, instance, or one-shot driver
    wrapping cannot change committed bytes.
  - **Evidence:** the exact late transaction-local DDL substitution receives no dispatch and the
    reviewed owner policy remains installed in the 12-test PostgreSQL intrinsic-security matrix.

- [x] **C110 - Mutable migration hashing authenticates changed applied SQL.**
      `packages/server/src/postgres-runtime.ts`
  - A changed, already-applied migration correctly failed the control check. Selective hash
    `update/digest` replacements then returned the stored checksum for exactly the normalization and
    execution-time rehash calls before self-restoring; the retry skipped the changed migration and
    returned `posture.ok=true` even though reviewed source and recorded identity no longer matched.
  - **Acceptance:** capture/validate hash construction and the exact hash-instance `update/digest`
    methods before authored code, bind canonical migration bytes to one immutable digest snapshot,
    and compare the stored, planned, and pre-execution checksum through captured constant-time scalar
    operations. No late prototype/instance/call-count hash replacement can alias changed SQL.
  - **Evidence:** exact late hash-instance replacement cannot authenticate the changed migration in
    the 12-test PostgreSQL intrinsic-security matrix.

- [x] **C111 - Mutable Node PostgreSQL driver dispatch forges live posture evidence.**
      `packages/server/src/postgres-runtime.ts`
  - After the runtime client had been constructed, an exact late `Pool.prototype.query` replacement
    intercepted the real catalog posture query and returned forged FORCE-RLS rows without touching
    the network. `NodePostgresRuntimeClient` accepted the substituted evidence through the live
    driver method and changed the security verdict.
  - **Acceptance:** capture and validate Pool and checked-out Client `query/connect/end/release`
    methods before authored code, invoke them only with witnessed receiver binding, and snapshot
    returned carriers before classification. Late prototype, instance, getter, and one-shot driver
    substitution cannot change SQL, parameters, rows, lifecycle, or the final posture verdict.
  - **Evidence:** the permanent transitive Pool/Client dispatch attacks and real driver lifecycle
    cases pass in the integrated PostgreSQL matrix; the six-boundary security run passes 235/235.

- [x] **C112 - Mutable diagnostic response assembly injects executable HTML.**
      `packages/server/src/document-diagnostics.ts`
  - A late selective `Array.prototype.map` replacement targeted the framework's compiler diagnostic
    list after every real diagnostic field had an escaping path, returned raw
    `<img onerror=...>` markup, and caused the built-in 500 diagnostic document to serve the event
    handler inside its trusted body.
  - **Acceptance:** diagnostic options, entries, help lines, source frames, styles, and final panel
    assembly use boot-pinned scalar/collection controls with no app-reachable callback between
    escaping and document emission. Late or one-shot array, string, RegExp, Math, or coercion
    replacement cannot add or substitute markup in the rendered diagnostic response.
  - **Evidence:** exact late diagnostic-map and bounded-source-marker regressions pass in
    `document.test.ts`; the integrated six-boundary security run passes 235/235.

- [x] **C113 - Mutable capability-signer selection bypasses an ambiguous authority set.**
      `packages/server/src/app-document.ts`
  - With two storage download endpoints mounted, `ctx.signUrl()` correctly failed because no one
    base path/secret had been selected. A selective late `Array.prototype.map` replacement removed
    one endpoint only during signer discovery; the same route returned 200 and minted a bearer URL
    under the remaining endpoint instead of preserving the fail-closed ambiguity error.
  - **Acceptance:** storage endpoint discovery traverses the closed app registry through exact own
    descriptors, counts every signer once, and binds base path, secret, replay posture, and scope
    callback from one immutable endpoint snapshot. Collection/prototype substitution cannot omit,
    add, reorder, or cross-bind signer authority, and every multi-signer app remains unavailable.
  - **Evidence:** the multi-signer late-collection replay remains fail-closed in
    `capability-route.test.ts`; the integrated six-boundary security run passes 235/235.

- [x] **C114 - Mutable dev live-target assembly substitutes executable fragment HTML.**
      `packages/server/src/vite-dev.ts`
  - A live-target renderer replaced `Array.prototype.join` after returning safe component markup.
    The dev HMR refresh endpoint joined its framework-rendered chunk list through that late method,
    served an attacker `<kovo-fragment><img onerror=...>` body with status 200, and the browser HMR
    path would apply those bytes as trusted fragment wire.
  - **Acceptance:** dev live-target render results, stylesheet chunks, final ordering, separator, and
    response bytes use the same boot-pinned collection/output controls as production mutation wire.
    No authored renderer callback or late intrinsic replacement can alter the final fragment body
    after escaping/rendering, and ordinary HMR refresh output remains byte-identical.
  - **Evidence:** the late live-target join replay and ordinary refresh cases pass in
    `vite-dev.test.ts`; the integrated six-boundary security run passes 235/235.

- [x] **C115 - A mutable Web Response constructor replaces the dev HMR client with attacker code.**
      `packages/server/src/{vite-dev,response-security-intrinsics}.ts`
  - After the framework server root was loaded, app code replaced `globalThis.Response` with a
    selective subclass. A request for `/@kovo/hmr-client` retained status 200 and its expected
    headers but served `globalThis.__kovoDevHmrClientPwned=1` instead of the framework HMR source,
    which a development browser would execute as same-origin JavaScript.
  - **Acceptance:** Vite-dev Web Response construction, body/header/status reads, text consumption,
    cloning, and Headers mutations route through one boot-validated native membrane captured before
    the app graph. Late constructor/prototype/getter/method replacement cannot alter HMR client,
    refresh, injected-document, diagnostic, or stylesheet response bytes and metadata.
  - **Evidence:** the exact late Response-subclass HMR client replacement stays inert in
    `vite-dev.test.ts`; the integrated six-boundary security run passes 235/235.

- [x] **C116 - Mutable Web Request and URL carriers bypass HMR route authority.**
      `packages/server/src/vite-dev.ts`
  - A late `Request` subclass added an admin header only to the internal HMR replay request;
    `guards.role('admin')` then served an unauthenticated refresh the protected `ADMIN SECRET` page.
    Independently, a late `URL` subclass retained an attacker-origin href while spoofing `.origin`
    during the same-origin comparison, so HMR replayed a route under the hostile origin with 200.
  - **Acceptance:** HMR URL construction/snapshots, same-origin and reserved-path decisions, internal
    Request construction, headers, method, and replay dispatch use boot-validated native controls.
    Late constructors, accessors, subclasses, and methods cannot add credentials or make distinct
    origins compare equal; ambiguity rejects before app dispatch.
  - **Evidence:** `vite-dev-intrinsics.test.ts` proves late Request principal injection and URL-origin
    spoofing stay outside dispatch; the integrated Vite-dev security matrix passes 39/39.

- [x] **C117 - Mutable dev collections fabricate assets and bless undeclared routes.**
      `packages/server/src/vite-dev.ts`
  - A selective stylesheet-array `.find` fabricated attacker CSS for `/admin`, shadowing a genuine
    app route. A separate `app.routes.map` replacement substituted an undeclared public
    `/undeclared-admin` route immediately before `deriveClosedKovoApp()`, which then snapshotted and
    blessed the forged declaration; both requests returned attacker-controlled 200 responses.
  - **Acceptance:** stylesheet inputs and every closed app route/renderer derivation are traversed
    through bounded dense own-data snapshots and exact keys. Late map/find/filter/iterator/species or
    Proxy substitution cannot fabricate, omit, reorder, or bless an asset, route, or renderer.
  - **Evidence:** exact late `Array.find` asset and `Array.map` undeclared-route attacks are inert in
    `vite-dev-intrinsics.test.ts`; the integrated Vite-dev security matrix passes 39/39.

- [x] **C118 - Mutable diagnostic traversal makes a compiler error fail open in dev.**
      `packages/server/src/vite-dev.ts`
  - A targeted `Array.prototype.some` replacement returned false for an exact KV225 compiler-error
    array. The all-diagnostics ledger still exposed the error, but the blocking request ledger did
    not record it, so the dependent `/cart` route received no teaching diagnostic and continued.
  - **Acceptance:** diagnostic entry snapshots, severity classification, module/request indexing,
    and blocking lookup use captured exact traversal and registry controls. Every error visible in
    the canonical ledger blocks every dependent request regardless of late collection mutation.
  - **Evidence:** the exact late `Array.some` KV225 suppression replay remains blocking in
    `vite-dev-intrinsics.test.ts`; the integrated Vite-dev security matrix passes 39/39.

- [x] **C119 - Mutable Node HMR buffering replaces a complete safe document with script.**
      `packages/server/src/vite-dev.ts`
  - The explicit Node-handler HMR adapter collected a safe HTML document, then called live
    `Buffer.concat(chunks)`. A selective replacement returned an attacker script buffer; the dev
    response kept status 200, served the script bytes, and omitted the original safe document.
  - **Acceptance:** Node response chunk validation, byte conversion, accumulation, concatenation,
    UTF-8 decoding, HMR injection, and final write use boot-validated Buffer/collection controls.
    Authored handlers and late Buffer/prototype methods cannot alter buffered bytes or metadata.
  - **Evidence:** exact late `Buffer.concat` document replacement plus call/bind dispatch attacks are
    inert in `vite-dev-intrinsics.test.ts`; the integrated Vite-dev security matrix passes 39/39.

- [x] **C120 - Mutable function binding swaps the object authorized by a capability URL.**
      `packages/server/src/app-document.ts`
  - A selective `Function.prototype.bind` replacement intercepted only the framework `signUrl`
    method threaded into route context. The route requested `receipts/public.txt`, but the wrapper
    changed the key to `receipts/secret.txt`; Kovo minted a cryptographically valid bearer URL for
    the secret object, and dereferencing it returned `secret-download`.
  - **Acceptance:** the framework-owned signer is read from an exact own-data descriptor and invoked
    with captured `Reflect.apply` over the original receiver/options. Mutable bind/call/apply or
    function prototype hooks cannot observe, replace, or cross-bind capability claims.
  - **Evidence:** the exact signer key-swap replay stays bound to the reviewed key in
    `capability-route.test.ts`; the integrated six-boundary security run passes 235/235.

- [x] **C121 - Mutable own-property dispatch turns static-export dry runs into real writes.**
      `packages/server/src/{vite-static-export-options,static-export}.ts`
  - A selective `Function.prototype.call` replacement made
    `Object.prototype.hasOwnProperty.call(options, 'outDir')` return false. The Vite inventory API
    accepted the forbidden output directory and, despite its dry-run contract, wrote `_headers`,
    client modules, and route HTML into that attacker-chosen path.
  - **Acceptance:** forbidden `outDir`, `distDir`, and `htmlPathStyle` presence is classified through
    boot-pinned exact own-data inspection before any replay or filesystem plan. Mutable call/apply,
    inherited pollution, getters, or Proxy ambiguity cannot turn inventory/manifest operations into
    writes or redirect build asset roots; rejected dry runs leave the target directory empty.
  - **Evidence:** exact call poisoning and time-varying Proxy options leave the supplied output
    directory empty in `vite-static-export-options.test.ts`; the six-boundary run passes 235/235.

- [x] **C122 - Mutable function binding converts a read-only storage view into write authority.**
      `packages/core/src/{storage,internal/filesystem-intrinsics}.ts`
  - A selective `Function.prototype.bind` replacement intercepted the source storage `get` method
    while Kovo built its read-only facade. The returned wrapper performed `storage.put()` before the
    genuine read; invoking query-side `readOnly.get('receipts/order-1.txt')` created the undeclared
    object `receipts/evil.txt`, bypassing the facade's explicit KV433 write denial.
  - **Acceptance:** get/stat/stream method identities are captured from stable descriptors and
    invoked only with a boot-pinned fixed receiver; freeze and denied put/delete/store/upload aliases
    are also framework-owned. Mutable bind/call/apply, Proxy/freeze globals, or later method changes
    cannot add any storage effect to a read capability.
  - **Evidence:** the exact bind-triggered write and facade alias regressions pass in
    `storage.test.ts`; the integrated six-boundary security run passes 235/235.

- [x] **C123 - Mutable query-delta membership retains confidential stale fields.**
      `packages/core/src/query-delta.ts`
  - Server truth omitted `secret: 'victim-only'` from the authoritative non-collection `set`, which
    must delete it from the held query value. A selective `Function.prototype.call` replacement
    made the live `hasOwnProperty.call(delta.set, 'secret')` return true; delta application reported
    success while preserving the confidential field beside the new public value.
  - **Acceptance:** delta construction/application snapshots own fields and dense arrays, and uses
    boot-pinned map/set membership, scalar conversion, keyed reconciliation, and property definition.
    Mutable call/apply, Object/Array/Map/Set methods, iterators, species, or sparse/accessor carriers
    cannot retain, omit, reorder, substitute, or prototype-route any query truth.
  - **Evidence:** inherited-list pollution, collection poisoning, and time-varying Proxy rows are
    inert; the integrated core/browser query-delta matrix passes 50/50 and focused check is clean.

- [x] **C124 - A late Proxy replacement disables the runtime database verifier.**
      `packages/test/src/{verifier,verifier-observation,sql-observer}.ts`
  - Replacing `globalThis.Proxy` only while `createDbVerifier().wrap(db)` ran returned the raw
    database handle. An uncovered `audit_log` write then produced no observation and
    `assertCovered()` incorrectly passed, invalidating the SPEC §11 runtime cross-check.
  - **Acceptance:** verifier proxies, method lookup/invocation, observation storage, SQL snapshots,
    and diagnostic traversal use boot-captured, witnessed controls. Late Proxy/Reflect/Function,
    Object/Array/Map/Set/WeakMap, Promise, or iterator mutation cannot suppress, fabricate, or
    reclassify an operation; uncertainty fails closed and exact adversarial tests remain permanent.
  - **Evidence:** the exact late-Proxy replay still records and rejects the uncovered write in the
    13-test verifier/adapter security matrix.

- [x] **C125 - The verifier exposes its mutable authority ledger to tested code.**
      `packages/test/src/{verifier,verifier-observation}.ts`
  - Both `verifier.observed` and wrapped-DB `__kovoObserved` returned the recorder's live array. A
    tested mutation could clear that array after an uncovered write, after which `assertCovered()`
    passed because the security evidence had been erased.
  - **Acceptance:** the recorder remains module-private and all exposed/captured observations are
    frozen dense snapshots of frozen exact operation records. Mutating an earlier view cannot alter
    current verification state, and externally supplied operation ledgers are re-snapshotted or
    rejected before they influence a coverage decision.
  - **Evidence:** mutations of both exposed observation views leave the private frozen ledger intact
    in the 13-test verifier/adapter security matrix.

- [x] **C126 - Caller-owned verifier inputs can retroactively bless an uncovered write.**
      `packages/test/src/{verifier,verifier-diagnostics}.ts`
  - After recording an uncovered `audit_log` write, mutating the original touch graph to declare an
    `audit` touch made `assertCovered()` pass. The verifier retained caller-owned graph/config
    objects as its live authorization policy instead of fixing policy at construction.
  - **Acceptance:** touch graphs, table/domain/key/exemption policy, and optional arrays are validated
    and copied into frozen null-prototype own-data snapshots before any DB handle is exposed. Later
    mutation, getters, inheritance, sparse arrays, proxies, or prototype pollution cannot change the
    policy used to classify an already observed or future operation.
  - **Evidence:** touch-graph/config mutation plus inherited/accessor/sparse carriers remain inert or
    fail closed in the 13-test verifier/adapter security matrix.

- [x] **C127 - Mutable array traversal suppresses runtime owner-scope violations.**
      `packages/test/src/verifier.ts`
  - A selective late `Array.prototype.filter` replacement returned an empty array only for exact
    foreign-owner rows. Both `assertOwnerRowsScoped()` and `assertOwnerWritesScoped()` then returned
    successfully for a victim row under an attacker principal, bypassing the SPEC §11.2 KV414
    runtime cross-check.
  - **Acceptance:** owner-row input, owner-column reads, foreign-owner collection/deduplication, and
    diagnostics use dense own-data snapshots plus captured exact primitives. Late Array/Set/String,
    iterators, accessors, sparse arrays, proxies, or prototype pollution cannot hide a foreign row;
    ambiguous carriers fail closed.
  - **Evidence:** both owner-row and owner-write exact late-filter replays retain KV414 in the
    13-test verifier/adapter security matrix.

- [x] **C128 - Mutable set membership authorizes undeclared test-database writes.**
      `packages/test/src/{sqlite,pglite}.ts`
  - An in-memory SQLite declared writer allowed only `cart_items`. A targeted late
    `Set.prototype.has('main.audit_log')` replacement made its helper authorization check return
    true, and `writer.write('main.audit_log', ...)` committed the forbidden row without KV406. The
    PGlite fallback uses the same live policy/set path.
  - **Acceptance:** declared-write policies are copied once from exact own dense data; normalized
    table membership, engine stat/authorizer decisions, statement construction, and driver calls use
    boot-captured witnessed controls. Late collection/string/function mutation or caller policy
    changes cannot authorize an undeclared table, and rejected operations leave engine state intact.
  - **Evidence:** exact SQLite and PGlite `Set.has`/policy-mutation replays reject the audit write and
    leave both engines unchanged in the 13-test verifier/adapter security matrix.

- [x] **C129 - Mutable PGlite dispatch turns a reviewed read into an engine write.**
      `packages/test/src/pglite.ts`
  - A late `PGlite.prototype.query` wrapper targeted the exact reviewed
    `select id from products`, used the reader receiver to disable
    `default_transaction_read_only`, and inserted `audit_log('stolen')` before forwarding the safe
    select. The raw read resolved normally while the supposedly read-only engine contained the row.
  - **Acceptance:** reader construction, session hardening, exec/query dispatch, transaction queue,
    statement/value snapshots, result projection, and close lifecycle use boot-captured witnessed
    driver/Promise controls. Late prototype/instance wrappers cannot change the session setting,
    execute extra SQL, alter reviewed bytes/values, or return before an enforcement failure.
  - **Evidence:** the exact dedicated-reader extra-SQL injection receives no dispatch; `audit_log`
    stays empty and read-only session posture stays on in the 13-test verifier/adapter matrix.

- [x] **C130 - Mutable app-graph traversal erases a webhook from the authority census.**
      `packages/compiler/src/{app-graph,compile-fact-ledger,compile-result}.ts`
  - A compiled webhook produced a complete verified-machine-auth endpoint fact. Replacing
    `Array.prototype.flatMap` only for the caller's component-result array made
    `deriveAppGraph()` omit `graph.endpoints` and its derived access fact entirely, while the
    runtime webhook declaration remained present and executable.
  - **Acceptance:** compiler fact-ledger append/merge/snapshot and app-graph derivation consume
    bounded dense own-data snapshots through boot-captured Map/Set/Array/Object/String/JSON controls.
    Component, route-page, task, endpoint, access, sink, capability, posture, and diagnostic facts
    cannot be omitted, fabricated, deduplicated together, or reordered by late dispatch or hostile
    carriers; uncertainty fails closed before graph emission/cache hashing.
  - **Evidence:** exact late-`flatMap`, caller-mutation, frozen-cache, hidden output-context sidecar,
    and fact-ledger mutation replays pass. App graph, registry, ledger, compile-result, and shared
    helpers contain no live collection/scalar dispatch; the compiler suite passes 1,004/1,004 plus
    compiler dist/DTS and the security-classifier corpus.

- [x] **C131 - Mutable production-build traversal blesses an undeclared route.**
      `packages/server/src/vite-build.ts`
  - With one declared `/safe` route and genuine build hints, a selective late
    `Array.prototype.map` replacement returned an attacker `/undeclared-admin` route only when the
    production builder traversed the closed app route array. `deriveClosedKovoApp()` then blessed
    that forged route, and the build returned it as the sole production route.
  - **Acceptance:** app/routes, route entries, manifest hints, client modules, assets, render-plan
    fingerprints, and derived-app overrides are exact one-time snapshots traversed with build
    security intrinsics. Late collection/prototype/Proxy mutation cannot add, omit, reorder, or
    cross-bind a route, renderer, hint, module, or asset before static/deploy output.
  - **Evidence:** the exact late route-map replay retains only `/safe`; focused route/asset tests pass
    2/2 and the broader build matrix passes 65/65.

- [x] **C132 - Mutable manifest-asset traversal publishes an arbitrary host file.**
      `packages/server/src/{vite-build-assets,vite-build-output}.ts`
  - A selective late `Array.prototype.map` replacement targeted the genuine manifest asset array
    before `viteDistSourcePath()` ran and returned `{ path: '/assets/credentials.txt', source:
    '/tmp/.../credentials.txt' }`. The static build completed and copied the host-only credential
    bytes into the public export, bypassing the Vite dist-root confinement check entirely.
  - **Acceptance:** manifest/build asset carriers are exact own-data snapshots, and every generated
    source path is derived inside the reviewed dist root after snapshotting. Late traversal,
    getters, proxies, URL/path methods, or forged `StaticExportAssetInput` objects cannot bypass
    confinement or publish a source not explicitly supplied through the separate author-asset API.
  - **Evidence:** the exact host-credential asset replay writes no file outside the manifest-derived
    dist source; focused route/asset tests pass 2/2 and the static/Vite matrix passes 264 tests.

- [x] **C133 - Mutable shared compiler deduplication erases a required KV320 diagnostic.**
      `packages/compiler/src/shared.ts` and validator/emit consumers
  - A selective late `Array.prototype.filter` replacement targeted the exact
    `product.unitPrice` overlap facts while shared `dedupeBy()` ran. Compilation then returned zero
    diagnostics instead of the required KV320 lint, allowing a fire-and-forget client event to carry server-owned
    query truth as a shadow data transport.
  - **Acceptance:** shared dedupe/sort/split helpers and every security-diagnostic caller use
    compiler security intrinsics over dense own-data snapshots and witnessed sets. Late Array/Set/
    String methods, iterators/species, sparse/accessor arrays, or hostile callbacks cannot omit or
    rewrite prior closed verdicts; KV320 and the adjacent KV231/KV233/KV317/KV330 reject corpus
    remain a superset under the classifier-corpus gate.
  - **Evidence:** the exact late-filter replay retains KV320 without invoking the replacement;
    collection/iterator/string/CSS controls and shared source-replacement regressions pass in the
    119-test shared/compiler matrix, the 90-test output/CSS/fixpoint matrix, and
    `check:security-classifier-corpus` (`corpora=6`).

- [x] **C134 - Mutable compiler attribute escaping emits executable event-handler markup.**
      `packages/compiler/src/shared.ts` and lowering/emit consumers
  - A static external href containing `" onmouseover="...` was correctly escaped in the control.
    Replacing `String.prototype.replaceAll` only for that value during compiler lowering made the
    emitted server module contain a genuine `onmouseover` attribute beside the truncated href, with
    no compiler diagnostic.
  - **Acceptance:** HTML-attribute and CSS-string escaping, case/identifier normalization, emitted
    source slicing/replacement, and every final compiler serialization sink use boot-captured
    witnessed String/RegExp/JSON controls. Late or one-shot prototype mutation cannot change
    reviewed scalar bytes, terminate an attribute/string token, add code/markup, or desynchronize
    fixpoint/render-equivalence output; exact HTML/CSS adversarial corpora remain permanent.
  - **Evidence:** the exact late-`replaceAll` replay emits only `&quot;`-escaped href bytes and never
    a genuine event-handler attribute; captured CSS escaping, source patching, render equivalence,
    compiler dist/DTS, and the same focused 209-test matrices pass.

- [x] **C135 - Colliding compiler fact hashes suppress graph/cache invalidation.**
      `packages/compiler/src/{fact-hash,app-graph,hmr-impact}.ts`
  - Distinct canonical facts `hmr-authority-149599` and `hmr-authority-312382` both produced the
    former 32-bit FNV-1a identity `3e919d20`. Authority-bearing graph or HMR facts could therefore
    alias and replay stale derived output despite changed source truth.
  - **Acceptance:** every fact, app-graph contribution, ledger family, HMR impact, and cache identity
    uses collision-resistant hashing over one canonical immutable preimage through boot-pinned crypto
    controls; late scalar/hash mutation cannot alter or collapse the digest.
  - **Evidence:** the fixed collision pair now produces distinct 64-hex SHA-256 identities; the exact
    late `charCodeAt`/`Math.imul`/number-format replay receives zero calls, and the full compiler
    matrix plus dist/DTS pass.

- [x] **C136 - Mutable page-transition state bypasses the session bfcache reload floor.**
      `packages/browser/src/{query-visible-return,document-lifecycle}.ts`, generated inline loader
  - After installing the session-dependent `pageshow` defense, a late replacement of
    `PageTransitionEvent.prototype.persisted` returned false for a genuine native persisted event.
    Modular and generated runtimes then skipped the mandatory reload and left prior-principal DOM
    visible; the exploit reproduces 6/6 in Chromium, Firefox, and WebKit.
  - **Acceptance:** source and generated lifecycle runtimes read the native persisted state through
    one boot-pinned, witnessed, fail-closed control. Late getter/prototype/event substitution cannot
    suppress a session-dependent restore reload; exact three-engine parity remains permanent.
  - **Evidence:** exact modular/generated persisted-getter substitution reloads 6/6 in Chromium,
    Firefox, and WebKit; the full browser matrix passes 399/399.

- [x] **C137 - Mutable broadcast event data cross-binds private wire across principals.**
      `packages/browser/src/broadcast.ts`, generated inline loader
  - A late `MessageEvent.prototype.data` getter preserved session A's genuine private mutation body
    but rewrote only its principal stamp to session B. Modular and generated receivers then accepted
    and applied A's query/fragment truth in B's UI; the exploit reproduces 6/6 across three engines.
  - **Acceptance:** receive paths use a boot-pinned witnessed native data read and one immutable exact
    envelope snapshot before fingerprint comparison or apply. Event/prototype/getter substitution
    cannot change principal, build, query, fragment, or body truth after transport delivery.
  - **Evidence:** the exact modular/generated cross-principal getter substitution rejects 6/6 in
    Chromium, Firefox, and WebKit; the complete direct browser matrix passes 411/411.

- [x] **C138 - Raw-read unwrapping bypasses the read-only SQL choke.**
      `packages/test/src` verifier/harness adapters
  - `readonlyDb(...).rawRead` exposed the framework-managed raw target before execution, allowing a
    mutable adapter to execute DML outside statement classification; SQLite/PGlite engine denials
    also escaped the required KV433 mapping.
  - **Acceptance:** raw reads retain the managed read-only membrane through final dispatch, snapshot
    SQL/values/metadata once, reject write-capable statements before engine effects, and normalize
    every engine denial to the framework's fail-closed verdict.
  - **Evidence:** the exact managed raw-read/engine-denial regressions pass in the 158-test managed DB
    matrix; server dist/DTS and the API surface gate pass.

- [x] **C139 - Mutable SQL-observation collections erase a real read.**
      `packages/test/src/{sql-observer,verifier-observation}.ts`
  - Late `Array.prototype.flatMap` and `Set.prototype.has` replacements erased a genuine
    `SELECT audit_log` observation, so the runtime verifier reported KV407 coverage as green.
  - **Acceptance:** parsing, operation expansion, dedupe, domain/table membership, and recorder append
    use captured controls over exact snapshots; no collection replacement can omit or reclassify a
    database effect.
  - **Evidence:** exact flatMap/Set and inherited-index-setter proofs preserve the `audit_log` read and
    KV407 denial; the shared verifier append now commits bounded own-data slots.

- [x] **C140 - Mutable side-effect fingerprints hide trigger and cascade writes.**
      `packages/test/src` engine side-effect verifier
  - Targeted `Function.prototype.call` redirection plus constant `JSON.stringify` fingerprints hid
    same-row-count trigger/cascade updates from the engine before/after net while verification passed.
  - **Acceptance:** engine queries, row snapshots, canonical fingerprints, equality, and effect-net
    construction use pinned exact controls and collision-resistant identity; any ambiguity fails
    coverage closed.
  - **Evidence:** the exact trigger/cascade fingerprint substitutions fail closed in the 158-test
    managed DB matrix; server dist/DTS and the API surface gate pass.

- [x] **C141 - A query mutates its declared reads after executing an undeclared read.**
      `packages/test/src` query harness
  - The loader widened its own `query.reads` after reading an undeclared table; post-load traversal
    accepted the changed declaration and KV407 passed.
  - **Acceptance:** query identity and declared read policy are immutable construction-time snapshots
    shared by execution and post-run verification; loader code cannot alter its authority after use.
  - **Evidence:** the exact late `query.reads` widening proof still fails KV407 in the complete
    `@kovojs/test` matrix.

- [x] **C142 - A query deletes its output schema before result verification.**
      `packages/test/src` query harness
  - The loader assigned `query.output = undefined`; post-load lookup then skipped KV410 result-schema
    validation for the already-produced value.
  - **Acceptance:** the exact output schema/verifier is captured before loader execution and always
    validates the returned value; later mutation or property ambiguity rejects rather than disables
    KV410.
  - **Evidence:** the exact output deletion proof retains its pre-load validator and fails KV410 in
    the complete `@kovojs/test` matrix.

- [x] **C143 - Mutable Promise dispatch skips post-handler verification.**
      `packages/test/src` verifier harness
  - A targeted late `Promise.prototype.then` replacement recognized the coverage assertion and
    returned the captured result without invoking it, allowing an uncovered operation to resolve.
  - **Acceptance:** handler/loader settlement and every post-execution assertion use boot-pinned
    Promise observation; late then/catch/finally substitution cannot skip success or failure checks.
  - **Evidence:** the targeted Promise.then replacement receives no verification dispatch and the
    uncovered read remains rejected in the complete `@kovojs/test` matrix.

- [x] **C144 - A page mutates its declared reads after rendering.**
      `packages/test/src` page harness
  - `render()` widened its fixture `reads` before the post-render assertion, hiding an undeclared DB
    read and making runtime coverage pass.
  - **Acceptance:** page read policy is one immutable pre-render snapshot used by both execution and
    verification; render code cannot expand authority after the effect.
  - **Evidence:** the exact page-policy widening proof fails KV407 in the complete `@kovojs/test`
    matrix.

- [x] **C145 - A mutation changes its touch-graph scope after writing.**
      `packages/test/src` mutation harness
  - The handler changed caller-owned `touchGraphKey` from a restrictive entry to a permissive entry
    before post-handler coverage, hiding an out-of-scope write.
  - **Acceptance:** mutation identity, touch-graph key, graph entry, domains, and table policy are
    snapshotted before handler execution and remain the sole verification authority.
  - **Evidence:** the exact late touch-graph-key switch remains bound to the restrictive entry and
    fails KV402 in the complete `@kovojs/test` matrix.

- [x] **C146 - A late Proxy replacement removes server database membranes.**
      `packages/server/src` managed DB adapters
  - `wrapDbAdapter` and `readonlyCapabilityDb` constructed live global `Proxy` instances after app
    code could replace the constructor; returning the raw target removes KV422/KV433 method and
    write guards.
  - **Acceptance:** every managed/read-only DB proxy uses a boot-captured witnessed constructor and
    pinned traps/dispatch; late global Proxy replacement cannot expose or return an unwrapped target.
  - **Evidence:** late Proxy substitution receives no managed/read-only construction dispatch in the
    158-test managed DB matrix; server dist/DTS and the API surface gate pass.

- [x] **C147 - Mutable Promise resolution commits a rejected asynchronous SQLite transaction.**
      `packages/test/src` SQLite verifier adapter
  - Replacing `Promise.resolve` after setup swallowed the rejection from an asynchronous transaction
    callback, so a real `better-sqlite3` transaction committed its row even though the authored
    callback failed.
  - **Acceptance:** transaction callback settlement uses one boot-pinned, witnessed Promise path;
    late resolve/then/catch substitution cannot turn rejection into commit or skip rollback.
  - **Evidence:** the real `better-sqlite3` rejection rolls back under late Promise replacement in the
    158-test managed DB matrix; server dist/DTS and the API surface gate pass.

- [x] **C148 - Mutable graph traversal erases default-deny authority facts.**
      `packages/core/src/graph.ts`
  - Late `Array.prototype.map`/`flatMap` replacements erased access, authentication, session, and
    ownership facts before `kovo check`; adjacent live sort/join/filter/some and String operations
    could reorder or forge the same security graph.
  - **Acceptance:** graph derivation traverses dense own entries, uses witnessed set/string controls,
    manually assembles detail text, and deterministically sorts without ambient prototype dispatch.
  - **Evidence:** the exact late collection/string substitution receives zero calls while preserving
    every authority fact; the 27-test graph/intrinsic matrix and core dist/DTS build pass.

- [x] **C149 - Mutable Promise rejection handling suppresses a read-only engine denial.**
      `packages/test/src` read-only engine verifier
  - Late `Promise.prototype.then`/`catch` substitution converted a genuine engine rejection into a
    successful read-only result and skipped the required KV433 fail-closed mapping.
  - **Acceptance:** engine settlement and rejection normalization use captured native Promise
    observation so application code cannot suppress a denial or change its framework verdict.
  - **Evidence:** the exact late then/catch substitution retains the engine denial and KV433 mapping
    in the 158-test managed DB matrix; server dist/DTS and the API surface gate pass.

- [x] **C150 - A query rewrites its integration-fixture read authority after execution.**
      `packages/test/src/integration/fixture-instance.ts`
  - A loader performed an undeclared read, then widened `app.queries`/`query.reads`; post-execution
    live `find`/`map` traversal accepted the changed declaration and let integration verification pass.
  - **Acceptance:** the fixture snapshots the exact query definition, declared reads, loader, and
    verification authority before execution using own-data traversal; later mutation or prototype
    substitution cannot widen coverage.
  - **Evidence:** the exact app/query mutation plus find/map substitution proof fails KV407 in the
    integration fixture security suite.

- [x] **C151 - Mutable BroadcastChannel dispatch strips a private wire's principal stamp.**
      `packages/browser/src/broadcast.ts`, generated inline loader
  - A late `BroadcastChannel.prototype.postMessage` wrapper preserved session A's private body but
    deleted only its principal. An anonymous sibling then accepted and applied the genuine structured
    clone; modular and generated exploits reproduce 6/6 across three engines.
  - **Acceptance:** publishers use a boot-pinned witnessed channel constructor and postMessage over
    one immutable exact envelope. Late prototype replacement cannot remove or rewrite principal,
    build, query, fragment, or body truth before transport.
  - **Evidence:** exact modular/generated late and pre-init dispatch substitutions reject 6/6 across
    Chromium, Firefox, and WebKit; full browser and browser-package matrices pass 426/426 and 750/750.

- [x] **C152 - A mutable Response constructor converts verifier failure into HTTP success.**
      `packages/test/src/integration/fixture-instance.ts`
  - A query loader replaced `globalThis.Response` with a constructor that returned status 200.
    `verificationFailureResponse()` then converted a real KV407 response into successful attacker
    content instead of retaining the framework's failure status.
  - **Acceptance:** integration verification responses use a boot-captured, semantically witnessed
    Response constructor and exact status/body/header snapshot; late global replacement cannot turn
    any verifier failure into success.
  - **Evidence:** the exact late global Response replacement retains the genuine verifier status and
    body in the integration fixture security suite.

- [x] **C153 - A retained seed adapter escapes integration verifier observation.**
      `packages/test/src/integration/fixture-instance.ts`
  - `seed(rawDb)` retained the unwrapped adapter; a later query used that handle for an undeclared
    product read, while the verifier observed zero operations and returned HTTP 200 despite declaring
    only the cart domain.
  - **Acceptance:** the fixture constructs the verifier before seeding and passes only its wrapped
    adapter; retained setup handles remain observed during later query/page/mutation execution.
  - **Evidence:** retained seed DB use is captured or revoked, and setup writes do not satisfy runtime
    coverage; both exact regressions pass in the integration fixture security suite.

- [x] **C154 - Mutable authoring-surface traversal suppresses the KV235 internal-import gate.**
      `packages/compiler/src/validate/authoring-surface.ts`
  - A selective late `Array.prototype.filter` erased the real non-public Kovo import from the
    authoring-surface pass. A local re-export can then launder an internal raw-output capability past
    the source module that KV235 is required to reject under SPEC.md §5.2.
  - **Acceptance:** module/call/render traversal, internal/generated specifier classification, IR
    header recognition, diagnostics, and help assembly use boot-pinned compiler controls over dense
    own-data facts; late collection/string/RegExp replacement cannot suppress KV235.
  - **Evidence:** the exact internal-import filter receives zero calls and KV235 remains blocking;
    124 compiler/Vite/route tests, compiler dist/DTS, and all classifier routing/corpus gates pass.

- [x] **C155 - Mutable CSS attachment substitutes a forged closed-app route.**
      `packages/cli/src/commands/build-export.ts`, generated build handler
  - During CLI CSS attachment, a late `Array.prototype.map` replaced the genuine snapshotted
    `app.routes` with `/forged-admin`, making the build's route authority disagree with the closed app.
  - **Acceptance:** stylesheet manifests, closed app arrays, route lookup, and generated handler
    reconstruction use boot-pinned dense controls; late collection/Map/String substitution cannot add,
    remove, or replace a route while attaching CSS.
  - **Evidence:** the exact substitution receives zero calls; the 9-test build-export security-order
    matrix and component/per-route CSS integration controls pass.

- [x] **C156 - Encoded integration asset traversal discloses a sibling directory.**
      `packages/test/src/integration-server.ts`
  - `tryServeBuiltAsset()` used string-prefix containment. The request
    `/assets/..%2f..%2fdist-secret%2fsecret.txt` normalized into the sibling `dist-secret` directory
    and returned its secret bytes over HTTP.
  - **Acceptance:** decoded asset paths resolve beneath the exact assets root with separator-aware
    relative containment and pinned URL/path controls; encoded separators, traversal, and prefix
    collisions fail closed before any filesystem read.
  - **Evidence:** exact encoded-prefix traversal and escaping-symlink requests are denied in the
    boot-fixture static security suite.

- [x] **C157 - Mutable navigation-stamp classification suppresses KV235.**
      `packages/compiler/src/validate/markup.ts`
  - A selective late `Set.prototype.has` replacement hid the hand-authored `kovo-nav-segment`
    attribute. The real compiler returned no diagnostic even though SPEC §8 reserves enhanced-
    navigation segment identity and persistence policy to the loader/compiler.
  - **Acceptance:** reserved-stamp construction/membership, JSX element and attribute traversal,
    diagnostic collection, and help assembly use boot-pinned compiler controls over dense own-data
    facts; late Set/collection/string replacement cannot suppress the KV235 verdict.
  - **Evidence:** the exact private-set replacement receives zero calls and KV235 remains blocking;
    125 compiler/Vite/route tests, compiler dist/DTS, and classifier routing/corpus gates pass.

- [x] **C158 - Bare page thunks execute outside verifier capture.**
      `packages/test/src` page harness
  - A bare page thunk closed over `harness.db`, read the undeclared `products` domain, and resolved
    successfully because `loadHarnessPage()` executed it outside `verifier.capture`.
  - **Acceptance:** every page thunk executes inside verifier capture against an immutable declared
    read policy (empty when none is declared); no page representation can perform an unobserved read.
  - **Evidence:** the exact bare-thunk database read now fails the empty read policy in the complete
    `@kovojs/test` matrix.

- [x] **C159 - Residual server Proxy construction removes request security membranes.**
      `packages/server/src/{untrusted-request-body,request-input-provenance,request-carrier,app-load-shed,secret-read-boundary,webhook}.ts`
  - Six production paths still constructed live global `Proxy` values after application code could
    replace the constructor, allowing FormData tags, mass-assignment provenance, request body caps,
    secret boxing, or transaction scope to be removed with the raw target returned instead.
  - **Acceptance:** every remaining request/database security membrane uses the shared boot-captured,
    witnessed Proxy constructor and pinned traps; no production `new Proxy(...)` remains.
  - **Evidence:** exact late Proxy regressions retain all six membranes in an 82-test focused matrix;
    FormData stays tagged, writes tracked, body caps enforced, secrets boxed, and webhook scope denied.

- [x] **C160 - Mutable request URL rewrites post-dispatch verifier authority.**
      `packages/test/src/integration/fixture-instance.ts`
  - A query for `/_q/cart` made an undeclared products read, then shadowed `request.url` to
    `/_q/products`; post-dispatch verification re-read the forged URL and accepted the broader policy.
    Mutation touch-graph routing has the same TOCTOU.
  - **Acceptance:** verification snapshots and decodes the exact request route before dispatch with
    pinned URL controls; query and mutation verification consume only that immutable route authority.
  - **Evidence:** exact post-dispatch query and mutation URL rewrites remain bound to their original
    verification routes in the integration fixture security suite.

- [x] **C161 - Mutable framework-identity lookup suppresses raw-trust provenance.**
      `packages/core/src/internal/{framework-identity,framework-identity-catalog}.ts`
  - A selective late `Array.prototype.find` made the resolver treat an unrelated render parameter as
    the imported `trustedHtml` declaration. The real request-derived raw-HTML call then emitted no
    KV426. Adjacent live catalog/path operations could erase Drizzle/compiler identity facts.
  - **Acceptance:** expression/declaration/import/export/project traversal, path normalization,
    catalog construction/source lookup, set/map membership, and scalar parsing use captured security
    controls over dense frozen facts; late collection/string mutation cannot lose or forge identity.
  - **Evidence:** the exact render-parameter and catalog scalar substitutions receive zero calls;
    the 120-test core/compiler/Drizzle identity matrix, all three dist/DTS builds, API, and classifier
    routing/corpus gates pass.

- [x] **C162 - Mutable query-shape extraction downgrades secret wire facts.**
      `packages/core/src/internal/query-shape-source.ts`
  - Late `Array.prototype.map` either replaced an exact primary secret shape with a public string
    shape during merge or omitted every source file during output-schema extraction. The real serial
    build path then handed forged/missing KV435 authority to the compiler after app evaluation.
  - **Acceptance:** source/project traversal, TS dispatch, object/schema extraction, fact merge,
    dedupe/order, and every shape carrier use captured dense own-data controls; a changed or ambiguous
    fact fails closed and the C13 secret/table-row corpus remains a superset.
  - **Evidence:** 27 exact extraction/merge/security regressions pass with zero late collection
    dispatch; core/compiler/server dist builds plus import, API, and classifier gates pass.

- [x] **C163 - Integration route pages have no declared read policy.**
      `packages/test/src/integration/fixture-instance.ts`
  - A `/products` route read the products domain with no declaration and returned HTTP 200 because
    non-query/non-mutation routes skipped read verification entirely.
  - **Acceptance:** fixtures expose an explicit immutable page/route read-policy map with empty-deny
    default; every route-page operation is captured and undeclared reads fail KV407.
  - **Evidence:** undeclared route reads fail KV407 while the predeclared route read passes in the
    integration fixture security suite.

- [x] **C164 - Mutable BroadcastChannel subscription bypasses receive principal checks.**
      `packages/browser/src/broadcast.ts`, generated inline loader
  - A late `BroadcastChannel.prototype.onmessage` setter wrapped the receiver and delivered a new
    brand-valid event with session A's private body but no principal. Modular/generated anonymous UIs
    applied it synchronously before the asynchronous controls witness; exploit reproduces 6/6.
  - **Acceptance:** subscription uses only a captured witnessed setter/listener and cannot process any
    event before controls readiness; late setter interposition cannot bypass the C137 snapshot floor.
  - **Evidence:** exact modular/generated subscription substitutions reject 6/6 across Chromium,
    Firefox, and WebKit; full browser and browser-package matrices pass 432/432 and 750/750.

- [x] **C165 - Integration route pages can write outside mutation authority.**
      `packages/test/src/integration/fixture-instance.ts`
  - A non-mutation page wrote the products domain under an empty touch graph and returned HTTP 200;
    the newly explicit route read check still did not assert the no-write invariant from SPEC §11.2.
  - **Acceptance:** every route/page request first asserts zero writes against immutable empty write
    authority, then checks declared reads; page writes fail KV402 before response success.
  - **Evidence:** the exact route-page write returns a KV402 verification failure in the integration
    fixture security suite.

- [x] **C166 - Read-only query and page harnesses ignore writes.**
      `packages/test/src` harness and integration query paths
  - Query loaders and object/thunk page renderers called only read-coverage checks; each could write a
    mapped products domain and resolve successfully instead of KV402. Integration `/_q/` was symmetric.
  - **Acceptance:** every read-only execution path asserts zero observed writes before read coverage;
    query, object-page, thunk-page, route-page, and integration query paths share the invariant.
  - **Evidence:** exact query, object-page, thunk-page, route-page, and integration-query write proofs
    all fail KV402 in the complete `@kovojs/test` matrix.

- [x] **C167 - Standalone mutation reads escape declared read coverage.**
      `packages/test/src` mutation verifier
  - `assertMutationReadsCovered()` considered only reads embedded inside write statements
    (`mutationRead === true`). A standalone `request.db.read('products')` inside the same mutation
    capture window bypassed an empty declared read policy and resolved successfully.
  - **Acceptance:** every read observed during mutation capture is mutation-scoped and checked against
    the immutable declared reads; `mutationRead` remains provenance metadata, never an inclusion gate.
  - **Evidence:** the exact undeclared standalone mutation read fails KV407 while the declared
    counterpart passes in the complete `@kovojs/test` matrix.

- [x] **C168 - Mutable storage byte copying substitutes validated upload bytes.**
      `packages/core/src/{storage,internal/filesystem-intrinsics}.ts`
  - A selective late `ArrayBuffer.prototype.slice` replaced a genuine typed-array upload with attacker
    bytes after validation; adjacent mutable view getters, stream readers, constructors, copy methods,
    and stream controllers could change the carrier at the same boundary.
  - **Acceptance:** raw buffers, offset views, stream acquisition/results, chunk snapshots, final
    assembly, adapter handoff, returned copies, and stream construction use boot-pinned witnessed byte
    controls so the bytes classified are the bytes stored and returned.
  - **Evidence:** the 30-test storage matrix exercises every carrier family under late substitution;
    core dist/DTS plus filesystem, sink, single-choke, TCB, API, and diff gates pass.

- [x] **C169 - Mutable public-asset ordering publishes a private sibling file.**
      `packages/cli/src/commands/build-export.ts`
  - A selective late `Array.prototype.sort` replaced `/mark.svg` with `/server-secret.env`; the real
    static export then copied the secret file into the public artifact under the expected asset path.
  - **Acceptance:** public-root discovery, relative-path ownership, deterministic ordering, and copy
    inputs use boot-pinned dense controls; late collection mutation cannot add, replace, or redirect an
    asset outside the exact public root.
  - **Evidence:** the exact real-export substitution receives zero calls, emits only `/mark.svg`, and
    omits the sibling secret; 139 focused static-export/bootstrap tests and all build boundary gates pass.

- [x] **C170 - A split-view Drizzle table reports one domain and executes another.**
      `packages/test/src` managed database verifier
  - A Proxy-backed table exposed `cart` to verifier classification but `audit` to the retained adapter,
    letting an operation pass declared-read checks while the engine executed against a different table.
  - **Acceptance:** table carriers are rejected when proxied and their exact table identity is captured
    once through witnessed Drizzle controls before both observation and adapter dispatch.
  - **Evidence:** the exact Proxy split-view regressions and adjacent managed-query controls pass in
    the 232-test verifier matrix; the retained adapter sees the same witnessed table as classification.

- [x] **C171 - Mutable BroadcastChannel retirement reopens a closed private subscription.**
      `packages/browser/src/broadcast.ts`, generated inline loader
  - Late `onmessage = null` and `close()` interposition made `MutationBroadcast.close()` retire only an
    attacker wrapper; a subsequent private message still reached and updated the closed subscriber.
  - **Acceptance:** retirement flips an immediate private state bit and uses captured clear/close
    controls; late method/setter replacement and close-before-ready races cannot deliver after close.
  - **Evidence:** exact late retirement, close-before-ready, and pre-init regressions pass 9/9 across
    three engines; full browser matrices pass 441/441 and 751/751 plus inline-loader and TT gates.

- [x] **C172 - Mutable post-replay path resolution redirects static export outside its root.**
      `packages/server/src/{static-export,artifact-output-manifest}.ts`, core filesystem boundary
  - A route replaced CommonJS `node:path.resolve`, synchronized the ESM binding, and made export
    re-resolve its already validated output root as an outside directory; full generated HTML was
    written outside while the configured safe directory remained bypassed. A lower artifact-output
    seam can rebind both root and target the same way.
  - **Acceptance:** static/Vite/artifact output roots and every downstream target derive once through
    boot-pinned path controls and remain bound to the confined output capability after app replay.
  - **Evidence:** 62 focused cross-package output/filesystem tests plus the exact synchronized path-
    binding replay prove both configured and lower artifact roots remain confined; builds and gates pass.

- [x] **C173 - Mutable filesystem-stat predicates permit writes through a symlink parent.**
      `packages/core/src/internal/filesystem.ts`
  - Late `Stats.prototype.isSymbolicLink = () => false` plus `isDirectory = () => true` made the real
    output boundary accept a symlinked parent and write `escaped.txt` into its outside target.
  - **Acceptance:** Stats/Dirent brands, kind predicates, identity/size/time facts, and every root,
    parent, target, read, delete, and traversal decision use boot-pinned witnessed controls.
  - **Evidence:** the exact late Stats prototype proof fails closed without creating the outside file;
    the 50-test integrated filesystem/storage matrix and core/server builds pass.

- [x] **C174 - Mutable FileHandle methods substitute outside bytes after path validation.**
      `packages/core/src/internal/filesystem.ts`
  - A late `FileHandle.prototype.readFile` replacement ran after exact realpath/open confinement and
    returned a sibling secret instead of the bytes from the validated inside handle.
  - **Acceptance:** handle stat/read/stream/close operations are pinned or dispatched through exact
    builtin controls bound to the validated handle; no late FileHandle method is authority-bearing.
  - **Evidence:** the exact late FileHandle replacement receives zero calls and the confined read
    returns `inside`; the 50-test integrated filesystem/storage matrix passes.

- [x] **C175 - Mutable node:path bindings escape the core output filesystem boundary.**
      `packages/core/src/internal/filesystem.ts`
  - Selective CommonJS `node:path.resolve` replacement plus `syncBuiltinESMExports()` returned an
    outside target during candidate construction and a forged inside path during containment. The
    real boundary completed successfully and wrote outside its pinned root.
  - **Acceptance:** every path primitive used for root capture, confinement, parent walking, staging,
    copy, rename, delete, and traversal is captured and witnessed before application evaluation.
  - **Evidence:** the synchronized `node:path` replacement receives zero calls and no outside target is
    written; the 50-test integrated matrix plus filesystem/sink/single-choke gates pass.

- [x] **C176 - Empty-auth navigation retains the previous broadcast principal.**
      `packages/browser/src` modular and generated enhanced-mutation paths
  - The supported successful empty-auth fallback performed hard navigation without retiring mutation
    broadcast authority. A real installed channel remained open with its receiver attached, so old-
    principal envelopes could still apply during delayed or cancelled navigation.
  - **Acceptance:** accepted auth/session-change fallbacks synchronously retire the principal channel
    before sanitized navigation in modular and generated paths; non-auth redirects remain unchanged.
  - **Evidence:** 107 focused modular/generated transition tests, full Node browser 752/752, and the
    three-engine browser matrix 441/441 pass with retirement ordered before navigation.

- [x] **C177 - Mutable structural lowering suppresses required text escaping.**
      `packages/compiler/src/lower/structural-jsx.ts`
  - A selective late `Array.prototype.some` reported that an ordinary `<h2 class="title">` already
    carried a generated binding. The real compiler then emitted `{product.name}` without `escapeText`,
    reopening raw server text interpolation for query-controlled markup.
  - **Acceptance:** static-text element/attribute/child traversal, binding exclusion, expression and
    trusted-composition classification, render-input lookup, and output-fact insertion use captured
    dense controls; late collection/string/Set mutation cannot suppress an escape.
  - **Evidence:** the exact substitution receives zero calls and retains `escapeText(product.name)`;
    112 structural/text/query/output security tests and compiler dist/DTS pass.

- [x] **C178 - Mutable structural helper emission injects executable server source.**
      `packages/compiler/src/lower/structural-jsx.ts`
  - A selective late `Array.prototype.join` replaced the one compiler-owned `escapeText` import name
    with a complete import terminator plus `globalThis.KOVO_COMPILER_INJECTION = true`. The real
    generated server module contained the injected executable statement.
  - **Acceptance:** helper/runtime import selection, dedupe, ordering, joining, derive assembly, and
    replacement insertion use captured dense controls; app code cannot contribute compiler source.
  - **Evidence:** the exact join receives zero calls and generated source contains only the canonical
    import; 113 structural/output tests, compiler dist/DTS, and all classifier corpus/routing gates pass.

- [x] **C179 - Mutable Node filesystem/crypto bindings replace validation and write operations.**
      `packages/core/src/internal/filesystem.ts`
  - `syncBuiltinESMExports()` updates the live imported `node:fs/promises` functions and
    `node:crypto.randomUUID`; late replacements can falsify lstat/realpath/stat, redirect file sinks,
    or inject separators into supposedly private temporary names.
  - **Acceptance:** every filesystem/crypto operation and temporary-name byte is captured and
    witnessed in one private membrane before authored code; synchronized builtin exports are inert.
  - **Evidence:** late synchronized fs/path/crypto replacement regressions pass in the 62-test focused
    matrix; core/server builds and filesystem, sink, single-choke, and TCB gates pass.

- [x] **C180 - Reauthentication navigation retains the expired broadcast principal.**
      `packages/browser/src` modular and generated enhanced-mutation paths
  - A 401 `Kovo-Reauth` response hard-navigated toward login without closing the old principal's
    mutation broadcast. Cancelled/delayed navigation left the real channel and receiver live.
  - **Acceptance:** reauthentication synchronously retires principal authority before safe/unsafe
    directive sanitization and navigation in modular/generated paths; ordinary navigation is unchanged.
  - **Evidence:** 113 focused branch/ordering tests, full Node browser 758/758, and three-engine
    browser 441/441 pass with retirement before every reauth navigation form.

- [x] **C181 - Mutable inline-derive emission injects executable server and client source.**
      `packages/compiler/src/lower/structural-jsx.ts`, `packages/compiler/src/emit/client.ts`
  - Replacing `Array.prototype.join` only for derive parameters `['now', 'cart']` closed the generated
    arrow function, injected a global statement, and commented out the remainder. Both emitted server
    and client modules contained executable `KOVO_DERIVE_INJECTION` source.
  - **Acceptance:** inline derive inputs, parameters, exports, state/output facts, and corresponding
    client derive emission use captured JSON/array/dense controls from one immutable fact.
  - **Evidence:** the exact join receives zero calls and neither module contains injected source;
    140 derive/structural/output tests and compiler dist/DTS pass.

- [x] **C182 - Caller-controlled staging prefixes escape the output capability.**
      `packages/core/src/internal/filesystem.ts`
  - `createStagingRoot('../../../escaped-staging-')` joined the unvalidated prefix beneath the root's
    sibling parent and made `mkdtemp` create a directory several ancestors outside that authority.
  - **Acceptance:** staging prefixes are strict nonempty single filename segments with no dot/parent,
    separator, absolute, or control-byte form; the final template remains beneath the pinned sibling.
  - **Evidence:** parent, absolute, separator, dot, and control-bearing prefix regressions reject before
    `mkdtemp`; valid private staging remains green in the focused filesystem/output matrix.

- [x] **C183 - Mutable bfcache guard enrollment suppresses persisted-page retirement.**
      `packages/browser/src` session/bfcache security controls
  - Late `Document.prototype.querySelector` hid a genuine `kovo-session` meta, while a separate late
    `EventTarget.prototype.addEventListener` replacement suppressed only `pageshow` enrollment. All
    six three-engine probes delivered persisted pages with zero reloads.
  - **Acceptance:** real-document session lookup and EventTarget add/remove/dispatch use boot-pinned
    witnessed controls; structural test seams remain explicit and disposal is exact.
  - **Evidence:** both late-poison attacks pass 6/6 across Chromium, Firefox, and WebKit; focused Node
    passes 35/35, focused browser 36/36, and the full browser matrix passes 447/447.

- [x] **C184 - Mutable client-handler emission injects executable browser source.**
      `packages/compiler/src/emit/client.ts`
  - A selective `Array.prototype.map` replaced the exact `emitHandlerExport` traversal with
    `globalThis.KOVO_HANDLER_INJECTION = true`; the generated immutable client module contained and
    would execute that statement instead of the reviewed handler.
  - **Acceptance:** handler/import/constant/state-derive traversal and top-level client block assembly
    use captured dense controls; emitted source derives only from the snapshotted lowering facts.
  - **Evidence:** the exact map receives zero calls and the canonical handler remains; 100 handler/
    capture/query/structural tests and compiler dist/DTS pass.

- [x] **C185 - Mutable ReadStream dispatch substitutes bytes from a validated descriptor.**
      `packages/core/src/internal/filesystem.ts`
  - Replacing `fs.ReadStream.prototype._read` after boundary construction made a confined stream read
    yield `FORGED` instead of `INSIDE`, despite the underlying opened descriptor remaining valid.
  - **Acceptance:** confined streaming uses a private numeric-fd Web stream over pinned read,
    controller, cancel, EOF, and close controls, with no late ReadStream prototype dispatch.
  - **Evidence:** the exact `_read` replacement receives zero calls and yields only validated descriptor
    bytes; focused filesystem/output tests, package builds, and authority gates pass.

- [x] **C186 - Default Trusted Types policy blocks the navigation-security witness.**
      `packages/browser/src` navigation security intrinsics
  - Under Kovo's default Trusted Types CSP, framework initialization assigned raw text through
    `innerHTML` while self-testing DOM controls. The import failed, so ordinary mutation forms fell
    back to native 303 submission without the enhanced navigation security layer.
  - **Acceptance:** the self-witness uses Trusted-Types-compatible DOM construction and proves the
    exact pinned controls under the default policy in every supported browser engine.
  - **Evidence:** the default-CSP integration proof loads the versioned runtime, transitions the
    bootstrap sentinel to the installed runtime with zero TT violations, and the full browser matrix
    passes 453/453 plus 1/1 Playwright integration.

- [x] **C187 - Mutable request URL views select a more permissive verifier scope.**
      `packages/test/src` request and response verification
  - Late `Request.url` and `URL.pathname` getter replacement can make pre-dispatch verification
    classify a request under a different, more permissive route scope; adjacent response error/RegExp
    seams can similarly change what the verifier reports after execution.
  - **Acceptance:** request identity, canonical pathname, scope selection, and response/error matching
    consume one boot-pinned witnessed snapshot that cannot diverge across dispatch and verification.
  - **Evidence:** exact Request/URL getter and response classifier regressions remain bound to their
    original scope; the integrated packages/test matrix passes 245/245 and browser passes 381/381.

- [x] **C188 - Mutable async-iterator dispatch deletes unrelated static-export files.**
      `packages/core/src/internal/filesystem.ts`, server/script output staging
  - Static cleanup consumed framework enumeration through `for await`. Replacing the shared async-
    iterator protocol made cleanup yield an unrelated in-root user file, which was then deleted.
  - **Acceptance:** authority-bearing enumeration returns a promised dense snapshot; cleanup rejects
    iterable/proxy ambiguity and consumes only indexed framework-owned names without protocol dispatch.
  - **Evidence:** the exact poisoned iterator is rejected before any delete, valid cleanup remains green,
    and 7 server plus 12 script/gate tests and the filesystem boundary gate pass after integration.

- [x] **C189 - Symlinked fixture asset roots redefine the trusted containment root.**
      `packages/test/src` integration fixture serving
  - Canonical containment began at `realpath(dist/assets)`, so symlinking the entire `dist` or `assets`
    directory outside the fixture established the outside directory itself as trusted and served it.
  - **Acceptance:** canonical fixture, dist, and assets roots form one witnessed containment chain;
    root-level symlinks fail closed before fixture content is served.
  - **Evidence:** both dist-root and assets-root symlink regressions reject outside content; fixture
    static-security tests pass 6/6 within the 245-test package matrix.

- [x] **C190 - Split-view static-export artifacts substitute executable output after validation.**
      `packages/server/src/static-export-output.ts`
  - Proxy-backed artifact arrays exposed reviewed bodies to target validation, then returned malicious
    script HTML when planned writes indexed the original plan, placing unreviewed bytes in `writes`.
  - **Acceptance:** all artifact families are snapshotted once into a private dense bundle used by both
    target validation and write construction; no live caller array is re-read.
  - **Evidence:** the exact Proxy split-view plan retains only `REVIEWED`, all returned artifact/write
    arrays and the plan are frozen, and 43 static-export/output tests plus server build and gates pass.

- [x] **C191 - Mutable integration database hooks bypass lifecycle verification.**
      `packages/test/src` integration fixture database bridge
  - Capability hooks were captured only after seed execution and cross-SSR hook properties remained
    configurable. A retained seed/app database could replace the PGlite reader/write hook before
    lifecycle resolution, hiding engine reads or committing writes before post-hoc rejection.
  - **Acceptance:** exact hooks are captured before seed, bridge/raw-read properties are sealed, and
    retained seed or app references cannot replace any verifier observation or dispatch control.
  - **Evidence:** retained seed/app references cannot replace sealed private capability shells; engine
    reads/writes remain observed across 245 package tests and the real manual fixture.

- [x] **C192 - Mutable manifest traversal accepts stale flat static-export documents.**
      `packages/server/src/static-export-result.ts`
  - Selective late `Array.map`/`filter` replacement made a real `/about.html` manifest appear as the
    required `/about/index.html` directory-index shape, allowing stale compatibility output after replay.
  - **Acceptance:** inventory, route-document matching, header copies, dry/write signatures, and Set/
    string/JSON facts consume private own-data snapshots without mutable collection or serialization dispatch.
  - **Evidence:** exact flat-output and JSON/toJSON drift regressions remain blocking; 23 manifest/Vite
    build tests, 10 direct manifest tests, server build, and authority gates pass.

- [x] **C193 - Mutable handler-param projection injects executable client source.**
      `packages/compiler/src/emit/client.ts`, `packages/compiler/src/types.ts`
  - A selective late `Array.map` replaced the reviewed `item.id` parameter projection with a forged
    attribute name that terminated `ctx.params`, injected a global statement, and commented out the rest.
  - **Acceptance:** element parameters, accesses, references, replacement selection/dedupe, identifier
    normalization, and emitted body assembly use pinned dense/string/RegExp controls.
  - **Evidence:** the exact projection replacement receives zero calls and the canonical handler remains;
    155 compiler/handler/output tests, compiler dist/DTS, and diff checks pass.

- [x] **C194 - Enhanced mutation dispatch loses its scheduled request binding.**
      browser runtime and integration request scheduling
  - A real enhanced manual mutation reaches its handler with an undefined scheduled request and crashes
    at `request.db`, preventing the intended request-scoped verifier path from completing.
  - **Acceptance:** enhanced dispatch binds the exact scheduled request through handler execution and
    verification; ordinary enhanced and no-JS controls retain equivalent authority and outcomes.
  - **Evidence:** app-mutation/verifier tests pass 42/42; the exact Playwright enhanced raw-write case
    reaches request-scoped verification and completes with the expected rejection, while TT control passes.

- [x] **C195 - Mutable handler-param attribute emission injects raw server markup.**
      `packages/compiler/src/emit/server-render.ts`, `packages/compiler/src/types.ts`
  - A selective late parameter `Array.map` replaced the reviewed quantity attribute with a tag-closing
    string and raw `<img>`; the real lowered server module contained the injected attacker markup.
  - **Acceptance:** parameter snapshots, type stamps, attribute escaping/assembly, chained handlers,
    module allowlists, and output-context facts use pinned dense/string/Set controls over one fact set.
  - **Evidence:** the exact replacement receives zero calls and only canonical escaped attributes emit;
    155 compiler/handler/output tests and compiler dist/DTS pass.

- [x] **C196 - Mutable endpoint-ref diagnostics disable static-export L0/L1 blocking.**
      static-export route protocol blocker
  - Replacing `Array.map` for mutation/query endpoint references produced zero diagnostics. Export then
    succeeded and wrote `/cart/index.html` containing a live `/_m/cart/add` form.
  - **Acceptance:** endpoint references are snapshotted and indexed into deterministic diagnostics;
    no mutable collection method can erase L0/L1 protocol blockers after route evaluation.
  - **Evidence:** the exact late-map route remains KV229-blocked with no output; 14/14 endpoint and
    filesystem-boundary tests, server build, and all build authority gates pass.

- [x] **C197 - Mutable query-dependency projection injects executable server source.**
      `packages/compiler/src/emit/server-render.ts`
  - A selective late `Array.map` replaced compiler-owned dynamic dependency expressions with a global
    assignment. The real server module executed it inside the generated `kovo-deps` expression.
  - **Acceptance:** query entries/tokens, dedupe, dynamic/static rendering, JSON literals, and host
    stamp assembly use pinned dense/Set/string controls without caller collection dispatch.
  - **Evidence:** the exact projection receives zero calls and canonical query-key expressions remain;
    196 compiler/stamp/handler/output tests and compiler dist/DTS pass.

- [x] **C198 - Mutable handler-patch traversal replaces reviewed server markup.**
      `packages/compiler/src/emit/server-render.ts`
  - Replacing the exact `handlerSourceReplacement` map returned a forged source span and raw `<img>`;
    the real lowered server module used the attacker patch instead of the reviewed handler attribute.
  - **Acceptance:** handler partitioning, chained/host patch construction, output-context projection,
    conflict diagnostics, and final patch accumulation use indexed snapshots and pinned identity sets.
  - **Evidence:** the exact replacement receives zero calls and the canonical handler attribute emits;
    the 196-test compiler matrix and dist/DTS build pass.

- [x] **C199 - Mutable template-literal escaping injects executable server statements.**
      `packages/compiler/src/emit/server-render.ts`
  - A selective final `String.replaceAll` closed `renderSource()`'s generated template literal,
    executed a global assignment, and returned a new template before the wrapper function closed.
  - **Acceptance:** backslash, backtick, and interpolation escaping use boot-pinned string controls;
    final server-source wrapping cannot add bytes after escaping.
  - **Evidence:** the exact final replacement receives zero calls and no injected statement appears;
    the 196-test compiler matrix and compiler dist/DTS pass.

- [x] **C200 - Mutable artifact accumulation substitutes bytes after static-export approval.**
      `packages/server/src/static-export.ts` and build intrinsics
  - A first route replaced `Array.push` so the next route's post-KV229 artifact commit substituted HTML
    containing a live mutation form; the unapproved bytes reached the real output directory.
  - **Acceptance:** approved artifacts commit through a boot-pinned own-data append that bypasses live
    methods and inherited numeric setters, preserving exactly the bytes inspected by the blocker.
  - **Evidence:** the exact two-route substitution retains approved HTML and writes no live form;
    19/19 focused tests, server build, and filesystem/import/API/export/choke/TCB gates pass.

- [x] **C201 - Inherited fixture MIME entries turn unknown assets into active HTML.**
      `packages/test/src` integration fixture server
  - Fixture code can add an unknown extension to `Object.prototype`; the prototype-bearing MIME table
    then serves that otherwise octet-stream asset as `text/html`, changing passive bytes into active content.
  - **Acceptance:** MIME authority is a frozen null-prototype own-data table and lookup rejects inherited,
    accessor, unstable, or unknown entries while preserving reviewed known types.
  - **Evidence:** prototype-polluted unknown extensions remain octet-stream while reviewed MIME types
    retain exact headers; static-security tests pass 6/6 and packages/test passes 245/245.

- [x] **C202 - Mutable preset retention filtering suppresses mandatory deploy-skew diagnostics.**
      `packages/server/src/build.ts`
  - A static route replaced `Array.filter` after neutral export; node preset inspection then omitted
    required KV417 even though the build emitted a versioned client module needing deploy retention.
  - **Acceptance:** preset retention classification snapshots client modules and uses pinned indexed
    suffix checks; route evaluation cannot suppress a required policy diagnostic.
  - **Evidence:** the exact neutral-build/preset regression retains KV417; build tests pass 32/32,
    filesystem gate tests 11/11, server build, and all authority gates pass.

- [x] **C203 - Mutable form-attribute search suppresses repeatable mutation identity.**
      `packages/compiler/src/emit/mutation-form.ts`
  - Selective late `Array.some` fabricated an authored `key` on a repeatable enhanced mutation form.
    KV238 disappeared and typed lowering proceeded instead of blocking ambiguous per-item identity.
  - **Acceptance:** form/error/control discovery, key and field diagnostics, schema sets/maps, stream
    targets, source replacements, CSRF imports, and explain facts use pinned dense/scalar controls.
  - **Evidence:** the exact poison receives zero calls, KV238 remains, and no mutation action emits;
    172 mutation/stamp/registry/diagnostic/compiler tests plus compiler dist/DTS pass.

- [x] **C204 - Database proxy descriptors vend raw unobserved authority.**
      `packages/test/src` verifier database membrane, with production managed-DB parity under review
  - The verifier Proxy traps `get` but not `getOwnPropertyDescriptor`; reading the descriptor value for
    `query`, `write`, or the capability symbol returns the raw adapter function and bypasses observation.
  - **Acceptance:** every reflective path exposes the same wrapped, witnessed operations as ordinary
    property access; descriptors cannot vend a writer or unobserved reader behind the verifier.
  - **Evidence:** root, nested, prepared, inherited-data, accessor, and non-configurable descriptor
    regressions fail closed or expose only observed methods; the 245-test verifier package matrix passes.

- [x] **C205 - Mutable built-in preset aggregation erases blocking deploy diagnostics.**
      node, Vercel, and Cloudflare preset inspectors
  - Live iterator/spread/push and RegExp dispatch can erase KV417/KV445/KV446 and Cloudflare unsupported-
    Node-API findings after their underlying classifiers run, making preset inspection fail open.
  - **Acceptance:** all built-in preset classification and diagnostic aggregation uses boot-pinned
    snapshots, indexed commits, and RegExp controls with deterministic nonempty blocking results.
  - **Evidence:** exact iterator, push, and RegExp suppression proofs retain KV417/KV445/KV446,
    missing-handler, and Cloudflare blocked-module errors; 47/47 build/gate tests and all gates pass.

- [x] **C206 - Mutable semantic normalization blesses visible server-render drift.**
      `packages/compiler/src/emit/render-equivalence.ts`
  - A selective late `String.replace` rewrote only the actual semantic render from `attacker` to
    `reviewed`; the real equivalence gate returned `ok: true` for visibly different server output.
  - **Acceptance:** semantic parsing, tag/attribute normalization, authored-token comparison, child/
    form/query rendering, sorting, JSON, VM evaluation, and final comparison use boot-pinned controls.
  - **Evidence:** the exact normalization replacement receives zero calls and the drift remains
    blocking; 162 render-equivalence/compiler/stamp/output tests and compiler dist/DTS pass.

- [x] **C207 - Mutable live-target export traversal injects executable server source.**
      `packages/compiler/src/emit/live-target-renderers.ts`
  - A selective late `Array.map` replaced the compiler-owned live-target renderer export with a global
    assignment; the executable statement landed inside the real lowered server module.
  - **Acceptance:** fact/query/import traversal, TypeScript AST import augmentation, identifiers, JSON,
    slicing, escaping, and final export assembly use boot-pinned dense/scalar controls.
  - **Evidence:** the exact replacement receives zero calls and only the canonical renderer emits;
    163 compiler/stamp/registry/query tests and compiler dist/DTS pass.

- [x] **C208 - Mutable Cloudflare TOML assembly replaces reviewed deploy configuration.**
      Cloudflare preset emission
  - Route-time `Array.join` replacement can substitute the final `wrangler.toml` after its fields were
    reviewed, changing worker `main`, routes, bindings, or compatibility configuration on disk.
  - **Acceptance:** every TOML field/line/array and final composition uses pinned snapshots and scalar
    escaping; the emitted bytes are exactly the reviewed preset configuration.
  - **Evidence:** the exact route-time join and option-mutation proof retains the reviewed worker,
    date, routes, and bindings; 49/49 build/gate tests, server build, and authority gates pass.

- [x] **C209 - Mutable bootstrap import traversal injects executable client source.**
      `packages/compiler/src/emit/bootstrap.ts`
  - A selective late `Array.map` replaced the compiler-owned component import line with a global
    assignment; the attacker statement landed at top level in the emitted app client bootstrap.
  - **Acceptance:** input facts, hashes/aliases, imports/specifiers, query/clock plans, JSON, dedupe, and
    final source assembly use boot-pinned compiler controls without caller collection dispatch.
  - **Evidence:** the exact import replacement receives zero calls and the canonical aliased import
    remains; 90 bootstrap/compiler/query tests and compiler dist/DTS pass.

- [x] **C210 - Mutable native form submission diverts enhanced-mutation fallback.**
      modular, bootstrap, and generated deferred browser paths
  - After bootstrap enrollment, late replacement of `HTMLFormElement.prototype.submit` intercepts the
    runtime-import rejection fallback in Chromium, Firefox, and WebKit after default submission was prevented.
  - **Acceptance:** genuine form fallback uses a boot-captured witnessed native submit control in every
    runtime path; explicit structural test fakes remain supported without granting authored authority.
  - **Evidence:** 468 direct browser tests pass across Chromium, Firefox, and WebKit; the 96 focused
    fallback proofs, 49 Node inline/form tests, browser build, generated loader checks, and security
    gates prove late and pre-import replacement cannot intercept genuine native fallback.

- [x] **C211 - Nested test database handles escape verifier observation.**
      `packages/test/src` database verifier
  - Test verification recognizes only a subset of nested driver handles; `db.session` and replica-style
    handles can expose raw SQL execution without the observation membrane used by production.
  - **Acceptance:** the full nested driver-handle family recursively enters the same reflective verifier
    membrane, or fails closed when its topology cannot be witnessed.
  - **Evidence:** session, pglite/sqlite/client/$client, $primary, and frozen replica read/write proofs
    remain observed; malformed/late-mutated carriers fail closed and packages/test passes 247/247.

- [x] **C212 - Mutable typed mutation-form assembly injects raw server markup.**
      `packages/compiler/src/emit/server-emit-shared.ts`
  - Selective late `Array.join` replaced reviewed generated method/action/mutation attributes with a
    tag-closing raw `<img>`; the lowered server module contained the attacker element.
  - **Acceptance:** form binding/key/schema discovery, attributes, conflicts, CSRF/idem replacements,
    targets, template escaping, output facts, and final assembly use boot-pinned compiler controls.
  - **Evidence:** the exact join receives zero calls and canonical form attributes remain; 209 central
    compiler/form/registry/handler tests and compiler dist/DTS pass.

- [x] **C213 - Mutable Node preset package inputs emit an attacker dependency graph.**
      Node preset runtime package and lockfile emission
  - Route-time `JSON.parse` replacement injected attacker name/packageManager/dependencies into emitted
    `package.json`; separately, iterator replacement suppressed the runtime lockfile copy.
  - **Acceptance:** package parsing, own-data manifest/dependency snapshots, key traversal, and lockfile
    selection/copy use pinned controls after route evaluation.
  - **Evidence:** both real node.emit attacks retain reviewed package metadata and the lockfile; 51/51
    build/gate tests, server build, supply-chain check, and all authority gates pass.

- [x] **C214 - Drizzle read builders escape test-verifier observation.**
      `packages/test/src` database verifier
  - `db.select().from(table)` and relational `db.query.<table>.findMany()` return raw builders/namespaces,
    so undeclared reads can execute while readset verification reports no observation.
  - **Acceptance:** select/with and relational builder families use the same witnessed recursive membrane
    as production, with table identity bound before execution and reflective paths fail closed.
  - **Evidence:** select/selectDistinct/join/count/with/CTE and relational namespace/builder proofs
    observe exact readsets while raw/unresolvable/malformed paths fail KV407; packages/test passes
    249/249 with the focused 68-test matrix, dist build, and classifier/guarantee gates green.

- [x] **C215 - Mutable post-replay request construction cross-binds static-export routes.**
      `packages/server/src/static-export-request.ts`
  - A first route can replace the live `URL`/`Request` globals after replay setup so a later public
    target is rendered with a privileged sibling request body while retaining the public artifact path.
  - **Acceptance:** synthetic URL/Request construction and the returned pathname/target identity use
    boot-pinned, witnessed controls; route evaluation cannot cross-bind request authority or output bytes.
  - **Evidence:** the exact two-route proof retains `/public` request identity and bytes under late
    `URL`/`Request` replacement; 31 static-export/build/gate tests, server build, and filesystem,
    import, API, export, single-choke, and TCB gates pass.

- [x] **C216 - Mutable platform-attribute traversal injects executable JSX.**
      `packages/compiler/src/lower/{platform,structural-jsx}.ts`
  - A selective late `Array.prototype.map` replaced the reviewed dialog command attributes with a
    tag-closing name; the real lowered server module gained an attacker-authored `<img>` element.
  - **Acceptance:** platform target recognition, substitution lookup, typed attribute projection,
    conflict diagnostics, and substitution recording use boot-pinned dense/exact controls only.
  - **Evidence:** the exact late `Array.map` injection receives zero calls and canonical dialog
    attributes remain; 150 compiler/platform/merge/structural tests and compiler dist/DTS pass.

- [x] **C217 - Mutable replay dispatch diverts a captured browser interaction.**
      modular, bootstrap, and generated early-event replay paths
  - After bootstrap capture and successful runtime installation, a late replacement of
    `EventTarget.prototype.dispatchEvent` consumes the replayed click in Chromium, Firefox, and WebKit.
  - **Acceptance:** genuine replay uses a boot-captured witnessed native dispatch control in every
    runtime path; own-data structural test fakes remain supported without granting authored authority.
  - **Evidence:** 474 direct browser tests pass across Chromium, Firefox, and WebKit; the focused
    36 cross-engine attack/fail-closed proofs, 45 Node generated/security tests, regenerated-loader
    check, browser build, and security gates prove replay never redispatches through the late realm.

- [x] **C218 - Mutable post-route stylesheet assembly can replace reviewed static CSS.**
      static-export stylesheet collection and final artifact assembly
  - Route code runs before stylesheet accumulation; live `Array.push`/iteration/join controls can
    suppress or replace reviewed chunks in the CSS artifact subsequently linked from exported HTML.
  - **Acceptance:** post-replay stylesheet collection, deduplication, ordering, and final bytes use
    boot-pinned dense controls and remain exact under late/import-order prototype replacement.
  - **Evidence:** the exact route poison proof retains approved app/build CSS and the public link
    under combined Array/Map/String/URL replacement; 60 build/static-export tests, server build,
    source gate, and filesystem/import/API/export/choke/TCB/supply-chain gates pass.

- [x] **C219 - Drizzle write builders hide joined and returning read authority.**
      `packages/test/src` mutation verifier database membrane
  - `db.update(table).from(other)` observes only the target write while joined/from and `returning()`
    reads remain on the raw builder; insert-select callback builders share the unobserved path.
  - **Acceptance:** every write-builder stage recursively enters the reflective membrane and records
    exact write and read identities before execution; unresolved/ambiguous builder shapes fail KV407.
  - **Evidence:** red-before-fix update-from/returning and callback insert-select proofs now record
    exact DML/source reads or fail before dispatch; packages/test passes 255/255, the focused 106-test
    matrix, dist build, and classifier/guarantee/census/brand gates pass.

- [x] **C220 - Mutable final JSX IR printing injects executable server markup.**
      `packages/compiler/src/jsx-ir.ts`
  - A selective late `Array.prototype.map` replaced the final reviewed platform attribute list with
    a tag-closing string; the emitted server module gained an attacker-authored `<img>` element.
  - **Acceptance:** IR construction, parent/child ownership, changed-root selection, attribute/child
    printing, replacement ordering, and final source strings use boot-pinned dense/exact controls.
  - **Evidence:** the exact final `Array.map` injection receives zero calls and canonical reviewed
    attributes remain; 201 compiler/IR/platform/state/style tests and compiler dist/DTS pass.

- [x] **C221 - Public Trusted Types policy cache forges browser output bytes.**
      modular raw-HTML and generated response-fragment application paths
  - A caller-owned `globalThis.__kovo_tt` object with `createHTML()` replaces framework-safe bytes
    with attacker markup in Chromium, Firefox, and WebKit before the DOM sink sees the value.
  - **Acceptance:** policy creation/cache identity is module-private and boot-owned in modular and
    generated paths; host factory controls are witnessed and caller globals can never mint output.
  - **Evidence:** 483 cross-engine browser and 760 Node browser tests pass; modular/generated/cache-
    preclaim attacks preserve exact safe bytes across Chromium, Firefox, and WebKit, with regenerated
    loader, strict-CSP Playwright, browser build, parity, sink, and security gates green.

- [x] **C222 - Mutable structural derive discovery injects executable client source.**
      `packages/compiler/src/lower/structural-jsx.ts`
  - A selective late `Array.prototype.map` modified the real safe `state.label` derive candidate;
    an attacker global assignment was emitted into both server render source and the client module.
  - **Acceptance:** structural attribute/text/reactive discovery, root/input derivation, naming,
    fact recording, and source assembly use boot-pinned dense/map/set/scalar controls end to end.
  - **Evidence:** the exact derive-candidate `Array.map` attack receives zero calls and the emitted
    expression remains `state.label`; 211 structural/platform/state/style/compiler tests and
    compiler dist/DTS pass, with no live compiler-time collection/scalar dispatch left in the owner.

- [x] **C223 - Mutable post-route public-asset classification can publish an external symlink.**
      neutral static public-asset copy
  - Public traversal runs after route code and consumes live directory iteration plus mutable
    `Dirent.isDirectory()`/`isFile()` controls, allowing an otherwise-skipped symlink to be treated
    as a file and copied from outside the Vite public root into the static artifact.
  - **Acceptance:** enumeration, entry classification, realpath containment, identity/race checks,
    and copying use boot-pinned filesystem evidence; symlinks and ambiguous entries fail closed.
  - **Evidence:** the exact real external-secret symlink proof now rejects KV229; 98 filesystem/build
    tests cover late/pre-import poison plus file/directory replacement races, with core/server builds,
    source gate, and filesystem/import/API/export/choke/TCB/supply-chain gates green.

- [x] **C224 - Mutable primitive composition injects executable server markup.**
      `packages/compiler/src/lower/{primitive-composition,attribute-merge}.ts`
  - A selective late `Array.prototype.map` replaced reviewed primitive `id`/`type` facts with a
    tag-closing IR attribute; the emitted server module gained an attacker-authored `<img>` element.
  - **Acceptance:** candidate discovery, child ownership, attribute parsing/merge/conflict policy,
    IDREF rewriting, diagnostics, IR projection, and unwrap assembly use boot-pinned controls.
  - **Evidence:** the exact primitive IR `Array.map` injection receives zero calls and canonical
    `id`/`type` survive; 188 composition/merge/output/compiler tests and compiler dist/DTS pass,
    with no live collection/scalar dispatch left in either composition owner.

- [x] **C225 - Transaction callbacks receive a raw unobserved database.**
      `packages/test/src` verifier database membrane
  - `db.transaction(callback)` is a generic passthrough, so the callback's transaction DB executes
    raw Drizzle/read/write operations while the verifier records nothing and coverage passes.
  - **Acceptance:** transaction/savepoint callback databases, nested results, reflection, rollback,
    and managed-DB composition recursively use the same verifier membrane or fail KV407 before use.
  - **Evidence:** async/nested/savepoint/raw-SQL/config/reflection/rollback proofs now observe or fail
    before authority; packages/test passes 262/262, focused 57/57, dist build, and classifier,
    guarantee, census, and brand gates pass.

- [x] **C226 - Mutable static-navigation projection injects executable server source.**
      `packages/compiler/src/lower/{navigation,navigation-lowering}.ts`
  - A selective late `Array.prototype.map` replaced the reviewed standalone `href()` source patch;
    the emitted server module evaluated an attacker global assignment before returning `/products/p1`.
  - **Acceptance:** static href call/attribute discovery, argument/object validation, route-pattern
    construction, replacement ordering, IR mutation, escaping, and source patches use pinned controls.
  - **Evidence:** the exact standalone replacement `Array.map` attack receives zero calls and the
    source remains the reviewed JSON href; 155 navigation/structural/output/compiler tests and
    compiler dist/DTS pass, with both navigation owners free of live compiler-time dispatch.

- [x] **C227 - Mutable TrustedHTML coercion replaces bytes after exact policy minting.**
      `packages/browser/src/security-output.ts` and generated output paths
  - After C221's private exact-byte policy mint, a late `TrustedHTML.prototype.toString` replacement
    changed sanitized safe markup into attacker `<img>` bytes in Chromium, Firefox, and WebKit.
  - **Acceptance:** platform TrustedHTML brand/stringification is boot-captured and witnessed; direct,
    sanitized, modular, and generated carriers retain exact bytes or fail closed without generic coercion.
  - **Evidence:** the late stringifier substitution now preserves exact minted bytes or rejects the
    carrier across Chromium, Firefox, and WebKit; browser 495, Node browser 760, focused 57, strict-
    CSP Playwright, regenerated parity, build, sink, and security gates pass.

- [x] **C228 - Inherited numeric setters erase durable-task build metadata.**
      neutral build task/manifest/meta assembly and preset consumption
  - After route replay, `tasks[tasks.length] = record` invokes an inherited numeric Array setter;
    a selective setter can erase an authored durable task, mark the build static-only, and make
    presets omit the server/JobRunner deployment path.
  - **Acceptance:** every post-replay task/route/manifest/meta collection uses pinned dense own-data
    commits; inherited setters, iterators, or late collection poison cannot erase deployment authority.
  - **Evidence:** the real neutral/Vercel proof retains `receipt/send`, non-static posture, function,
    and JobRunner under late/pre-import setters; 65 build/preset tests, server build, touched-file
    checks, source gate, and filesystem/import/API/export/choke/TCB/supply-chain/guarantee gates pass.

- [x] **C229 - Raw prepared `execute` methods bypass verifier observation.**
      `packages/test/src` database verifier membrane
  - Root/nested `prepare(statement)` handles observe only a small terminal subset; `execute()` reaches
    the adapter and performs a write while verifier coverage records no operation and passes.
  - **Acceptance:** all prepared read/write/result/iterator/thenable terminals bind statement identity
    and enter the recursive reflective membrane before dispatch, including managed-DB composition.
  - **Evidence:** prepared execute/values/sync/iterator/stream/thenable/reflection proofs now observe
    or fail before dispatch in both managed composition orders; packages/test passes 269/269, dist
    build, and classifier/guarantee/census/brand gates pass.

- [x] **C230 - Mutable browser fetch transport substitutes post-validation response bytes.**
      modular and generated navigation/query/live-target/mutation fetch paths
  - Security controls pin Response/Headers/DOMParser getters but re-read `scope.fetch`; a late global
    replacement returns attacker response bytes that the otherwise-pinned response reader accepts.
  - **Acceptance:** browser fetch, promise, and response carrier identity are boot-captured/witnessed
    in every transport path; late/pre-init replacement or foreign carriers fail closed across parity.
  - **Evidence:** late fetch/Response replacement cannot substitute bytes in modular or generated
    navigation, query, live-target, or mutation paths; pre-init accessors and inherited carriers fail
    closed across 522 browser and 761 browser-package unit tests, with generated-loader parity green.

- [x] **C231 - Mutable static-spread projection injects executable server markup.**
      `packages/compiler/src/lower/primitive-spreads.ts`
  - A selective late `Array.prototype.map` replaced reviewed `{ id, title }` spread facts with a
    tag-closing IR name; the emitted server module gained an attacker-authored `<img>` element.
  - **Acceptance:** spread/entry discovery, literal parsing, numeric/scalar validation, removal,
    projection, and IR insertion use boot-pinned dense/scalar controls without prototype dispatch.
  - **Evidence:** the exact static-spread `Array.map` injection receives zero calls and reviewed
    `id`/`title` survive; 91 spread/structural/output/style tests and compiler dist/DTS pass, with
    no live compiler-time collection/scalar dispatch remaining in the owner.

- [x] **C232 - Mutable template-stamp assembly injects executable client source.**
      `packages/compiler/src/emit/client.ts`
  - A selective late `Array.prototype.join` replaced reviewed escaped list-template segments with
    an attacker function; the emitted client render plan executes a global assignment at runtime.
  - **Acceptance:** client import/constant manifests, query/clock plans, template placeholder sorting,
    path projection, escaped segments, and final executable source assembly use pinned controls.
  - **Evidence:** the exact late-`Array.join` template-stamp injection receives zero calls while the
    escaped `read(["name"])` source survives; all 1,031 compiler tests and compiler dist/DTS pass.

- [x] **C233 - Push-based durable-task snapshots invoke inherited numeric setters.**
      task runtime security intrinsics and registry snapshots
  - Even boot-captured `Array.prototype.push` performs ordinary indexed writes; a route-installed
    inherited numeric setter erases task entries and causes runtime startup/cron integrity failures.
  - **Acceptance:** all durable-task registry/job/schedule snapshots commit own dense data properties;
    late/pre-init inherited setters cannot erase, reorder, or cross-bind task runtime facts.
  - **Evidence:** the exact inherited-setter task proof now starts and dispatches the registered task;
    6 focused C228/C233 tests, 53 durable-task tests, 15 adjacent runtime tests, server dist/DTS, and
    the task security source gates pass.

- [x] **C234 - Inherited numeric setters erase compiler security snapshots.**
      `packages/compiler/src/compiler-security-intrinsics.ts`
  - `compilerSnapshotDenseArray()` used ordinary indexed assignment; a selective inherited setter
    swallowed KV210/KV201 diagnostics and made the real unsafe browser-capture compilation pass clean.
  - **Acceptance:** every compiler intrinsic array producer commits dense own-data properties so
    inherited setters cannot erase diagnostics, facts, split parts, regex captures, or source inputs.
  - **Evidence:** the exact selective inherited setter receives zero diagnostic commits and KV210/
    KV201 remain present; all 1,031 compiler tests and compiler dist/DTS pass.

- [x] **C235 - Deferred capture descendants execute database authority after verification.**
      `packages/test/src` verifier capture lifecycle
  - AsyncLocalStorage descendants retain the recorder after the handler promise settles; a deferred
    write runs after empty observations pass coverage and after the response/verification boundary.
  - **Acceptance:** every authority entry checks an active capture epoch before adapter/transaction/
    probe dispatch; settled descendants fail KV407 while genuinely awaited in-scope work remains valid.
  - **Evidence:** detached direct, prepared, nested, transaction, harness, and PGlite descendants now
    fail KV407 after settlement while awaited/concurrent live scopes pass; all 278 `@kovojs/test`
    tests, its dist/DTS build, and classifier/security/capability gates are green.

- [x] **C236 - Captured response-array push strips mandatory cookie attributes.**
      `packages/server/src/{response-security-intrinsics,cookies}.ts`
  - A late inherited numeric setter can swallow `HttpOnly` while the captured
    `Array.prototype.push` still advances the cookie-parts length, so the default credential-cookie
    serializer emits a session cookie without its SPEC §9.1.1 browser-confidentiality floor.
  - **Acceptance:** response-security array construction uses a boot-pinned own-data indexed commit;
    late and pre-import inherited setters cannot suppress cookie/CSP/response values, and a source
    gate prevents response authority from returning to prototype-visible push or numeric assignment.
  - **Evidence:** the exact late HttpOnly-strip and pre-import setter regressions pass; the 302-test
    response/document matrix, server distribution build, and response-array source gate are green.

- [x] **C237 - Inherited egress array writes rewrite private IPv6 words as public.**
      `packages/server/src/{egress-intrinsics,egress}.ts`
  - A selective inherited index-zero setter substitutes AWS IMDSv6's leading `fd00` word with
    `2606` while captured `Array.prototype.push` advances the parser array. The real
    `evaluateEgress` authority therefore classifies `fd00:ec2::254` as public and admits it outside
    the credential frame.
  - **Acceptance:** every egress multi-item and splice-argument array commit uses boot-pinned
    own-data descriptors; late and pre-import inherited numeric setters cannot rewrite private or
    metadata destinations, and a source gate prevents prototype-visible egress array commits.
  - **Evidence:** the exact `fd00` rewrite/admission, splice-argument, and pre-import regressions pass;
    the 91-test egress/Undici/redirect/bootstrap matrix, server distribution build, filesystem/egress
    source gates, classifier corpus, and security boundary gates are green.

- [x] **C238 - Fresh async contexts launder retained verifier DB authority.**
      `packages/test/src` harness and integration verifier capture lifecycle
  - C235 revoked AsyncLocalStorage descendants, but a handler could retain a closure over its
    request DB, return, and invoke that closure from a fresh context with no ambient store. The
    verifier treated the absent capture as unrestricted and the adapter wrote after green coverage.
  - **Acceptance:** harness/query/page/request DB handles and every derived method, builder, prepared,
    nested, and transaction handle bind to the capture epoch that exposed them; fixture setup uses an
    isolated setup capture, and request-only handles reject both inherited and fresh post-settlement use.
  - **Evidence:** fresh-context mutation, query, page, prepared, nested, direct-method, and real PGlite
    route proofs all fail KV407 before adapter dispatch; all 283 `@kovojs/test` tests and dist/DTS pass.

- [x] **C239 - Reserved verifier adapter hooks cannot compose the managed DB authority boundary.**
      `packages/{server,test}/src`
  - The verifier replaced declared-write/read-only adapter hooks with authored-call blockers, but
    `managedDb()` had no sealed path to invoke the genuine hook. Managed verification therefore
    threw before the request ran; an adjacent dispatch path also invoked accessor-backed SQL
    properties while composing policy.
  - **Acceptance:** verifier adapters register module-private framework hooks whose results remain
    wrapped and capture-bound, direct/reflected authored access stays blocked, and the verifier
    proves security-bearing raw properties are data-backed before consulting an adapter get trap.
  - **Evidence:** declared-write composition records the real inherited SQL write; an accessor-backed
    SQL method and capability hook both fail before their getters run, direct reflected hooks remain
    reserved, all 287 `@kovojs/test` tests pass, and server/test dist/DTS builds are green.

- [x] **C240 - Inherited DOM-snapshot setters preserve executable fragment attributes.**
      `packages/browser/src/navigation-security-intrinsics.ts`
  - `snapshotIndexedCollection()` assigned DOM `Attr` entries through ordinary array indices. A late
    inherited index-zero setter swallowed a leading `onclick`, so whole-node response adoption never
    presented the executable attribute to the sanitizer and retained it on the live element.
  - **Acceptance:** DOM collections, attribute snapshots, and adjacent mutation-broadcast arrays use
    boot-pinned verified own-data commits with bounded lengths; inherited setters cannot erase,
    replace, sparsify, or cross-bind response or broadcast authority.
  - **Evidence:** the exact leading-`onclick` whole-node adoption exploit now reaches the inherited
    setter zero times and removes the attribute in Chromium, Firefox, and WebKit.

- [x] **C241 - Inherited Set materialization erases compiler identity denials.**
      `packages/core/src/internal/security-witness-intrinsics.ts`
  - The shared security Set enumerator assigned values through inherited numeric setters. A
    pre-import setter could erase a forbidden TypeScript `SyntaxKind` while framework-identity
    deny sets initialized, weakening the compiler provenance boundary before its first check.
  - **Acceptance:** every shared security Set value is committed and verified as own array data;
    late and pre-import numeric setters cannot erase identity kinds or runtime delta set values.
  - **Evidence:** exact late and fresh-process pre-import setter proofs receive no Set-value commit
    and preserve the sole marker; the identity/query-delta/security-witness matrix passes 55 tests.

- [x] **C242 - Inherited entry setters erase query shapes from render-plan tokens.**
      `packages/core/src/internal/render-plan-token-intrinsics.ts`
  - A poisoned index-zero setter swallowed the first `{query, shape}` entry before hashing, allowing
    incompatible query projections to retain one build/render-plan fingerprint.
  - **Acceptance:** render-plan entries use verified own-data commits before framing and hashing;
    no inherited setter can omit a query from deploy-skew authority.
  - **Evidence:** exact `account`-entry suppression receives zero commits and distinct `id`/`role`
    shapes retain distinct fingerprints; the 60-test core matrix and core dist/DTS build pass.

- [x] **C243 - Inherited capability-map setters resurrect one-time tokens.**
      `packages/server/src/{capability-intrinsics,capability-url}.ts`
  - Replay eviction materialized the consumed-token Map through ordinary array assignment. A setter
    replaced an unexpired `[token, expiry]` with an expired tuple, deleted the replay id, and made the
    same signed one-time token consumable again.
  - **Acceptance:** capability Map entries commit through pinned own-data descriptors and are
    verified before replay eviction can observe them.
  - **Evidence:** the exact unexpired-entry substitution receives zero capability commits, retains
    store size one, and rejects a second consume; 76 capability tests pass.

- [x] **C244 - Inherited analyzer arrays replace static proof inputs and results.**
      `packages/server/src/internal/data-plane-static-analysis{,-intrinsics}.ts`
  - Static-analysis Promise aggregation and surrounding worker/source/fact collections used ordinary
    indexed writes, allowing app/plugin prototype setters to replace a rejected analyzer result with
    a forged safe value after the analyzer ran.
  - **Acceptance:** analyzer arrays use a boot-validated indexed own-data primitive for inputs,
    asynchronous results, sources, diagnostics, worker tasks, and fact aggregation.
  - **Evidence:** the exact Promise input/result substitution receives zero commits and returns the
    original ordered results; all 16 data-plane static-analysis tests pass.

- [x] **C245 - Indexed prototype pollution cross-binds diagnostic URL parsing.**
      `packages/server/src/logging-intrinsics.ts`
  - Node's native URL implementation itself observed a late inherited array setter: parsing
    `?code=...` produced an attacker replacement query key before Kovo's pinned getters ran, enabling
    forged log fields and making redaction decisions describe different bytes.
  - **Acceptance:** logging rejects any indexed property on the Array prototype chain before native
    URL parsing and commits accepted query keys through pinned verified own-data descriptors.
  - **Evidence:** the exact query-key substitution now fails the diagnostic URL closed; the 13-test
    logging/redaction matrix passes.

- [x] **C246 - Query-shape merge keys invoke prototype setters.**
      `packages/server/src/internal/data-plane-static-analysis{,-intrinsics}.ts`
  - Output/static query shapes merged into `{}` with bracket assignment, so `__proto__` or an
    inherited named setter could mutate the proof object's prototype or suppress a security-bearing
    field before the compiler consumed it.
  - **Acceptance:** merged shapes are null-prototype records and every field is committed as verified
    own data through boot-validated controls.
  - **Evidence:** inherited `role` and literal `__proto__` probes never invoke a setter, preserve exact
    own values, and keep a null prototype; all 16 data-plane static-analysis tests pass.

- [x] **C247 - Inherited IV-order setters weaken AES-GCM nonce-reuse tracking.**
      `packages/server/src/confidential-at-rest-intrinsics.ts`
  - The recent-IV Set stored genuine nonces, but its eviction order used captured `Array.push`, which
    still invoked inherited index setters. Cross-bound order slots could evict a still-recent nonce
    and weaken the fail-closed repeat detector when a degraded random source repeated it.
  - **Acceptance:** every IV order entry commits through a boot-pinned verified own-data descriptor;
    prototype setters cannot observe or alter the replay window.
  - **Evidence:** the exact base64url-IV setter receives zero commits while encryption succeeds; all
    11 confidential-at-rest tests pass.

- [x] **C248 - Core authority arrays remain prototype-visible outside Set materialization.**
      `packages/core/src`
  - Framework path/catalog identity, route matching, SQL recipes, HMAC secrets/signatures, storage
    segments, query shapes/deltas, graph facts, module refs, and XSS sink candidates still appended
    to fresh arrays with ordinary indexed writes. Selective inherited setters could erase or replace
    the precise item later classified, hashed, authenticated, or emitted.
  - **Acceptance:** the core security witness exposes one bounded verified own-data append and every
    production core append routes through it; no fresh core authority array uses numeric assignment.
  - **Evidence:** the late/pre-import generic setter proofs pass, the production source census finds
    no `array[array.length] =` writes under `packages/core/src`, all 304 core tests pass, and core
    dist/DTS builds are green.

- [x] **C249 - Inherited numeric setters can erase compiler security diagnostics and provenance.**
      `packages/compiler/src/{compiler-security-intrinsics.ts,security,validate}`
  - Compiler validation still appended authoring, XSS, confidentiality, client-capture, markup, and
    provenance facts with ordinary indexed writes. A selective inherited setter could swallow the
    rejecting fact after classification and let compilation continue without its required error.
  - **Acceptance:** every production security-validator append uses one bounded, boot-pinned,
    verified own-data commit; the security/validate source census has no numeric length assignment.
  - **Evidence:** the exact KV235 diagnostic setter receives zero commits and the diagnostic remains;
    all 1,032 compiler tests pass, and compiler dist/DTS builds are green.

- [x] **C250 - Compiler emit, cache, parse, and build facts still use prototype-visible appends.**
      `packages/compiler/src`
  - Outside the validators, 204 fresh-array writes still committed source replacements, output
    contexts, mutation-form facts, cache identities, graph facts, parsed models, and generated module
    lines through inherited numeric setters. Selective setters could erase or cross-bind the exact
    reviewed fact before it was hashed, cached, or emitted.
  - **Acceptance:** every production compiler append routes through the bounded boot-pinned own-data
    primitive; the complete non-test compiler source census has no numeric length assignment.
  - **Evidence:** an inherited setter cannot observe or erase an `on:click` emitter patch; the complete
    compiler census is empty and all 1,033 compiler tests pass.

- [x] **C251 - Server mutation, wire, static-export, and build collections remain cross-bindable.**
      `packages/server/src`
  - 112 production server appends still exposed mutation targets/chunks, wire fields, client-module
    plans, SRI/header/static-export facts, build assets, diagnostics, and request snapshots to
    inherited numeric setters before final response or artifact decisions consumed them.
  - **Acceptance:** the shared server witness provides a bounded verified own-data append, isolated
    bootstrap owners retain local equivalents, and the non-test server census has no numeric length
    assignment.
  - **Evidence:** the exact inherited setter receives zero witness commits; the complete server
    source census is empty and the full 2,390-test server matrix passes.

- [x] **C252 - Browser wire, DOM, sanitizer, and inline-loader arrays remain cross-bindable.**
      `packages/browser/src`
  - 39 modular and generated-bootstrap appends still exposed parsed wire tokens, decoded fragments,
    morph plans, handler queues, sanitizer stacks/attributes, dynamic-import allowlists, and applied
    target reports to inherited numeric setters before DOM or import sinks consumed them.
  - **Acceptance:** browser collections use the verified witness append; extracted inline helpers
    route the same calls through the early boot navigation controls; generated parity stays exact.
  - **Evidence:** the exact setter receives zero commits, the source census is empty, inline parity
    and Trusted Types routing pass, all 762 node and 525 three-engine browser tests pass, and browser
    dist/DTS builds are green.

- [x] **C253 - Drizzle SQL constructor argument arrays invoke inherited numeric setters.**
      `packages/drizzle/src/runtime.ts`
  - The SQL template invocation and `sql.join` metadata aggregation copied reviewed values through
    ordinary indexed writes. A selective setter could erase a bound parameter from the executable
    constructor call or cross-bind the metadata later authenticated by the managed SQL choke.
  - **Acceptance:** SQL constructor and metadata arrays commit through boot-captured verified own
    descriptors; the production Drizzle census has no numeric length assignment.
  - **Evidence:** the exact template-argument setter receives zero commits and the managed snapshot
    retains `$1` plus its original value; all 866 Drizzle tests and dist/DTS builds pass.

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

- [x] **H20 - Mutable client-module and render-plan controls can cross-bind immutable code or
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
  - **Evidence:** `pnpm exec vitest run --config vitest.bugz.config.ts
    packages/core/src/internal/client-module-url.content-identity.test.ts
    packages/core/src/internal/render-plan-token.test.ts packages/compiler/src/handler-lowering.test.ts
    packages/server/src/client-modules.test.ts packages/server/src/vite-build.test.ts` passes; fixed
    32-bit FNV collisions produce distinct 256-bit versions and poisoned collection/hash controls
    cannot cross-bind module bytes or render-plan fingerprints.

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

- [x] **H27 - Truncated CSS hashes alias distinct deploy assets.**
      `packages/compiler/src/css.ts`
  - CSS split chunks truncated SHA-256 to 32 bits. Two fixed distinct valid CSS sources both emitted
    the real `/assets/base-36fabc25.css` path even though their complete bytes and CSP hashes differ,
    defeating the asset path's cache-busting/content-identity role across deployments.
  - **Acceptance:** CSS chunk identity uses a collision-resistant source digest with enough bits for
    immutable deployment identity, and manifest/href generation, CSP hashes, static output, and
    delivery accounting consume the same exact byte snapshot; fixed collision regressions produce
    distinct paths without weakening ordinary deterministic builds.
  - **Evidence:** `pnpm exec vitest run --config vitest.bugz.config.ts
    packages/compiler/src/css.test.ts` passes; its fixed 32-bit-prefix collision emits distinct
    256-bit paths while manifest, CSP, and byte-accounting assertions remain green.

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

- [x] **H32 - Mutable query-result capping publishes unbounded attacker-expanded responses.**
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
  - **Evidence:** the 128-test query/SQL/ingress matrix passes both the row-101 omission and
    one-to-10,000 amplification regressions; output stays capped and reports `QUERY_LIST_LIMIT`.

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

- [x] **H34 - The supported integration runner races fixture evaluation against bootstrap.**
      `packages/test/src/integration/boot-fixture.ts`
  - The fixture app and server root were loaded concurrently through the same `ssr.noExternal`
    server. An authored fixture could evaluate first and poison the runner's server/compiler
    controls before their trust root existed, making conformance/security tests order-dependent.
  - **Acceptance:** load the complete server/compiler profile sequentially in the exact Vite SSR
    graph before the fixture entry. A poison-first fixture regression must prove app evaluation
    cannot influence captured controls while the normal integration suite retains its behavior.
  - Evidence: the focused fixture-plugin/bootstrap tests pass 3 cases and Chromium passes
    `bootstrap-order.spec.ts`; the exact `ssr.noExternal` graph loads compiler intrinsics and the
    server root sequentially before the poison-first authored fixture.

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

- [x] **M10 - Mutable PostgreSQL SQL scanning admits app principal-control statements.**
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
  - **Evidence:** the 153-test managed matrix covers late and pre-import scanner poison plus quoted,
    schema-qualified, Unicode-escaped, comment, transaction, role, and session-control variants;
    every principal-control spelling fails before the client sink.

- [x] **M11 - Tagged FormData aliases distinct no-JS replay bodies.**
      `packages/server/src/replay.ts`
  - Request provenance wrapped `FormData` in a registered proxy, but replay fingerprinting accepted
    only the native receiver. Two different form bodies with the same `Kovo-Idem` therefore hashed
    as the same empty proxy shape and replayed the first 303 instead of returning an idempotency
    conflict for the changed body.
  - **Evidence:** the 68-test no-JS replay/request-body matrix uses the shared exact FormData snapshot
    boundary; distinct tagged bodies now return `IDEMPOTENCY_CONFLICT`, while identical replay and
    ordinary native FormData remain green.

- [x] **M12 - The reference login shell reused one process-wide CSRF binding across browsers.**
      `examples/reference/src/app-shell.ts`, `examples/reference/src/shell-auth-form.tsx`
  - The hand-authored reference form bound every anonymous login token to the same server constant.
    A token obtained by one browser was therefore valid for another browser's pre-authentication
    flow whenever the Origin floor was not the rejecting layer.
  - **Evidence:** the reference shell now uses compiler-owned JSX mutation forms and the framework's
    per-browser anonymous CSRF cookie. Its real HTTP regression obtains two independent bindings and
    proves browser A's token with browser B's cookie fails with `CSRF`; the ordinary auth flow passes.

## Latest verification

The remediation pass remains intentionally non-zero: C17-C19, C21-C22, C25, C28, C31-C32, C42,
C58-C76, H20, H27, H32-H35, and M10 are active compiler-cache, static-analysis, server authority/output,
and immutable-output fixes. Integrated evidence is green at 97 PostgreSQL, 88 egress, 37
filesystem/storage, 180 request-dispatch, 198 app/schema/document, 158 auth/response, 51 Better Auth,
86 crypto/replay, 234 output/compiler/core, 87 scalar route/handler/secret, and 18 password tests. A
complete fresh sweep of the final integrated tree is still required.
