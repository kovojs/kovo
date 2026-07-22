# Security Bug Ledger (`bugz-36`)

<!-- kovo-security-ledger: transient -->

**Date:** 2026-07-21
**Status:** CLOSED — remediation complete; publication and required CI pending
**Baseline:** `11ba9ce4fbb0da08a458ce25ba575851efbc9082`
**Lifecycle:** `closed-pending-publication`; archive by 2026-08-18 to
`plans/history/bugz-36.md` after the verified closing tip is published and required CI is green.

**Scope:** Distinct security and security-evidence defects found while completing the three 10x
security roadmaps after `bugz-35`. Every root below was reproduced before closure and deduplicated
against prior active and historical ledgers under `plans/`. Decorative/self-referential SHA cleanup
is intentionally excluded: `bugz-35` L2 already owns acceptance of unbound hex, and repeated stamps
add no new root. L3 is distinct because a load-bearing analyzer identity hashed real bytes but
trusted the expected identity supplied by the same subject; L5 is distinct because ordinary tests
required a deferred final record to follow moving source while the two final writers could not
produce one clean, coherent evidence subject.

## Severity summary

| Severity | Open | Closed |
| -------- | ---: | -----: |
| Critical |    0 |      3 |
| High     |    0 |     10 |
| Medium   |    0 |     18 |
| Low      |    0 |      6 |

## Critical

- [x] **C1 — The OIDC release job executed package tooling outside the reviewed byte closure.**
  - A pinned setup action still fetched mutable toolchain bytes before trusted npm publication, and
    the publish-authority census omitted repository-local actions. Compromised setup bytes could
    therefore reach registry authority (SPEC §2 and §6.6).
  - **Dedup:** residual beneath `bugz-29` C20: that fix separated build from OIDC but did not
    authenticate the transitive Node/npm setup bytes.
  - **Closure:** `2d049c08d` uses checksum-bound Node in no-install/OIDC jobs, integrity-bound offline
    pnpm only in producer jobs, an exact npm executable, and includes `.github/actions/**` in the
    authority scan.
  - **Evidence:** the release-workflow, publisher, registry-state, and supply-chain suites pass; the
    Node checksum and pnpm SRI match their upstream published identities.

- [x] **C2 — The producer drift check trusted Git's transformable view of worktree bytes.**
  - Local clean filters and attributes could make changed producer bytes compare equal to `HEAD`,
    bypassing increasingly elaborate same-worktree Git checks before sealing (SPEC §2 and §6.6).
  - **Dedup:** distinct from `bugz-29` C20/H22's missing tree coverage and rebuild boundary; this was
    Git clean-filter identity inside the producer worktree.
  - **Closure:** `2d049c08d` deletes the transform-sensitive proof and moves census, rehashing, and
    materialization into a fresh no-install `seal-release` job and checkout.
  - **Evidence:** `scripts/release-workflow-security.test.mjs` and
    `scripts/verify-packed-release-payload.test.mjs` pass.

- [x] **C3 — Reproducibility evidence was self-attested by two builds and their comparator on one
      runner.**
  - One build could alter the other checkout or comparator, while the comparator trusted manifest
    hashes without hashing the corresponding tarballs (SPEC §2 and §6.6).
  - **Dedup:** distinct from `bugz-29` C21's manifest-path escape and H22's release rebuild; this was
    independence and byte authentication of the reproducibility oracle.
  - **Closure:** `2d049c08d` runs A and B on separate fresh runners, downloads both bounded payloads
    into a third no-install job, rejects surplus/symlinked subjects, and rehashes actual tarballs.
  - **Evidence:** `scripts/reproducible-pack.test.mjs` passes its lying-manifest, surplus-file, and
    symlink controls.

## High

