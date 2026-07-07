# Round-18 Papercuts 37

Created 2026-07-06. Source of truth remains `SPEC.md`. Refuted-but-notable / scoping items from the Round-18 security
dogfood (verify followup-14 + hunt). Security fail-opens are in `plans/claude-bugz-39.md`. Isolated worktree at
`fdfa74164`; `/Users/mini/kovo` untouched. Line numbers cite that HEAD.

## Issues

- [ ] **P1 — Scoping: the runtime-identity least-privilege gate covers role ATTRIBUTES and predefined-role MEMBERSHIP
      (DEC-A/followup-14), but NOT direct object-privilege escalation — a direct `GRANT EXECUTE` on a `SECURITY DEFINER`
      routine, or a direct dangerous object grant, that confers capability without any role membership.** (LOW→MED,
      framework/scoping; `identity-direct-grant` IDGATE-1; REFUTED as a NEW fail-open)
  - Why REFUTED as a fail-open: a reachable `SECURITY DEFINER` routine EXECUTE-granted to the login/assumable set is
    already refused by the always-on `auditPostgresReachableRoutines` (`postgres-runtime.ts:1500-1542`, no vetted
    allowlist) — the DEC-A followup-14 work did not need to cover it because that audit does. So the identity table in
    `bugz-38`/`followup-14` ("attributes ∪ predefined-role membership ∪ dangerous direct GRANTs") has its third column
    covered by a DIFFERENT, existing control, not a hole.
  - Why record it: the three identity escalation axes are now enforced by TWO separate controls (posture allowlist +
    reachable-routines audit). SPEC §10.3 should state that the identity escalation surface = {attributes, predefined-
    role membership, direct definer-routine EXECUTE} and name which control owns each, so a future refactor that
    narrows the reachable-routines audit (e.g. adds a vetted allowlist) knows it is load-bearing for this axis. This is
    a documentation/coherence item, not a code fix.

- [ ] **P2 — The DEC-C positive credential classifier is name-lexical (final camelCase segment is a credential noun),
      so a credential column with a non-lexical name (`material`, `entropy`, `vaultRef`, `blob`) is not auto-classified
      even on the tables it does cover.** (LOW, framework/confidentiality-ceiling; `credential-nonlexical-name` V3-2;
      REFUTED — inherent ceiling of any name-based rule, covered by the enforced static bridge + author override)
  - Why REFUTED: no purely name-based classifier can catch a credential stored under a non-credential-sounding name;
    the enforced path is the static bridge (`apiKey.key`) + explicit author `secret:` annotation, and the positive rule
    is a best-effort DEFAULT-secret net for the common cases. Not a reachable framework-owned hole beyond B2's wiring.
  - Acceptance (optional hardening): document that a non-lexically-named credential column requires an explicit
    `secret:` annotation; the positive rule is a safety net, not a guarantee. (Pairs with `bugz-39` B2's wiring fix.)

- [ ] **P3 — The DEC-C positive rule can over-block a benign readable column whose final segment is a credential noun
      (`publicKey`, `zipCode`, `avatarSeed`, `passwordStrength`, `*Hash` used as a content digest).** (LOW,
      framework/over-block; `credential-rule-overblock` V3-3; REFUTED as harmful)
  - Why REFUTED as harmful: classifying a benign column `secret:` is FAIL-CLOSED (it blocks a wire projection that was
    readable) — an over-block is a DevEx annoyance, not a security defect, and the author can mark it readable. Given
    the technical-preview stronger-default bias, defaulting an ambiguous credential-noun column to secret is the correct
    trade. Recorded only so the B2 wiring fix keeps the noun lexicon conservative (segment-final match, as implemented)
    to bound the over-block, and offers an author escape (explicit non-secret annotation) for false positives like
    `publicKey`/`zipCode`.

## Note

Round 18's fail-opens (`bugz-39` B1–B3) are the substantive output; this ledger records the three findings that were
adversarially refuted as fail-opens but carry a real scoping/documentation or DevEx nuance worth a SPEC line or a bound
on the B2 fix. Throwaway probes under `/Users/mini/kovo-dogfood-round18-apps/`; `/Users/mini/kovo` untouched.
