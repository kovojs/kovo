# Security Bug Ledger (`bugz-29`)

**Date:** 2026-07-13

**Scope:** Fresh adversarial security dogfood after the `bugz-28` remediation checkpoint at
`a81c4763c`. Findings are ranked by practical impact, then exploitability. `SPEC.md` §2 and §6.6
remain normative: authored code shares framework realms, public markers/types are not proof, and
uncertain trust-boundary behavior fails closed. This is a compact current-state closure ledger, not
a transcript.

## Severity summary

| Severity | Count | Items  |
| -------- | ----: | ------ |
| Critical |     8 | C1-C8  |
| High     |    10 | H1-H10 |
| Medium   |     2 | M1-M2  |

## Critical

- [x] **C1 - Authored build config can mint a signed persistent compiler-cache entry containing
      attacker-selected emitted code.** `packages/compiler/src/persistent-compile-cache.ts`,
      `packages/compiler/src/cached-compile.ts`, compiler/CLI/Vite callers
  - The internal barrel exposed the raw cache writer, which HMAC-signed arbitrary caller-supplied
    compile results. A first identity-binding draft was still bypassable because its verifier was
    imported after config evaluation and a `node:module.registerHooks()` resolver could substitute
    an always-true module. A forged entry then survived later transforms without a genuine compiler
    invocation.
  - **Acceptance:** signer and checker are co-located behind module-private identity/canonical-byte/
    footprint/key bindings; only a high-level genuine-compiler cache path persists; built chunks do
    not export raw writer/checker authority. SPEC §5.2, §6.6.
  - **Evidence:** `2c135240a`; 76 focused cache/MCP, 85 broader compiler, 19 CLI/build-security,
    and 48 full build tests pass; the built-dist resolver-hook probe exposes no raw writer/checker,
    strict compiler perf passes, and seven security gates are green.

- [x] **C2 - A public `Symbol.for` query-fact bridge lets authored Vite config replace compiler
      provenance facts.** `packages/server/src/internal/data-plane-static-analysis.ts`,
      `packages/cli/src/commands/build-export.ts`
  - Preseeding `Symbol.for('kovo.build.queryShapeFacts')` made the compiler trust attacker-selected
    query shapes rather than derive them, bypassing the same static facts that enforce wire
    confidentiality and update coverage.
  - **Evidence:** `9d7df8c68`; the bridge is deleted and production builds pass facts directly to the
    trusted compiler plugin. Focused static-analysis tests pass. SPEC §2, §5.2, §11.2.

- [x] **C3 - Poisonable browser lifetime/navigation controls can retain privileged stale DOM after
      the server revokes access.** `packages/browser/src/{enhanced-navigation,navigation-security-
    intrinsics,inline-loader-build}.ts`
  - Late `Element.contains` forged sibling suppression; late `startViewTransition` skipped the DOM
    callback while history advanced; public `.a` island controllers and late Abort methods kept
    removed work alive; late head insertion dropped authoritative metadata. The reproduced page
    retained `PRIVILEGED` after the server returned `ACCESS-REVOKED`.
  - **Evidence:** `a8b5af001`; private boot-pinned controller registry, witnessed contains/insertion,
    verified commit-once transition fallback, and stream-abort controls pass 105 three-engine
    navigation, 78 lifetime/recovery/response, 39 runtime-security, and 144 Node tests. SPEC §6.6,
    §8, §9.1.

- [x] **C4 - Public egress-floor symbols let authored pre-boot code forge the production SSRF
      self-probe.** `packages/server/src/{egress,egress-bootstrap}.ts`
  - Seeding `Symbol.for('kovo.egress.originalConnect')`/`connectWrapper` with a no-op hook made
    production report the net floor installed while `169.254.169.254:80` reached the bypass.
  - **Evidence:** `0435769e1`; all floor identity/policy/hardening state is module-private, the live
    metadata-address exploit now throws before the forged hook, and the six-file egress/task matrix
    passes 117/117. SPEC §2, §6.6.