- [x] **H1 — Capability closure omitted TypeScript module-authority syntax.**
  - Import-equals, exported entity aliases, `export =`, and namespace re-exports could erase raw
    capability edges or adapter bootstrap ordering (SPEC §5.2, §6.6, and KV448/C13).
  - **Dedup:** unlike `bugz-29` C2's incomplete source graph, these modules were present but their
    TypeScript/namespace edge forms were unsupported.
  - **Closure:** `c9c1a02dc` and `f1f3a1c5e` preserve and classify these authority edges.
  - **Evidence:** the import-equals and namespace cases in
    `packages/compiler/src/capability-closure.security.test.ts` pass.

- [x] **H2 — Capability roots lacked sound per-use lexical and control-flow provenance.**
  - Shadows, mutable aliases, forward captures, exceptional/loop joins, reflective and computed
    calls, constructors, templates, accessors, decorators, JSX, and budget overflow could hide
    reachable raw authority (SPEC §5.2, §6.6, and KV448/C13).
  - **Dedup:** the module edge existed; the intra/interprocedural abstract state lost the capability,
    unlike earlier import-graph omissions.
  - **Closure:** `160e817dd`, `915fb3e98`, `e08fb5307`, `b5993d57d`, `0fee83916`, and `d91c6a39c`
    make those paths explicit and fail closed at finite budgets.
  - **Evidence:** `packages/compiler/src/capability-closure.security.test.ts` passes the lexical,
    control-flow, reflection, accessor/decorator, JSX, and overflow families.

- [x] **H3 — Omitted or falsy socket hosts bypassed localhost SSRF classification.**
  - Node interprets `{ port }`, empty, `null`, `false`, and zero hosts as local defaults while the
    floor previously forwarded them without equivalent classification (SPEC §6.6).
  - **Dedup:** distinct from `bugz-29` C4's Unix/datagram/lifecycle omissions.
  - **Closure:** `c19abeafc` normalizes implicit local destinations before policy.
  - **Evidence:** real socket controls in `packages/server/src/egress.test.ts` pass.

- [x] **H4 — Native egress sinks re-read mutable carrier state after classification.**
  - Proxy-backed connect options, mutable DNS answers, agent overlays, and conflicting
    `host`/`hostname` values could classify one destination and dial or reuse another (SPEC §6.6
    rule 5).
  - **Dedup:** distinct from `bugz-29` H11 pool-generation reuse and H14 response/header carriers.
  - **Closure:** `01b3e3a63` and `509023a48` snapshot the carrier consumed by each native sink.
  - **Evidence:** `packages/server/src/egress-carrier-snapshot.test.ts` passes.

- [x] **H5 — Certificates could circularly prove their own policy.**
  - Certificate-authored roots, doors, artifact lists, and opaque premises could yield PASS with an
    empty root set or omitted capability-bearing package (SPEC §2, §6.6, and §11/C13).
  - **Dedup:** unlike `bugz-35` M1's hidden analysis entrypoints, this was circular authority inside
    the independent evidence format/checker.
  - **Closure:** `fe054354c`, `6831bba4c`, and `b7b341a34` move the package/artifact/root census into
    reviewer-owned policy and reject vacuous or opaque proof inputs.
  - **Evidence:** the certificate policy, independent verifier, and negative-control suites pass.

- [x] **H6 — Certificate resolution modeled source spelling instead of Node and portable filesystem
      identity.**
  - Encoded URLs, nested/case-folded/trailing-dot/NFKC `node_modules`, condition/type targets,
    unconventional entries, reserved/colliding paths, and package/bin aliases could hide or
    substitute executable bytes (SPEC §6.6 and §11).
  - **Dedup:** distinct from `bugz-34`'s HTTP authority identity and `bugz-29` H12's generic build
    filesystem race.
  - **Closure:** `516954334`, `836cc94bf`, `fcf980a08`, `b7b341a34`, `60cb75b70`, `df302d917`,
    `f523939ae`, and `aea0e29c8` close the portable resolver and package aliases.
  - **Evidence:** `packages/verify/src/index.test.ts` passes the URL, target, entrypoint, portable-path,
    and alias adversarial families.

