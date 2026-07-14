# Security Bug Ledger (`bugz-29`)

**Date:** 2026-07-13

**Scope:** Exhaustive adversarial security dogfood after the `bugz-28` checkpoint at
`a81c4763c`. Rankings are by practical impact first, then exploitability. Each item below is a
finding family; several families contain multiple independently reproduced variants. `SPEC.md`
§2, §5.2, §6.6, §9, and §10 remain normative: authored code shares framework realms, structural
markers are not proof, security facts are snapshotted once, and uncertain trust-boundary behavior
fails closed.

## Severity summary

| Severity | Families | Items  |
| -------- | -------: | ------ |
| Critical |       21 | C1-C21 |
| High     |       23 | H1-H23 |
| Medium   |       12 | M1-M12 |
| Low      |        2 | L1-L2  |

## Critical

- [x] **C1 - Authored build config could mint signed persistent compiler-cache entries containing
      attacker-selected output.**
  - **Evidence:** `2c135240a` co-locates signing with genuine compilation and removes the signer
    oracle; compiler, built-dist, CLI, perf, and cache-security tests pass. SPEC §5.2, §6.6.

- [x] **C2 - Forgeable or incomplete compiler facts could replace query/table/source security
      truth.**
  - Public global query facts, omitted runtime-reachable imports, unsafe source links, and partial
    table discovery could all make emitted policy differ from authored runtime code.
  - **Evidence:** `9d7df8c68`, `0aa2faf0e`, `468f1bd3e`; facts now come from rooted descriptor reads,
    a closed import graph, and exact compiler-owned table manifests. SPEC §5.2, §10, §11.2.

- [x] **C3 - Poisonable browser lifetime and navigation controls could retain privileged stale DOM
      after server revocation.**
  - **Evidence:** `a8b5af001`, `738480301`, `9a8bc096b`, `5c27f033b`, `484d99066`; private pinned
    lifetime, head, transition, abort, and teardown controls pass three-engine tests. SPEC §8, §9.1.

- [x] **C4 - Public or incomplete egress-floor authority could be forged or bypassed.**
  - Public symbols could forge the SSRF self-probe, while lifecycle, Unix-socket, and datagram paths
    escaped the intended network floor.
  - **Evidence:** `0435769e1`, `03409e9e0`, `8fb99d2cf`, `b38fde272`; floor identity is private and
    all supported transports enter pinned dial-time enforcement. SPEC §6.6.

- [x] **C5 - Secret clone protection could be skipped or bypassed through custom array state.**
  - A forgeable global marker suppressed the guard; enumerable custom array properties later let a
    Secret escape structured-clone preflight.
  - **Evidence:** `f9c76cc9a`, `a277fbafa`; private composed guards and bounded exact-own traversal
    reject both exploits with KV435. SPEC §6.6.

- [x] **C6 - Drizzle runtime security annotations could be omitted, forged, or replaced after
      declaration.**
  - Unknown fields, structural lookalikes, writable callback slots, and incomplete discovery could
    erase secret/ownership metadata or forge public posture.
  - **Evidence:** `fee48de6b`, `66044587b`, `e1c10ee3a`, `0aa2faf0e`, `468f1bd3e`; runtime policy now
    exact-matches compiler-owned facts. SPEC §2, §6.6, §10.

- [x] **C7 - Browser response, stream, query, optimism, and idempotency controls could substitute
      attacker truth for server truth.**
  - Reproductions covered redirected fragments, hidden query truth, injected template markup,
    forged stream completion/post-terminal bytes, retained optimistic privilege, stale principal
    channels, constant/reused idempotency tokens, and generated/modular drift.
  - **Evidence:** `8eef7d9d6`, `8d0539056`, `483500d9b`, `5ccaaa537`, `ed302e104`, `977df2f01`,
    `6013175b2`, `5e058c510`, `2c49775e6`; Node and Chromium/Firefox/WebKit matrices pass. SPEC §9.

