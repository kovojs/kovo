# Round-17 Papercuts 36

Created 2026-07-06. Source of truth remains `SPEC.md`. Hygiene / proof-completeness / defense-in-depth items from the
Round-17 Postgres/auth security dogfood AFTER `plans/fundamental-fixes-followup-13.md`. Security fail-opens are in
`plans/claude-bugz-38.md`. Dogfooded in an isolated worktree at main HEAD `2040f54de`; `/Users/mini/kovo` untouched.
Line numbers cite that HEAD.

## Issues

- [x] **P1 — The DEC-C non-egress proof confines plaintext-reading to the trusted module by a HARDCODED 4-name regex
      (`auth.api.(getSession|signInEmail|signOut|signUpEmail)`), so any additional Better Auth plaintext-reading
      endpoint (`resetPassword`, `changePassword`, `forgetPassword`, `verifyEmail`, …) is invisible to the confinement
      scan and could be called outside the trusted zone without tripping any test — the "reachable secret surface" is a
      maintained denylist-shaped allowlist, not a reachability graph.** (LOW→MED, framework/proof-completeness;
      `pg-auth-nonegress-surface` P1; the same class as round-16 P1 — the proof checks a proxy, not the true surface)
  - Observed: `internal.trusted-plaintext.test.ts:96-109` regexes source for `auth.api.(getSession|signInEmail|signOut|
signUpEmail)(` and asserts all matches live in `internal/trusted-plaintext.ts`. The set of "APIs that read
    plaintext" is the four literal names — not derived from Better Auth's actual endpoint surface.
  - Root cause: DEC-C fixed the _file-scan-vs-reachability_ problem for the systemRole/adapter paths (the manifest in
    `non-egress-proof.ts:40-126`), but this sibling confinement scan re-introduces the same C10 shape at the
    plaintext-API layer: a hand-picked list of endpoint names standing in for "every plaintext-reading endpoint."
  - Why it matters: a Better Auth upgrade (or a plugin) that adds a plaintext-reading endpoint used outside the trusted
    module egresses cross-user plaintext with no test going red. Not a reproduced fail-open (no current endpoint
    outside the four is shown reachable-and-unboxed), but the proof reads as a control while its surface is incomplete.
  - Acceptance: the plaintext-API confinement derives the reading-endpoint set from Better Auth's actual surface (or a
    fail-closed enumeration that goes RED when a new `auth.api.*` plaintext method appears unclassified), so a new
    plaintext endpoint fails the proof until it is classified boxed/confined — mirroring the DEC-B version-guard.

- [x] **P2 — Better Auth PLUGIN credential columns escape secret-classification: `betterAuthCredentialSecretFields` is
      a hardcoded 8-name denylist (`accessToken, backupCodes, clientSecret, idToken, password, refreshToken, secret,
token`), so a plugin credential column outside those names — canonically the official apiKey plugin's `key`
      column, or any custom credential `additionalField` — is never classified `secret:`, and the framework's OWN KV406
      bridge suggestion emits it as an ordinary readable column.** (MED, framework/confidentiality-hardening;
      `pg-plugin-secret-classification` P2; split verify — REAL as a same-owner KV435 wire-serialization gap, REFUTED as
      a cross-user egress; carried as a hardening papercut)
  - Observed: `betterAuthCredentialSecretFields` (`packages/better-auth/src/internal.ts:976-987`) returns only names
    intersecting the 8-entry list; consumed by `withBetterAuthSecretFields` (`:918/968-974`), the sole secret-carrying
    branch of `suggestedUnsupportedPluginTableAnnotation` (`:906-923`), surfaced as the KV406 `suggestedAnnotation`.
    For the official apiKey field set the suggested annotation is `{domain:'auth', key:'userId'}` with NO secret list —
    `key` (the stored API-key credential) presented as readable. The static bridge `betterAuthSchemaBridge`
    (`internal/contracts.ts:558-608`) has no apiKey entry; the DEC-C manifest models only `account.password` +
    `session.token`. No completeness test binds this filter to Better Auth's real plugin credential columns.
  - Why it (partly) matters / why it is a papercut not a bug: the annotation is owner-scoped (`key:'userId'`), so under
    Kovo ownership + engine RLS FORCE a read returns only the requesting user's own API keys — not a cross-user leak;
    and it is an ADVISORY KV406 suggestion the developer is told to confirm. But the framework classifies the owner's
    OWN `session.token`/`account.password` as secret precisely because owner-scoping is insufficient for credential
    WIRE-confidentiality; by that same standard `apiKey.key` should be secret. A developer who bridges apiKey per the
    framework's own suggestion can project `key` to the client with no KV435 refusal.
  - Root cause: C10 again — a hand-picked denylist of credential column NAMES instead of a positive rule
    (credential-shaped plugin columns default to secret unless proven non-secret).
  - Acceptance: unknown/plugin credential-shaped columns default to `secret:` classification (or the KV406 suggestion
    refuses to omit a plausible credential column without an explicit author override), and a completeness test binds
    the classifier to Better Auth's known plugin credential columns (starting with apiKey `key`). SPEC notes the
    default-secret rule for unclassified plugin credential columns.