- [x] **H7 — The independent verifier did not parse every executable module reference.**
  - The old lexer stopped after 14,688 of 185,714 imports in a near-limit module and mishandled
    no-substitution template imports, allowing a dangerous tail edge to disappear (SPEC §6.6 and
    §11/C13).
  - **Dedup:** this is the separately shipped checker, not a compiler scanner defect.
  - **Closure:** `205bc89c4` uses complete parser-backed discovery; `836cc94bf` closes template import
    semantics.
  - **Evidence:** the near-limit tail-import and template-import cases in
    `packages/verify/src/index.test.ts` pass.

- [x] **H8 — Reviewer-authenticated verifier modules loaded unauthenticated parser bytes.**
  - A same-version adjacent malicious Acorn could omit dangerous imports while every reviewer-hashed
    verifier module remained unchanged (SPEC §2, §6.6, and §11/C13).
  - **Dedup:** distinct from H7's parser behavior and `bugz-35` M1's TCB root discovery.
  - **Closure:** `4543b4a99` bundles Acorn into the reviewer-owned verifier bytes, removes runtime
    dependencies, and rejects bare parser imports in pack/release gates.
  - **Evidence:** `scripts/check-pack-security.test.mjs` and
    `scripts/verify-packed-release-certificate.test.mjs` pass.

- [x] **H9 — Release evidence did not consistently name the exact bytes eventually published.**
  - The certificate initially checked workspace output, archive attestation covered a different
    envelope, and the producer payload admitted surplus bytes outside the reviewed manifest
    (SPEC §2 and §6.6).
  - **Dedup:** a distinct residual beneath `bugz-29` C21/H22: those fixed tarball path and rebuild
    identity, not the certificate and outer evidence envelope.
  - **Closure:** earlier tarball/certificate joins plus `2d049c08d` authenticate the exact bounded
    producer census; `340d69e2d` runs the reviewer-authenticated packed certificate before creating
    the sole archive consumed by attest and publish jobs.
  - **Evidence:** the packed-payload, reproducibility-subject, packed-certificate, and release-workflow
    suites pass.

- [x] **H10 — Endpoint response posture used substring classification and omitted a plain-text
      branch.**
  - Tokens such as `x-private`, `application/jsonp`, or `text/html; profile=json` could satisfy
    cache/media checks, while text bodies admitted active HTML/JSON or incorrect public caching
    (SPEC §9.1 and §9.5).
  - **Dedup:** distinct from `bugz-33` H17/M31's response-mutation and cache-cookie defects.
  - **Closure:** `8bb71d9ca`, `4535150b9`, and `1c7d23429` define exact media/cache tokens and the
    explicit `text/plain` posture.
  - **Evidence:** `packages/server/src/response-posture.test.ts` and the real HTTP/2 method regression
    pass.

## Medium

- [x] **M1 — The production advisory gate parsed the wrong pnpm schema and could report false green.**
  - It expected npm's `vulnerabilities` object while pnpm 10 emitted `advisories`, without binding
    process status to report schema/counts.
  - **Dedup:** `bugz-27` owned one esbuild advisory; this root was the audit evidence parser itself.
  - **Closure:** `ed58f4648` fails closed on pnpm schema/status and `c8b0bb819` remediates the affected
    production dependency set.
  - **Evidence:** `scripts/supply-chain-gates.test.mjs` and the live supply-chain gate pass.

- [x] **M2 — MCP callers controlled ambient compiler, filesystem, and provenance authority.**
  - Caller-selected graph/discovery paths, compile filenames, and supplied security facts could read
    local files or spoof producer-owned inputs (SPEC §5.3, §6.6, and §11.3).
  - **Dedup:** `bugz-29` M5 bounded request bytes; it did not remove these semantic authorities.
  - **Closure:** `e86f258b1` replaces ambient paths/facts with bounded framework-owned inputs.
  - **Evidence:** `packages/cli/src/mcp-adapter-security.test.ts` passes.