- [x] **C8 - Canonical wire values could collide, mutate, exhaust resources, or be emitted in a
      form every decoder rejects.**
  - Inherited `toJSON`, proxy lengths, forged tags, tag-shaped user records, cycles, lossy host
    values, and raw/HTML-safe expansion broke canonicality or encoder/decoder parity.
  - **Evidence:** `fd0196789`, `1ae217f65`, `41145f15b`, `a277fbafa`, `5e058c510`; canonical tags,
    exact traversal, graph budgets, and final serialized-size bounds are symmetric. SPEC §6.6, §9.

- [x] **C9 - Late TypedArray/ArrayBuffer authority poisoning could authenticate forged signatures
      or weak secrets.**
  - Poisoned length/byteLength collapsed HMAC comparisons and Secret equality, admitted undersized
    signing material, and species-dispatched copies could retain attacker-mutated bytes.
  - **Evidence:** `9b1a4e3f7`, `a277fbafa`, `8ade644f7`; captured internal-slot getters and explicit
    intrinsic copies protect WebCrypto, keyrings, CSRF, capabilities, and byte snapshots. SPEC §6.6.

- [x] **C10 - Durable replay authority and truth could be forged, structurally substituted, or
      committed before settlement.**
  - **Evidence:** `23c592c84`, `cbbbc9be6`, `6be46576f`, `f3434a211`; module-private runtime receipts,
    bounded schemas, authenticated stores, and awaited settlement own replay truth. SPEC §9.1,
    §10.3.

- [x] **C11 - Forgeable Vite re-entry provenance could suppress KV235 and accept attacker-selected
      lowered server output.**
  - **Evidence:** `cab4b4b84`; Vite config/options and framework-compile regressions require a
    root/file-bound framework outcome, while retired cross-configuration caches cannot suppress a
    genuine compile. `vp check` and the focused compiler/Vite suites pass. SPEC §2, §5.2.

- [x] **C12 - Production bundles could consume app source bytes different from the snapshot that
      passed the build security preflight.**
  - An authored config timer could rewrite an imported module after preflight; the server bundler
    then emitted request-derived raw SQL from the unapproved bytes.
  - **Evidence:** `e40f78044`; client, component-scan, and server transforms compare Vite's exact
    source value with the approved closed source graph, and changed/new-module timer attacks fail
    before server artifact emission. SPEC §5.2, §6.6.

- [x] **C13 - Runtime security engines could be first-resolved after app evaluation or consume
      app-realm collection authority.**
  - **Evidence:** `9b6b1a4e6`, `716f2fa69`, `5b90d62d6`, `a2f615be8`, `3abc7bad3`; password and
    egress work is boot-owned, while managed SQL parsing runs in an exact-dependency private realm
    installed by a capability-authenticated bootstrap. Parser-registry attacks and 158 direct
    managed-DB/mutation/guard/task regressions pass. SPEC §6.6.

- [x] **C14 - Generated live-target renderer authority leaked across app aggregates in one
      process.**
  - **Evidence:** `e851d70b9`; an async-local, single-consumer app-graph scope owns generated
    renderer registration, late/unscoped registration has no authority, and sequential/concurrent
    app plus HMR/removal isolation regressions pass. SPEC §2, §6.6, §9.1, §9.5.

- [x] **C15 - A later app aggregate could replace the process-wide egress floor and widen an
      earlier app's outbound authority.**
  - A strict app first blocked loopback, then a second `createApp()` allowlisted the local target;
    the first app's process could immediately fetch the previously denied internal response.
  - **Evidence:** `5c95a833e`; app bootstrap now permits repair/reinstallation only when the
    normalized process policy and hardening posture are unchanged, while incompatible apps fail
    before any transport policy is replaced. The exact transport repro plus 102 egress tests,
    egress-boundary, sink-policy, and `vp check` pass. SPEC §6.6.

