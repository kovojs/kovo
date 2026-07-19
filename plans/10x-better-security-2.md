# 10x Better Security 2 — Derive-and-Re-Witness Roadmap

Status: ACTIVE (created 2026-07-18). Successor frontier layered on `plans/10x-better-security.md`
(the four-layer closure roadmap) and `plans/threat-matrix-plan.md` (the scoped coverage matrix).
This plan opens the next set of architectural frontiers that plan-1's four layers do not own. It
accepts work only when it removes an authored-declaration or per-shape treadmill, extends a
declare-once fact to a surface that lacks it, or makes an already-proven fact re-witnessed where and
when code actually runs. No item lands as a point fix.

## Authority, scope, and honesty boundary

`SPEC.md` and its `spec/*.md` modules stay normative; any item here that changes a guarantee must
land the SPEC text with the implementation. Security-classifier migrations obey
`rules/security-classifier-refactors.md` C13; compiler work obeys `rules/compiler-hard-rules.md`;
crypto/key, supply-chain, and v1 claims obey `rules/dependency-policy.md` and `rules/v1-acceptance.md`.

Scope is plan-1's scope: ordinary framework exposure (remote users, hostile request/body/header
values, browser and intermediary differentials, deployment/adaptor mistakes, untrusted data reaching
app logic, supported integrations). Same-process malicious app/host code, pre-bootstrap loader
compromise, and same-realm intrinsic poisoning remain outside the app-level proof per SPEC §6.6.
Two items below (§1.1 analyzer soundness, §4.3 attestation) are detection/integrity mechanisms, not
inexpressibility claims — they are honestly labeled as such and do not extend the prime guarantee.

## Relationship to plan-1 (what this is NOT)

Plan-1 converts enumerative classifiers into structural closure **at build time**: capability-closed
module graph, finite compiler-owned security IR, narrow normalized abstract interpretation, runtime
sink floors, plus forcing gates (`test:authz-paranoid`, `check:security-gate-mutations`, C13 corpus,
C9 inventory). Every item here was checked against plan-1's full text and its own check-scripts;
none re-treads a plan-1 checkbox. Several items deliberately reuse plan-1's own machinery (the KV414
provenance engine, the C9 sink registry closure, the capability census, the fuzz-campaign and
counterexample infrastructure) — they extend those mechanisms to surfaces plan-1 stops short of, in
plan-1's native idiom.

## Thesis

Plan-1's target is to make its scoped unsafe states inexpressible or fail closed at build/runtime
doors. The residual frontier is that **security facts are still authored, single-tier, and
point-in-time**: a `cache=public` header, a CSP allowlist, a TCB membership row, an env secret's
confidentiality, a boot-time DB posture, a corpus of known bypasses — each is a human declaration
trusted forever, on one tier, never re-checked against reality. Plan-2's move is mechanical:

1. **Derive, don't author.** Every security-relevant fact is computed from one authoritative source
   (the app's own schema, the finite operation set, the module graph, the mint-site census) and the
   authored declaration degrades to an _intent_ that is mechanically diffed against the derivation.
   Drift between declared and derived is a build error.
2. **Re-witness continuously.** A fact proven once is re-proven wherever and whenever code runs —
   prod and dev server, request thread and background task, CDN and browser, mint time and revocation
   time. Divergence between tiers, or between mint-time authority and present authority, is a
   fail-closed runtime rejection.
3. **Falsify and bind the prover.** The derivation and checking machinery itself — the abstract
   interpreter's bounded semantics, the spec↔code binding, and the analysis-time TCB — gets
   independent counterexample search and mechanical closure evidence. These mechanisms increase
   confidence; they do not prove general JavaScript soundness or runtime-host integrity.

## Dependency-driven execution order

The numbered sections below are a reference taxonomy, not the implementation order. Execution uses
these release trains; a train starts only when its entry gate is evidenced at the exact current SHA:

| Train                                      | Work                                                                       | Entry gate                                                                 | Exit                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| A — reproduce and close live defects       | §2.2 config-secret runtime boxing; §3.1 blob and durable-job key isolation | Phase 0 has one red test and threat-matrix cell per channel                | The exact red tests pass through runtime-owned doors                    |
| B — contain ambient/runtime authority      | §3.4 async context; §4.5 dev host; §4.1 DB posture lease                   | Plan-1 runtime doors and the relevant door censuses are exact-tip green    | Cross-request, dev-tier, and posture-decay oracles pass                 |
| C — resolve high-risk architecture choices | §2.4 cache influence; §4.2 deadlines; §3.3 revocation epochs; §3.2 crypto  | Phase 0 decision records define the enforceable boundary and non-claims    | Each design has a bounded finite/static door plus a runtime floor       |
| D — derive remaining declarations          | §2.1, §2.3, §2.5                                                           | Plan-1 finite IR, normalized graph, and C9 inventories are consumable data | D has a frozen denominator and zero uncovered obligations               |
| E — meta-assurance and deployed evidence   | §1.1–§1.3, §4.3–§4.4                                                       | Trains A–D are stable enough that their inventories no longer churn        | Falsification, conformance, reproducibility, and observation gates pass |

Within a train, prioritize reproduced attacker-facing severity, then dependency leverage, then cost.
Do not start a meta-assurance item while a reproduced live channel in Train A remains open.

### Per-section completion contract

A section is complete only when its concise evidence names every applicable field below. “Not
applicable” requires a reviewed reason; a unit test cannot close behavior observable only in a built
or served artifact.

| Field          | Required evidence                                                                           |
| -------------- | ------------------------------------------------------------------------------------------- |
| Authority      | SPEC delta, threat-matrix cell, exact supported scope, and explicit non-claims              |
| Architecture   | Decision record, dependencies, produced artifact/door, residuals, and recovery posture      |
| Public surface | API/type/export change plus `check:api-surface`, or evidence that no public surface changed |
| Forcing proof  | Red reproduction, C13 anchor where applicable, behavioral mutant, and fail-closed negative  |
| Real behavior  | Production build/served-artifact or real-browser/real-Postgres proof at the bug's own layer |
| Cost           | Versioned latency, memory, occupancy, and availability budget for every hot-path addition   |
| Completion     | Exact command, no required skips, clean checkout, and intended CI job/artifact              |

---

## Phase 0 — Reconcile against the current tip and rank

- [ ] Rebase every §-item premise on the exact current `main` SHA (plan-1 has advanced through
      Phase 2C/3C partials since this plan's audit). For each item, re-confirm the cited file:line
      still holds or update it; drop any item plan-1 has since closed. Record the baseline SHA.
- [ ] Reproduce the storage-key blob read/overwrite channel at the baseline across every supported
      storage adapter; record attacker prerequisites, severity, threat-matrix cell, and exact red test.
- [ ] Reproduce durable-job cross-principal coalescing for both memory and Postgres queues; record
      debounce/throttle behavior, attacker prerequisites, severity, threat-matrix cell, and red test.
- [ ] Reproduce `s.secret(...).parse` returning `isSecret() === false`, then prove which wire, log,
      clone, and artifact channels remain reachable; give this distinct class its own matrix cell.
- [ ] Land architecture decision records before production work for: cache-key/influence semantics,
      runtime `ScopedKey` representation and escape authority, principal-epoch source/freshness,
      single-context-envelope vs shared ALS contract, cooperative vs hard deadlines, explicit
      cross-origin isolation, and the deployed-attestation trust anchor.
- [ ] Materialize frozen, stable-ID D and W denominator inventories. Each row names its owner,
      authoritative source, applicability, proof/re-witness, and reviewed exemption; deletion or an
      `inapplicable` change requires an explicit reviewed-raise marker and a killing mutant.
- [ ] Add D and W uncovered-obligation counts—not only percentages—to the baseline collector so
      progress remains comparable when the implementation grows.

---

## Phase 1 — Prove the prover (meta-assurance)

### 1.1 Differential soundness-falsification oracle for the abstract interpreter

**Class:** silently-unsound transfer function — the one failure mode mutation-kill, corpora, and
runtime floors are all blind to when the missing shape was not anticipated. **Leverage:** high ·
**Effort:** XL. This oracle searches for counterexamples to SPEC §11.2's `observed ⊆ static`
invariant over an explicitly finite generated language. It does **not** prove soundness for general
JavaScript or for behavior outside that language. Sequence after plan-1 Layer-3 lands the
semantic-graph rule table as data (schema is `kovo-security-semantic-graph/v2`,
`packages/core/src/internal/security-operation-ir.ts:23`).

**Depends on:** plan-1 Layer 3 and Phase 0's exact transfer inventory. **Produces:** a versioned
supported-language grammar, independent concrete semantics, minimized counterexamples, and nightly
falsification results. **Blocks:** the §1.1 exit claim only; absence of findings is evidence, not proof.

Today the analyzer "deliberately does not execute or model general JavaScript"
(`packages/compiler/src/scan/security-operation-ir.ts`); its soundness is an untested assumption. No
declared transfer registry exists to read (transfer identities are computed as inline strings, e.g.
`local:${callable.name}`), so step 1 is to _build_ that registry and refactor the analyzer to consume it.

- [ ] Extract the lattice elements + transfer functions into a versioned JSON census; gate fails if a
      transfer is added without a census entry (plant one, watch it fail). Define the exact generated
      language, excluded JavaScript semantics, and resource bounds beside the census.
- [ ] Seeded program generator whose productions derive 1:1 from that census (every element/transfer,
      including alias/helper-call/budget-edge shapes); assert productions ⊇ transfers in the generator's
      own test — the load-bearing anti-corpus safeguard.
- [ ] Implement an independent concrete interpreter for the finite generated language. Cross-check it
      against compiled emitted modules through instrumented framework effect doors, not arbitrary Proxy
      observation; seeded canaries prove that both a missed transfer and a missing effect observation
      fail the harness.
- [ ] Subset oracle: assert `observed ⊆ abstract-predicted` per program; on violation minimize and
      persist under the existing `kovo.security-fuzz-counterexample/v1` schema; weakening one transfer
      must produce a persisted counterexample + CI failure.
- [ ] Enroll as a seventh `analyzer-soundness` family in `scripts/security-fuzz-campaign.mjs`, fixed
      seed, running in `test:security-fuzz-nightly` (the campaign already runs cross-implementation
      differential families for redos/headers; none targets the interpreter — that is the gap).

### 1.2 Spec↔implementation conformance closure

**Class:** silent bidirectional drift — SPEC says fail-closed while code stopped enforcing, or code
enforces what SPEC no longer promises. **Leverage:** medium (process closure, not a new attacker
class) · **Effort:** L · generalizes the proven `check:security-guarantee` tri-binding from 3/89
guarantees to the full KV surface. Coverage exists (46/61 fixture-missing codes do assert
`code:'KV###'` in per-package suites) but is _unbound_ to the spec registry — deleting a test or an
enforcement site does not fail CI against SPEC.

**Depends on:** the exact diagnostics registry and Phase 0 baseline. **Produces:** generated
diagnostic constructors and a registry↔enforcement↔test binding. **Blocks:** spec-conformance exit,
not live-channel remediation.

- [ ] Add a machine-readable enforcement-class column (`compile-error | fail-closed-runtime |
audited-escape`, per SPEC §2 precedence) to the `spec/11-diagnostics.md` KV table.
- [ ] Generate typed KV constructors from the registry and route production emission through the
      validating diagnostics door; stage removal of ad hoc `{ code: 'KV###' }` production literals
      under the classifier-refactor rule without banning test fixtures that consume generated IDs.
- [ ] `check:spec-conformance-closure` requires, per error-class KV, a registry row, derived production
      enforcement site, red fixture, green counterpart, and own-layer evidence. Runtime emission
      coverage is supporting evidence only; a platform-specific zero-emission row needs a reviewed
      applicability reason rather than a synthetic test call.
- [ ] Promote `diagnostics-ref`'s registry equality out of the site pipeline into the root check chain.

### 1.3 Analysis-time TCB closure + reproducible rebuild

**Class:** analyzer/build supply-chain compromise — a poisoned toolchain defeats all four layers at
once. **Leverage:** medium (verified: frozen-lockfile + pnpm integrity + SHA-pinned actions + OIDC
publishing already block the easy variants; residual is repo-write/build-infra adversaries) ·
**Effort:** L · single weakest-marginal meta item, but the reproducible-rebuild proof is uniquely
fitting for a framework whose product is proof.

**Depends on:** a stable release toolchain and `rules/dependency-policy.md`. **Produces:** the exact
analysis-time dependency closure and deterministic package subjects. **Blocks:** artifact identity
used by §4.3; it does not establish runtime host integrity.

- [ ] Enroll the analyzer toolchain (`typescript`, `vp`, `vitest`, `esbuild`, `ts-morph`) in
      `security/TCB.md` with exact pins; the `typescript ^6.0.3` caret in
      `packages/compiler/package.json` should FAIL `check:tcb-boundary` first, proving the gate sees it.
- [ ] Replace `lockfileHasResolvedVersion`'s regex presence test
      (`scripts/check-tcb-boundary.mjs:498`) with structural `pnpm-lock.yaml` parsing that pins each
      surface's `resolution.integrity` sha512 — closes the same-version lockfile-integrity swap that
      currently passes on human review alone.
- [ ] `check:analysis-time-closure`: walk the import graph of every gate entrypoint + the compile
      path, derive the loaded third-party set, fail on any package absent from the TCB manifest.
- [ ] Monotone shrink ratchet on `totalTcbMaxLines`/entry count/closure size (explicit reviewed-raise
      marker; mutation-killed).
- [ ] Define deterministic package inputs first (normalized mtimes, ownership, ordering, modes,
      locale/timezone, and `SOURCE_DATE_EPOCH`), then run a reproducible-pack job in a second clean
      checkout and compare each public tarball's sha512 subject. The attestation records both build
      environments and honestly excludes runtime-host integrity.

---

## Phase 2 — Derive, don't author

### 2.1 Decision-surface coverage closure (corpus + capability census)

**Class:** "bypass exists but nobody observed it" — a superset-of-observed corpus cannot close it.
**Leverage:** high · **Effort:** L · extends the C9 closure-over-frozen-vocabulary pattern
(`source-sink-registry.test.ts` already asserts owners == `securityOperationKinds`) from door
ownership to _coverage obligations_.

**Depends on:** plan-1 finite operation inventories, normalized graph, and C9 ownership. **Produces:**
a stable-ID decision-surface manifest and D denominator. **Blocks:** §1.1 generator completeness,
§4.5 door comparison, and D exit.

The two hand-maintained artifacts still grow by observation: `check-security-classifier-corpus.mjs`
(3,616 lines of pinned snippet anchors) and `capability-surface-census-gate.mjs` (11 hand rows + ~30
regex pins over 12 files, silently missing new mints among 46 witness-registry files).

- [ ] Emit `kovo-security-coverage/v1`, a decision-surface manifest generated from
      `browserSecurityOperationKinds`/`serverSecurityOperationKinds` + posture `rootKinds` + the
      closed verdict set; independently verify the cell count and that appending a scratch kind adds
      exactly its cells.
- [ ] Flip `check:security-classifier-corpus` to require each cell to carry a witness or a reviewed
      `inapplicable` row with reason (fail-closed on unclassified); a new IR operation/root kind
      without coverage becomes a build error.
- [ ] Replace the capability-census regex pins with a TS-symbol-identity walk over every
      `createWitnessWeakMap`/`systemDb` mint site, fail-closed classifying each as mint vs internal
      registry with reason (46 sites today); missing census row → fail.
- [ ] Sequence the encoding/carrier grammar generator LAST as a versioned closed grammar (weakest
      component; must not become a denylist). Keep all historical anchors as mapped witnesses so C13
      is never weakened during cutover.

### 2.2 Config-secret env door

**Class:** config-secret exfiltration (API key / connection string / signing seed → HTML, wire JSON,
logs, error output, `structuredClone`, client artifact). **Leverage:** high · **Effort:** M · fixes
a live honesty bug and makes every existing choke fire for free. NOTE: the client-bundle channel is
already owned elsewhere (`packages/compiler/src/validate/client-capture.ts` + secure-by-construction);
the unowned, high-leverage piece is the **runtime** door.

**Depends on:** the distinct Phase 0 red reproduction and a public-API decision for parsed env.
**Produces:** runtime `SecretValue` boxes plus a frozen, typed env snapshot. **Blocks:** the config-
secret live-channel exit and any credential-factory migration.

`s.secret(schema).parse` is a bare `as Secret<Value>` cast (`packages/server/src/schema.ts:438`), so
`isSecret()` is false at runtime and the KV435 wire choke, log scrub, and `structuredClone` guard
never engage for config secrets. `validateAppEnv` returns void; `createApp` exposes no `app.env`.

- [x] Make `s.secret(schema).parse` return `secret(parsed)` (a runtime non-coercible `SecretValue`
      box), mirroring `secret-read-boundary.ts` for DB columns; assert `isSecret(...) === true` and
      that the wire sink throws KV435.
  - Evidence: `packages/server/src/schema.test.ts` and `packages/server/src/env.test.ts` pass in the
    integrated schema/env security suites.
- [x] Retain the parsed env in `createApp` and expose a frozen typed `app.env` — `s.secret` fields as
      boxes, undeclared keys absent; raw pinned snapshot stays framework-internal. Land the SPEC and
      public API decision with `check:api-surface` rather than treating `app.env` as incidental plumbing.
  - Evidence: `packages/server/src/env.test.ts` proves the frozen declared projection and build-only
    unavailable sentinels; the public app type is reviewed in `packages/server/src/app-types.ts`.
- [x] Prove wire/artifact ineligibility by construction (SSR interpolation, template literal,
      `JSON.stringify`, `structuredClone`, log line all throw/redact via existing chokes — no new sink code).
  - Evidence: the focused config-secret build/env/reveal run passes 6 tests, including a real normal
    build without the production value and fail-closed sentinel egress.
- [x] One reveal-once credential-factory DX pattern + `kovo explain` reveal-audit, so the audited exit
      stays legible and apps don't cargo-cult `reveal()`. Use constant-time comparison only for
      fixed-length keyed/verifier digests; do not claim general JavaScript string equality or arbitrary
      request fields are constant-time.
  - Evidence: `packages/drizzle/src/runtime-reveals-static.test.ts` and the CLI build/explain tests
    prove alias/order coverage, exact call identity, and KV426 for unrecordable dynamic reveals.

### 2.3 Compiler-derived browser posture manifest

**Class:** CSP/Permissions-Policy allowlist drift — the browser-side twin of the egress-denylist
treadmill plan-1 retires server-side. **Leverage:** high (defense-in-depth, not the primary proof) ·
**Effort:** L · promotes the existing hash-only compiler→server channel (`css.ts` cspHash) into a
posture manifest.

**Depends on:** plan-1's finite browser operation inventory and the Phase 0 cross-origin-isolation
decision. **Produces:** a compiler-derived CSP/Permissions-Policy intent manifest. **Blocks:** the
browser portion of D, §4.5 door comparison, and optional isolation posture.

`renderDefaultDocumentCsp` ships a strict default CSP, but `CspAllowlist` origins are free-form and
verified against nothing; Permissions-Policy is a hand-list duplicated in two sites
(`response.ts:596` + `document-core.ts:744`); COEP is deliberately absent.

- [ ] Compiler emits an external-origin census (static asset-position URLs keyed by CSP directive,
      with spans) alongside the existing inline hashes; a dynamic/computed external URL in an asset
      position fails closed with a named audited escape, not a silent fallback to the hand allowlist.
- [ ] Generalize `renderDefaultDocumentCsp` into an assembler consuming only the manifest: census
      origins auto-admitted; every authored `CspAllowlist` entry must match a census origin or carry a
      declared rationale; unused entries throw at check time.
- [ ] Pin Permissions-Policy to the `BrowserSecurityOperationKind` enum via one exhaustive switch
      (owning both render sites), so a new operation kind fails typecheck until its feature grant is decided.
- [ ] Keep the conservative default COOP posture. Add an explicit `crossOriginIsolation` posture only
      when the manifest closes static assets, dynamic fetches, workers, frames, popups, and CORP/CORS
      requirements; prove it in Chromium, Firefox, and WebKit with OAuth/embed negative fixtures.
      `check:browser-posture-derivation` asserts rendered headers match the selected posture byte-for-byte.

### 2.4 HTTP shared-cache generality proof

**Class:** web cache poisoning + cache deception via CDN. `Cache-Control`/`Vary` are among the only
headers apps write directly; `response-posture.ts` checks the emitted header matches the _declared_
posture but never proves a `cache=public` response is principal-invariant or that `Vary` covers every
input the handler read. One authored declaration leaks a user's rendered page to everyone behind a
shared cache. **Leverage:** high (attacker-facing, unowned by plan-1 or §3.1's internal ScopedKey) ·
**Effort:** M-L.

**Depends on:** plan-1 Layer 3 and the Phase 0 cache-key/influence decision. **Produces:** a finite
`kovo-cache-influence/v1` manifest plus a per-response rejection floor. **Blocks:** public-cache D
coverage and the cache dimensions of §4.4.

- [ ] Define `kovo-cache-influence/v1` with distinct axes: URL path/search (already part of the cache
      key), named request headers (`Vary` candidates), cookies/Authorization (public-cache closed by
      default), principal/session facts, framework runtime state, and declared external data versions.
- [ ] Derive the complete influence set statically for handlers inside the finite security IR. A
      handler with opaque calls or an influence outside the supported public set cannot emit `public`
      without a named audited escape; a single observed execution never establishes positive safety.
- [ ] Extend runtime provenance to query/document execution only as a rejection floor for the current
      response. Principal, cookie, Authorization, secret, or unclassified influence strips/rejects
      `public`; it cannot widen a compile-time closed verdict.
- [ ] Derive `Vary` only from request-header axes. Never encode principal or URL/search state as a
      `Vary` token; the manifest records how each non-header axis participates in the cache key or
      closes shared caching.
- [ ] `check:cache-generality` diffs authored intent against the manifest, and a real intermediary
      oracle proves prime/reuse behavior across principals, cookies, Authorization, query variants,
      header variants, and branch changes.

### 2.5 Wire-ingress grammar registry + reject-by-default /\_q/

**Class:** parser-differential / request-smuggling at Kovo's own protocol envelope, plus the last
opt-in validation door. **Leverage:** medium (verified: attestation makes forged Live-Targets inert
and K2 budgets bound DoS — this is anti-drift + posture, not an open exploitable hole) ·
**Effort:** M. The `/_q/` reject-by-default change is the real win; the registry is anti-drift closure.

**Depends on:** plan-1 wire sinks and a stable finite protocol vocabulary. **Produces:** one grammar
registry, derived encoder/decoder, and the `/_q/` reject default. **Blocks:** the wire portion of D;
it is not a prerequisite for live Train A fixes.

Today the server hand-parses `Kovo-Targets`/`Kovo-Live-Targets` (a quote/depth-aware mini-tokenizer)
while three independent browser encoders hand-write the same grammar; an argsless `/_q/` query casts
the raw tagged search record straight into `load` (`query.ts:807`, `rawInput as Input`).

- [ ] Core-owned grammar declared once as typed data; derive BOTH the browser encoder and server
      decoder from it (kills the two-implementations drift class structurally). Seeded round-trip
      oracle `decode(encode(v)) ≡ v` enrolled in C13.
- [ ] `check:wire-input-boundary` (patterned on `check:c9-sink-inventory`): symbol-identity census of
      framework protocol header/cookie/search-param reads vs the registry. App-owned reads and reviewed
      third-party adapters are outside this grammar unless they enter through a named framework door.
- [ ] Make `/_q/` reject-by-default: 422 when no `args` schema is declared and search input is
      non-empty; update SPEC §9.4 + conformance sweep.

---

## Phase 3 — Declare-once across the whole authority surface

### 3.1 ScopedKey — owner provenance for every non-DB stateful sink

**Class:** cross-tenant blob IDOR/overwrite AND durable-job coalescing collision — both expressible
today with zero diagnostics. **Leverage:** high (not transformational: reads sit behind the
capability-URL verify door; exploits need app-derived keys) · **Effort:** L · reuses the KV414
provenance engine + C9 registry + tasks' DEC-G posture grammar, and retires three bespoke schemes.

**Depends on:** the two distinct Phase 0 red channels, C9 stateful-sink ownership, and the Phase 0
representation decision. **Produces:** a runtime-opaque scoped-key algebra and physical namespace
frame. **Blocks:** storage/task live-channel exit and stateful-sink D coverage.

Storage keys are bare strings with no principal dimension (`storage.ts`); `ctx.signUrl({key})` mints
for any app key; the durable-job unique index is `(task_key, logical_key)` with no principal
(`task-queue.ts:236`), so a client-influenced `schedule(…,{key})` can debounce-replace or
throttle-suppress another tenant's pending job. Only the DB owner fact + RLS provide isolation today.

- [x] Repro both channels as failing conformance tests (memory + Postgres queues).
  - Evidence: `packages/core/src/scoped-key.test.ts`, `packages/server/src/state-key.test.ts`, and the
    queue/Postgres replay tests are part of the integrated 30-file, 898-test green run.
- [x] Specify a single `ScopedKey` algebra in SPEC (storage §12, tasks §9.6, data-plane §10.3),
      promoting `replay.ts`'s length-framed `(posture, principal|reason|public, app-key)` composition;
      add a KV for unscoped stateful-sink keys and named system/public escape postures.
  - Evidence: SPEC §§6.6/9.6/10.3 freeze `kovo-scoped-key-v1` and KV450.
- [x] Make `ScopedKey` a runtime-opaque value with a module-private witness and canonical framed bytes;
      its principal scope comes from the framework request/task authority, never an app-supplied ID.
      Storage/queue doors reject strings, forged structures, and TypeScript casts before namespace use.
  - Evidence: `packages/core/src/scoped-key.test.ts` passes forged/cast/delimiter/surrogate negatives;
    mutant `scoped-key/drop-runtime-witness-rejection` is killed.
- [x] Make system/public construction capability-owned rather than `reason`-string-owned: callers use a
      reviewed posture registered in the source/sink census, and the runtime records that exact posture.
  - Evidence: reviewed public posture binds `publicScopedKey`; system postures are a closed union in
    `packages/core/src/scoped-key.ts`.
- [x] Storage adapters (memory/fs/S3) and both queues embed the validated scope frame in the physical
      namespace (fs sha256 digest input; queue `logical_key`) and prove cross-owner non-collision.
  - Evidence: the integrated storage/task/replay suite passes 898 tests across memory, filesystem, S3,
    memory queue, and Postgres queue paths.
- [x] C9 inventory gains a required `keyScoping` column for every stateful op; `check:c9-sink-inventory`
      fails closed on an unclassified one — future stateful sinks inherit the obligation automatically.
  - Evidence: `packages/core/src/internal/source-sink-registry.test.ts` passes in the integrated run.
- [x] KV414-analog compile gate over key positions (`storage.*`, `signUrl({key})`, `respond.storedFile`,
      `schedule(…,{key})`); migrate `replay.ts` + rate-limit buckets onto the shared frame.
  - Evidence: route-page/compiler tests pass; mutants `compiler-finite-ir/drop-scoped-key-sink-closure`
    and `scoped-key/drop-runtime-witness-rejection` are killed.

### 3.2 One crypto authority door + purpose registry + rotation lifecycle

**Class:** four standing defects — divergent/absent intrinsic pinning (better-auth already shipped
bare unpinned `crypto.subtle` on a raw secret), two coexisting constant-time compares, raw-secret key
reuse across purposes, and unrotatable/never-zeroized keys. **Leverage:** high · **Effort:** L ·
enforcement is plan-1's own module-graph closure applied to `node:crypto`. Plan-1's Layer-1 authority
list (network/fs/process/worker/vm/db-driver) omits crypto entirely.

**Depends on:** plan-1 capability closure and a purpose/algorithm compatibility decision. **Produces:**
purpose-bound opaque crypto handles and a rotation envelope. **Blocks:** §4.3 signing and the crypto
portion of D; it must not become one generic signer available to every caller.

~27 non-test modules import `node:crypto`/`crypto.subtle`/argon2 directly, each with its own (or no)
boot-pinning ritual; zero production zeroization anywhere; no gate polices raw crypto acquisition.

- [ ] Add a `crypto-acquisition` capability to the module-graph closure: importing the primitives
      outside a declared door fails the build (seed the door list with today's ~27 modules; the list
      must monotonically shrink or it degenerates into a census manifest). Classify build-time
      non-secret hashing as a separate low-privilege `digest` capability.
- [ ] `crypto-authority.ts`: one boot pinning + known-answer self-test, but distribute only
      purpose-bound opaque handles exposing the minimum operation for that purpose—not a generic
      signer/sealer or raw key. Retire `verifier.ts`'s hand XOR compare in favor of fixed-length
      digest comparison through the authority door.
- [ ] Closed purpose registry: every derivation is `HKDF(root, purpose, audience)` where `purpose` is
      a checked-in literal; an unregistered purpose cannot derive a key (cross-purpose reuse in
      `html.ts` and rate-limit becomes inexpressible).
- [ ] Extend the active/previous/revoked ring to at-rest AEAD (`confidential-at-rest.ts` already
      stores `keyId` — wire it to a ring with overlap-window decrypt); spec the envelope-contract
      change in SPEC §6.6 first. Treat Buffer overwrite on revocation as best-effort memory hygiene,
      not a JavaScript zeroization guarantee, and record unavoidable copies in the threat model.

### 3.3 Principal-epoch revocation propagation

**Class:** stale privilege / session fixation — capability URLs, replay receipts, and continuations
minted under a principal outlive password changes, role downgrades, and session revocation (they
carry signature + expiry but no freshness input). **Leverage:** high · **Effort:** M-L · the auth
TCB door routes verification through one runtime but does not own identity _lifecycle_.

**Depends on:** an identity-provider/auth-store freshness contract and the credential mint-site
census. **Produces:** a persistent monotone revocation version and bounded-staleness verifier door.
**Blocks:** principal-freshness W coverage.

- [ ] The authoritative identity provider or auth store exposes a persistent per-principal epoch
      independent of any one session. Password changes, role/tenant changes, administrative actions,
      external-provider revocation, and account deletion update or tombstone it monotonically.
- [ ] Every credential-derived mint door (capability URLs, replay receipts, continuations — enumerable
      from the existing mint-site census) embeds the epoch at mint; every verifier compares embedded vs
      current, fail-closed. Specify lookup caching, maximum revocation staleness, outage behavior, and
      the latency/availability budget; expiry remains defense-in-depth.
- [ ] Privilege-changing Kovo mutations route through the epoch door, with the mutation registry used
      as a completeness check—not as the authority that infers semantic privilege changes from table
      names. Prove out-of-band/provider changes invalidate existing artifacts too.

### 3.4 Async-context authority confinement + non-interference oracle

**Class:** cross-request principal/credential/lifecycle bleed and TOCTOU over pinned facts — the
classic framework catastrophe. The runtime rides ≥8 independent `AsyncLocalStorage` carriers
(`response-lifecycle-context.ts`, `request-input-provenance.ts`, `egress-credentials.ts`,
`jsx-context.ts`, `live-target-registry.ts`, …), each hand-rolling its own missing-store behavior;
`race-repeat.yml` only re-runs flaky tests, it is not a bleed oracle. **Leverage:** high ·
**Effort:** L-M.

**Depends on:** the Phase 0 choice between one request-authority envelope and a shared carrier
contract, plus the runtime door census. **Produces:** context lifecycle identity and a real concurrency
oracle. **Blocks:** §4.2 deadline propagation and async-context W coverage.

- [ ] ALS-door census gate: mechanically enumerate every framework `AsyncLocalStorage` and enforce one
      shared confinement contract (fail-closed on missing store, reject foreign/stale stores by
      identity witness, no ambient fallback); a carrier bypassing the contract is a build error.
- [ ] Cross-request non-interference oracle: a seeded generator drives N concurrent requests under
      distinct principals with forced await-point interleavings (microtask shuffling, stream
      backpressure, thenable traps) and asserts zero cross-principal fact movement across every door.
- [ ] Keep runtime scheduling/interleaving evidence separate from static analysis. Feed only normalized
      check→await→use programs into §1.1 when the finite generated language defines their semantics;
      do not claim the abstract interpreter models arbitrary event-loop scheduling.

---

## Phase 4 — Re-witness continuously and across tiers

### 4.1 Database posture lease

**Class:** silent decay of the boot-time least-privilege proof the entire engine-door guarantee rests
on (SPEC §10.3) — an out-of-band `GRANT pg_read_all_data`, a dropped RLS policy, a provider change,
or a restored stale backup voids every floor while a long-lived process trusts the boot proof forever.
**Leverage:** high · **Effort:** L · the spatial door is already complete (one connection factory,
witnessed role topology, transaction-local identity frames); this extends it along the time axis.

**Depends on:** the real-Postgres posture suite and sole connection/transaction doors. **Produces:**
a bounded-cost posture digest, lease state, and recovery protocol. **Blocks:** DB-posture W coverage.

- [ ] Deterministic posture digest from the existing `checkRuntimeDbPosture` catalog queries (role
      attributes/memberships/assumable-role closure/policies/grants); stable across boots, changes on
      a single added grant. Use a budgeted subset — the full reachability audit is too heavy per interval.
- [ ] Renewable lease: re-derive on a fixed interval and on 42501-class permission errors; any
      divergence or renewal failure trips `app-load-shed` (KV433) fail-closed, never serve-degraded.
      Define TTL, zero-grace expiry, connection draining, operator recovery, jitter/backoff, and
      availability budget. Test: mid-run `GRANT pg_read_all_data` → requests shed until a successful
      authoritative re-witness, without an attacker-triggerable busy-loop.
- [ ] Mechanize the pooler witness (today docs-only, `cli.md:241`): inside one transaction, round-trip
      a `set_config` frame probe across two statements + `pg_backend_pid()` stability; fail closed on
      a shuffling pooler.
- [ ] Restore-staleness (correction: the existing `database_instance_id` nonce is minted-once and
      survives a same-DB restore): digest a monotone freshness fact instead — the migration-ledger head
      / a posture epoch reasserted by `kovo db migrate`. Surface lease state in `kovo explain --capabilities`.

### 4.2 Mandatory request deadline + occupancy budget

**Class:** availability — handler-hang accumulation (the ~identity-blind rate window admits unbounded
forever-hanging requests with no in-flight cap), hung-upstream propagation (no default egress
timeout), slow-read response draining. **Leverage:** high · **Effort:** L · extends the §9.5
mandatory-finite `MUST NOT accept false` posture (already governing bytes/chunks/entries/rate) to the
time+occupancy dimension through the one existing pre-dispatch admission door. Ride plan-1's egress/DB
door migrations, don't race them.

**Depends on:** §3.4 context lifetime, the framework effect-door census, and the Phase 0 cooperative
vs hard-deadline decision. **Produces:** bounded admission and cooperative cancellation for owned
effects. **Blocks:** availability W coverage; it cannot bound arbitrary synchronous app JavaScript.

- [ ] `normalizeAppRequestLimits` gains `deadlineMs` + `maxInFlight` with finite defaults, hard
      ceilings, and the same cannot-be-`false` TypeError posture as `maxBodyBytes`.
- [ ] `preDispatchLoadShedResponse` mints a framework-owned per-request deadline `AbortSignal` and
      acquires an occupancy slot; over-occupancy sheds 503+Retry-After before any handler work. Specify
      exact slot release on response completion, disconnect, exception, deadline, and streaming escape.
- [ ] The deadline becomes a required capability parameter of the effect-door contract (egress fetch,
      DB/transaction, deferred-region, streaming flush); the capability census fails an owned door that
      does not consume it. Explicitly exclude arbitrary Promises and synchronous loops from the hard
      guarantee unless Kovo later isolates app execution in a terminable worker/process.
- [ ] Post-deadline discard at the response mint door + bounded response write-out; abort propagates
      into the transaction door (`mutation-wire.ts` `abort` hook) with explicit pre-commit vs
      post-commit semantics—never claim cancellation can roll back an already committed transaction.
      Named audited escape for legitimate streaming/long-poll surfaces, visible in `kovo explain`.

### 4.3 Security-event door + signed runtime posture attestation

**Class:** unknowable-in-prod — is the deployed binary the reviewed posture, and are the floors
actually firing? Today denials are `console.warn` strings and the CSP snapshot is `@internal`/test-only.
**Leverage:** high (detection/integrity, NOT inexpressibility — complements, doesn't extend, the
prime guarantee) · **Effort:** L.

**Depends on:** §1.3 deterministic artifact subjects, §3.2 purpose-bound signing, and the Phase 0
trust-anchor decision. **Produces:** structured denial telemetry plus a nonce-bound signed posture
self-report from one responding instance. **Blocks:** deployed-evidence exit, but cannot establish
host integrity or fleet-wide identity without a separate remote-attestation/deployment trust anchor.

- [ ] Single `securityEvent()` door (witness-intrinsic style). Its taxonomy must be _built_ as a
      projection of the Layer-2 security-operation IR / a gate-emitted denial-site census (correction:
      no verdict inventory exists to read yet); then extend `check:classifier-verdict-routing` with an
      emits-event obligation so a floor that doesn't route its denial fails the gate.
- [ ] Route egress-deny, CSRF-reject, closure-audit refusal, budget-exhaustion, capability-closed
      through it; stable `kovo-security-event/v1` schema, `reporting.ts` redaction discipline,
      keyring-HMAC hash-chain (defends exported/at-rest tampering only), bounded ring, export only via
      the declared-egress door. Enroll the sink in C9 + sink-policy.
- [ ] Build embeds a canonical posture digest of the security facts `kovo explain` already computes
      (endpoint auth/CSRF posture, egress allowlist, audited escapes, IR version tokens) into the
      server artifact. A challenge endpoint signs a caller nonce, artifact subject, instance identity,
      boot-witness results, posture digest, issuance/expiry times, and event-chain head with a key bound
      to the reviewed deployment identity; stale or replayed evidence fails verification.
- [ ] `kovo explain --attest <url>` verifies the challenge and diffs the reported digest against the
      reviewed artifact. Its output says exactly what is established: one key-holding responding
      instance reported the reviewed posture at that time. It must not claim executed-code identity,
      uncompromised host state, complete event delivery, or fleet-wide equality without external proof.

### 4.4 Response indistinguishability contract

**Class:** error/stack/secret disclosure regressions, account/resource enumeration via differential
responses and timing (three doors — `password.ts` decoy, `capability-route.ts` 404, `app-request.ts`
constant bodies — each independently rediscovered the pattern; Better Auth signup/reset remains an
open email-enumeration oracle). **Leverage:** high · **Effort:** L · sequence the body-content rule
after Layer-3 lands (else it's a second raw-AST analyzer).

**Depends on:** plan-1 Layer 3 and an explicit policy mapping from surface to equivalence class.
**Produces:** a versioned observation model, uniform-work combinators, and dual-world oracles.
**Blocks:** response-observation exit; schema confidentiality labels are inputs, not policy by themselves.

- [ ] SPEC §9.2 canonical rejection table + defined indistinguishability classes. Each class names its
      attacker-visible tuple: status, redirect, selected headers, cookies/tokens after normalization,
      body type/length/content relation, connection behavior, work factor, and timing distribution.
- [ ] Extend `check:wire-output-boundary` with a fail-closed body-content rule over the Layer-3
      provenance IR: no catch-bound error value / `Error` property / request-derived string into a wire
      body outside the audited render door — error redaction becomes inexpressible, not per-handler care.
- [ ] Explicit surface policy selects the world pairs that must be equivalent (exists-not-owned vs
      absent; account present vs absent). Schema `owner:`/`secret:`/`governed` facts may propose
      candidates but cannot infer product policy; an unclassified remotely reachable surface fails
      closed. The oracle compares the declared observation tuple rather than blindly requiring raw
      byte equality.
- [ ] Promote the password decoy into a reusable uniform-work combinator, normalize Better Auth
      signup/forgot-password at the mount door, and run a versioned nightly statistical timing budget
      with sample size, noise model, effect threshold, and persisted counterexamples.

### 4.5 Dev-tier door parity + single dev-host door

**Class:** the dev-server CVE class (DNS-rebinding to localhost, HMR websocket abuse, source/env
exfiltration) — dev is a first-class attack surface where authors run untrusted input all day, yet
dev hardening is scattered point checks (`dev.ts` allowlist, one HMR origin snapshot in `vite-dev.ts`,
reactive fixes) and no check gates the dev tier or proves its doors match prod. **Leverage:** high ·
**Effort:** L-M.

**Depends on:** §2.1's stable door identities and the prod/dev authority mapping. **Produces:** one
dev-host door and a tier-aware manifest comparison. **Blocks:** dev-tier W and deployed-evidence exit.

- [ ] One dev-host boot door owning loopback-default binding, an Origin/Host allowlist for both HTTP
      and the HMR upgrade (DNS-rebinding fail-closed), and authentication for any dev endpoint that can
      read source or env. Prove real HTTP and websocket rebinding attacks, not only request mocks.
- [ ] Emit a versioned door manifest for prod boot and dev boot (reuse the capability/door census) and
      gate a tier-aware mapping: every prod obligation must be equivalent, stronger, or have a named
      audited dev exception; dev-only HMR/source/module-graph doors carry their own authentication and
      exposure obligations. Do not require byte-identical manifests for intentionally different tiers.

---

## Phase 5 — Convergence measurements and scoped exit

Extend plan-1's R/M/P/G with two derivation-era metrics:

- **D — derivation obligations.** Stable-ID rows in `kovo-security-derivation-inventory/v1`. Report
  `derived`, `checked-intent`, `reviewed-exempt`, and **uncovered absolute counts** for cache posture,
  browser posture, TCB membership, coverage cells, capability mints, env-secret classification, and
  wire grammars. Percentages are informational; the target is zero uncovered rows. Denominator rows
  cannot disappear or become inapplicable without a reviewed-raise marker and mutation evidence.
- **W — re-witness obligations.** Stable-ID rows in `kovo-security-rewitness-inventory/v1`, each with
  authoritative source, owner, renewal trigger/TTL, failure posture, cost budget, evidence, and reviewed
  exemption. Report continuously re-witnessed, reviewed-exempt, and **uncovered absolute counts**.
  The target is zero uncovered load-bearing facts, not a percentage over a mutable denominator.

Exit (extends `threat-matrix-plan.md` and plan-1 Phase 6; does not restate plan-1's gates):

- [ ] §1.1 soundness-falsification oracle runs nightly ≥2 weeks with zero unresolved
      `observed ⊄ predicted` counterexamples over its versioned finite language; publish grammar,
      semantic-coverage, canary-recall, mutation, seed, and budget evidence without claiming proof of
      general JavaScript soundness.
- [ ] D inventory has zero uncovered stable-ID obligations; every authored declaration is derived,
      mechanically checked intent, or a reviewed explicit exemption, and drift fails the build.
- [ ] W inventory has zero uncovered stable-ID obligations; every runtime-load-bearing fact is
      re-witnessed within its declared freshness/failure budget or is explicitly signed off.
- [ ] All three reproduced live channels—storage key isolation, durable-job coalescing, and config-
      secret runtime egress—are closed by runtime-owned doors with their exact red tests green.
- [ ] `kovo explain --attest` verifies the bounded single-instance posture statement defined in §4.3;
      the tier-aware dev/prod obligation mapping is green without overclaiming host or fleet identity.
- [ ] New SPEC text (ScopedKey algebra, posture lease, request deadline, config-env door, cache
      generality, indistinguishability classes, crypto envelope) landed and cited from code, with each
      residual/out-of-scope cell explicit in the threat matrix.
- [ ] Every changed public API/export passes `check:api-surface`; full classifier, compiler, browser,
      integration, package, real-Postgres, performance, memory, and availability gates pass from a
      clean checkout with zero required skips at the intended SHA, followed by required CI jobs.

## Notes on sequencing and honesty

- **Layer-3 dependency.** §1.1, §2.4, §2.5, §3.4, §4.4 depend on plan-1's Layer-3 normalized semantic
  graph landing as consumable data (schema `kovo-security-semantic-graph/v2`). Building any of their
  provenance rules before that exists would re-create the raw-AST treadmill plan-1 is retiring.
- **Release-train discipline.** The dependency table, not section numbering, controls execution.
  Train A live defects preempt meta work; decision-record entry gates prevent uncertain cache,
  deadline, epoch, isolation, context, or attestation designs from ossifying in production code.
- **Effort honesty.** §1.1 is XL (build the transfer registry + refactor the analyzer to consume it +
  an independent finite-language interpreter + emitted-module comparison). §1.3, §2.5, and §1.2
  are the weakest-marginal items per the completeness critic — real but the smallest risk reduction;
  do them last.
- **Not inexpressibility.** §1.1 and §4.3 are meta-assurance and detection/integrity respectively.
  They must never be marketed as extending the prime guarantee. §1.1 searches a bounded language for
  counterexamples; §4.3 verifies a nonce-bound statement from one key-holding instance unless an
  external remote-attestation/fleet trust anchor establishes more.
