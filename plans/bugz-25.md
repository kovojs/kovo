# Bug Ledger (`bugz-25`)

**Date:** 2026-07-10

**Scope:** Security-first adversarial regression sweep of the Kovo framework at `main` HEAD
`0baa97b82`, using `SPEC.md` and its incorporated sub-specifications as the contract. Per the audit
request, a defect could be carried even when it is a regression or residual of a prior ledger.

**Method:** Three parallel subsystem finders plus a root-led targeted pass, four independent
adversarial skeptic passes, and a final completeness critic with a targeted process-global collector
census. Every carried item was reproduced in a detached throwaway worktree against real source; all
proof worktrees were removed. No production code was changed.

## Severity summary

| Severity | Count | Items |
| -------- | ----: | ----- |
| High     |     4 | H1-H4 |
| Medium   |     8 | M1-M8 |
| Low      |     1 | L1    |

The recurring failure mode is proof/enforcement drift: a privileged capability or security fact is
present at runtime, but an alias, assignment, spread, early return, stale snapshot, or unbounded
side-channel makes the gate reason about a weaker proxy.

## High

- [ ] **H1 - The generated Better Auth instance re-exposes its privileged system adapter to
      app-authored `src/auth.ts`, allowing plaintext auth-secret reads.**
      `packages/create-kovo/templates/src/auth.ts:71-80`,
      `packages/create-kovo/templates/src/_kovo/app-runtime-db.ts:80-95`,
      `packages/better-auth/src/internal/non-egress-proof.ts:97-115`
  - The raw `appRuntimeAuthDb` export was removed, but `createAuthAdapter()` is passed into the
    app-owned Better Auth instance. Its typed `(await auth.$context).adapter.findMany(...)` surface
    still
    reads arbitrary `account` and `session` rows with system authority. The sound-subset gate limits
    imports from `_kovo`; it does not limit use or re-export of the adapter reachable through
    `auth.ts`.
  - **Exploit:** an ordinary helper exported from the allowlisted `src/auth.ts` can read every
    `account.password` and `session.token`; a declared endpoint can serialize those plaintext values
    to a remote caller. Every generated Postgres starter carries the capability.
  - **Verified:** an independently scaffolded current Postgres starter added that helper, signed in,
    and observed both `"password":` and `"token":` in JSON under `KOVO_PARANOID=1`. Its
    `check:sound-subset`, `kovo build ./src/app.tsx`, and runtime Vitest all passed.
  - **SPEC:** root `SPEC.md` section 6.6/10.3 and `spec/10-data-plane.md` capability ownership plus
    C9/C10 require app code to receive governed facades, not a privileged capability hidden behind a
    named file. The non-egress manifest's compare/verify-only claim is false for this reachable API.
  - **Status:** direct residual/regression of `plans/bugz-24.md` A1; the direct DB export was narrowed,
    but the acceptance criterion was not met.
  - **Fix direction:** keep the Better Auth adapter and instance in a framework-owned trusted module;
    expose only the session/credential operations the app needs, and make the non-egress proof close
    over every request-reachable export rather than a hand-described adapter use.

- [ ] **H2 - Detached or destructured `sql.raw` aliases bypass KV422 and enter an unwrapped Drizzle
      builder.** `packages/drizzle/src/static.ts:1795-1835`,
      `packages/server/src/sql-safe-handle.ts:67-72,244-269`
  - `sqlRawHelperDiagnostic()` immediately returns unless the callee is still a property-access
    expression. `const raw = sql.raw; raw(input.sort)` and the equivalent destructuring alias
    therefore disappear before symbol-identity resolution. Managed `select` is a
    builder fast path, so the resulting raw fragment never reaches the managed statement parser.
  - **Exploit:** request-controlled `ORDER BY`, `WHERE`, or projection text can carry an injected SQL
    expression/subquery. The direct spelling emits KV422; the byte-equivalent alias spellings compile
    with no KV422 and execute through the normal managed read builder.
  - **Verified:** the independent control produced KV422, both alias forms produced zero diagnostics,
    and a real `managedDb(..., 'read').select().from().orderBy(raw(dynamic))` accepted the raw SQL
    object. The public `sql.raw` member is a detachable arrow property, so the shape is valid
    TypeScript and preserves runtime semantics.
  - **SPEC:** sections 10.2/10.3, KV422, and section 11.1 require executable SQL text to be
    parameterized, allowlisted, or audibly trusted using AST identity provenance.
  - **Status:** incomplete residual of `plans/bugz.md` H4; import aliases and namespace receivers were
    fixed, but aliases of the dangerous member value were not.
  - **Fix direction:** resolve member-value aliases/destructuring by symbol identity and fail closed on
    unresolved calls derived from `sql.raw`/`sql.identifier`; add a runtime raw-fragment choke to
    builder fast paths as defense in depth.