- [x] **C16 - Live-target refresh could cross the source route's authorization and request
      context.**
  - A public page descriptor could be replayed through dev HMR for a forbidden route, or through a
    denied/invalid production mutation while response queries observed the mutation URL. Both
    variants returned route-context secrets without the source route owning the render decision.
  - **Evidence:** `7ea6d7d5a`, `4a9221421`, `b6ebaf70d`, `42d207482`, `5c804e3d5`, and
    `96e1e1336`; attestations bind the canonical source URL, mutation/HMR rerun the exact source
    guard chain, and every response query/renderer receives a sanitized canonical GET. SPEC §6.6,
    §9.1, §9.3, §9.5.1.

- [x] **C17 - A valid public live descriptor could select an unsigned private query-only target.**
  - Forging `Kovo-Targets` beside a valid public descriptor executed a private query loader and
    returned its server secret because query-only targets were not bound to the signed renderer.
  - **Evidence:** `94a7f8c54`; every query-only layout/update target is now generated, signed, and
    exact-renderer-bound, with the affected eight-file 219-test matrix green. SPEC §6.6, §9.1.

- [x] **C18 - Mutation input could steer a live target's unrelated query argument domain.**
  - A signed descriptor's component props did not exclusively own query instance arguments, so an
    unrelated mutation input could select a different row while retaining the descriptor's target.
  - **Evidence:** `9fa0cb209`; descriptor props now own query arguments and all generated dynamic
    instances render without consulting mutation input. SPEC §6.6, §9.1.

- [x] **C19 - Live-target attestations were reusable across app, build, session, or principal
      boundaries.**
  - Reproductions crossed same-contract apps, stale builds, two users sharing one CSRF session
    binding, no-global-CSRF principals, and anonymous CSRF cookies A/B.
  - **Evidence:** `d19ba17a1`, `3ccf1f20c`, `3b18368e7`, `8642a0ec5`, and `0b5ad9f45`; the payload
    binds the exact app/build audience, CSRF session or anonymous-cookie identity, and independently
    resolved framework principal. The final server suite is 182 files/2742 tests green. SPEC §6.6,
    §9.1, §9.3.

- [x] **C20 - Release OIDC authority was reachable before exact trusted-CI authorization and by
      checkout, install, build, and pack code.**
  - Dispatch could skip validation, same-name checks were not bound to the official CI workflow,
    and the drift check omitted part of the tracked tree.
  - **Evidence:** `8b0f43d0a`; a no-checkout/no-OIDC job binds the exact main SHA to the official
    GitHub Actions app, CI workflow, suite, repository, and successful push run; a separate no-OIDC
    prepare job owns all repository code, dry runs stop there, and only the reviewed archive reaches
    the minimal publish job.

- [x] **C21 - A self-attested packed manifest could select a decoy package identity and publish an
      arbitrary tarball outside the verified release directory.**
  - The exact `../../outside.tgz` reproduction reached `npm publish` while a valid package name was
    present elsewhere in the manifest.
  - **Evidence:** `8b0f43d0a`; the publisher exact-matches the ordered release inventory and packed
    manifest identity, rejects duplicate/escaping/symlinked paths, revalidates the real path,
    tarball hash, file list, and manifest, and compares already-published `dist.integrity`.

## High

- [x] **H1 - Starter dependencies, tools, and CI actions were not fully immutable.**
  - **Evidence:** `7e232d8cf`, `93613ddc0`, `e7a09b6a7`, and `8b0f43d0a`; exact versions/digests,
    exact generated starter tool versions, npmjs registry pins, and patched transports pass
    supply-chain policy gates.

- [x] **H2 - Production starter boot could seed a known credential or accept weak secret/cookie
      posture.**
  - **Evidence:** `081580070`, `0d9b73952`, `88be171ae`; production seeding is refused and the real
    artifact provisions only through CSRF-protected sign-up.

