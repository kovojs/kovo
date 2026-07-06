# Fundamental Fixes Followup 14 — the allowlist must range over the COMPLETE surface, not one axis of it

Created 2026-07-06. Self-standing. Source of truth for behavior is `SPEC.md`. Continues the C10 line
(`fundamental-fixes-followup-{6..13}.md`). Responds to the Round-17 dogfood (`plans/claude-bugz-38.md` B1–F1,
`plans/claude-papercuts-36.md` P1–P5). Line numbers cite `main` (`b335d4065`).

## 1. The one foundational issue (round-17 restatement)

followup-13 (DEC-B) fixed round-16 B2 by turning the dangerous-attribute check from a DENYLIST into an ALLOWLIST. Round
17 shows the allowlist was over the wrong DOMAIN: an allowlist is only as complete as the SET it ranges over, and both
round-17 fail-opens are the same error — **the set the allowlist/analyzer ranges over is itself a hand-picked subset of
the true surface.**

| Finding | The set the check ranges over        | The subset shipped (wrong)                                | The complete surface it must range over                                                         |
| ------- | ------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| B1      | engine-identity escalation axes       | role ATTRIBUTES only (`rolsuper`…`rolcreatedb`)           | attributes ∪ **predefined-role membership** (`pg_execute_server_program`, `pg_write_all_data`, …) |
| F1      | catastrophic-backtracking quantifiers | `{+, *, {n,m}}` — **omits `?`**                          | every quantifier the engine backtracks on, incl. `?` (already recognized by `quantifierAt`)      |

**Meta-invariant (extends C10):**

- **C11 — An allowlist (or a sound-subset analyzer) is only complete if the SET IT RANGES OVER is the complete surface,
  computed from the engine/spec, not a hand-picked subset of the axes. Making a check an allowlist over an incomplete
  domain reproduces the very fox C10 warns about: the escalation axis you did not enumerate.** Corollary: when a check
  says "the entity must have ONLY safe members of set S," S must be the complete set of member-KINDS (attribute-elevation
  AND membership-elevation; every quantifier form), or a new kind is silently safe by default.

## 2. Decisions / work items

### DEC-A — Identity escalation surface = attributes ∪ predefined-role membership (fixes B1)

- [ ] **A1 — The DEC-B runtime-identity posture (`postgresRuntimeLoginPostureIssues`, `postgres-runtime.ts:2700-2801`)
      must range its allowlist over predefined-role MEMBERSHIP as well as role attributes. The runtime login AND every
      assumable role (the SAME `pg_has_role MEMBER` closure DEC-B already computes) must be a member of ONLY the
      framework's own roles (`{reader, writer, admin, system}`) plus an explicit benign don't-care set — membership in
      ANY PostgreSQL predefined role (`pg_*`) that is not on the benign allowlist REFUSES provision/check/boot with the
      role named. This is an ALLOWLIST (member of only known-safe roles), so a NEW predefined role in a future Postgres
      release fails closed by default. Reuse the existing assumable-role enumeration (no second closure) per O3.**
  - Rationale: the assumable-role closure (`:2746-2757`) already enumerates every reachable role; the bug is only that
    the per-role gate (`:2765`) discards roles carrying none of the 5 attributes. Predefined roles like
    `pg_execute_server_program` (COPY … FROM PROGRAM ⇒ OS command exec) and `pg_write_all_data` carry all 5 attributes
    false, so they slip through. Ranging the allowlist over membership-KIND, not just attribute-KIND, closes it.
  - Design choice (C10/technical-preview bias): ALLOWLIST over the framework roles, not a denylist of known-bad
    predefined roles — so a future `pg_*` role is refused until explicitly classified benign. Benign don't-care set
    starts empty (or minimal, e.g. nothing); a legitimate operator need for a benign predefined role is an explicit
    future classification, not a default hole. Hard break OK (no one uses Kovo yet).
  - Acceptance: a runtime login (or assumable role) that is a member of `pg_execute_server_program` / `pg_write_all_data`
    / `pg_read_server_files` / `pg_write_server_files` / `pg_read_all_data` / `pg_monitor` makes `kovo db
    check`/provision/boot REFUSE with the predefined role named; a login that is a member of only `{reader, writer,
    admin, system}` passes; the audited identity set is the SAME `{login} ∪ assumable closure` DEC-B/DEC-C use (no
    drift). Add a predefined-role-membership axis to the grant-shape fuzzer identity axis (re-introducing the gap turns
    it RED). SPEC §10.3 + `security-markers.ts` KV433 wording states the escalation surface is attributes ∪ predefined
    -role membership.
  - Folds papercut P1's version-guard analog: a fail-closed guard so a NEW `pg_*` predefined role the framework has not
    classified is refused by default is already implied by the allowlist shape (member-of-only-known-safe), so no
    separate denylist maintenance is needed.

### DEC-B — The sound-subset ReDoS analyzer's quantifier set is complete (fixes F1)