- [ ] **H3 - Shorthand and spread-composed `atomic`/`version` annotations silently disable KV429.**
      `packages/drizzle/src/static.ts:4693-4708`,
      `packages/drizzle/src/static/derivation.ts:1785-1792,1860-1871`
  - `concurrencyColumnsFromObject()` accepts only direct `PropertyAssignment` nodes. Valid shorthand
    (`kovo({ domain, atomic, version })`) and typed object spread
    (`kovo({ domain, ...concurrency })`) are ignored instead of resolved or rejected, leaving the compiler's
    `concurrencyByTable` map empty even though runtime metadata retains the annotations.
  - **Exploit:** all read-modify-write code for the affected table loses the declared lost-update
    gate. Concurrent inventory, balance, coupon, or version writes can overwrite each other under
    ordinary `READ COMMITTED` execution.
  - **Verified:** direct annotations plus an unsafe update produced a TOCTOU/KV429 fact; public,
    type-valid shorthand and spread controls produced none. No runtime CAS/version mechanism consumes
    the retained metadata.
  - **SPEC:** section 10.1 declares `atomic`/`version` once as load-bearing security facts; section
    10.3 makes unguarded single-row read-modify-write KV429.
  - **Status:** newly identified annotation-extraction root cause.
  - **Fix direction:** resolve static shorthand/spread objects transitively, and emit a fatal
    diagnostic when a concurrency annotation cannot be proven instead of treating it as absent.

- [ ] **H4 - KV429 loses read provenance across ordinary reassignment and destructuring assignment.**
      `packages/drizzle/src/static/derivation.ts:1931-1988`
  - `atomicReadFlowBefore()` scans only `VariableDeclaration` initializers. It never updates the flow
    maps for assignment expressions, so either `next = row.stock - qty` or
    `[row] = await db.select(...)` severs the read-to-absolute-write proof.
  - **Exploit:** concurrent requests read the same contended value, compute absolute replacements,
    and both updates ship; the later write silently overwrites the first.
  - **Verified:** declaration-form controls produced KV429. Equivalent reassignment and destructuring
    assignment forms produced no fact and reached the normal update path with no automatic runtime
    CAS/version backstop.
  - **SPEC:** section 10.3 KV429 promises single-row lost-update detection for declared contended
    columns; section 11.1 makes this a static dataflow obligation.
  - **Status:** incomplete residual of the prior `bugz-8` KV429 fix.
  - **Fix direction:** include simple/destructuring assignment writes in the forward flow model and
    conservatively taint/fail closed when an atomic value's provenance cannot be resolved.

## Medium

- [ ] **M1 - A matched route's default 404 can forward a rolling session cookie without a cache
      floor.** `packages/server/src/app-document.ts:138-157,177-233`,
      `packages/server/src/document-core.ts:717-759`
  - The matched non-200 fallback appends `sessionProvider` cookies and returns before document
    session-dependence computes/applies `Cache-Control: no-store` and `Vary: Cookie`.
  - **Exploit:** a signed-in user hits a matched route whose page returns `notFound()` during a rolling
    session refresh. A shared cache that stores the otherwise cacheable 404 can replay the victim's
    `Set-Cookie` to another visitor, enabling session takeover.
  - **Verified:** the current public route path returned `404` plus a victim token, with no
    `Cache-Control` or `Vary`; the equivalent `200` control emitted `no-store` and `Vary: Cookie`.
  - **Scope:** unmatched 404s do not resolve the provider, configured global error shells are
    protected, and this audit did not carry the broader 500 claim. Exploitation requires the cookie
    refresh moment and a shared cache that stores/replays `Set-Cookie`, hence Medium rather than High.
  - **SPEC:** section 7's session-dependent document cache rule and section 9.4's shared-cache contract
    require identity-varying documents to be unstoreable.
  - **Status:** incomplete regression of earlier cache-floor fixes (part-4 G1 and bugz-3 L2/M2).
  - **Fix direction:** compute/apply the session/provider-cookie cache posture before every early
    return, including matched 404/403/error outcomes.