- [ ] **P3 — The DEC-E differential fuzzer's ground-truth oracle observes ONLY a SECURITY DEFINER TRIGGER firing, so it
      is non-differential for every non-trigger definer mechanism (CHECK/domain, DEFAULT, GENERATED recompute, rewrite
      rule, index expression) — those cases drive no write and hardcode `leak=false`, resting entirely on the audit's
      own `expectedAuditRefusal` — and the `fk-cascade` case is additionally VACUOUS (its driving `DELETE … WHERE` is
      rejected 42501 for lack of SELECT, so the cascade + definer trigger it is named for never fire). C10 applied to
      the checker itself: the completeness ORACLE covers a subset of the propagation surface.** (LOW→MED,
      framework/test-completeness; `pg-differential-oracle-subset` P3; consolidates D1/D2/D3 — all REFUTED as fail-opens,
      carried as checker hygiene)
  - Observed: `postgres-grant-shape-fuzzer.test.ts` — the four non-trigger attached-code cases
    (`attachedCheckConstraintCase:896`, `attachedRewriteRuleCase:934`, `attachedDefaultExpressionCase:972`,
    `attachedIndexExpressionCase:1010`) set `probeKind:'privilege'`, `sql:'SELECT false AS unsafe'`, `shouldLeak:false`,
    so `probeLeak` (`:1066-1091`) returns a hardcoded `leak=false` with no engine cross-check; there is no GENERATED
    ALWAYS AS case at all. The `fkCascadePropagationTriggerCase` (`:679-733`) grants only `DELETE ON parent` but drives
    `DELETE FROM parent WHERE id='p1'`, which needs SELECT on the referenced column → 42501 → `probeLeak` catch returns
    `leak=false` trivially matching `shouldLeak:false`; the cascade + BEFORE-DELETE definer trigger never execute.
    Reproduced: the definer DEFAULT/generated function DOES run on a writer INSERT while the oracle observes nothing.
  - Why it is NOT a fail-open (the reason to record, not alarm): ENFORCEMENT is intact. The structural attached-code
    catalog query (`postgres-runtime.ts:1201-1296`) covers all mechanisms (GENERATED share `pg_attrdef` with DEFAULT),
    and each case still asserts `expectedAuditRefusal` against the real posture check; and the FK-cascade STATIC closure
    CTE (`:1333-1362`) reaches the child via `confdeltype` purely from catalog metadata, independent of the runtime
    DELETE. Crucially, the **EXECUTE-gating asymmetry** (found on the A-axis): only TRIGGERS bypass `EXECUTE`; every
    other attached-code mechanism (DEFAULT/CHECK/domain/generated/index) enforces `EXECUTE`, so a non-trigger definer
    function that can fire requires the writer to hold EXECUTE and is independently refused by
    `auditPostgresReachableRoutines` (`:1500-1542`, no allowlist). Triggers are therefore the ONLY real fail-open axis —
    which is exactly why DEC-A's trigger focus is sound.
  - Why it matters (hygiene): the differential harness advertises "the engine adjudicates completeness," but for
    non-trigger mechanisms the engine never runs — a future regression that dropped the `pg_attrdef`/`pg_constraint`
    union would be caught only by structural reasoning (or the shared DEFAULT case), not by an observed leak, and the
    fk-cascade case gives zero runtime evidence despite its name.
  - Acceptance: the fk-cascade case grants enough (e.g. SELECT on parent) that the driving write succeeds and the
    definer trigger actually fires (observed `leak=true`); add non-trigger differential cases that drive a write and
    observe the definer DEFAULT/CHECK/GENERATED/rewrite function executing (a side-effect log), so the oracle is
    differential across the full attached-code surface. Record the EXECUTE-gating asymmetry in SPEC §10.3 as the reason
    triggers are the sole EXECUTE-bypassing mechanism.