- [x] **M3 — MCP transport and compiler tools lacked semantic-work and lifecycle bounds.**
  - Duplicate/deep JSON, split UTF-8, premature commit, output/backpressure amplification, dense
    graphs, and unlimited calls could exhaust or wedge the stdio process.
  - **Dedup:** small byte-bounded inputs can induce disproportionate work, unlike `bugz-29` M5's
    byte-cap root.
  - **Closure:** `44ce0b733` and `e86f258b1` bound transport, output, graph work, calls, and session
    lifecycle; `7adca3037` removes the legacy SDK path.
  - **Evidence:** `packages/cli/src/mcp-adapter-security.test.ts` passes its framing, amplification,
    graph, and budget cases.

- [x] **M4 — Security-evidence readers checked a path separately from the bytes later consumed.**
  - Certificates and CLI inputs could grow, become FIFOs, switch identity, or race between
    stat/open/read.
  - **Dedup:** the same invariant as `bugz-29` H12 at lower-reachability standalone evidence inputs,
    not at production build sinks.
  - **Closure:** `b07264851`, `516954334`, `d4a9a8993`, and `70787fc0f` use bounded regular-file
    snapshots through the read/parse boundary.
  - **Evidence:** `packages/verify/src/file-snapshot.test.ts`,
    `packages/verify/src/file-snapshot-open.test.ts`, and CLI attestation race cases pass.

- [x] **M5 — Complete verifier parsing could accumulate unbounded references and reports.**
  - Near-limit modules and graph fan-out could exhaust memory or emit enormous findings before a
    closed verdict.
  - **Dedup:** H7 omitted references; this distinct root retained them without finite resource
    accounting.
  - **Closure:** `e7d504736` enforces exact per-module, aggregate, sentinel, and post-fixpoint budgets.
  - **Evidence:** the corresponding budget families in `packages/verify/src/index.test.ts` pass.

- [x] **M6 — `kovo update-docs` imported mutable website text into agent instructions.**
  - A compromise or redirect of `kovo.sh` could write prompt-injection text into `AGENTS.md` and the
    local docs mirror without changing the installed package (SPEC §2).
  - **Dedup:** no prior ledger owns this remote agent-instruction provenance root.
  - **Closure:** `e9ed2cce8` copies only the installed, versioned snapshot and performs no remote
    fetch.
  - **Evidence:** `packages/cli/src/index.update-docs.test.ts` passes its zero-network and exact-snapshot
    controls.

- [x] **M7 — Downstream canonicalization changed extension-method identity.**
  - A lower-case HTTP/2 extension method such as `purge` could become `PURGE` and dispatch a handler
    declared for different exact bytes (SPEC §9.5).
  - **Dedup:** `bugz-33` M34 fixed standard-method case at the Node-to-Fetch boundary; extension
    identity remained distinct.
  - **Closure:** `8bb71d9ca` canonicalizes only the standard method set and preserves extensions.
  - **Evidence:** the real HTTP/2 regression requires `purge -> 405` and `PURGE -> 200`.

- [x] **M8 — The privileged publisher parsed an unbounded packed manifest.**
  - An oversized artifact could exhaust the OIDC publish job before schema or hash validation.
  - **Dedup:** `bugz-29` C21 addressed manifest path/identity forgery, not pre-parse resource bounds.
  - **Closure:** `dd4e5bf52` snapshots the manifest through the fixed byte limit before JSON parsing.
  - **Evidence:** `scripts/publish-packed-packages.test.mjs` passes its sparse max-plus-one control.

- [x] **M9 — In-process parser reconciliation retained mutable Acorn controls after bootstrap.**
  - Mutating reviewed ambient, boot-reachable, or fixed-mode parser controls after import could make
    an in-process reconciliation parse omit an executable edge and preserve a false-green verdict.
  - **Dedup:** H7 owns complete parsing and H8 owns the authenticated parser bytes; this root was
    post-bootstrap mutable control state in the optional same-realm defense-in-depth path.
  - **Closure:** `1437c5014`, `c73b7f8bc`, `479312e63`, and `97d8b8f34` capture and census the reviewed
    controls and private fixed-mode instance families. `22732c9f0` makes the boundary explicit: the
    independent verdict is the fresh standalone CLI, while deliberately instrumenting dependency
    internals to discover previously unreachable closure objects is privileged same-realm compromise.
  - **Evidence:** all 86 verifier tests pass and the private-parser-family forcing mutant is killed;
    read-only CLI review confirms the standalone verifier never evaluates the app module graph.

