# Kovo Security Threat-Matrix (v1 coverage map)

Created 2026-07-06 (threat-matrix-plan M1 + M3–M8 first fill). Normative source of behavior is `SPEC.md`. This is the
coverage map for the v1 security signoff: every {surface × threat} cell records a **named control (with its test/gate)**,
an **audited escape hatch**, or an **explicit out-of-scope note (whose responsibility it is)**. A cell with none is
**OPEN**. v1 does not freeze with an OPEN cell or an unresolved blocking external-audit finding (`rules/v1-acceptance.md`
16.9). Threat categories: **C** confidentiality, **I** integrity, **A** availability, **Au** authenticity.

## The matrix

| Surface                         | C (confidentiality)                                                                                                                             | I (integrity)                                                                                     | A (availability)                                                         | Au (authenticity)                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **DB / data plane**             | GREEN¹ — RLS FORCE + non-superuser roles + column-REVOKE + closure/attached-code/identity audits                                                | GREEN¹ — narrowed writer grant, KV438 governed-column floor, WITH CHECK, declared-write choke     | scope: app/deploy (M5); GREEN-footgun — query-list cap 100, bounded pool | GREEN¹ — principal integrity: wrapped-client reconstruct + `set_config` confinement + identity allowlist     |
| **Auth**                        | GREEN (M2) — adapter non-egress proof: fail-closed reachability proof over every request-reachable secret path, TCB-enrolled; timing GREEN (M4) | GREEN — governed-column floor on `user`/`session` (KV438)                                         | GREEN — pre-dispatch rate budgets on auth endpoints (M5)                 | GREEN — CSRF, HttpOnly+Secure+SameSite cookies, session lifecycle; session unforgeability = dep surface (M6) |
| **Wire / HTTP**                 | GREEN — DEC-F sink inventory: secret box on every egress channel + log redaction                                                                | **OPEN (M35)** — non-canonical HTTP authority crosses Node-to-Fetch as split URL/Host identities  | scope: app/deploy (M5); GREEN — 1 MiB body cap (413), rate budgets (429) | GREEN — CSRF, webhook verify, request-input provenance                                                       |
| **Render / browser**            | GREEN — escape-by-default; `trustedHtml` the only branded raw door                                                                              | GREEN — contextual escaping across text/attr/URL-scheme positions                                 | N/A — client render cost is app-authored                                 | GREEN — Trusted-Types policy + inline-loader import allowlist                                                |
| **Build / compiler**            | GREEN — server-only-value capture (KV437); generated code carries no secret                                                                     | GREEN (M7) — codegen framework-constructed; KV235 provenance; sink-policy + import-boundary gates | N/A — build is dev-time                                                  | GREEN (M7) — `dynamic.import.process` sole door = `/c/` versioned-module allowlist                           |
| **Dependencies / supply chain** | GREEN (M6) — `trustedDependencySurfaces` + exact pins + `--frozen-lockfile`, `check:tcb-boundary`                                               | GREEN (M6) — `rules/dependency-policy.md` update policy + review triggers                         | out-of-scope — dependency-internal DoS                                   | GREEN (M6) — Better Auth session/hash/reset/2FA/linking surfaces enrolled as review triggers                 |
| **Runtime / infra**             | GREEN (M8) — no cross-tenant bleed; pool scrubbed; module state per-request; caches principal-independent                                       | GREEN (M8) — transaction-local session state; DISCARD ALL on release                              | scope: app/deploy (M5); GREEN — bounded pool + rate budgets              | GREEN (M8) — pool identity reset; no principal bleed across reuse                                            |

¹ **DB cells: `fundamental-fixes-followup-13` LANDED** the round-16 fixes (`claude-bugz-37`: write-propagation
closure B1, REPLICATION/predefined-role identity B2/round-17, login-identity B4) plus the DEC-E differential fuzzer —
GREEN (no longer pending).

