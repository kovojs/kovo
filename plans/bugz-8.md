# Bugz 8

Created 2026-06-28. Source of truth remains `SPEC.md`; this ledger captures
security/soundness defects found during exhaustive Kovo dogfooding after the
`plans/papercuts-6.md` fixes.

## Scope

Dogfooded a linked SQLite app at `/Users/mini/kovo-dogfood-20260628c/drizzle-depth`
against current local `main`. The app exercised owner-scoped Drizzle domains,
advanced query shapes, governed writes, computed keys, CAS, and deliberate unsafe
mutation probes.

## Issues

### A. Drizzle Static Security Gates

- [ ] **Write-side KV414 misses owner-table writes keyed by destructured mutation input.** (high, security/soundness; found by `drizzle-depth`)
  - Observed behavior: `unsafeSpendBudget` updates owner-annotated `projects` by
    destructured client `projectId` with no owner predicate, but `kovo build` emits
    no WRITE KV414 for `src/mutations.ts:147-150`.
  - Root cause direction: `packages/drizzle/src/static/summaries.ts:3112-3145`
    reuses query instance-key operand recovery for write predicates, while
    `packages/drizzle/src/static/summaries.ts:2292-2319` recognizes input paths
    rooted at literal `input` / local input aliases; destructured mutation params
    like `{ projectId }` are not treated as client input in write instance-key
    comparisons.
  - Why it matters: SPEC §10.3 / §11.1 require owner-table writes keyed by client
    input to fail closed with KV414 unless the session owner predicate is proven.
  - Repro evidence: in `/Users/mini/kovo-dogfood-20260628c/drizzle-depth`,
    `pnpm run check` exits 1 with deliberate KV406/KV410/KV414 query/KV438
    diagnostics, but no WRITE KV414 for `unsafeSpendBudget`; the unsafe handler
    destructures `projectId` and writes `.where(eq(projects.id, projectId))`.
  - Acceptance: write-side owner-scope analysis treats destructured mutation input
    bindings as client-controlled instance keys and emits KV414 for owner-table
    writes lacking a proven session owner predicate.

- [ ] **KV429 misses read-then-absolute-write lost updates on atomic columns.** (high, security/soundness; found by `drizzle-depth`)
  - Observed behavior: `unsafeSpendBudget` reads `projects.budgetCents`, computes
    `nextBudget`, then writes `budgetCents` without version/CAS, but `kovo build`
    emits no KV429.
  - Root cause direction: `packages/drizzle/src/static/derivation.ts:1772-1798`
    flags atomic writes when `effect.sets[column]` syntactically reads the same
    column, and `packages/drizzle/src/static/derivation.ts:1802-1808` checks
    self-reference inside the SET expression only. A prior SELECT feeding a later
    absolute variable write is invisible.
  - Why it matters: SPEC §10.3 KV429 requires unsafe read-modify-write shapes on
    atomic/versioned columns to fail closed; otherwise concurrent mutations can
    lose updates.
  - Repro evidence: in `/Users/mini/kovo-dogfood-20260628c/drizzle-depth`,
    `src/mutations.ts:136-150` contains the read/compute/write pattern and
    `pnpm run check` emits no KV429; the same app's CAS test proves
    `compareAndSet` returns a stale-version conflict on the safe path.
  - Acceptance: static derivation/lost-update analysis recognizes read-then
    absolute-write flows into atomic columns and emits KV429 unless a CAS/version
    guard or allowed atomic update pattern is proven.

## Refuted / Not Carried Forward

- Session-scoped RQB owner reads: adding a `kovoAnalyzerSummary` for the session
  principal removed KV414 as expected.
- Computed-key mass assignment: KV438 fires for `.set({ [input.field]: input.value })`.
- SQLite CAS runtime: `compareAndSet` succeeds once and reports a stale conflict
  on a stale version.

## Latest Verification

- In `/Users/mini/kovo-dogfood-20260628c/drizzle-depth`, `pnpm exec tsc --noEmit`,
  `node scripts/check-sound-subset.mjs`, and `pnpm run test` passed.
- In `/Users/mini/kovo-dogfood-20260628c/drizzle-depth`, `pnpm run check` exits 1
  with expected deliberate diagnostics but no WRITE KV414 for `unsafeSpendBudget`
  and no KV429 for its read-then-absolute-write pattern.