- [ ] **M2 - A sparse, non-empty `access` guard array audits as guarded but runs as allow-all.**
      `packages/server/src/access-graph.ts:119-135`, `packages/core/src/graph.ts:866-902`,
      `packages/server/src/guards.ts:758-795`
  - Audit logic treats `access.length > 0` as a guard decision; array mapping skips holes. Runtime
    `for...of` yields each hole as `undefined`, and `runGuard(undefined)` explicitly succeeds.
  - **Exploit:** the strict-TypeScript-valid shape
    `const access: Guard<Request>[] = []; access.length = 1` discharges KV436 but lets an anonymous
    request execute a supposedly private
    query.
  - **Verified:** `kovoCheck` exited successfully with no KV436, while the anonymous query endpoint
    returned `200` containing the private marker. Any real denying guard still stops the chain; the
    all-hole construction is a narrow prerequisite.
  - **SPEC:** section 2 default-deny and section 10.2 KV436 require the audited executable guards to be
    the guards actually enforced.
  - **Status:** new array-density variant, distinct from the fixed legacy `access`/`guard` field split.
  - **Fix direction:** validate that access is a dense, non-empty array of actual guards at declaration
    and runtime, freeze/snapshot it, and make any invalid element fail closed.

- [ ] **M3 - Attacker-owned dynamic JSX spreads can inject executable Kovo `on:*` control
      attributes.** `packages/compiler/src/security/output-context.ts:262-276`,
      `packages/server/src/jsx-runtime.ts:337-350`,
      `packages/browser/src/loader-lifecycle.ts:164-178`,
      `packages/browser/src/handlers.ts:147-165`
  - The compiler validates only statically expanded spread objects. Runtime attribute-name safety
    deliberately preserves Kovo `on:*`, so a caller-owned record can mint `on:load`, parameter-type,
    and `data-p-*` attributes with no compiler provenance. The loader automatically imports and
    invokes the named same-origin handler.
  - **Exploit:** `<article {...profile.attributes}>` with attacker-controlled attributes can force-run
    an app-shipped client handler gadget in the victim's origin and supply its parameters. This is not
    arbitrary external JavaScript, and server authorization still applies, but useful handlers can
    perform authenticated/destructive UI actions.
  - **Verified:** the dynamic spread compiled with zero KV211/KV236 diagnostics, rendered an injected
    `on:load` ref and account parameter verbatim, and `installExecutionTriggers()` imported the
    `/c/` module and invoked the export with the attacker value.
  - **SPEC:** sections 4.7/4.8 require "execute nothing the page didn't declare" and classify `on*` as
    unsafe; section 6.6 requires load-bearing residual strings to validate against generated
    registries.
  - **Status:** semantic residual adjacent to prior hostile attribute-name/native-event fixes.
  - **Fix direction:** caller-owned spreads must never create Kovo control attributes; require
    compiler-owned registry provenance at emission/runtime, and make an empty module allowlist deny
    rather than broaden `/c/` imports.

- [ ] **M4 - Anonymous enhanced mutations disable replay even with a configured store and idem
      token.** `packages/server/src/replay.ts:276-297,330-343,384-389,479-509`
  - Enhanced replay scope recognizes only an app session id. It does not carry the framework-owned
    anonymous CSRF binding, so pre-auth requests resolve to `scope: null`; lookup and reservation
    silently return `disabled`.
  - **Exploit:** duplicate enhanced login, signup, reset, checkout, email, or other public mutation
    POSTs with the same `Kovo-Idem` execute independently. The current starter configures both
    anonymous CSRF and `createMemoryMutationReplayStore()`.
  - **Verified:** one CSRF-valid anonymous enhanced request executed twice with an identical store,
    mutation key, body, and idem. The session-bound control executed once and replayed. No-JS has a
    separate mutation-key fallback and was not affected.
  - **SPEC:** section 10.3 says every enhanced/no-JS/streaming mutation must atomically reserve the
    `(principal, mutation, idem)` identity before running and never re-execute a duplicate.
  - **Status:** residual of bugz-18 B2 / GAP4-2.
  - **Fix direction:** use the anonymous CSRF binding (or another framework-owned anonymous principal
    key) in the enhanced replay scope; preserve mutation and request-fingerprint separation.