## Cell evidence (non-trivial cells)

- **DB × C/I/Au** — the arc's core (`fundamental-fixes-followup-6..13`): engine RLS as the sole owner-scope door,
  secrets column-REVOKE'd + boxed, principal set via a confined single-statement surface, identity attribute allowlist.
  Enforced by `checkPostgresAppDbPosture`, `pnpm run test:authz-paranoid`, the grant-shape + (DEC-E) differential
  fuzzers. followup-13 landed DEC-A (write-propagation closure) + DEC-B (REPLICATION/predefined-role identity), closing
  `claude-bugz-37`; round-17 extended the identity allowlist to predefined-role membership.
- **Auth × C (M2) — GREEN (closed).** The reachability-based non-egress proof is built, fail-closed, and TCB-enrolled:
  `betterAuthRequestSecretPaths` (`internal/non-egress-proof.ts`) inventories every request-reachable secret path and
  `proveBetterAuthRequestSecretNonEgress` rejects any cross-user credential read whose disposition is not boxed or a
  vetted compare/verify — enrolled in `security/TCB.md` as `better-auth.request-secret-surface.proof`
  (`classification: tcb`) + its inventory, proven by `internal.trusted-plaintext.test.ts` (22 tests; injecting an unsafe
  path turns the proof RED). followup-13 DEC-C built the reachability proof + boxed `systemRole` read; followup-15 DEC-C
  replaced the old named-module scan with the fail-closed plaintext-API enumeration (`proveBetterAuthPlaintextApiConfinement`,
  closing `claude-papercuts-35` P1 / round-16 B3); round-22 axis A5 adversarially re-swept the surface and found no
  request-reachable unboxed cross-user credential. Auth-FLOW controls (password-reset/verify token single-use+expiry,
  2FA replay) are Better-Auth-owned and recorded as `trustedDependencySurface` review triggers (M6), not a Kovo
  guarantee.
- **Auth × C (M4 timing) — GREEN.** Kovo's own auth crypto is constant-time — argon2 native `verify` (`password.ts:216`)
  - a param-matched **decoy digest** for absent accounts (`password.ts:180-207`) closing the user-existence oracle;
    capability/CSRF compares use `secureEqual` = SHA-256 + `timingSafeEqual` (`keyring.ts:208`, no length oracle); every
    credential failure collapses to one opaque `INVALID_CREDENTIALS` (`better-auth/mutations.ts:105/111/172/178`). Better
    Auth's internal password/session compare is a **dependency assumption** (→ M6).
- **Auth × Au (A2) — GREEN.** Session posture and lifecycle are covered by two Kovo-owned tests: the Better Auth
  credential wrapper preserves/floors `HttpOnly`/`Secure`/`SameSite` cookie attributes when forwarding session cookies
  (`packages/better-auth/src/index.credential-mutations.test.ts`), and `packages/better-auth/src/index.session.test.ts`
  proves refresh `Set-Cookie` headers are forwarded through the lifecycle sink without exposing the app session to the
  Better Auth redirect mount. Session-token signing/verification and provider callback state binding remain Better Auth
  dependency surfaces in `security/TCB.md`.
- **Wire × C/I** — the DEC-F sink inventory (22 sinks, `packages/core/src/internal/source-sink-registry.ts`) +
  hostile-value tests; round-16 reproduced XSS/redirect/identifier/headers/cookies/egress all SOUND. For the round-22
  A4 path specifically, `packages/server/src/app-mutation-request.test.ts` proves JSON mutation bodies are decoded
  through a positive object-schema allowlist without prototype-pollution side effects, and
  `packages/server/src/schema.test.ts` proves the FormData/object decoder uses null-prototype records with own-key
  gating. Log/error secret redaction via `scrubConsoleArgs` (`logging.ts:39`).