- [x] **M10 — Packed Better Auth roots initialized secret-dependent code before runtime lockout.**
  - Some supported packed entrypoints could import the adapter before installing the runtime lock,
    permitting early environment-dependent initialization under an unsupported preload/import order.
  - **Dedup:** distinct from earlier runtime-lock completeness roots: the guard existed, but packed
    root ordering did not consistently install it first.
  - **Closure:** `3d5d91fbb`, `981404c59`, and `ba0562452` make the generated standalone lock private
    and require every supported packed root to import it before adapter initialization.
  - **Evidence:** the packed-root ordering regression covers the public, internal, and mount-adapter
    entries. A privileged host preload remains outside the framework boundary and can already read
    the host environment directly.

- [x] **M11 — Query names and instance keys collapsed into one ambiguous runtime string.**
  - An unkeyed query name could equal another query's full instance key. Refetch hooks, visible-return
    ledgers, optimistic key derivation, and instance-specific update-plan lookup reused that display
    string as decision identity; a response for `{ name: "foo", key: "bar" }` could therefore select
    the DOM update plan registered for the unrelated query named `bar`.
  - **Dedup:** distinct from wire framing and query-store storage collisions: the wire already carried
    separate `name`/`key` attributes and the store used a NUL-framed composite, but downstream
    decision APIs collapsed those exact facts again.
  - **Closure:** `02a4df25a`, `895b783ce`, and `6181323a4` carry frozen `{ name, key }` facts through
    hydration, refetch, events, visible return, and apply; plan lookup uses collision-free framed
    identity, while full-domain optimistic keys remain exact.
  - **Evidence:** the focused query identity/typed-read suite passes 126/126, including colon-name,
    foreign-domain, plan-selection, and keyed/unkeyed collision controls.

- [x] **M12 — Handler capture analysis treated opaque helper and container uses as scalar-safe.**
  - A server component could capture `item.fn`, pass it through a local helper, and invoke it there;
    the compiler emitted the capture as a serialized handler parameter even though its finite
    handler language had not proved that every use was scalar-only. Object, array, destructuring,
    computed-key, and same-name shadowing variants exposed the same deny-enumeration and lexical
    identity gap (SPEC §5.2).
  - **Dedup:** distinct from H2's capability-root reachability and the historical handler-call
    fixtures: this root is the positive proof required before an arbitrary captured value may cross
    the server-to-browser serialization boundary.
  - **Closure:** `8326bbfe0` requires parser-owned positive scalar-use proof; `5a9b49954`,
    `ee677d596`, `704247092`, `2e16f4409`, and `10c738a99` close recursive state snapshots, delayed
    aliases, local maps, `Object.assign`, retained state-object writes, and state callee/constructor/
    tag paths. `20fdbb9c3` and `a723de4d7` make handler/binding publication transactional.
  - **Evidence:** the focused compiler handler/IR suite passes 783/783 and the modular browser
    handler/binding suite passes 224/224, covering opaque helpers, containers, protocols, callable
    state, shadowing, rollback, and safe scalar controls.

