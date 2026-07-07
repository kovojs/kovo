# Kovo Security Threat-Matrix (v1 coverage map)

Created 2026-07-06 (threat-matrix-plan M1 + M3–M8 first fill). Normative source of behavior is `SPEC.md`. This is the
coverage map for the v1 security signoff: every {surface × threat} cell records a **named control (with its test/gate)**,
an **audited escape hatch**, or an **explicit out-of-scope note (whose responsibility it is)**. A cell with none is
**OPEN**. v1 does not freeze with an OPEN cell or an unresolved blocking external-audit finding (`rules/v1-acceptance.md`
16.9). Threat categories: **C** confidentiality, **I** integrity, **A** availability, **Au** authenticity.

## The matrix

| Surface                         | C (confidentiality)                                                                                                                             | I (integrity)                                                                                     | A (availability)                                                         | Au (authenticity)                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **DB / data plane**             | GREEN¹ — RLS FORCE + non-superuser roles + column-REVOKE + closure/attached-code/identity audits                                                | GREEN¹ — narrowed writer grant, KV438 governed-column floor, WITH CHECK, declared-write choke     | scope: app/deploy (M5); GREEN-footgun — query-list cap 100, bounded pool | GREEN¹ — principal integrity: wrapped-client reconstruct + `set_config` confinement + identity allowlist      |
| **Auth**                        | GREEN (M2) — non-egress proof + opaque credential failure/timing floor; reset/verify/2FA/linking semantics reviewed as Better Auth dep surfaces | GREEN — governed-column floor on `user`/`session` (KV438)                                         | GREEN — pre-dispatch rate budgets on auth endpoints (M5)                 | GREEN — CSRF, session-cookie posture/refresh lifecycle; token signing + callback-state binding = dep surfaces |
| **Wire / HTTP**                 | GREEN — DEC-F sink inventory: secret box on every egress channel + log redaction                                                                | GREEN — positive schema allowlist + null-proto decode + typed header/cookie channels              | scope: app/deploy (M5); GREEN — 1 MiB body cap (413), rate budgets (429) | GREEN — CSRF Origin+token floor, webhook verify, request-input provenance                                     |
| **Render / browser**            | GREEN — escape-by-default; `trustedHtml` the only branded raw door                                                                              | GREEN — contextual escaping across text/attr/URL-scheme positions                                 | N/A — client render cost is app-authored                                 | GREEN — Trusted-Types policy + inline-loader import allowlist                                                 |
| **Build / compiler**            | GREEN — server-only-value capture (KV437); generated code carries no secret                                                                     | GREEN (M7) — codegen framework-constructed; KV235 provenance; sink-policy + import-boundary gates | N/A — build is dev-time                                                  | GREEN (M7) — `dynamic.import.process` sole door = `/c/` versioned-module allowlist                            |
| **Dependencies / supply chain** | **OPEN (M6)** — dep surfaces recorded; caret pins remain on `pg`/`pglite`                                                                       | **OPEN (M6)** — no dependency update/provenance policy                                            | out-of-scope — dependency-internal DoS                                   | **OPEN (M6)** — Better Auth session/hash/reset/2FA/linking surfaces need review-on-bump policy                |
| **Runtime / infra**             | GREEN (M8) — no cross-tenant bleed; pool scrubbed; module state per-request; caches principal-independent                                       | GREEN (M8) — transaction-local session state; DISCARD ALL on release                              | scope: app/deploy (M5); GREEN — bounded pool + rate budgets              | GREEN (M8) — pool identity reset; no principal bleed across reuse                                             |

¹ **DB cells depend on `fundamental-fixes-followup-13` landing** the round-16 fixes (`claude-bugz-37`: write-propagation
closure B1, REPLICATION attribute B2, login-identity B4). Green-**pending**-followup-13; the controls are specified and
under implementation.

## Cell evidence (non-trivial cells)

- **DB × C/I/Au** — the arc's core (`fundamental-fixes-followup-6..13`): engine RLS as the sole owner-scope door,
  secrets column-REVOKE'd + boxed, principal set via a confined single-statement surface, identity attribute allowlist.
  Enforced by `checkPostgresAppDbPosture`, `pnpm run test:authz-paranoid`, the grant-shape + (DEC-E) differential
  fuzzers. **Pending:** followup-13 DEC-A (write-propagation closure) + DEC-B (REPLICATION/login) close `claude-bugz-37`.