- **Wire × Au (A1) — GREEN.** CSRF does not rely on SameSite alone: `packages/server/src/csrf.test.ts` proves the
  Origin / `Sec-Fetch-Site` floor and synchronizer-token audience binding for unsafe requests, and
  `packages/server/src/app-dispatch.test.ts` covers the end-to-end mutation/endpoint dispatch paths that reject missing
  or cross-origin CSRF attempts before handler execution.
- **Wire × I (M34) — GREEN.** SPEC §9.5 requires adapters to preserve the raw case-sensitive HTTP
  method identity across the Web `Request` boundary. `packages/server/src/__bugz_remote_ingress.test.ts`
  sends real HTTP/2 `post`, `PoSt`, and `POST`; live Node rejects the first two before dispatch and
  admits only exact `POST`. `packages/server/src/node.test.ts` and `build.test.ts` prove the same
  closed verdict and extension-method behavior in live, emitted Node, and Vercel adapters. The
  `node-fetch-method-identity-closed` C13 anchor prevents silent removal.
- **Wire × I (M35) — OPEN.** At audited code SHA `e5f613be9`, real HTTP/2
  `:authority: %65xample.com` reaches the handler as URL host `example.com` but app-visible Host
  `%65xample.com`. `plans/bugz-34.md` owns canonical-authority rejection across live and emitted
  Node/Vercel, real-wire and parity regressions, SPEC §9.5 text, and a C13 anchor.
- **Runtime × Au (A6) — GREEN.** Capability URLs bind the signed canonical object, method, scope, and expiry before any
  storage read. `packages/server/src/capability-url.test.ts` proves claim-mismatch, expiry, signature, audience, and
  replay rejection; `packages/server/src/capability-route.test.ts` proves the verify sink runs before dereference, so a
  wrong object/scope/method token never reaches storage.
- **Build × I/Au (M7) — GREEN.** No app-untrusted string reaches an executable position: `templateLiteral` wraps lowered
  HTML; the two `node:vm` sites run only framework-constructed constant-returning modules in a timeboxed empty sandbox;
  the KV235 provenance token (`compiler-hard-rules.md:13`) makes lowered/executable content framework-only;
  `check:sink-policy-gate` forbids `eval`/`new Function`/`node:vm` with an empty allowlist and confines `child_process`;
  `import-boundary` blocks app code from `@kovojs/compiler`/`internal`/`generated`; `check:inline-loader` proves the
  committed loader (with its `ki()`/`im()` import allowlist to `/c/` versioned modules) is byte-for-byte
  framework-constructed. _Hardening note (low, author-trust):_ `componentName` is interpolated raw at a few identifier
  sites (`emit/client.ts:311/314/318/582`, `lower/handlers.ts:69`, `emit/bootstrap.ts:86`), reachable only via the
  filename fallback `inferComponentName` (`scan/parse.ts:444`) for an author-controlled component — asymmetric with the
  derive/live-target emitters which sanitize. Route through `sanitizeIdentifier`.
- **Deps × C/I/Au (M6) — GREEN (closed, followup-16).** Exact-pinned `pg` 8.22.0 / `@electric-sql/pglite` 0.5.1 /
  `@node-rs/argon2` 2.0.2 / `better-sqlite3` 12.11.1 (+ `better-auth` 1.6.17, `drizzle-orm` 1.0.0-rc.4);
  `--frozen-lockfile` in the shared `kovo-setup` action + `release.yml`; `scripts/supply-chain-gates.mjs` +
  `check:pack-security`. `security/TCB.md` gained a `trustedDependencySurfaces` manifest naming the 10 dependency
  BEHAVIOR surfaces (node-pg + Drizzle parameterization; PGlite + Postgres RLS/role; Better Auth password,
  session/cookie, reset/verification token lifecycle, two-factor replay resistance, and account-linking state binding;
  argon2) ENFORCED by `check:tcb-boundary` (fails on caret/drift). New `rules/dependency-policy.md`. The dependency
  runtime behavior stays a documented human review trigger, not a machine-checked property.