- [x] **M13 — The live-target emitter reparsed executable query text after parser analysis.**
  - The emitter reconstructed a TypeScript source file from a raw query-expression string to decide
    executable imports and identifiers, while generated helper aliases were chosen without the
    parser's complete authored-name set. This created a second, source-text decision layer after the
    parser facts and could either disagree with analysis or collide with an authored binding
    (compiler hard rule 10; SPEC §5.2).
  - **Dedup:** distinct from M11's runtime query identity and earlier parser-completeness findings:
    the authoritative parse had already completed, but emission discarded its typed facts and made a
    new executable decision from text.
  - **Closure:** `fdc65aca4` carries parser-owned query imports, identifiers, executable-use facts,
    and the complete authored-name set into emission; `8371478ce` preserves the proved import order
    while deriving collision-free helper/export bindings without an emitter reparse.
  - **Evidence:** the focused compiler suite passes 783/783, including helper suffix-chain,
    authored import/local/export collision, generated binding, and import-order controls.

- [x] **M14 — Versioned enhanced requests were decoded by the current build without document-build
      selection.**
  - A browser retained across deploys did not send its immutable document build on query and mutation
    target requests. The current app therefore decoded old target bytes under the new wire grammar;
    the v1 colon/literal-percent form and later framed forms had no unambiguous cross-version meaning
    (SPEC §9 and §14 deploy skew).
  - **Dedup:** distinct from M11's same-version identity collapse and previous response-only build
    mismatch checks: this root occurred before the server selected a grammar and registry.
  - **Closure:** `895b783ce` binds every enhanced request to the document build and exact retained
    decoder; `d103de2bf`, `259a68683`, `8046b9527`, `37abd9bb6`, and `24f869a47` derive and atomically
    publish the exact module representation, render-plan, and app-build values. Only the immutable
    module URL and `Kovo-Build` are external carriers; the render fingerprint remains an internal
    app-token input. `3bb3026c4` keeps one admitted build coherent through route, mutation, document,
    and error rendering. Production presets fail KV417 without the SPEC §14 retention proof.
  - **Evidence:** the focused build/client-module/Vite/request-coherence suite passes as part of the
    276/276 server/browser/wire run, covering full representation digests, atomic snapshots, exact
    retained selection, token freeze, served-byte pinning, module-less grammar rotation, and the
    retention floor.

- [x] **M15 — Typed-read refetch trusted foreign final responses as query truth.**
  - The modular and inline lifecycle `/_q/` refetch paths validated fragment media and a public
    compatibility token but did not prove the final response URL. A same-origin request that followed
    a CORS-readable cross-origin redirect could therefore accept a foreign `Kovo-Build` /
    `Kovo-Build-Skew` header as reload authority or apply a foreign `<kovo-query>` body (SPEC §9.4 and
    §14).
  - **Dedup:** distinct from M14's request-side decoder selection: this root is response-origin
    authority after fetch redirect handling, and the build token is deliberately not an
    authenticator.
  - **Closure:** `facf1b866`, `e4e8235b1`, and `b07a68e62` snapshot the canonical `/_q/` URL and
    require an unredirected exact final href/origin before reading framework headers or body; they
    also make status, media, body grammar, JSON admission, and build-skew markers exact.
  - **Evidence:** the focused typed-read suite passes 126/126 and Chromium recovery/response parity
    passes 68/68, including foreign redirects, forged public tokens, stale bodies, and modular/
    generated-inline paths.

- [x] **M16 — Enhanced mutation responses trusted the wrong same-origin endpoint.**
  - The modular and inline mutation paths admitted any final same-origin response before reading
    framework build, session-transition, reauthentication, change, and fragment truth. An
    unredirected response whose final URL named another same-origin endpoint could therefore apply
    that endpoint's fragment body or trigger framework recovery/navigation authority.
  - **Dedup:** distinct from M15's credential-bearing typed-read redirect and M14's request-side
    decoder selection. Mutation transport already rejected cross-origin results; it failed to bind
    an unredirected response to the exact mutation action URL.
  - **Closure:** `895b783ce` and `ccfeac4ee` snapshot the exact action URL, use Fetch redirect-error
    mode, and reject missing, redirected, manual, or wrong-endpoint final facts before any `Kovo-*`
    header/body authority. Native no-JavaScript 303 PRG remains separate.
  - **Evidence:** the mutation/navigation slice of the 276/276 focused run and Chromium response
    parity (68/68) cover wrong endpoints, redirect shapes, session transitions, fragments, and the
    generated inline loader.