- **Auth × C/Au (M2) — GREEN.** Kovo now proves the request-reachable Better Auth secret surface instead of a proxy
  module name: `packages/better-auth/src/internal.trusted-plaintext.test.ts` enumerates the submitted-password,
  request-cookie, Set-Cookie, adapter sign-in/password-compare, adapter session-token-lookup, and mount-delegation
  paths and fails red on any new unboxed cross-user credential read or unconfined plaintext API call. The app-visible
  credential wrappers add two more Kovo-owned controls: `packages/server/src/password.test.ts` proves uniform
  absent-account decoy work (no enumeration timing oracle), and
  `packages/better-auth/src/index.credential-mutations.test.ts` proves sign-in/sign-up only succeed on positive session
  evidence and treat `twoFactorRedirect` as unauthenticated. Reset/email-verification token single-use + expiry,
  two-factor/backup-code replay resistance, and account-link callback identity binding are **dependency assumptions**
  recorded in `security/TCB.md`, not independent Kovo guarantees.
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
- **Deps × C/I/Au (M6) — OPEN.** HAVE: committed `pnpm-lock.yaml`; `scripts/supply-chain-gates.mjs`
  (`onlyBuiltDependencies` freeze, lifecycle-script ban, `pnpm audit` ≥moderate); `check:pack-security`; `better-auth`
  1.6.17 + `drizzle-orm` 1.0.0-rc.4 exact-pinned; `security/TCB.md` records the dependency behaviors the guarantees
  rest on. GAPS: (1) `pg` `^8.16.3` + `@electric-sql/pglite` `^0.5.1` (+ argon2, better-sqlite3) are **caret** not
  exact; CI lacks `--frozen-lockfile`. (2) no `rules/dependency-policy.md`. The 10
  review-trigger dependency surfaces: node-pg parameterization; Drizzle SQL-gen parameterization; PGlite `SET LOCAL
ROLE`/RLS; Postgres `SET ROLE`/`FORCE RLS`; Better Auth password hashing; Better Auth session/cookie integrity; Better
  Auth reset/verification token lifecycle; Better Auth two-factor replay resistance; Better Auth account-linking state
  binding; argon2 hashing.
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

| Cell                           | State | Owner / next step                                                                                 |
| ------------------------------ | ----- | ------------------------------------------------------------------------------------------------- |
| **M3** Escape-hatch visibility | OPEN  | `kovo explain --capabilities` surfaces only 2 of ~12 escapes — see below; own follow-up           |
| **M6** Deps / supply chain     | OPEN  | exact-pin `pg`/`pglite`/argon2/better-sqlite3 + `--frozen-lockfile`; `rules/dependency-policy.md` |

### M3 — escape-hatch visibility gap (detail)

The `kovo explain --capabilities` renderer supports 12 capability kinds but the pipeline populates only **2**
(`publishToClient` + `trustedReveal`); the 7 static trust escapes are surfaced via `graph.trustEscapes`. Every
**runtime-audited** escape has a `drain*Facts()` collector that is defined/exported but **never invoked** into
`graph.capabilities`: `crossOwnerRead` (`managed-db.ts:616`), `trustedAssign`/`serverValue` (`write-governance.ts:95`),
`unsafeCookie` (`cookies.ts:130`), `publicRelation` (`postgres-runtime.ts:391`), `systemDb`/`authAdapterDb`
(`postgres-runtime.ts:439`), `acceptUnverified`, `egressAllowInternal` (`egress.ts:254`), `unsafeRegex` (`redos.ts:506`,
standing marker `SF-WIRE(graph-output)` `redos.ts:502`), `rawRead`. `actAs`/`declareSystem*` have no capability kind at
all. The format test's green is manufactured (`index.kovo-explain.test.ts:1109` hand-injects capabilities). **Impact:**
a reviewer auditing a real app sees ~2 of ~12 intentional holes — the "review every escape from one place" guarantee is
broken. **Not a fail-open** (escapes still carry their runtime guards), but an audit-completeness gap. **Fix:** wire the
orphaned drains + static producers into `graph.capabilities`/`graph.cookieDowngrades`; resolve `SF-WIRE(graph-output)`.

## Status

- M1 authored (this document). M3–M8 first-fill complete (probe evidence above).
- **Green:** M4 (timing), M5 (DoS scope + no footgun), M7 (build/compiler), M8 (runtime/infra).
- **Open (v1 blockers):** M3 (escape visibility), M6 (supply chain).
- **Not yet done:** external audit (threat-matrix-plan §3, after all cells green).