- [ ] **P4 — `auditPostgresAttachedCode` enumerates DOMAIN DEFAULT expression functions via `pg_attrdef` only, so a
      SECURITY DEFINER function used as a DOMAIN's DEFAULT (stored in `pg_type.typdefaultbin`, not `pg_attrdef`) is
      dropped from the KV433_ATTACHED_CODE per-mechanism report even though the carrying relation is in the write
      closure.** (LOW, framework/diagnostic-hygiene; `pg-domain-default-attribution` P4; REFUTED as a fail-open —
      EXECUTE-backstopped by `auditPostgresReachableRoutines`)
  - Observed: the only default-expression mechanism (`postgres-runtime.ts:1256-1266`) joins `pg_attrdef`→`pg_proc`;
    `grep typdefault|pg_type` in `postgres-runtime.ts` returns zero hits, so a domain-default definer function is not
    listed by the attached-code audit. The relation is still reported writable, but the "attached to X via mechanism Y"
    context is lost.
  - Why it is only hygiene: domain DEFAULT evaluation enforces EXECUTE, so whenever it fires the writer holds EXECUTE
    and `auditPostgresReachableRoutines` (`:1500-1542`) independently refuses the definer routine (KV433*REACHABLE*
    ROUTINE, no allowlist). The gap is message-specificity + a latent risk IF the routine audit ever gained a vetted
    allowlist (the attached-code path would then be the only cover and it does not scan `pg_type`).
  - Acceptance: the attached-code default mechanism also scans `pg_type.typdefaultbin` (and exclusion-constraint
    operator functions via `pg_constraint`→`pg_operator`→`pg_proc`) so the per-mechanism attribution is complete;
    covered by an attached-code fuzzer case on a domain-default definer function.

- [ ] **P5 — followup-13 (`476cc1782` "Preserve Postgres query config metadata") relaxed the scoped-query wire carrier
      from a framework-reconstructed `{text, values}` to spreading the ENTIRE untrusted app query-config object
      (`{...snapshot.diagnosticQuery, text, values}`) into the driver call, vetted only by a submit/then property
      denylist — a strict reduction of the wire-carrier boundary strictness that held through followup-12, and a
      denylist-shaped allowlist over driver-surface fields.** (LOW, framework/defense-in-depth; `pg-scoped-carrier-
    passthrough` P5; REFUTED as a fail-open — text/values last-wins + single-statement + RLS FORCE)
  - Observed: `managed-db.ts:1180-1195` `postgresQueryExecutionArgs` returns `{...snapshot.diagnosticQuery, text,
values}` for any record-shaped config; `assertPlainPostgresQueryConfigSafe` (`:1163-1178`) denies only own
    `submit`/`then` descriptors. Pre-commit body was `return [snapshot.text, [...snapshot.values], queryOptions]`. The
    sibling cross-owner/raw-read path still uses a clean `reconstructedDriverCarrier` (`:1691-1699`) — the framework
    knows the stricter posture.
  - Why it is only defense-in-depth: `text`/`values` are re-applied last-wins over the spread and `text` is
    re-validated (`assertAppPostgresTextAllowed`), single-statement shape is enforced, submit/then hijack throws KV414,
    and RLS FORCE + `kovo.principal` gate every row. The forwarded fields (`name`, `rowMode`, `types`, `queryMode`) are
    inert result-shaping options in the app's own trust domain; no field crosses the principal boundary on the current
    node-pg surface. No cross-principal leak reproduces.
  - Why it matters: it is a strictness regression against the followup-6..12 "only framework-reconstructed text+values
    reach the driver" posture, and the updated tests only assert the metadata IS forwarded + submit throws — they add
    no allowlist over which config fields may cross. A future driver field or behavior could turn a forwarded field
    dangerous.
  - Acceptance: the scoped-query carrier forwards an ALLOWLIST of known-inert driver fields (or reverts to the clean
    `{text, values}` reconstruct used by the sibling path), so the wire carrier is a positive allowlist, not a
    submit/then denylist; SPEC records which driver-config fields are permitted to cross and why they are inert.

## Refuted / Not Carried Forward (strong positive signal)

- The A-write-closure and E-dataplane-regression axes produced ZERO fail-opens (see `claude-bugz-38.md` Refuted): the
  DEC-A propagation closure, the EXECUTE-gating backstop, engine RLS FORCE owner-scoping, the secret box, the wire-sink
  inventory, and the wrapped-client reconstruct all held on the followup-13 build. Round 17's only enforcement gaps are
  B1 (predefined-role membership) and F1 (the `?`-quantifier ReDoS soundness bug) in `claude-bugz-38.md`; everything on
  the four DEC closures is either sound or a hygiene/completeness item above.

## Latest Verification

- P1 (plaintext-API 4-name regex) and P3/P4 (differential-oracle subset + EXECUTE-gating asymmetry) grounded by reading
  `internal.trusted-plaintext.test.ts`, `postgres-grant-shape-fuzzer.test.ts`, and `postgres-runtime.ts:1201-1543`
  first-hand. P2 (plugin secret denylist) confirmed at `internal.ts:976-987`; split verify (same-owner KV435 gap REAL,
  cross-user egress REFUTED) → hardening papercut. P5 confirmed at `managed-db.ts:1180-1195` vs `git show
476cc1782^:...`; refuted as a fail-open. Throwaway probes under `/Users/mini/kovo-dogfood-round17-apps/` — safe to
  delete. `/Users/mini/kovo` untouched; no servers left running.