- [x] **C5 - A forgeable global marker suppresses the `structuredClone` secret choke.**
      `packages/core/src/secret.ts`
  - App code could preseed `Symbol.for('kovo.secret.structuredCloneGuard')`, replace
    `structuredClone`, and cause a fresh Kovo module to skip guard installation and reveal a Secret.
  - **Evidence:** `f9c76cc9a`; every module copy composes a private guard, snapshots exact own data,
    rejects accessor-hidden values, and the preseeded-marker exploit fails KV435. SPEC §6.6.

- [x] **C6 - Misspelled/unknown Drizzle security annotations are silently erased at runtime.**
      `packages/drizzle/src/{drizzle-surface,runtime-security-intrinsics}.ts`
  - Casted `secrect`, `parrent`, `whem`, non-enumerable, and symbol fields survived TypeScript but
    were dropped from runtime metadata, making intended confidentiality/ownership posture vanish.
  - **Evidence:** `fee48de6b`; pinned own-key enumeration rejects every unknown top-level/nested
    field and hostile `Reflect.ownKeys` replacement. SPEC §6.6, §10.1.

- [x] **C7 - Mutable response-application and Trusted Types controls can redirect/suppress server
      truth or make framework policy controllers collide.** `packages/browser/src/{fragment-targets,
    response-fragment-apply,trusted-types,mutation-fetch,inline-loader-build}.ts`,
      `packages/server/src/csp.ts`
  - Late selector/string/collection poisoning could redirect fragment commits or skip retired-live
    cancellation. Generated and modular runtimes also claimed the same Trusted Types policy name;
    typed 422 streaming failures entered the wrong application path.
  - **Evidence:** `8eef7d9d6`; distinct private policy controllers, CSP admission without duplicate
    policies, pinned fragment decisions, and typed failure buffering pass the server/browser,
    streaming, deferred, inline-loader, and Trusted Types matrices. SPEC §6.6, §9.1, §9.2.

- [x] **C8 - Canonical wire/JSON traversal accepts forged inherited `toJSON`, proxy lengths, cycles,
      and unbounded graphs.** `packages/core/src/internal/wire-json.ts`, `packages/core/src/json-clone.ts`
  - Inherited Array/Object `toJSON` and a proxy length trap changed canonical bytes; cycles/deep or
    huge graphs caused stack/CPU exhaustion in security-bearing wire snapshots.
  - **Evidence:** `fd0196789`; exact-own traversal, shared-reference handling, and deterministic
    64-depth/100k-node budgets pass 356 core tests plus focused poison/DoS regressions. SPEC §6.6,
    §9.

## High

- [x] **H1 - Starter/build dependencies and CI actions are not fully immutable.**
      create-kovo templates, `packages/{server,test}/package.json`, lockfile, dependency policy
  - Floating package-manager setup/actions and unpinned SQL-parser/transport ranges could change
    the build/security TCB without review.
  - **Evidence:** `7e232d8cf`, `93613ddc0`; immutable action/tool/dependency pins and policy/TCB
    records pass starter and supply-chain gates.

- [x] **H2 - Production starter boot can seed a known demo credential and accept weak secret/cookie
      posture.** create-kovo runtime DB/auth templates
  - A production artifact could create `demo@example.com`; configuration paths did not uniformly
    prove strong secrets and secure production cookie defaults.
  - **Evidence:** `081580070`, `0d9b73952`; production seed refusal and explicit secret/cookie
    proofs pass the real production runtime acceptance, which now provisions a user only through a
    CSRF-protected sign-up flow (`88be171ae`). SPEC §6.5, §10.

- [x] **H3 - Generated CI checkout leaves repository credentials available to later build steps.**
      `packages/create-kovo/templates/.github/workflows/ci.yml`
  - The default checkout credential persistence unnecessarily exposed the token to authored build
    hooks/dependencies.
  - **Evidence:** `6468784e9`; generated checkout uses `persist-credentials: false` and starter
    snapshot tests enforce it.

- [x] **H4 - Public demo sessions accept caller-chosen identities and weak cross-site cookie
      isolation.** `scripts/demo-session/dispatcher.mjs`
  - Caller-named sessions enable fixation/collision; host-derived cookie handling lacked the full
    host-prefix, Secure, SameSite, and cross-session isolation floors.
  - **Evidence:** `f2e14b44e`, `5420528ae`; dispatcher tests prove server-minted identities and
    isolated host cookies.

