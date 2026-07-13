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
| Critical |       14 | C1-C14 |
| High     |       19 | H1-H19 |
| Medium   |        9 | M1-M9  |
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

- [ ] **C11 - Forgeable Vite re-entry provenance could suppress KV235 and accept attacker-selected
      lowered server output.**
  - A source-visible trusted factory accepted an injected compiler callback, while persistent
    file/source recognition let one plugin suppress the genuine compiler in a later plugin.
  - **Open proof:** integrate the exact forged-factory regression and require a framework-owned,
    root/file-bound, one-shot compiler outcome before re-entry can be skipped. SPEC §2, §5.2.

- [x] **C12 - Production bundles could consume app source bytes different from the snapshot that
      passed the build security preflight.**
  - An authored config timer could rewrite an imported module after preflight; the server bundler
    then emitted request-derived raw SQL from the unapproved bytes.
  - **Evidence:** `e40f78044`; client, component-scan, and server transforms compare Vite's exact
    source value with the approved closed source graph, and changed/new-module timer attacks fail
    before server artifact emission. SPEC §5.2, §6.6.

- [ ] **C13 - Runtime security engines could be first-resolved after app evaluation or consume
      app-realm collection authority.**
  - Reproductions replaced the managed SQL parser, Argon2 password work, and the Undici-floor
    witness after framework initialization; a later selective `Array.prototype.map` replacement
    also made the captured SQL parser report no write targets and bypass the managed write policy.
  - **Open proof:** keep `9b6b1a4e6`, `716f2fa69`, and `5b90d62d6`; replace the incomplete parser
    pin in `ea30e8c0e` with an isolated, exact-dependency parser realm and prove both classifier and
    managed-execution attacks fail. SPEC §6.6.

- [ ] **C14 - Generated live-target renderer authority leaked across app aggregates in one
      process.**
  - Registering app A's generated renderer, creating app A, then registering app B's renderer and
    creating app B left both renderers in `appB.liveTargetRenderers`. With a shared process
    attestation secret, an A descriptor can therefore select A's query-backed renderer while it is
    running with B's request and DB context.
  - **Open proof:** bind generated renderers to the exact app aggregate/module graph, prove two
    sequential apps cannot observe each other's renderer authority, and cover removal/HMR without
    retaining a deleted renderer. SPEC §2, §6.6, §9.1, §9.5.

## High

- [x] **H1 - Starter dependencies, tools, and CI actions were not fully immutable.**
  - **Evidence:** `7e232d8cf`, `93613ddc0`, `e7a09b6a7`; exact versions/digests and patched
    transports pass supply-chain policy gates.

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

- [ ] **H19 - Concurrent filesystem storage reads could combine an object body and metadata from
      different committed generations.**
  - Writers were serialized only per adapter instance while `get`, `stat`, and `stream` read the
    body and sidecar separately; two same-root adapters reproduced a new body with the prior
    content type, ETag, and metadata.
  - **Open proof:** commit body bytes behind one atomic generation pointer, share read/write
    coordination across same-root instances, and prove `get`, `stat`, and `stream` each observe one
    complete generation. SPEC §6.6, §10.6.

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

- [ ] **M9 - Concurrent framework output commits used alias-incomplete lock keys.**
  - Parent and nested filesystem roots could address the same target through different queues,
    overlap their rename/post-commit checks, and spuriously reject a legitimate build write.
  - **Open proof:** integrate the process-global commit queue and the overlapping-root regression,
    then rerun storage/filesystem race suites. SPEC §10.6.

## Low

- [x] **L1 - Whitespace-only public-access reasons false-greened the authorization audit.**
  - **Evidence:** `2af8131ce`; blank/padded reasons are rejected and structural forgeries emit KV436.

- [x] **L2 - Control-bearing public-access reasons could forge endpoint-audit output.**
  - **Evidence:** `f5ec993f7`; C0/DEL/line-separator controls are rejected before audit rendering.

## Closure gates

- [ ] Obtain explicit zero-new-finding conclusions on the final integrated head for runtime,
      browser/core, and compiler/build/supply-chain scopes.
  - Prior zero conclusions at `be2b43bda` were superseded by C11-C14, H18-H19, and M9; repeat the
    independent sweeps after every open family is integrated.
- [ ] Regenerate and review the final pack-security snapshot, then run exact-head static, paranoid,
      package, root-test, browser, integration, starter, kovo-check, publish, perf, and diff gates.
- [ ] Push the verified head to `main` and monitor the aggregate GitHub Actions result to green.
