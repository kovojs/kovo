# Bugz 5

Created 2026-06-27. Source of truth remains `SPEC.md`. This ledger captures a
security/soundness defect found while dogfooding advanced auth/access features
(see `plans/papercut-super-2.md` for the same run's non-security papercuts).
Escalated here per the dogfood rule: security/soundness holes belong in `bugz`,
not the papercuts ledger.

## Issues

- [x] **H1 — `kovo build` preflight never runs the KV414 (IDOR), KV438 (mass-assignment), KV433 (GET-write reachability), or KV429 (lost-update/TOCTOU) static security gates, so an IDOR/owner-scope-missing app builds and deploys green.**
  - Evidence: `pnpm exec vitest run packages/cli/src/index.kovo-build.test.ts --testNamePattern "Drizzle security extractors|fatal optimistic"` proves `kovo build` now feeds Drizzle owner/mass-assignment/query-write/TOCTOU facts into `kovo check` and fails before artifact emission with KV414/KV438/KV433/KV429.
  - Observed behavior: an owner-scoped query (a domain annotated `owner:`) whose
    ownership guard is removed — i.e. it loads any tenant's row by a client-supplied
    key — passes `kovo build` (the starter's `build:prod`/`serve` deploy path) with
    **exit 0 and zero KV414/KV438/KV433/KV429 findings**. The whole scaffold gate
    suite (`pnpm run check` = `vp check` + `check:sound-subset` +
    `check:endpoint-posture`, then `build:prod` = `kovo build`) never runs the
    owner/mass-assignment/GET-write/TOCTOU analyses.
  - Root cause: the build preflight builds its `KovoCheckInput` without the
    security extractors. `staticDrizzleBuildFacts`
    (`packages/cli/src/commands/build-export.ts:534-563`) calls only
    `analyzeSqlSafetyFromProject` / `extractQueryFactsFromProject` /
    `extractTouchGraphFromProject`, and `staticBuildCheckGraph` (:510-520) returns
    a graph with no `ownerDomains` / `scopeAudits` / `massAssignment`. It never
    calls `extractOwnerAuditFromProject` / `extractMassAssignmentFromProject` /
    `extractQueryWriteReachabilityFromProject` / `extractToctouFromProject` — which
    **exist** (`packages/drizzle/src/static.ts:1577`, re-exported :3490-3496) and
    **are** wired into `packages/cli/src/commands/compile.ts:1204-1265` (the
    `kovo compile drizzle-static` plumbing path). With those inputs empty,
    `unscopedAccesses` (`packages/cli/src/graph-output.ts:2253-2266`) returns `[]`,
    so KV414/KV438/KV433/KV429 can never fire in the build path. The round-1 commit
    `ea3a89921` ("Gate kovo build with typecheck and verifier") wired the
    KV436/KV402/KV310-class access/touch/coverage gates but left the security
    extractors unwired; `kovo check` consumes a pre-built `graph.json` (it does not
    extract from the project), and `kovo compile drizzle-static` is a low-level
    subcommand no app author runs — so **no app-author-facing command runs these
    gates over a real project.**
  - Why it matters: SPEC §10.3 declares KV414 a **blocking, runtime-verified**
    by-construction IDOR defense, and §5.2 #9 requires the build to match the full
    `kovo check` verifier. For "the most secure web framework," the flagship
    production build silently omits its own core security analyses — a cross-tenant
    read (IDOR), an attacker-chosen-column write (mass-assignment), a state-changing
    GET, or a lost-update can ship to production with a green build. This is a
    fail-OPEN soundness gap (the gates simply don't run), not a fail-closed
    false-positive.
  - Repro evidence (first-hand): `grep -c` for the four extractors in
    `packages/cli/src/commands/build-export.ts` = **0**; the same names appear at
    `compile.ts:1248-1265`. Empirically: copied the dogfood auth app, replaced
    `noteQuery`'s `guards.all(appAuthed, guards.owns(...))` with bare
    `guard: appAuthed` (loads `notes` by client-supplied `args.id`, no owner check),
    ran `kovo build ./src/app.tsx` → **EXIT 0, zero KV414/KV438/KV433/KV429**, node
    preset emitted. The verifier independently fed a hand-built graph
    (`ownerDomains:[{domain:note}]`, `scopeAudits:[{domain:note,kind:query,scope:args,key:arg:id}]`)
    to `kovo check` → `ERROR KV414 QUERY note ... Owner-table access is not scoped
to the session principal (IDOR)`, proving the gate works when fed the facts the
    build never produces.
  - Acceptance: have `kovo build`'s preflight run
    `extractOwnerAuditFromProject` / `extractMassAssignmentFromProject` /
    `extractQueryWriteReachabilityFromProject` / `extractToctouFromProject` over the
    project (mirroring `compile.ts`) and populate `ownerDomains`/`scopeAudits`/
    `massAssignment`/GET-write/TOCTOU facts into the graph it checks. Add a
    create-kovo / CLI test that an IDOR app (owner domain + client-keyed query with
    no `owns` guard) **fails** `kovo build` with KV414, and that the starter's
    `pnpm run check` suite (not just `kovo build`) exercises the owner/mass-assignment
    gates. Confirm KV438/KV433/KV429 analogously.

## Refuted / Not Carried Forward

- The dogfood auth app's _correct_ code (with `guards.owns`) is sound — KV414 is
  discharged by the guard; the defect is that an _incorrect_ app is not caught.
- Not a duplicate: `plans/capability-gaps.md` item #1 targets the old `vp build`/
  example plugin and predates this verifier; `bugz`/`bugz-2/3/4` items fix bugs
  _inside_ the extractors, not their absence from the build preflight.

## Latest Verification

- `pnpm exec vitest run packages/cli/src/index.kovo-build.test.ts --testNamePattern "Drizzle security extractors|fatal optimistic"` → passes, covering the fixed production-build preflight graph.
- `pnpm exec vitest run packages/drizzle/src/index.write-callbacks-carriers.test.ts --testNamePattern "string-keyed domain"` → passes, covering the adjacent `domain('x')` false-positive fix used by webhook/domain builds.
