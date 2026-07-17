# Security Classifier Refactors

`SPEC.md` §2 and `spec/06-type-system.md` §6.6 are normative. Security classifiers are
default-deny boundaries: a refactor must prove that it preserves every prior reject,
non-public, secret, or closed verdict unless the normative contract changes in the
same review.

## C13 Superset Rule

- [ ] Before replacing a crude classifier with a more precise parser, normalizer, or
      AST walk, commit a regression corpus for the old classifier's closed verdicts.
- [ ] The replacement must pass that corpus as a superset: every input that used to
      reject or classify non-public/secret must still do so unless `SPEC.md` is
      explicitly changed.
- [ ] The corpus must include the bug repro that motivated the refactor and the
      adjacent encoding or traversal variants that would have exposed the same subset
      mistake.
- [ ] The gate must run in `pnpm run check`; a local focused unit test is not enough
      for security-classifier refactors.
- [ ] If a classifier has no independent ground-truth oracle, keep a wiring and
      consistency corpus instead: every observed input site must invoke the same
      classifier and produce the same closed/open verdict for the same logical value.

In-scope classifiers for this rule:

- [ ] ReDoS pattern safety (`packages/server/src/redos.ts` and
      `packages/compiler/src/validate/redos-pattern.ts`).
- [ ] Outbound IP/egress classification (`packages/server/src/egress.ts`).
- [ ] Better Auth credential/secret classification
      (`packages/better-auth/src/internal.ts`).
- [ ] CSRF session/anonymous principal binding (`packages/server/src/csrf.ts`).
- [ ] Sink registry policy (`packages/core/src/internal/source-sink-registry.ts` and
      `packages/core/src/internal/sink-policy.ts`).
- [ ] Postgres identity and authorization posture.

The `check:security-classifier-corpus` gate records the current required corpus
anchors. Add to it when a new security classifier becomes release-significant.