- [ ] **M5 - Request-time audit collectors retain one process-global object per invocation without a
      bound or production drain.** `packages/core/src/secret.ts:61,411-417`,
      `packages/server/src/cookies.ts:114-131`,
      `packages/server/src/write-governance.ts:43,76-96`,
      `packages/server/src/managed-db.ts:584-625,1839-1857,1913-1925`,
      `packages/server/src/capability-route.ts:115,139-140,200-208`
  - `secretRevealAuditFacts`, `cookieDowngradeFacts`, `trustedAssignFacts`,
    `publicReadAuditFacts`, `crossOwnerReadAuditFacts`, and `capabilityMintFacts` are module-global
    arrays. Their push sites run during requests, but repository-wide call-site inspection found no
    production drain, environment gate, or capacity bound.
  - **Exploit:** repeatedly request a normal route that calls `ctx.signUrl()`, a public/cross-owner raw
    read, or another affected escape. Default rate shedding slows the growth but never bounds process
    lifetime retention; affected servers eventually exhaust memory.
  - **Verified:** 10,000 real `createSignUrl().signUrl()` calls retained exactly 10,000 facts. The
    targeted census excluded declaration-time `unsafeRegex`/unverified-MIME facts, boot-time Postgres
    posture facts, and production-gated RLS diagnostics.
  - **SPEC:** section 9.5 makes bounded pre-dispatch availability a framework-owned runtime posture;
    an unbounded per-request side collector defeats that claim behind the limiter.
  - **Status:** broadens the already documented `publicReadAuditFacts`/`crossOwnerReadAuditFacts`
    papercut to a request-time collector family.
  - **Fix direction:** use static call-site facts for build/explain, remove runtime-only collectors
    where redundant, and otherwise use bounded telemetry or request-scoped/dev-only drains.

- [ ] **M6 - BroadcastChannel keeps the page-load principal across a no-navigation session change.**
      `packages/browser/src/loader.ts:170-197`,
      `packages/browser/src/broadcast.ts:140-147,188-203`,
      `packages/browser/src/mutation-apply.ts:119-125`
  - The loader captures the principal once. Both envelope publishing and receiving keep using that
    snapshot, and no path drops/rotates the channel when a successful enhanced mutation changes the
    browser session.
  - **Exploit:** a supported custom session-establishing mutation returns a non-empty 2xx response
    with private `<kovo-query>` truth instead of navigating. The newly authenticated sender stamps it
    with the old anonymous principal, and another anonymous tab accepts and applies it.
  - **Verified:** two loaders captured `undefined`; after the sender's simulated login, its private
    account query broadcast still had no principal and the anonymous peer applied the victim marker.
  - **Scope:** the default Better Auth sign-in path redirects or returns the special empty auth
    response, causing a full navigation; the issue requires a custom no-navigation session transition.
  - **SPEC:** section 9.3 explicitly requires the current principal fingerprint on every envelope and
    requires the channel to be dropped on session change.
  - **Status:** residual of the earlier asymmetric anonymous/principal BroadcastChannel fix.
  - **Fix direction:** have the server signal the post-response principal/session transition, rotate
    or close the channel before applying/publishing truth, and derive every envelope fingerprint from
    the current principal rather than installation state.

- [ ] **M7 - In-flight replay reservations expire, permit a duplicate execution, and allow a stale
      commit to overwrite the newer result.** `packages/server/src/replay.ts:127,135-153,166-175,204-237`
  - Pending and committed records share one TTL. Expiry deletes a still-running reservation, so a
    duplicate can reserve the same key. The old reservation's `commit()` then unconditionally writes
    even when it is no longer the current generation.
  - **Exploit:** a handler runs beyond the replay TTL; a retry executes concurrently, commits a newer
    response, and the stale original later replaces it. Default reachability requires a handler over
    five minutes; the public shorter `ttlMs` option widens the window.
  - **Verified:** with a 10 ms TTL, reservation A expired, B reserved and committed, then A committed
    and became the replayed result.
  - **SPEC:** section 10.3 requires duplicates to block on the in-flight reservation and replay the
    settled response, never execute twice.
  - **Status:** residual of A6/E4/K3 replay fixes; source comments promise pending records are never
    evicted, but generic expiry still does so.
  - **Fix direction:** separate pending leases from committed-response TTLs and fence commits with a
    reservation generation/token so an expired or superseded owner cannot write.