- [x] **M17 — Typed-read authorization failures preserved previously authorized browser truth.**
  - The visible-return/delta-miss typed-read client reported and skipped an exact same-build 403,
    and reported a followed unauthenticated redirect as a generic fetch error. In both cases the
    prior query-store value and dependent DOM remained authoritative-looking after the server had
    denied the current principal (SPEC §6.5, §9.4, and §14 recovery).
  - **Dedup:** distinct from M15's foreign-final-response authority and M14's build selection: this
    root is the same-origin exact typed-read endpoint's negative authorization outcome after URL
    and build admission.
  - **Closure:** `ccfeac4ee`, `facf1b866`, `e4e8235b1`, and `b07a68e62` reject typed-read redirects,
    classify exact 401/403 denial as terminal document recovery, cancel stale bodies, and preflight
    the whole response batch before applying any query value.
  - **Evidence:** the focused typed-read/lifecycle suite passes 126/126 and Chromium recovery parity
    passes 68/68, including seeded-private 403, enhanced unauthenticated denial, native 303,
    multi-query atomicity, visible return, delta miss, and terminal reentrancy.

- [x] **M18 — Browser response-media classifiers accepted ambiguous combined fields.**
  - A mutation fragment or enhanced-navigation response was admitted when a safe media type appeared
    before a comma or line break, so an ambiguous field such as fragment media followed by
    `text/html` could still reach DOM or navigation authority (SPEC §7 and §9).
  - **Dedup:** H10 owns server endpoint posture, while M15/M16 bind response URL and redirect facts;
    this root was the browser's media-field parser after those checks.
  - **Closure:** `3435f78f9` rejects comma, CR, LF, and NUL ambiguity before parsing parameters in
    every remaining mutation and enhanced-navigation media classifier, including generated inline
    output.
  - **Evidence:** the mutation/navigation slice of the 276/276 focused run and Chromium recovery/
    navigation parity (68/68) cover combined-field, line-break, valid-parameter, and exact-media
    controls.

## Low

- [x] **L1 — Dry-run release dispatch still exercised attestation authority.**
  - A nominal dry run obtained avoidable OIDC/attestation privileges and external side effects.
  - **Dedup:** least-authority drift, not the package-compromise path owned by C1.
  - **Closure:** `6044df10d` conditions both attestation jobs and publication on non-dry-run input.
  - **Evidence:** `scripts/release-workflow-security.test.mjs` passes.

- [x] **L2 — Live browser target metadata could be substituted during serialization.**
  - Late collection mutation, inherited optional fields, hostile DOM accessors, and inherited
    `toJSON` hooks could change the framework-emitted descriptor metadata between discovery and wire
    encoding.
  - **Dedup:** distinct from server authorization defects: canonical server attestation rejects a
    substituted app/build/principal/source/descriptor tuple, so no authority bypass was reproduced.
  - **Closure:** `17ea432f8`, `389fcd68d`, `664e81803`, `81614f81b`, `14c2f1795`, and `b3561991c`
    snapshot own-data metadata once, canonically serialize integer-index keys without inherited
    callbacks, reject mixed collections atomically, and pin HMR/live-target dispatch plus bounded
    header-safe bytes. `7cb63e1d3` refreshes the exact browser wire fixture after the identity
    migration.
  - **Evidence:** the mutation-target/wire slice of the 276/276 focused run passes, and the exact
    Chromium mutation-target parity suite passes 2/2.

- [x] **L3 — The compiler posture gate circularly authenticated its own implementation digest.**
  - The analyzer hashed its real source bytes but also supplied the expected digest, so an edit plus
    restamp could satisfy the supposedly independent identity check.
  - **Dedup:** `bugz-35` L2 owns arbitrary digest-shaped strings; this digest was computed over real
    bytes but lacked an independently controlled expectation.
  - **Closure:** `e0b7645a6` removes the compiler self-digest while retaining independent metadata,
    version, fingerprint, export-status, and noncompiler package checks; `8e14673cd` refreshes the
    separately reviewed CLI posture subject.
  - **Evidence:** the focused compiler posture suite passes 94/94, and review finds no self/fixed-point
    identity marker in the remaining compiler root.

