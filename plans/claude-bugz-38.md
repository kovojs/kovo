# Round-17 Bugz 38

Created 2026-07-06. Source of truth remains `SPEC.md`. Security fail-opens from the Round-17 exhaustive
Postgres/auth security dogfood AFTER `plans/fundamental-fixes-followup-13.md` (C10 closures). Hygiene /
proof-completeness / over-block items are in `plans/claude-papercuts-36.md`. Dogfooded in an isolated worktree at
main HEAD `2040f54de` (followup-13 merged); `/Users/mini/kovo` untouched. Line numbers cite that HEAD.

## The round-17 restatement of the arc

Round 17 continues convergence: the two carried fail-opens are the SAME meta-pattern (C10 — "a security set is the
COMPLETE closure/allowlist computed from the boundary, never a hand-picked subset") applied one level deeper than
followup-13 reached:

| Finding | The set                                    | How it was built (wrong)                                         | What it should be                                                                   |
| ------- | ------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| B1      | dangerous engine-identity capabilities     | the ALLOWLIST over 5 role ATTRIBUTES (`rolsuper`…`rolcreatedb`)   | attributes ∪ **predefined-role membership** ∪ dangerous direct GRANTs — the full escalation surface |
| F1      | regex structures `.pattern()` rejects       | a quantifier set of `{+, *, {n,m}}` — **omits `?`**              | every quantifier the engine backtracks on, incl. `?` (which the file's own `quantifierAt` already recognizes) |

DEC-B fixed B2 (the attribute *denylist* → attribute *allowlist*) but the allowlist is over the wrong domain: role
attributes are only ONE axis of PostgreSQL privilege elevation. F1 is the same shape on a fresh surface — the ReDoS
analyzer's "safe subset" is a hand-picked subset of the dangerous-quantifier space.

## Issues

- [ ] **B1 — The DEC-B runtime-identity posture (`postgresRuntimeLoginPostureIssues`) certifies the login and its full
      assumable-role closure using ONLY the 5-element role-ATTRIBUTE allowlist, so membership in a PostgreSQL
      predefined role (`pg_execute_server_program`, `pg_write_all_data`/`pg_read_all_data`, `pg_read_server_files`/
      `pg_write_server_files`, `pg_monitor`, `pg_maintain`) — every one of which carries all five attribute booleans
      false — passes the identity gate unflagged, even though such membership is a real engine-level escalation
      (COPY … FROM PROGRAM ⇒ OS command execution; bulk cross-table write; host FS read/write).** (HIGH,
      framework/authorization; `postgres-identity-closure` B1; code gap reproduced first-hand — live COPY-FROM-PROGRAM
      exploit NOT independently verified, see caveat)
  - Observed (confirmed first-hand): the assumable-role closure query enumerates the full `pg_has_role(login, role,
    'MEMBER')` set (`postgres-runtime.ts:2746-2757`) but SELECTs only the 5 attribute booleans, and the per-role gate
    `if (postgresRoleElevatedAttributes(role).length === 0) continue` (`:2765`) drops any role whose 5 booleans are all
    false. `postgresRoleElevatedAttributes` (`:2645-2651`) iterates only `POSTGRES_ELEVATED_ROLE_ATTRIBUTES`
    (`:52-58` = `rolsuper, rolbypassrls, rolreplication, rolcreaterole, rolcreatedb`). PostgreSQL predefined roles are
    `NOLOGIN` roles with all five false, so each is skipped and no `KV433_RUNTIME_ROLE` issue is emitted. `grep` across
    `packages/` for any `pg_execute_server_program|pg_read_all_data|pg_write_all_data|pg_read_server_files|
    pg_write_server_files|pg_monitor|pg_maintain|predefined` returns ZERO hits.
  - No backstop for the command-exec / bulk-write predefined roles: `auditPostgresReachableRoutines` (`:1500-1542`)
    inspects only `pg_proc` SECURITY DEFINER routines; `auditPostgresUnexpectedPrivileges` (`:1570-1678`) inspects only
    FDW/foreign-server/language/large-object/default_acl ACLs; the relation-reachability audit
    (`POSTGRES_REACHABLE_RELATIONS_SQL` `:73-98`, run `:1084`) uses `has_table_privilege`, which reflects COPY-PROGRAM
    / server-file capability via NO table privilege at all. (`pg_read_all_data` read paths would separately surface via
    the relation-reachability audit's implicit SELECT, but `pg_execute_server_program` and `pg_write_all_data` have no
    such backstop.) The column-drift version-guard (`postgresRoleAttributeVersionIssues` `:2658-2698`) fail-closes only
    on new `pg_roles` ATTRIBUTE columns — it does not enumerate `pg_auth_members`/predefined-role edges.
  - Root cause: C10 recursion. DEC-B correctly made the attribute check an allowlist, but the SET the allowlist ranges
    over — role attributes — is itself a hand-picked subset of PostgreSQL's escalation axes. Membership in a predefined
    role is escalation that the closure *enumerates the role for* and then discards because it carries no elevated
    attribute. This is the exact analog of round-16 B2 (the audit forgot `REPLICATION`), one level up: now it forgets an
    entire escalation axis (predefined-role membership).
  - Why it matters: the identity posture gate is the control `SPEC §10.3` delegates the "runtime identity is
    least-privilege" guarantee to; it fail-closes on boot (`checkPostgresAppDbPosture` → throw) and at
    `assertRuntimeConnectionLeastPrivilege`. A login that is a member of `pg_execute_server_program` gets a GREEN
    least-privilege certification while holding OS-command execution as the DB server user — a false assurance in the
    precise gate meant to catch operator over-privilege.
  - CAVEAT (honesty): the attacker's claimed live repro (COPY … FROM PROGRAM writing `RCE_PROOF.txt`) could NOT be
    independently confirmed — the proof file is absent from the apps dir. The CODE gap is confirmed by direct source
    reading; the end-to-end exploit additionally requires the operator to have GRANTed a predefined role into the
    login's membership closure (Kovo never does this itself, and does not document doing it). Severity is therefore
    HIGH (false-assurance in the least-privilege gate for an adopted/operator-configured topology), not the reported
    CRITICAL. It is the same class the gate already fail-closes on for `BYPASSRLS`, so the incompleteness is
    framework-owned regardless of who created the topology.
  - Acceptance: the DEC-B identity posture enumerates dangerous PREDEFINED-role membership as part of the same
    assumable-role closure — the login and every assumable role must be a member of NONE of the escalation predefined
    roles (`pg_execute_server_program`, `pg_read_all_data`, `pg_write_all_data`, `pg_read_server_files`,
    `pg_write_server_files`, and any future `pg_*` role granting engine-wide capability), computed as an allowlist
    (member of only the framework's own `{reader, writer, admin, system}` + benign roles) so a NEW predefined role in a
    future Postgres release fails closed. Add a predefined-role-membership axis to the grant-shape fuzzer's identity
    axis; a login member of `pg_execute_server_program` must make `kovo db check`/boot REFUSE. Reclassify the KV433
    identity codes in `security-markers.ts` to state the escalation surface is attributes ∪ predefined-role membership.

- [ ] **F1 — The KV434 ReDoS static analyzer that gates the SAFE `s.string().pattern(...)` wire-string API is
      unsound for optional-quantifier nesting: `containsQuantifier` treats only `+`, `*`, and `{` as quantifiers and
      OMITS `?`, so a quantified group whose body is quantified only with `?` — e.g. `(a?b?)+`, `(a?){50}b` — passes
      `assertLinearSafePattern` and is compiled into a live `RegExp`, shipping a request-triggerable
      exponential-backtracking ReDoS on the API whose entire purpose is to reject that class.** (HIGH,
      framework/availability+correctness; `redos-optional-quantifier` F1; fully reproduced first-hand)
  - Observed (self-verified): `containsQuantifier` (`redos.ts:228-238`) returns true only for `+`, `*`, `{`; the
    nested-quantifier gate (`redos.ts:201-208`) throws only when `containsQuantifier(body)` is true, so a `?`-only body
    (`a?b?`) is never rejected. The file's own `quantifierAt` (`redos.ts:241-243`) DOES recognize `?` — an internal
    inconsistency, and the docstring (`redos.ts:185-190`) explicitly promises to reject "a quantified group whose body
    contains a quantifier." Runtime reach: `schema.ts:628-635` `pattern()` calls `assertLinearSafePattern(src)` then
    `new RegExp(src)`; `parse()` runs `regex.test` synchronously on the event loop behind only the 4096-char input cap
    (`schema.ts:659-663`), which `redos.ts:461-465` explicitly documents is NOT a CPU bound. The compile-time twin
    `isLinearSafeLiteralPattern` → `containsQuantifier` in `redos-pattern.ts:159-169` has the IDENTICAL `?` omission, so
    there is no build-time KV434 backstop either.
  - Reproduced first-hand: `/(a?b?)+$/.test('ab'.repeat(n)+'X')` measured — len 41 → 0.6s, 45 → 0.45s, 49 → 1.8s,
    53 → 7.1s (≈4× per +4 chars; multi-second blowup at ~50 chars, hours by ~70 chars — all far below the 4096 cap). A
    single ~60-char untrusted request field validated by `s.string().pattern('(a?b?)+$')` wedges the Node event loop.
    Code trace confirms the analyzer ACCEPTS `(a?b?)+$` (body `a?b?` → `containsQuantifier` false; no top-level `|` so
    `hasOverlappingAlternatives` false; no adjacent same-atom overlap).
  - Root cause: same C10 shape as B1 on a different surface — the analyzer's dangerous-quantifier SET is a hand-picked
    subset that omits `?`. `?` under an outer `+`/`*` is textbook catastrophic backtracking (each optional multiplies
    partition ambiguity). The analyzer already catches the `+`-nested analog `(a+)+`, so this is a soundness bug, not a
    disclosed limitation.
  - Why it matters: `.pattern()` is marketed (`schema.ts:401-403,417-419`) as the by-construction-safe alternative to
    the audited `unsafeRegex(...)` escape — an author who uses it per its documented safety guarantee ships a DoS. The
    KV434 guarantee is broken for the whole `?`-nesting class on both the runtime and compile-time paths.
  - Acceptance: `containsQuantifier` (and its `redos-pattern.ts` twin) treats `?` as a quantifier (route it through the
    existing `quantifierAt` so the quantifier set is defined once, not duplicated as a subset), so `(a?b?)+`,
    `(a?){50}b`, `(a?)+` are rejected by `assertLinearSafePattern` at runtime AND flagged with a KV434 diagnostic at
    compile time; the existing `(a+)+`/`(a|a)*` rejections still hold; a benign `(a?b?)` (no outer quantifier) and a
    linear `a?b?c?` still pass. Add `(a?b?)+`-class cases to the redos test suite so the omission cannot regress.

## Refuted / Not Carried Forward (strong positive signal)

- **A-write-closure — 0 fail-opens.** The DEC-A write-propagation closure (`postgresWritePropagationClosure`
  `:1299-1371`) walks FK referential actions (`confdeltype`/`confupdtype` ∈ `c,n,d`), `pg_inherits` (partitions + legacy
  inheritance in one walk), and rewrite rules; the 7-mechanism attached-code enumeration (`:1201-1281`) covers
  trigger/rule/CHECK/domain/default+generated/index. The one candidate — DOMAIN DEFAULT expression functions in
  `pg_type.typdefaultbin` not enumerated by the attached-code query (A1) — is REFUTED as a fail-open: every non-trigger
  attached-code mechanism ENFORCES `EXECUTE`, so a definer function that actually fires on a writer INSERT requires the
  writer to hold EXECUTE, and `auditPostgresReachableRoutines` (`:1500-1542`, no vetted allowlist) independently
  refuses it. Recorded as a papercut (message-context erosion + the EXECUTE-gating asymmetry) in `papercuts-36`.
- **E-dataplane-regression — 0 reproduced escapes.** Owner-scope IDOR (engine RLS FORCE still the sole door), secret
  columns to the client (KV435 box), wire sinks (XSS/redirect/identifier/headers/cookies), the wrapped-client statement
  reconstruct, and pool-state bleed all held on the followup-13 build. The one candidate (E1, the followup-13
  scoped-query carrier relaxation) is REFUTED as a fail-open — text/values are re-applied last-wins over the spread,
  single-statement shape is enforced, submit/then is blocked (KV414), and RLS FORCE gates rows — recorded as a
  defense-in-depth hygiene regression in `papercuts-36`.
- **D-differential — no fail-open.** The DEC-E oracle observes only TRIGGER fires and is non-differential for
  non-trigger definer mechanisms (D1/D2/D3 all refuted as fail-opens). No member escapes ENFORCEMENT: the structural
  attached-code catalog query covers all mechanisms and the EXECUTE-gating asymmetry backstops non-trigger definer code.
  Recorded as a fuzzer-completeness papercut in `papercuts-36`.

## Latest Verification

- **B1** — code gap confirmed first-hand by reading `postgres-runtime.ts:52-58, 2645-2651, 2700-2801` (the `:2765`
  attribute-only skip; the `:2749` query fetching only the 5 booleans; the `:2658-2698` version-guard covering only
  attribute columns). Live COPY-FROM-PROGRAM exploit NOT confirmed (`RCE_PROOF.txt` absent). Severity HIGH.
- **F1** — fully self-verified: `redos.ts:228-238` (`?` omission) vs `:241-243` (`quantifierAt` recognizes `?`);
  exponential timing measured directly (`/(a?b?)+$/`: 49 chars → 1.8s, 53 chars → 7.1s). Both runtime (`schema.ts`) and
  compile-time (`redos-pattern.ts:159-169`) paths affected.
- Throwaway probe scripts under `/Users/mini/kovo-dogfood-round17-apps/` — safe to delete. Isolated worktree at
  `/Users/mini/kovo-dogfood-round17` (branch `agent/dogfood-round17`). `/Users/mini/kovo` untouched; no servers left
  running.