- [x] **H3 - Generated CI checkout retained repository credentials for later build steps.**
  - **Evidence:** `6468784e9`; starter CI uses `persist-credentials: false`.

- [x] **H4 - Demo sessions accepted caller-selected identities and weak cross-site cookie
      isolation.**
  - **Evidence:** `f2e14b44e`, `5420528ae`; identities are server-minted and host-prefixed secure
    cookies isolate sessions.

- [x] **H5 - Demo, site, and example asset servers allowed malformed, prefix-confused, out-of-root,
      or symlink reads.**
  - **Evidence:** `9842189f4`, `afb96f125`, `ef9a5e58d`, `ab9a89fd9`; canonical descriptor/root
    confinement rejects every reproduced escape.

- [x] **H6 - Docker build context included nested environment, credential, and key material.**
  - **Evidence:** `a1e0c81fe`; a real context meta-test enforces nested exclusions.

- [x] **H7 - Cloud Build used mutable privileged builders and mutable deployment tags.**
  - **Evidence:** `fe57b17e9`; builders are digest-pinned and images use immutable build IDs.

- [x] **H8 - Emitted Node images used a mutable obsolete base and ran install/runtime as root.**
  - **Evidence:** `68c2b08b3`; emitted images use pinned multi-arch Node 24 and `USER node`.

- [x] **H9 - Emitted runtime installs ignored lock policy or executed lifecycle scripts.**
  - **Evidence:** `d13b50938`, `b75d59ed2`; npm/pnpm/Yarn installs are frozen, script-disabled, and
    preserve lock-relevant pnpm policy.

- [x] **H10 - Caller-triggered demo builds had no admission bound.**
  - **Evidence:** `45f136756`; concurrent build/session work is capped and cleaned up.

- [x] **H11 - Egress pools and caches retained stale or unbounded destination authority.**
  - **Evidence:** `22347de9c`, `ca48caea0`, `03409e9e0`; policy generations own fresh pools and DNS
    state is bounded without weakening rebinding pins.

- [x] **H12 - Static/build/compiler filesystem operations had descriptor, TOCTOU, or root-confinement
      gaps.**
  - **Evidence:** `6584284cd`, `d04296e06`, `c91e466bd`, `f6d6571d4`, `2ede08424`, `f901217bc`,
    `468f1bd3e`; checked descriptors own the exact bytes later consumed.

- [x] **H13 - Executable, DB migration, and source path authority could change after review.**
  - **Evidence:** `7a3221f92`, `468f1bd3e`; command identity and fs/path/url controls are boot-pinned
    before authored schema/config evaluation.

- [x] **H14 - Server request, response, webhook, header, and byte carriers could mutate after
      classification.**
  - Reproductions included raw Response header mutation, verifier-body aliasing, species copies,
    post-classification byte edits, and a stateful header Proxy revealing `Set-Cookie` only at the
    final `csrf:false` wire sink.
  - **Evidence:** `e7b2720e3`, `9b1a4e3f7`, `8ade644f7`, `7901da650`; every sink consumes one owned
    snapshot and reconstructs the outcome.

- [x] **H15 - Inherited/accessor access and guard fields could forge public or guarded audit
      authority; poisoned iteration could collide render contracts.**
  - **Evidence:** `a277fbafa`; exact-own snapshots and indexed canonical models reject the exploits.

- [x] **H16 - Direct grants to the managed Postgres runtime login escaped engine-door closure
      audits.**
  - **Evidence:** `769021eda`; runtime login identities join the same relation/routine closure and
    the exact false-green grant now refuses KV433. SPEC §10, §11.2.

- [x] **H17 - Static export could classify attacker-forged or time-varying Response headers and
      write a non-document body.**
  - **Evidence:** `d14ac8973`; Response headers are boot-pinned, normalized once before awaiting the
    body, frozen, and reused for classification, diagnostics, and output.

