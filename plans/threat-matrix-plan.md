# Threat-Matrix Plan — the v1 security-signoff artifact: coverage matrix + external audit

Created 2026-07-06. Self-standing. Source of truth for behavior is `SPEC.md`. Delegated from
`plans/fundamental-fixes-followup-13.md` O4. This plan answers the "when do we stop" question the 16-round
data-plane security arc could never answer: it replaces "no finding this round" with "every threat-model cell has a
named control, an audited escape hatch, or an explicit out-of-scope note — and a third party has verified it."

## 1. Why this plan exists

The `fundamental-fixes-followup-{6..13}` arc drove the DATA-PLANE confidentiality/integrity story to convergence
(engine RLS as the sole owner-scope door; secrets boxed; value carriers reconstructed; sinks inventoried; enumerations
closed). But every round found "the next axis," and the only stopping signal has been the absence of a finding in the
latest dogfood — which is not a completeness proof. A security-by-construction framework needs a COVERAGE MAP that
makes "done" a checkable claim, plus an INDEPENDENT audit so the claim is not self-graded.

**This plan is the v1 security gate** (it should be referenced from `rules/v1-acceptance.md` gate 16.9): v1 does not
freeze until the matrix is green and the external audit's blocking findings are closed.

## 2. The coverage matrix

Enumerate every cell of {threat category} × {surface}. For each cell record: the **named control** (with the test/gate
that enforces it), OR the **audited escape hatch** (logged + surfaced in `kovo explain`), OR an **explicit out-of-scope
note** (what Kovo does NOT guarantee, and whose responsibility it is). A cell with none of these is an OPEN gap.

Threat categories: **Confidentiality** (C), **Integrity** (I), **Availability** (A), **Authenticity** (Au).
Surfaces: **DB / data plane**, **Auth**, **Wire / HTTP**, **Render / browser**, **Build / compiler**, **Dependencies /
supply chain**, **Runtime / infra**.

- [ ] **M1 — Author the matrix (one row per surface, one column per threat category) and fill every cell.** Seed it
      from the arc's existing controls (below) so the already-solved cells are recorded, not re-litigated, and the gaps
      stand out.
  - Acceptance: `docs/security-threat-matrix.md` exists with every cell filled (control+test / escape / out-of-scope);
    a `## Open cells` section lists any cell without one; `rules/v1-acceptance.md` 16.9 references it as a freeze gate.

### Already-solved cells (record, do not re-open)

- DB × C/I: engine RLS FORCE + reader/writer roles + column-REVOKE + the closure/attached-code/identity audits
  (followup-{6..13}); enforced by `checkPostgresAppDbPosture`, `test:authz-paranoid`, the grant-shape + differential
  fuzzers.
- Wire × C/I: the DEC-F sink inventory + hostile-value tests (followup-12); render escape-by-default; typed
  header/cookie channels; egress allowlist.
- DB × Au (principal integrity): the wrapped-client statement reconstruct + set_config confinement + `SET LOCAL ROLE`
  (followup-{10,12}); the identity attribute allowlist (followup-13 DEC-B).

### Cells the arc has NOT systematically swept (fill first — these are the likely OPEN ones)

- [ ] **M2 — Auth × C/Au: enroll and PROVE the auth-adapter TCB.** The Better Auth adapter has recurred three times
      (`bugz-24` A1, round-15 B4, round-16 B3): a request-reachable handle reads unboxed cross-user credentials. Make the
      adapter a first-class, minimal, TCB-manifest-enrolled module with a reachability-based non-egress proof (followup-13
      DEC-C is the mechanism); this cell stays OPEN until that proof is green.
- [x] **M3 — Escape-hatch audit completeness (C/I): every `trustedSql`/`rawRead`/`crossOwnerRead`/`trustedAssign`/
      `declarePublicRelation`/`unsafeRegex` site is logged and surfaced in `kovo explain --capabilities` with its
      justification.** The escapes are intentional holes; the guarantee is that they are all VISIBLE to a reviewer.
  - Static producer added: `collectCapabilityEscapesFromProject` + `collectCookieDowngradesFromProject`
    (packages/drizzle/src/trust-escapes-static.ts) detect each app-authored escape at its CALL SITE and emit a
    `CapabilityExplain`/`CookieDowngradeExplain`, mirroring the `publishToClient` call-site pattern — NOT the runtime
    `drain*Facts()` collectors (those fire only during a live request and never populate a merely-built graph, which is
    what `kovo explain` reads). Wired into `graph.capabilities`/`graph.cookieDowngrades` through both the real build
    graph (build-export.ts `staticBuildCheckGraph`) and the `compile drizzle-static` extract, then through
    `deriveAppGraph` (app-graph.ts) into `kovo explain --capabilities`/`--cookies`.
  - Kinds now surfaced statically from source: `serverValue`, `trustedAssign` (as `serverValue`), `unsafeRegex`,
    `publicRelation`, `systemDb` (`usePostgresSystemDb`), `acceptUnverified`, `unsafeCookie`, `crossOwnerRead`,
    `rawRead`, `actAs`, `declareSystemRead`, `declareSystemWrite`, `egressAllowInternal`; `trustedSql` stays on
    `--trust` (trust-escape pass); `trustedReveal` is folded from `graph.revealed`. New `CapabilityExplain.kind`s
    added: `unsafeRegex`, `rawRead`, `actAs`, `declareSystemRead`, `declareSystemWrite` (packages/core/src/graph.ts).
  - `SF-WIRE(graph-output)` at redos.ts is RESOLVED: `unsafeRegex(...)` is surfaced by the static producer; the runtime
    `drainUnsafeRegexFacts()` is retained only as DiD/test observation, no longer the audit source of truth.
  - Deferred (documented, honest): `managedSqlStatement` and `postgresRoleTopology` have NO per-app call site — they are
    framework-FIXED capabilities (same identity every build) already enumerated by the capability-surface census gate
    (scripts/capability-surface-census.manifest.json, rows `managed-sql-statement-identity`/`postgres-role-topology`).
    They are visible to a reviewer via that gate rather than as a per-call `graph.capabilities` row; a future follow-up
    could emit those fixed rows into `--capabilities` too so the audit truly reads from one place.
  - Evidence: `pnpm --filter @kovojs/drizzle exec vitest run src/capability-escapes-static.test.ts` (14 pass, real
    source → collector); `pnpm --filter @kovojs/cli exec vitest run src/index.kovo-explain.test.ts` (49 pass, incl. two
    source-driven end-to-end `--capabilities`/`--cookies` producer tests that replace the former hand-injected graph;
    the remaining hand-injected test is re-labeled as a renderer/fold unit test for the framework-fixed kinds).
