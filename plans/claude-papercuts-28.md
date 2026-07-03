# Round-9 Papercuts 28

Created 2026-07-02. Source of truth remains `SPEC.md`. Over-block + classification-soundness items from the round-9
paranoid dogfood AFTER `plans/fundamental-fixes-followup-4.md`. Security fail-opens are in `plans/claude-bugz-30.md`.

**Meta-theme — the registry (DEC-D) is the new enumerate-and-classify surface, and it has no invariant that a
value/effect property must be `runtime-choke`.** That missing invariant is the ROOT of `bugz-30` B1/B2 (authorization,
projection, invalidation mis-classified `build-only`) and B4 (`by-construction` asserted, not proven). And the round-8
provenance box still fails the _other_ way — over-boxing legit aggregates (P1 below), the dual of `bugz-30` B3.

## Issues

- [ ] **P1 — The SQLite provenance box OVER-boxes: `count/sum/avg` and most SQL functions over a NON-secret table are mislabeled `Secret`, 500-ing legitimate aggregate/computed queries under `KOVO_PARANOID=1`.** (MED, over-block, architectural; reproduced, paranoid-confirmed)
  - Observed: a legitimate query `select count(*) as n from contacts` (or `sum`/`avg`/most scalar functions) over a table with NO secret column is refused at wire egress → HTTP 500, because the box treats the opaque expression result as `Secret`.
  - Root cause: `packages/server/src/secret-read-boundary.ts:244-245` — `if (referencesSecretTable || expressionSafety.get(key) === 'opaque') { opaqueResultKeys.add(key); }`. The `|| expressionSafety === 'opaque'` branch boxes an opaque expression result **regardless of whether any secret table is referenced**. `classifySqlExpression → sqlChunkIsSafe → sqlStringChunkIsInert` treats `count(*)`/`sum(x)`/most functions as un-whitelisted → opaque → boxed even over `contacts` (no secret column).
  - Why it matters: the same mechanism under-boxes UNION secrets (`bugz-30` B3) and over-boxes plain aggregates — the classic incomplete-classifier failing both ways, on the very fix that was supposed to make confidentiality sound. Aggregates are ubiquitous; this breaks ordinary read loaders.
  - Acceptance: an opaque expression is boxed only when it could derive from a secret column (references a secret-bearing table AND the expression's inputs are not proven non-secret); a `count(*)`/`sum(nonSecret)` over a non-secret table serves. Pairs with `bugz-30` B3 (fail-closed on compound selects) — box exactly the secret-derived values, no more, no less.

- [ ] **P2 — The registry has no invariant that a value/effect property MUST be `runtime-choke` (never `build-only`); the drift guard only checks "every code has an entry," so a mis-classified value property is invisible.** (HIGH-impact / architectural honesty; root of `bugz-30` B1/B2/B4)
  - Observed: authorization (KV414), projection-to-wire (KV439), invalidation (KV407/KV408), output-coverage (KV410) are `build-only` — all value/coverage properties that the plan's own §2.1 taxonomy says must be runtime-enforced. Nothing in the registry tests catches this: DEC-D's drift guard asserts "every emitted code ∈ registry" and "every `runtime-choke` names a live choke," but NOT "every value/effect property is `runtime-choke`."
  - Root cause: `security-markers.ts` classification is hand-assigned with no property-type→enforcement soundness check. The `build-only` bucket is treated as legitimate for any code, but for a value/effect property `build-only` means "static-only," which the whole re-architecture proved unsound.
  - Why it matters: the registry made the incompleteness look like an intentional decision rather than a bug — the enumerate-and-allow pattern moved up one level into the classification itself. This is why `bugz-30` B1 (IDOR) shipped as an accepted `[x]`.
  - Acceptance: add a registry invariant + test — every code whose `property` is a value/effect authorization/confidentiality/integrity/injection property MUST be `runtime-choke` (or `by-construction` with a _proven_ runtime floor); `build-only` is permitted only for genuinely author-time/build-shape properties (e.g. "server-only value captured into the client bundle" KV437, a compile-time bundling fact). Re-audit every current `build-only` code against this and reclassify IDOR/projection/invalidation.

## Refuted / Not Carried Forward

- **PG definer-view / `SECURITY DEFINER` bypass — refuted** (REVOKE + `security_invoker` held).
- **Egress-choke object-recursion / coercion gaps — refuted** (non-coercible box held; the reported issue was a stale-`dist` harness artifact).
- **reveal-audit ledger note — refuted** as a served leak (a hygiene observation, not exploitable).
- **`FOR UPDATE` on a reader — refuted/LOW.**
- **Dev/prod parity + core-flow regression — none observed this round** beyond the over-block P1.

## Latest Verification

- P1 self-verified in source (`secret-read-boundary.ts:244-245` opaque-branch boxes regardless of secret-table
  reference); reproduced as a 500 on `count(*)` under paranoid. P2 is the classification root of `bugz-30`
  B1/B2/B4 (`security-markers.ts` `build-only` for value properties; no property-type→enforcement invariant).
- Throwaway apps under `/Users/mini/kovo-dogfood-round9/` — safe to delete. No framework source or `SPEC.md` changed.
