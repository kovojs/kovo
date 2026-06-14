# v1 Cleanup Plan

Status: closing 2026-06-14 — all six cleanup items implemented and verified on `main`; final
`pnpm run acceptance` pending (see Closeout). Created 2026-06-13; scope decisions locked 2026-06-13.

`SPEC.md` remains the source of truth for framework behavior. This file is the standalone ledger for
cleanup discovered during final v1 verification; all six items are now complete.

## Scope Decisions (locked 2026-06-13)

- Disposition: **release-blocking**. Every item is closed with cited evidence.
- Item 1 (test seams): **all oversized test files** are in scope, not only the originally named two.
- Item 2 (axe): **expand axe coverage broadly** across every claimed primitive family/state tier, and
  record the surviving accessibility claim normatively.
- Items 3 and 4: **full removal preferred** for duplicated parser/apply logic and Drizzle source-mode
  paths, accepting the added test churn rather than stopping at fail-closed shims.

## Archived Context

- `IMPLEMENT_v1.md`, `plans/codebase-quality-round2.md`, and `plans/ui.md` are archived v1 ledgers
  (registry in `plans/archive.md`). Their broad qualitative cleanup claims seeded the items below.
- Deferred work outside this plan: `plans/better-docs.md` and `plans/react-interop.md`.

## Cleanup Checklist

- [x] Split oversized test seams into focused executable surfaces.
  - 10 oversized files split into per-concern siblings + co-located non-test helper modules, with
    `it()` counts preserved verbatim per file: drizzle index 228→13 (cfc39802), drizzle-pin 160→8
    (0aae6b63), gallery browser 40→5 (55c6f7be), better-auth-pin 38→6 (5b12fcf7), better-auth 57→5
    (15eb4d76), cli 90→6 (7fefe2da), ui 24→4 (307cfc8b), commerce 28→5 (8f1a3c71), server 66→10
    (bbd0b0f7), gallery node 48→9 (bce49344); import cleanup (298f3ae2).
  - Kept whole with documented reasons: `tests/fw-check.node.mjs` (node:test acceptance harness),
    `packages/test/src/package-exports.test.ts` (single full-surface public-API manifest), and
    `packages/runtime/src/inline-loader-parser-parity.test.ts` (cohesive parity surface) — ccf450d2,
    0978153a. The fw-check drizzle test path was globbed to the split files (0978153a).
  - Proof: `vp check --no-fmt` reports 0 errors / 0 warnings; per-package vitest totals unchanged.
- [x] Expand UI axe coverage to match the strongest accessibility claim (commit 67e5d644).
  - axe now runs on every claimed interactive end-state (open/expanded, checked/indeterminate,
    pressed, value end-states, error) plus a static-styled-fixtures block; `expectNoAxeViolations`
    call sites rose 26→43. The fabricated "SPEC §13.1 G3" citations now point to the real normative
    SPEC §12.1 (commit 7a946fa3); the claim is also documented in
    `site/content/guides/accessibility.md`. Native top-layer descent verified empirically.
- [x] Reduce runtime parser/apply duplication (commit 0be49bae).
  - Both mutation-response body readers delegate to one shared `readMutationResponseBodyCore`; the
    inline reader stays a thin wrapper so its AST-extracted closure regenerates within the 4 KB gzip
    budget (3111 ≤ 4096). The intentional inline-defers-JSON round-trip is kept and documented (SPEC
    §4.4) since it is required by the budget, not duplication. Proof: `check:inline-loader` passes;
    parity/scanner/parser tests 53→56; runtime suite 309 green; malformed-reporting order preserved.
- [x] Remove Drizzle source-mode dependency; require project-mode extraction (commit 93901580).
  - Deleted the source-mode fact pipeline (`extractTouchGraphFromSource`, `extractQueryFactsFromSource`,
    the source function/table chains, `isLikelyDrizzleReceiver`, the source receiver/fact extractors);
    `static.ts` 9391→8577. Kept the unconditional fail-closed FW406 destructured-receiver path and the
    shared parser infra. Positive source-fact tests migrated to typed `PgDatabase`/`pgDatabaseTypes`
    receivers; deleted-as-duplicate tests each cite a named project twin (cross-walk verified no silent
    Postgres coverage loss). Proof: conformance drizzle-pin 160 passed (real drizzle-orm 0.45.2 via
    project mode); drizzle package+surface 229; `vp check` 0 errors / 769 files.
- [x] Remove source-string decision-making from compiler post-parse phases (commit 7b4f2acc).
  - Replaced the named-vs-anonymous handler regex (`lower/handlers.ts`, `emit/client.ts`), the raw
    call-argument trimming/`=== 'state'` element-param extraction, the FW211 `comment.text.includes`
    scan, and `/request$/i` with typed parser facts (`expressionIsBareIdentifier`, `callArgumentKinds`,
    `JsxCommentModel.justifiedDiagnostics`, a typed request predicate) threaded to emit via
    `HandlerLowering.isBareNamedHandler`. Added an AST guard `postParseSourceStringProjectFact` over
    `lower/validate/analyze/emit/**` + `graph.ts`, asserted in fw-check with a passing negative-control.
    Rule recorded as SPEC §5.2 rule 8 (commit e1a130fe). Proof: compiler suite 217; fw-check 50.
- [x] Replace stale references to archived v1 ledgers (folded into commit 93901580).
  - Removed the one live stale work-pointer — the `IMPLEMENT_v1` citation in `static.ts`
    `isDrizzleReceiver` now reads `SPEC §11.1 (v1 scope)` (`rg IMPLEMENT_v1 packages/drizzle/src/static.ts`
    returns 0). Remaining ledger-name matches are intentionally-preserved history (the `plans/archive.md`
    registry, this file's Archived Context, and `plans/app-shell.md` RoundNNN transcripts).

## Verification Rules

- [x] Wording-only cleanup: `git diff --check` clean; repo formatter applied.
- [x] Code changes: focused package tests + `vp check --no-fmt` → 0 errors / 0 warnings across 838 files.
- [ ] Before closing this plan, rerun `pnpm run acceptance` (pending — see Closeout).

## Closeout

- Each item was implemented in an isolated git worktree and re-verified on `main` before integration.
- Items surfaced during final verification that are **not** v1-cleanup work (pre-existing on `main`):
  - Markdown formatting drift in `README.md`, `SPEC.md`, and `plans/*` from earlier un-formatted
    commits, normalized via `vp check --fix` to unblock the acceptance formatting gate.
  - `examples/gallery/src/interactive-gallery.visual.browser.test.ts` shows environment-dependent
    screenshot-hash variance (the recorded allow-list lacks this dev machine's render). It is flaky,
    not a split regression — the gallery browser suite was 40/40 at split time on the same machine.