- [ ] **M4 — Timing side-channels (C): the trusted-zone secret compare is CONSTANT-TIME** (password/token verify), and
      no error-message-length / early-return oracle distinguishes "wrong user" from "wrong secret". (followup-12 O4 flagged
      the compare.)
- [ ] **M5 — Availability / DoS (A): decide scope.** Connection exhaustion, ReDoS (the `unsafeRegex` escape), O(n^2)
      query shapes, unbounded uploads/result sets. Likely OUT OF SCOPE for the framework's security guarantee (rate-limit /
      resource limits are the app + deploy's responsibility) — but say so explicitly per cell, and confirm the framework
      ships no DoS FOOTGUN (e.g. an un-timeout-ed query path, an unbounded task fan-out).
- [ ] **M6 — Dependencies / supply chain (C/I/Au): scope + hygiene.** Better Auth, Drizzle, node-pg, PGlite have their
      own surfaces. Out of scope to audit their internals, but IN scope: pinned versions + lockfile, a documented update
      policy, and the TCB manifest marking which dependency surfaces Kovo's guarantees DEPEND on (so a dependency change
      that touches them is a review trigger).
- [ ] **M7 — Build / compiler (I): the generated code trust boundary.** `dynamic.import.process` is a DEC-F sink;
      confirm the compiler's OUTPUT (lowered IR, generated server/client modules) cannot be influenced by app-authored
      untrusted input into an executable position, and that the build gates (`check:*`) own that boundary.
- [ ] **M8 — Runtime / infra × C: multi-tenant infra hygiene.** Connection-pool scrub (`DISCARD ALL`, followup-12
      DEC-C) is done; also confirm no cross-tenant bleed via shared PGlite files, log aggregation carrying secrets, or a
      shared cache key. The `log/error output` sink (DEC-F) covers secret-in-logs; confirm cross-tenant log isolation is
      the deploy's job and documented.

## 3. External audit

- [ ] **A1 — Once the matrix has no OPEN cells, commission a third-party security audit** scoped to the data-plane
      confidentiality/integrity + auth guarantees, giving the auditor the matrix + SPEC §10.3 + the paranoid dogfood
      harness as the threat model. The matrix makes the audit efficient (directed, not exploratory).
  - Acceptance: an external audit report exists; every blocking finding is closed (a new `bugz`/`followup` as needed);
    the matrix is updated with the auditor-verified controls. Record in `docs/v1-acceptance-ledger.md`.
- [ ] **A2 — The matrix + audit become the standing v1 security gate in `rules/v1-acceptance.md` 16.9:** v1 does not
      freeze with an OPEN matrix cell or an unresolved blocking audit finding.

## 4. Open design issues (for this plan)

- [ ] **TO1 — Matrix granularity: per-cell vs per-mechanism.** A single {surface × category} cell can hide multiple
      distinct controls. **Decision:** allow a cell to list MULTIPLE controls, but each must name a test/gate; a cell is
      green only when every listed control is enforced and no known sub-surface is unlisted. Keep the matrix coarse enough
      to be readable, fine enough that "green" means something.
- [ ] **TO2 — Out-of-scope must be HONEST, not an escape valve.** Marking a cell out-of-scope (DoS, supply-chain
      internals) is legitimate only if the boundary is real and documented for the app author. **Decision:** every
      out-of-scope note names WHOSE responsibility the threat is and what the framework does to avoid being a FOOTGUN for
      it; a reviewer (or the auditor) signs off that the exclusion is reasonable.
- [ ] **TO3 — Keeping the matrix live.** A coverage matrix rots as the framework grows. **Decision:** a new public
      surface or sink requires a matrix row/cell update (a `check:*` gate that fails if a new sink in the DEC-F registry, or
      a new escape hatch, has no matrix cell) — so the matrix stays a checked invariant, not a one-time doc.

## 5. Acceptance (v1 security signoff)

- [ ] The matrix has no OPEN cell (every cell: control+test / audited escape / signed-off out-of-scope).
- [ ] M2–M8's first-fill cells are green (auth TCB proof, escape-hatch visibility, constant-time compare, scoped
      DoS/supply-chain/build/infra).
- [ ] A third-party audit is complete with all blocking findings closed.
- [ ] `rules/v1-acceptance.md` 16.9 references the matrix + audit as freeze gates; `docs/v1-acceptance-ledger.md`
      records the dated evidence.