- [ ] **B1 — `containsQuantifier` (`redos.ts:228-238`) and its compile-time twin (`redos-pattern.ts:159-169`) must treat
      `?` as a quantifier, so a quantified group whose body is quantified with `?` — `(a?b?)+`, `(a?){50}b`, `(a?)+` — is
      rejected by `assertLinearSafePattern` at runtime AND flagged with a KV434 diagnostic at compile time. Route the
      quantifier test through the existing `quantifierAt` (which already recognizes `?`) so the quantifier set is defined
      ONCE, not duplicated as a subset.**
  - Rationale: the file's own `quantifierAt` (`redos.ts:241-243`) already recognizes `?`; the omission in
    `containsQuantifier` is an internal inconsistency, and the docstring (`redos.ts:185-190`) explicitly promises to
    reject "a quantified group whose body contains a quantifier." `?` under an outer `+`/`*` is textbook catastrophic
    backtracking (self-verified round-17: `(a?b?)+` on 53 chars → 7.1s, under the 4096 cap). The analyzer already
    catches the `+`-nested analog `(a+)+`, so this is a soundness bug, not a disclosed limitation.
  - Acceptance: `assertLinearSafePattern('(a?b?)+$')`, `('(a?){50}b')`, `('(a?)+')` THROW; the compile-time lint flags
    the same with KV434; the existing `(a+)+` / `(a|a)*` rejections still hold; a benign `(a?b?)` (no outer quantifier)
    and a linear `a?b?c?` still PASS (no over-block). Add `?`-nesting cases to the redos test suite (runtime + compile)
    so the omission cannot regress. The single-source quantifier set (via `quantifierAt`) is asserted by a test.

## 3. Papercuts roll-up (from `claude-papercuts-36.md`) — decisions

- [x] **DEC-C (folds P1 + P2) — Better Auth secret-surface completeness.** (a) The plaintext-API confinement is now a
      fail-closed enumeration: `proveBetterAuthPlaintextApiConfinement` (`internal/non-egress-proof.ts`) scans every
      `auth.api.*` call site and goes RED when a method is unclassified or a plaintext-reading method is used outside the
      trusted module — `internal.trusted-plaintext.test.ts` proves the real surface GREEN and two synthetic usages RED
      (P1). (b) `betterAuthCredentialSecretFields`/`isBetterAuthCredentialShapedColumn` (`internal.ts`) is a POSITIVE
      rule (final name segment is a credential noun → default `secret:`), so `apiKey.key` and custom credential fields
      classify secret unless proven non-secret; the KV406 suggestion no longer omits them (proven by the
      `customCredential` suggestion test) and `apiKey` is statically bridged with `secret: ['key']` (enforced) (P2). A
      completeness test binds the classifier to the known plugin credential columns.
  - Evidence: `pnpm --filter @kovojs/better-auth exec vitest run` → 6 files / 93 tests PASS, incl. the new
    `plugin credential secret classification` + fail-closed plaintext-API confinement cases. SPEC.md §10.1 C10 note added
    in `spec/10-data-plane.md`.
- [ ] **DEC-D (folds P3 + P4) — differential-oracle + attached-code attribution completeness (test/DiD hygiene, lower
      priority).** (a) The fk-cascade fuzzer case grants enough that the driving write SUCCEEDS and the definer trigger
      fires (observed `leak=true`); add non-trigger differential cases (DEFAULT/CHECK/GENERATED/rewrite) that drive a
      write and observe the definer function executing (P3). (b) The attached-code default mechanism also scans
      `pg_type.typdefaultbin` (domain defaults) + exclusion-constraint operator functions so per-mechanism attribution
      is complete (P4). SPEC §10.3 records the EXECUTE-gating asymmetry (only triggers bypass EXECUTE) as WHY triggers
      are the sole fail-open axis and the non-trigger mechanisms are EXECUTE-backstopped.
- [ ] **DEC-E (folds P5) — scoped-query wire carrier is a positive allowlist (defense-in-depth).** The scoped-query
      carrier (`managed-db.ts:1180-1195`) forwards an ALLOWLIST of known-inert driver fields (or reverts to the clean
      `{text, values}` reconstruct the sibling cross-owner path uses), not a submit/then denylist; SPEC records which
      driver-config fields may cross and why they are inert.

## 4. Proving

- [ ] **DEC-A:** predefined-role membership refusal (each escalation role) + framework-role-only pass + fuzzer identity
      axis RED on re-introduction.
  - Evidence: `pnpm exec vitest --run packages/server/src/postgres-runtime.test.ts packages/server/src/postgres-grant-shape-fuzzer.test.ts`.
- [ ] **DEC-B:** `?`-nesting rejected at runtime + compile; benign/linear pass; single-source quantifier test.
  - Evidence: `pnpm exec vitest --run packages/server/src/redos.test.ts` + the compiler redos-pattern test.
- [x] **DEC-C:** new-plaintext-endpoint turns the proof RED; unknown plugin credential column classified secret;
      completeness test binds the classifier.
  - Evidence: `pnpm --filter @kovojs/better-auth exec vitest run` (93 pass) — `internal.trusted-plaintext.test.ts`
    (unclassified + misplaced synthetic usages RED) and `index.schema-bridge.test.ts` (completeness + KV406 suggestion).
- [ ] Root gates unaffected: `check:tcb-boundary`, `check:capability-surface-census`, `check:wire-output-boundary`,
      `check:single-choke`, `check:sink-policy`, `vp check`, `git diff --check`.

## 5. Meta

Round 17 confirmed the arc keeps CONVERGING: A-write-closure and E-dataplane-regression found ZERO fail-opens; the only
enforcement gaps are B1 (an escalation axis) and F1 (a quantifier form) — both the C11 "the allowlist ranged over a
subset of the surface" shape. Once DEC-A/DEC-B land and the papercuts are addressed, `plans/threat-matrix-plan.md` M2
(auth-adapter TCB) is the last named-open cell before the external audit gate.
