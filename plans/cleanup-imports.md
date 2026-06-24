# Cleanup Import Boundary Exceptions

## Goal

Remove the remaining app-facing import-boundary exceptions. Delete hand-authored verifier graph
fixtures from examples, replace app-authored internal runtime usage with public APIs or real compiled
artifacts, and keep real behavior tests that exercise auth, request-shell, route, mutation, static
export, and docs-site build behavior.

## Scope

- Targeted exceptions:
  - `examples/crm/src/graph.ts -> @kovojs/core/internal/graph`
  - `examples/stackoverflow/src/graph.ts -> @kovojs/core/internal/graph`
  - `examples/reference/src/app.ts -> @kovojs/core/internal/graph`
  - `examples/stackoverflow/src/interactive-app.tsx -> @kovojs/server/internal/wire`
  - `site/scripts/capture.mjs -> @kovojs/browser/internal/inline-loader`
  - `site/scripts/export-static.mjs -> @kovojs/compiler/package-styles`
  - `site/content/guides/streaming.md -> @kovojs/browser/generated`
- Do not add public graph types or make compiler-emitted ABI subpaths app-authored public APIs just
  to preserve examples.
- Do not replace deleted checks with new hand-authored verifier graph fixtures.

## Checklist

- [x] Remove the CRM verifier graph fixture.
  - Evidence: `examples/crm/src/graph.ts` and `examples/crm/src/graph.test.ts` are deleted;
    `examples/crm/src/index.ts` no longer exports graph helpers; `pnpm exec vitest run
examples/crm/src/interactive-app.test.ts` passed as part of the combined CRM/StackOverflow run.

- [x] Remove the StackOverflow verifier graph fixture.
  - Evidence: `examples/stackoverflow/src/graph.ts` and
    `examples/stackoverflow/src/kovo-graph.test.ts` are deleted; `examples/stackoverflow/src/app.ts`
    no longer exports graph helpers; `pnpm exec vitest run
examples/stackoverflow/src/interactive-app.test.ts` passed as part of the combined
    CRM/StackOverflow run.

- [x] Keep the reference app but remove its hand-authored graph audit fixture.
  - Evidence: `examples/reference/src/app.ts` no longer exports `referenceGraph`;
    `examples/reference/src/app.test.ts` no longer contains the graph audit block; `pnpm exec vitest
run examples/reference/src/app.test.ts examples/reference/src/app-shell.test.ts` passed.

- [x] Resolve the StackOverflow source live-target renderer exception.
  - Evidence: `examples/stackoverflow/src/interactive-app.tsx` no longer imports
    `@kovojs/server/internal/wire`; StackOverflow components run through `exampleKovoCompilerPlugin`;
    `examples/drizzle-registry-runtime.ts` derives query-read and mutation-touch facts from the
    source tree and registers them through Vite virtual-module loading without committed artifacts.
  - Evidence: `pnpm exec vitest run examples/stackoverflow/src/interactive-app.test.ts
examples/crm/src/interactive-app.test.ts` passed.

- [x] Resolve the docs capture inline-loader exception.
  - Evidence: `site/scripts/capture.mjs` no longer imports
    `@kovojs/browser/internal/inline-loader`; it renders a tiny public Kovo document through Vite SSR
    and measures the inline loader script emitted in that document.
  - Evidence: `pnpm --filter @kovojs/site run build` passed.

- [x] Resolve the site package-CSS extraction exception.
  - Evidence: `packages/compiler/src/index.ts` exports `extractAppComponentCss`; `site/scripts/export-static.mjs`
    imports it from public `@kovojs/compiler`; `pnpm --filter @kovojs/site run build` passed.

- [x] Resolve the streaming-guide generated-runtime docs exception.
  - Evidence: `site/content/guides/streaming.md` no longer imports
    `@kovojs/browser/generated`; `node scripts/import-boundary.mjs` passed.

- [x] Remove the now-obsolete import-boundary exceptions.
  - Evidence: `scripts/import-boundary.mjs` has empty exception sets; `pnpm exec vitest run
scripts/import-boundary.test.mjs` passed and still covers stale-entry failure.

- [x] Verify the cleanup.
  - Evidence: `node scripts/import-boundary.mjs` passed.
  - Evidence: `pnpm exec vitest run scripts/import-boundary.test.mjs` passed.
  - Evidence: `pnpm exec vitest run examples/stackoverflow/src/interactive-app.test.ts
examples/crm/src/interactive-app.test.ts` passed.
  - Evidence: `pnpm exec vitest run examples/reference/src/app.test.ts
examples/reference/src/app-shell.test.ts` passed.
  - Evidence: `pnpm --filter @kovojs/site run build` passed.
  - Evidence: `node scripts/no-committed-generated.mjs` passed.
  - Evidence: `pnpm exec tsc -p examples/stackoverflow/tsconfig.json --noEmit` and `pnpm exec tsc
-p examples/crm/tsconfig.json --noEmit` passed.
  - Evidence: `git diff --check` passed.

## Notes

The reference app's purpose is Better Auth and request-shell integration coverage: session mapping,
credential sign-in, sign-out, CSRF, guards, no-JS form behavior, Vite middleware, shared Node handler,
and static-export boundaries. Its hand-authored `referenceGraph` object was verifier-fixture coverage,
not core reference-app behavior, so it was removed rather than migrated.

Root `pnpm exec tsc -p tsconfig.json --noEmit` remains blocked by unrelated existing test typing
failures in conformance/server/test files; it no longer reports errors for the new example registry
helper.