- [x] **H18 - The static-analysis disk cache followed an app-planted symlink and overwrote a file
      outside the project cache root.**
  - **Evidence:** `736f78617`; cross-run static security-fact caching is retired, process-local
    canonical snapshots are bounded to one entry per lane, and the symlink regression leaves the
    outside victim untouched. SPEC §2, §10.6.

- [x] **H19 - Concurrent filesystem storage reads could combine an object body and metadata from
      different committed generations.**
  - **Evidence:** `cab4b4b84`; same-root adapters share a process-global generation lock and body,
    metadata, stat, and stream reads resolve one atomically committed generation. Core storage and
    overlapping-adapter race suites pass. SPEC §6.6, §10.6.

- [x] **H20 - Ordinary app-authored mutation/live-target response registries exposed arbitrary
      render and query authority.**
  - Root `mutationResponses`, `fragmentRenderers`, and `liveTargetRenderers` options let request
    target headers select app callbacks. Empty targets acted as a wildcard, duplicate targets could
    amplify work, and CSRF/schema/guard/replay failures could invoke callbacks before handler
    authority existed.
  - **Evidence:** `e5a7bba5d`, `4861d9fb9`, `d19ba17a1`, `052e3acad`, and `5455450b9`; root response
    options are rejected, only scoped compiler-generated registries carry authority, targets are
    exact/deduped, and typed failure renderers declare the submitted mutation key. The complete
    migrated integration matrix is 160/160 green. SPEC §2, §6.6, §9.1, §9.5.

- [x] **H21 - Principal-specific HMR refresh output was cacheable and live refresh accepted safe
      methods that its framework client never used.**
  - A proxy/browser cache could retain session-specific route or fragment bytes, while GET/HEAD
    unnecessarily widened the dev refresh transport.
  - **Evidence:** `e4f7eb604`; live refresh is POST-only and every route/live success or failure has
    `Cache-Control: private, no-store` plus `Vary: Cookie`; the final focused six-file matrix is
    172/172 green. SPEC §9.5.1.

- [x] **H22 - Final release tarballs were rebuilt through lifecycle scripts outside the reviewed
      scanner and egress path, while registry state was ambient and integrity-blind.**
  - The bytes scanned by pack-security were not necessarily the bytes later published; uncommon
    and NUL-bearing files also escaped the prior scan.
  - **Evidence:** `8b0f43d0a`; one lifecycle-disabled pack path produces the final bytes, then exact
    tarball contents, snapshot, manifest, and sha512 are scanned and attested; npmjs is explicitly
    pinned and an existing version is skipped only when `dist.integrity` matches.

- [x] **H23 - An obsolete placeholder bootstrap remained a second ambient-registry npm mutation
      authority and treated every registry lookup error as a missing package.**
  - **Evidence:** `fabca7f08`; all 13 public packages were confirmed present, the publisher was
    removed, and the supply-chain gate now requires exactly one npm publish authority: the attested
    packed-package publisher.

## Medium

- [x] **M1 - PGlite declared-write verification attributed setup/seed writes to a request.**
  - **Evidence:** `5f2dd7f02`; per-request baselines keep write evidence honest.

- [x] **M2 - Compiler render-equivalence lookup was cubic on large component sets.**
  - **Evidence:** `e91274285`; indexed semantic models pass the strict compiler-perf gate.

- [x] **M3 - Sanitizer, DOM reconciliation, JSON/wire sorting, graph traversal, clone, and HMAC
      candidate work had quadratic or unbounded paths.**
  - **Evidence:** `64a031516`, `43bc178d7`, `80aa4b51f`, `119974a51`, `a277fbafa`; deterministic
    depth/node/byte/cardinality bounds and linear indexes cover the reproduced DoS inputs.