- [ ] **M8 - Azure `IDENTITY_ENDPOINT` loopback is not metadata-classified, so the supported
      credential frame fails and the suggested workaround removes SSRF isolation.**
      `packages/server/src/egress.ts:40-44,552-563,761-785`,
      `packages/server/src/egress-credentials.ts:52-58`
  - Only named link-local addresses classify as `metadata`; all `127/8` addresses classify as ordinary
    `loopback`. `azureCredential()` enters the metadata frame, but that frame has no effect on the
    loopback class. An exact `allowInternal` entry then allows the identity endpoint both inside and
    outside the credential frame.
  - **Exploit:** on Azure App Service, the supported managed-identity provider remains blocked until
    an operator allowlists the loopback endpoint. A reflected SSRF can then reach the same token
    endpoint without credential-factory provenance.
  - **Verified:** the Azure frame still returned `EgressBlockedError` for `127.0.0.1:<port>`; the exact
    allowlist made the same destination pass outside the frame. A `169.254.169.254` control worked only
    inside the frame.
  - **Scope:** the default behavior fails closed; Azure plus the operator workaround is required.
  - **SPEC:** section 6.6 explicitly names Azure's `IDENTITY_ENDPOINT` loopback as metadata that must be
    reachable only in `azureCredential()` and never through `allowInternal`.
  - **Status:** new classification gap.
  - **Fix direction:** resolve and pin the configured Azure identity endpoint as metadata-sensitive,
    reject it from `allowInternal`, and allow it only within the Azure credential frame.

## Low

- [ ] **L1 - Filesystem storage deletion follows a symlinked parent outside the configured root.**
      `packages/core/src/storage.ts:224-237`,
      `packages/core/src/internal/filesystem.ts:243-247`
  - Storage reads use realpath confinement, but `deleteConfinedFile()` performs only lexical
    containment before `rm(filePath)`. A symlinked directory inside the root is followed by the delete
    operation.
  - **Exploit:** if another local actor or shared-volume process can plant `root/link -> outside`, an
    attacker-controlled storage key `link/victim` deletes the outside blob and metadata sidecar.
  - **Verified:** `storage.get()` correctly returned `undefined` for the same escaped path, while
    `storage.delete()` removed the external file.
  - **Scope:** Kovo's storage API cannot create the symlink; exploitation needs local/shared-filesystem
    influence, so this is Low despite the arbitrary-delete primitive.
  - **SPEC:** section 10.6 assigns storage key/path containment to the framework-owned filesystem door.
  - **Status:** new read/delete parity gap.
  - **Fix direction:** reject symlink parents for delete using the same realpath-aware boundary as
    reads/writes, with a race-resistant filesystem operation where the platform permits it.

## Refuted / not carried forward

- **`bugz-24` A2 mutable separated SQL carrier:** current core/server tests reject accessor-backed
  carriers and snapshot proxy-backed text/values before validation and execution. The focused
  `sql-safety`/`sql-safe-handle` regression selection passed; no current bypass was reproduced.
- **All fallback 404/500 responses leak rolling cookies:** narrowed. Unmatched 404s do not resolve the
  session provider, configured global error shells carry the safe posture, and 500s are not normally
  heuristically cached. M1 is the reproduced matched-route/default-404 path only.
- **Default Better Auth login leaks through BroadcastChannel:** refuted. Its redirect/empty-response
  handling navigates before private truth is rebroadcast. M6 requires a supported custom non-navigating
  session-establishing mutation.
- **Azure metadata is exposed by default:** refuted. The default is fail-closed; M8 is the dangerous
  operational workaround forced by the classification bug.
- **Raw endpoint/session, guarded query cache, native `onclick`/`srcdoc`/style, fragment sanitization,
  deferred-boundary, and mutable SQL-carrier regression seeds:** current focused source/tests held;
  none was promoted without a new reproduced path.

## Verification methodology

- The harness was first proven by importing and executing real package source in a detached worktree
  produced by `.agents/skills/find-bugz/scripts/setup-bugz-worktree.sh`.
- Auth adapter skeptic: one generated-starter integration test passed in 25.04 s, including
  `KOVO_PARANOID=1`, `check:sound-subset`, production build, sign-in, and plaintext-secret assertions.
- Data/compiler skeptic: two focused files / five tests passed for sparse access, detached `sql.raw`,
  assignment-flow KV429, and annotation-composition KV429.
- Cache/control-attribute skeptic: four independent tests passed; the earlier finder also passed five
  real compiler/server/browser controls.
- Replay skeptic: two focused replay tests passed; anonymous vs authenticated and pending-generation
  controls were asserted in the same run.
- Targeted second round: three files / four tests passed for BroadcastChannel, Azure egress,
  filesystem deletion, and collector growth; the collector census retained exactly 10,000 facts.
- Current regression control:
  `pnpm exec vitest run packages/core/src/sql-safety.test.ts packages/server/src/sql-safe-handle.test.ts --testNamePattern 'accessor-backed|mutable|snapshot|getter|same immutable' --reporter=verbose`
  passed.
- Every proof file/worktree was removed after capture. The only repository change from this audit is
  this ledger.
