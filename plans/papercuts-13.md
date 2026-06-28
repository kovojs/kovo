# Papercuts 13

Created 2026-06-28. Source of truth remains `SPEC.md`; this ledger captures
dogfood findings after `plans/papercuts-12.md` and `plans/bugz-11.md` were
closed.

## Scope

Dogfooded linked local apps under `/Users/mini/kovo-dogfood-20260628`:
`baseline` and `ui-copy-regression`.

The baseline starter passed `pnpm run check`, `pnpm run test`, and a dev HTTP
smoke for `/` and `/login`. `plans/bugz-11.md` and `plans/papercuts-12.md`
remain fully checked off; this pass used them as regression targets.

## Issues

### A. Copied UI Workflow

- [x] **Copied `table.tsx` is not formatter-stable under the generated starter
      check gate.** (low, dev-tooling; found by `ui-copy-regression`)
  - Observed behavior: after copying the full UI catalog with `kovo add`,
    `pnpm run check` failed immediately in the formatter phase on
    `src/components/ui/table.tsx`.
  - Root cause: `packages/ui/src/table.tsx` formatted cleanly in package source,
    but the copy-in transform rewrote `props.children` to the generated
    composition-slot variable, shortening the `TableRow` call enough that the
    starter formatter wanted it collapsed to one line.
  - Why it matters: the normal copy-in workflow should not make a generated
    starter fail its own first `check` before the author edits anything.
  - Repro evidence: in
    `/Users/mini/kovo-dogfood-20260628/ui-copy-regression`,
    `pnpm exec kovo add ... table ... --out src/components/ui && pnpm run check`
    failed with `Formatting issues found src/components/ui/table.tsx`; `vp check
--fix src/components/ui/table.tsx` reduced the delta to the `TableRow`
    `tablePartWithChildren('tr', ...)` call.
  - Acceptance: copied `table.tsx` is formatter-, lint-, and type-clean after
    `kovo add`, and the copied catalog app passes its generated check.
  - Evidence: 2026-06-28
    `pnpm exec vitest run packages/cli/src/index.kovo-add.test.ts` passed with
    copied table `rowChildren` coverage; regenerating
    `/Users/mini/kovo-dogfood-20260628/ui-copy-regression/src/components/ui/table.tsx`
    via `pnpm exec kovo add table --out src/components/ui` then
    `pnpm exec vp check src/components/ui/table.tsx` passed; the full
    `ui-copy-regression` `pnpm run check` passed.

## Deferred Observations

Copied-catalog cold import/dev render remains slow, but this pass did not carry
it as a fix target. `src/catalog-dogfood.test.ts` in `ui-copy-regression`
passed, but took 43.63s total with 43.08s in transform/import; dev
`GET /catalog` returned no bytes before a 40s curl timeout. This is
performance-adjacent and intentionally deferred while `kovo check` performance
work is pending.

## Latest Verification

- `/Users/mini/kovo-dogfood-20260628/baseline`: `pnpm run check`,
  `pnpm run test`, and dev HTTP smoke for `/` and `/login` passed.
- `/Users/mini/kovo-dogfood-20260628/ui-copy-regression`: `pnpm run check`
  passed after regenerating copied `table.tsx` from the fixed source.