- [x] **M4 - Audit reasons, escape receipts, guard metadata, MIME facts, and explicit security
      opt-outs accepted ambiguous or unbounded text.**
  - **Evidence:** `047a34e02`, `2e3123d8a`, `6ba3e83a1`, `05d478662`, `551819c24`, `2c96d37fb`,
    `48cf1345d`; printable bounded exact text and required justifications own the audit record.

- [x] **M5 - MCP stdio lines, compile sources, and filenames were unbounded.**
  - **Evidence:** `468f1bd3e`; 4 MiB line, 2 MiB source, and 4096-character filename caps recover
    cleanly after rejection.

- [x] **M6 - DNS, reporting, request-body, security-state, and cache cardinalities could grow or be
      miscounted.**
  - **Evidence:** `ca48caea0`, `119974a51`, `9b1a4e3f7`, `8ade644f7`, `be2b43bda`; pinned
    byte/cardinality facts and pre-allocation target-header ceilings enforce deterministic caps.

- [x] **M7 - Entropy and generated security-audit controls could be falsified by late intrinsics or
      census drift.**
  - **Evidence:** `284261ed5`, `584b44d16`, `9605972d9`; boot-pinned entropy and sink/capability
    census gates preserve review evidence.

- [x] **M8 - Starter/runtime-package verification omitted full CI and lock-relevant package policy.**
  - **Evidence:** `4baecfe0e`, `b75d59ed2`; full starter CI and frozen generated installs are proven.

- [x] **M9 - Concurrent framework output commits used alias-incomplete lock keys.**
  - **Evidence:** `cab4b4b84`; a process-global canonical commit queue serializes overlapping roots,
    and the nested/parent alias regression plus filesystem race suites pass. SPEC §10.6.

- [x] **M10 - HMR live-target descriptors used an ambiguous comma delimiter.**
  - **Evidence:** `e851d70b9`; HMR emits the canonical semicolon-separated descriptor list, strict
    parsing regressions pass, and `hmr-dev-client.spec.ts` is 7/7 green. SPEC §9.1, §9.5.1.

- [x] **M11 - Static analysis retained one ts-morph project per source file and exhausted memory
      on an ordinary starter build.**
  - A 59 KiB, 13-file starter database analysis grew beyond 4 GiB and terminated before its
    fail-closed security facts could be produced.
  - **Evidence:** `7fd1b40c5`; one bounded syntactic project is shared per analysis run, changed
    same-name snapshots fail closed, and the exact paranoid production-artifact gate is 7/7 green.
    SPEC §11.1.

- [x] **M12 - Absent optional query-output fields passed schema validation but became enumerable
      `undefined` values that the canonical wire rejected.**
  - A client-selectable query branch could turn a valid optional projection into a stable 500,
    affecting query endpoints and dependent render/rerun paths.
  - **Evidence:** `4677caa86`; synchronous and asynchronous object parsing now omit only absent
    optional fields, retain defaults and explicitly present values, and the real typed-read wire
    regression plus schema/wire suites are 129/129 green. SPEC §6, §9.4.

## Low

- [x] **L1 - Whitespace-only public-access reasons false-greened the authorization audit.**
  - **Evidence:** `2af8131ce`; blank/padded reasons are rejected and structural forgeries emit KV436.

- [x] **L2 - Control-bearing public-access reasons could forge endpoint-audit output.**
  - **Evidence:** `f5ec993f7`; C0/DEL/line-separator controls are rejected before audit rendering.

## Closure gates

- [ ] Obtain explicit zero-new-finding conclusions on the final integrated head for runtime,
      browser/core, and compiler/build/supply-chain scopes.
  - Prior zero conclusions at `be2b43bda` were superseded by C11-C15, H18-H19, and M9; repeat the
    independent sweeps after every open family is integrated.
- [ ] Regenerate and review the final pack-security snapshot, then run exact-head static, paranoid,
      package, root-test, browser, integration, starter, kovo-check, publish, perf, and diff gates.
- [ ] Push the verified head to `main` and monitor the aggregate GitHub Actions result to green.
