# Papercuts 13

Created 2026-06-28. Source of truth remains `SPEC.md`; this ledger captures
dogfood findings after `plans/papercuts-12.md` and `plans/bugz-11.md` were
closed.

## Scope

Dogfooded linked local apps under `/Users/mini/kovo-dogfood-20260628`:
`baseline`, `ui-copy-regression`, and `query-stream-regression`.

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

### B. Query / Streaming Export

- [x] **CLI `kovo export` reports generic replay 500 for Vite-loaded component
      query routes.** (low, dev-tooling; regression of `plans/papercuts-12.md`;
      found by `query-stream-regression`)
  - Observed behavior:
    `/Users/mini/kovo-dogfood-20260628/query-stream-regression`
    `pnpm exec kovo export ./src/app.tsx --skip-non-exportable --out
dist-export-selfcheck` reported only `KV229 static export can only write
successful HTML route documents; '/' returned status 500`, while direct
    in-process replay of the same app produced the concrete deferred/streamed
    marker diagnostic.
  - Root cause: `packages/cli/src/commands/build-export.ts:1662-1689` loaded
    TSX app modules through Vite but called `exportStaticApp` from the CLI's
    Node-resolved `@kovojs/server` module. The app's JSX runtime and the
    exporter's `runWithJsxRequestContext` therefore used different module
    instances; component query loading reached
    `packages/server/src/jsx-runtime.ts:633-635` with no request context and the
    route collapsed to a generic 500 document before static-export diagnostics
    could see the deferred/mutation markers.
  - Why it matters: TSX apps are the normal starter shape. Export diagnostics
    need to explain non-exportable dynamic content, not hide it behind a server
    error that looks like a framework crash.
  - Repro evidence: the query/stream dogfood app's CLI export command above
    emitted the generic route 500 before the fix; a temporary Vite-load debug
    test captured `Route JSX component
components/contacts/query-stream-export-region requires request context`.
  - Acceptance: Vite-loaded CLI export uses the same `@kovojs/server` module
    graph as the app module, component-local queries have request context during
    replay, and the query/stream route reports the concrete deferred/streamed
    KV229 diagnostic.
  - Evidence: 2026-06-28
    `pnpm exec vitest run packages/cli/src/index.kovo-export.test.ts` passed
    with a TSX component-query export regression; rerunning
    `/Users/mini/kovo-dogfood-20260628/query-stream-regression`
    `pnpm exec kovo export ./src/app.tsx --skip-non-exportable --out
dist-export-selfcheck` reported `replayed HTML contains deferred, streamed,
or fragment route markers`; `pnpm run check` and `pnpm run test` passed in
    the same dogfood app.

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
- `/Users/mini/kovo-dogfood-20260628/query-stream-regression`: `pnpm run check`,
  `pnpm run test`, and `pnpm exec kovo export ./src/app.tsx
--skip-non-exportable --out dist-export-selfcheck` passed with concrete KV229
  diagnostics for non-exportable dynamic route content.