- **Runtime × C (M8) — GREEN.** Pool doubly-scrubbed (`DISCARD ALL` `postgres-runtime.ts:1846` + transaction-local
  `set_config(...,true)`/`SET LOCAL` `managed-db.ts:1365-1378`); module-level audit-fact arrays have no exported read
  path (`declarePublicRead` is the only public export); logs redact secrets; caches are principal-independent (decoy
  cache keyed by argon2 params; WeakMaps; per-request `AsyncLocalStorage`). _Latent papercut (not confidentiality):_
  `crossOwnerReadAuditFacts`/`publicReadAuditFacts` are not env-gated (unlike `postgresRlsSilentDenyDiagnostics` at
  `managed-db.ts:1395`) → unbounded growth in prod; gate behind non-production or bound/drain.

## Availability scope (M5) — out-of-scope for the security GUARANTEE, no framework footgun

The framework OWNS a normative default-on **pre-dispatch load-shed posture** (SPEC §9.5): 1 MiB body cap (413, enforced
by a streaming byte-counter so a lying `content-length` can't bypass); identity-blind rate budgets (global 20k/min +
per-IP 600/min + per-surface, 429) with a bounded LRU bucket store; **ReDoS static rejection** (`assertLinearSafePattern`
`redos.ts:194`) + a 4096-char runtime cap that bounds even the `unsafeRegex` escape; query-list cap 100; capped task
retries + cron backfill; bounded pg pool. **No framework-owned DoS footgun.** The **app + deploy own**: query cost /
`statement_timeout` (the framework sets none — legitimately deploy-owned), pool sizing, per-principal quotas, and
infrastructure-level (L3/L4) DDoS.

## Deploy responsibilities (documented, not framework-ownable)

- **Per-tenant log-stream isolation** — the framework redacts secrets in log output but does not partition log
  destinations per tenant.
- **Production DB** — dev PGlite runs one data dir per app process (RLS is the tenant boundary); production must use a
  real Postgres via `KOVO_DATABASE_URL` with the framework's least-privilege roles.
- **`statement_timeout` / connection-pool sizing / per-principal rate quotas** — set at the connection string / deploy.

## Open cells (v1 blockers) + first-fill work

| Cell                                  | State | Owner / next step                                                                                                                                               |
| ------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M2** Auth × C — adapter non-egress  | GREEN | Closed: fail-closed non-egress proof TCB-enrolled (`better-auth.request-secret-surface.proof`), `internal.trusted-plaintext.test.ts` 22 pass; round-22 A5 clean |
| **M3** Escape-hatch visibility        | GREEN | Closed by followup-16: static capability producers surface every escape in `kovo explain --capabilities`/`--cookies`                                            |
| **M6** Deps / supply chain            | GREEN | Closed by followup-16 M6: exact pins + `--frozen-lockfile` + `trustedDependencySurfaces` (`check:tcb-boundary`) + `rules/dependency-policy.md`                  |
| **M35** Wire × I — authority identity | OPEN  | Close `plans/bugz-34.md` across live and emitted Node/Vercel before Web `Request` construction                                                                  |

## Status

- M1 authored (this document). M2–M8 remain GREEN; M35 is OPEN.
- **Green:** M2 (auth-adapter non-egress proof, closed 2026-07-07), M3 (escape visibility, followup-16), M4 (timing),
  M5 (DoS scope + no footgun), M6 (supply chain, followup-16), M7 (build/compiler), M8 (runtime/infra); DB/Wire/Render/
  Runtime cells green (followup-{6..17} landed).
- **Open cells: M35.** The first comparable convergence audit found a remotely supplied authority
  identity split at the Node-to-Fetch boundary; `plans/bugz-34.md` owns closure.
- **Next:** close and retest M35, then commission the external audit
  (`plans/threat-matrix-plan.md` §3 A1), the last v1 security-signoff step.