- [x] **H5 - Demo/static asset servers permit malformed, encoded-prefix, out-of-root, or symlink
      reads.** demo-session serve, site static serve, commerce/StackOverflow example serve
  - Decoded traversal/prefix confusion (`dist-evil` starts with `dist`) and symlinks could serve
    files outside the intended exported root.
  - **Evidence:** `9842189f4`, `afb96f125`, `ef9a5e58d`, `ab9a89fd9`; canonical root/candidate
    confinement rejects malformed escapes, encoded sibling traversal, and symlink escape while
    serving a real asset.

- [x] **H6 - Docker build context includes nested environment/credential/key material.**
      `.dockerignore`
  - `COPY . .` included nested `.env.local` and common credential/key paths.
  - **Evidence:** `a1e0c81fe`; a real Docker-context meta test enforces nested exclusions.

- [x] **H7 - Cloud Build uses mutable privileged builders and mutable image tags.** root/site
      `cloudbuild.yaml`
  - Mutable builder identities and `latest` deployment tags allow provenance drift between review
    and execution.
  - **Evidence:** `fe57b17e9`; builders are digest-pinned and images use immutable build IDs.

- [x] **H8 - Emitted Node images use a mutable obsolete base and run install/runtime as root.**
      `packages/server/src/build.ts`
  - Generated Dockerfiles used `node:22-alpine` despite the Node 24 floor and never dropped root.
  - **Evidence:** `68c2b08b3`; multi-arch Node 24 digest, owned artifact copy, and `USER node` are
    asserted by emitted-artifact tests.

- [x] **H9 - Emitted Docker artifacts ignore their lockfile and execute dependency lifecycle
      scripts.** `packages/server/src/build.ts`
  - The artifact copied locks but always ran unlocked `npm install`; pnpm locks were invalid because
    the runtime manifest dropped required dependency sections.
  - **Evidence:** `d13b50938`; generator preserves lock-compatible manifests, requires a lock,
    selects frozen npm/pnpm/Yarn installs with scripts disabled, and executes a frozen-pnpm proof.

- [x] **H10 - Demo build admission is unbounded.** `scripts/demo-session/dispatcher.mjs`
  - Concurrent caller-triggered builds could exhaust CPU/memory and session slots.
  - **Evidence:** `45f136756`; bounded admission and cleanup regressions reject excess work.

## Medium

- [x] **M1 - PGlite declared-write verification attributes setup/seed writes to the request.**
      `packages/test/src/integration/pglite-harness.ts`
  - Accumulated engine counters had no per-request baseline, producing false evidence about which
    tables the operation wrote and masking coverage-test quality.
  - **Evidence:** `5f2dd7f02`; in-transaction baseline plus reset/regression fail-closed behavior
    passes the 15-test PGlite harness.

- [x] **M2 - Compiler render-equivalence lookup is cubic on large component sets.** compiler
      semantic render-model path
  - Repeated linear scans inside render-equivalence comparisons drove compiler-perf CI into timeout/
    OOM territory, weakening availability of security gates on adversarially large projects.
  - **Evidence:** `e91274285`; indexed semantic render models pass the strict two-run compiler-perf
    gate (large cold compile approximately 1.15s locally).

## Closure gates

- [x] Integrate the C1 compiler-cache checkpoint and rerun compiler/CLI/build, built-dist, perf,
      and focused security gates.
  - **Evidence:** `2c135240a`; agent exact gates above passed. Final aggregate API/pack checks remain
    part of the exact-head gate below so their baselines include every integrated package change.
- [ ] Obtain explicit zero-new-finding conclusions for compiler/CLI/build, core/browser, and the
      fresh exact-head server/auth/data-plane critic.
- [ ] Run the final exact-head static, paranoid, package, root-test, browser, integration, starter,
      kovo-check, publish, and diff gates.
- [ ] Push the final commit to `main` and monitor the aggregate GitHub Actions run to green.