- [x] **L4 — An absent optional live-target header consumed budget at the exact transport limit.**
  - When required mutation headers plus `Kovo-Targets` used exactly the 9,216-byte application-header
    budget, the planner still reserved line overhead for an empty `Kovo-Live-Targets` value and
    rejected a request that the emitted transport would safely omit.
  - **Dedup:** distinct from earlier oversized-header and sparse-array work bounds: this was a
    conservative-accounting false rejection at the documented inclusive boundary.
  - **Closure:** `b3561991c` and `895b783ce` bound the real target transport and account only emitted
    header lines, omitting empty optional fields while retaining strict aggregate overflow rejection.
  - **Evidence:** `packages/core/src/internal/wire-input-grammar.test.ts` passes within the 276/276
    focused run, including exact-limit, omitted-empty, one-byte-over, and required-plus-optional
    planner controls.

- [x] **L5 — Deferred final evidence required perpetual restamping and could not be written
      coherently.**
  - Ordinary `pnpm test` required the retained convergence record to equal the moving live compiler
    census, despite final evidence being deferred. Separately, each standalone final writer required
    a clean worktree, so the first artifact necessarily made the second writer reject the subject.
  - **Dedup:** unlike `bugz-35` L2's unbound digest-shaped strings and L3's self-authenticating
    analyzer identity, these checks bound real facts but imposed the wrong lifecycle and an
    unexecutable two-file transaction.
  - **Closure:** `a55b5ec5f` separates retained-history validation from explicit `--artifact` live
    equality, and adds one final-evidence orchestrator that asserts cleanliness once, validates both
    documents against the same subject before writing, and rolls back the file set on write failure.
    The standalone artifact writers remain strict.
  - **Evidence:** the convergence/orchestrator suite passes 18/18, the integrated evidence/server
    suite passes 94/94, and the retained command is green; controls cover live drift, one cleanliness
    assertion, prevalidation, subject mismatch, and second-write rollback.

- [x] **L6 — Stateless delegated handlers created layout drift that aborted private islands.**
  - Every stateless handler committed fallback `{}` as a new `kovo-state="{}"` attribute. Enhanced
    navigation then judged an unchanged compiler-stamped layout shell as changed, replaced it, and
    aborted the private island's `AbortSignal`. No remote security bypass was reproduced.
  - **Dedup:** distinct from handler-state serialization authority (M12) and target metadata (L2):
    the state bytes were safe, but their framework-created presence changed lifecycle identity.
  - **Closure:** `df349d4ec` makes modular and generated-inline dispatch omit only an absent empty
    state snapshot while retaining explicit state hosts and newly nonempty state.
  - **Evidence:** the focused modular/generated-inline handler slice passes 105/105, full Chromium
    inline navigation passes 36/36 (including the exact layout repro), and inline-loader freshness
    passes.

## Latest verification

- Release/supply-chain focused suites (63/63) and verifier suite (86/86); selected private-parser
  forcing mutant killed (the final-tip campaign remains a Phase 6 gate).
- Query identity, typed-read, lifecycle, and scanner suites (126/126).
- Compiler handler/IR/emission suites (783/783); modular handler/binding suites (224/224).
- Build, client-module, Vite, request-coherence, mutation, navigation, target, and wire suites
  (276/276).
- Chromium recovery/response/navigation parity (68/68), mutation-target parity (2/2), and full
  inline-navigation layout parity (36/36); inline-loader freshness passes.
- Convergence/final-evidence transaction suite (18/18), integrated evidence/server suite (94/94),
  and retained-history check.
- `pnpm run check:runtime-tier-door-parity` (8/8), `node scripts/supply-chain-gates.mjs`, and YAML
  parse of both workflows plus both release composite actions.
