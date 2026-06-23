# Defer JSX Primitive

**Goal:** replace raw-string `defer({...})` JSX child usage with a JSX-native public
`<Defer>` primitive. App TSX authors fallback and region content as normal server renderables; the
framework owns the emitted `<kovo-defer>` placeholder. `defer()` remains only as an internal lowering
helper.

## Current Status

- [x] Runtime lowering uses a shared helper for public `Defer` and internal `defer()`.
  - Evidence: [packages/server/src/deferred-region.ts](/Users/mini/kovo-agent-defer-jsx/packages/server/src/deferred-region.ts)
    defines `Defer`, `lowerDeferredRegion`, and the `@internal` `defer()` helper; `pnpm exec vitest
--run --dir packages/server/src deferred-region.test.ts jsx-runtime.test.ts` passed.
- [x] `Defer` renders fallback and region output through normal server JSX/text escaping.
  - Evidence: [packages/server/src/renderable.ts](/Users/mini/kovo-agent-defer-jsx/packages/server/src/renderable.ts)
    centralizes server renderable rendering; `packages/server/src/deferred-region.test.ts` covers
    escaped text fallback, JSX fallback, trusted raw fallback, rendered JSX chunks, and escaped bare
    string chunk output.
- [x] Deferred `after-paint` and `visible` regions emit branded framework-owned placeholders and
      collect fragment chunks with `stylesheets`.
  - Evidence: `pnpm exec vitest --run --dir packages/server/src deferred-region.test.ts
jsx-runtime.test.ts` passed for placeholder, target escaping, chunk priority, chunk HTML, and
    stylesheet assertions.
- [x] `critical`, omitted priority, and no collector context render immediately without deferred
      chunks.
  - Evidence: `packages/server/src/deferred-region.test.ts` covers all three immediate-render paths.
- [x] Public API exposes `Defer`, `DeferProps`, and `ServerRenderable`, and no longer exposes
      app-facing `defer()`.
  - Evidence: [packages/server/src/api/rendering.ts](/Users/mini/kovo-agent-defer-jsx/packages/server/src/api/rendering.ts)
    and [packages/server/src/index.ts](/Users/mini/kovo-agent-defer-jsx/packages/server/src/index.ts)
    export the public primitive/types; `pnpm exec vitest --run --dir packages/server/src/api
app.test.ts` passed; `pnpm run check:api-surface` passed.
- [x] `SPEC.md` documents `<Defer>` as the public deferred-region API and reserves `defer()` for
      internal lowering.
  - Evidence: [SPEC.md](/Users/mini/kovo-agent-defer-jsx/SPEC.md) §8 names `Defer`, framework-owned
    `<kovo-defer>` output, and `KV244` for direct `{defer(...)}` JSX children.
- [x] Static validation reports `KV244` for direct `{defer(...)}` JSX children and accepts
      `<Defer />`.
  - Evidence: [packages/compiler/src/validate/defer-jsx.ts](/Users/mini/kovo-agent-defer-jsx/packages/compiler/src/validate/defer-jsx.ts)
    is registered in the compiler validation pipeline; `pnpm exec vitest --run --dir
packages/compiler/src diagnostic-coverage-matrix.test.ts compile-component.test.ts
route-pages.test.ts` passed.
- [x] Diagnostics schema and coverage include `KV244`.
  - Evidence: [packages/core/src/diagnostics.ts](/Users/mini/kovo-agent-defer-jsx/packages/core/src/diagnostics.ts)
    defines `KV244`; `pnpm exec vitest --run --dir packages/core/src diagnostics.test.ts` passed.
- [x] Stack Overflow example call sites use `<Defer>` and no longer wrap framework placeholders in
      `trustedHtml(defer(...))`.
  - Evidence: [examples/stackoverflow/src/components/question-detail.tsx](/Users/mini/kovo-agent-defer-jsx/examples/stackoverflow/src/components/question-detail.tsx)
    and [examples/stackoverflow/src/components/right-rail.tsx](/Users/mini/kovo-agent-defer-jsx/examples/stackoverflow/src/components/right-rail.tsx)
    were migrated; `pnpm exec vitest --run --dir examples/stackoverflow/src interactive-app.test.ts`
    passed after regenerating example graph files.
- [x] Browser-visible stream apply and server after-paint/visible stream assembly still pass.
  - Evidence: `pnpm exec vitest --run --config vitest.browser.config.ts
packages/browser/src/apply-deferred-stream.browser.test.ts` passed; `pnpm exec vitest --run --dir
packages/server/src deferred-stream.test.ts app-document.test.ts` passed.

## Closed Decisions

- [x] `fallback` is a renderable value, not a function.
  - Evidence: `DeferProps.fallback` is typed as `ServerRenderable`; no lazy fallback function is
    exported.
- [x] Keep internal `defer()` during the cutover, but remove it from public app-facing exports.
  - Evidence: `defer()` is still available through internal server modules for framework callers;
    `packages/server/src/api/app.test.ts` asserts it is not exported from the public surface.

## Latest Verification

- [x] Focused compiler, core, server, browser, and Stack Overflow example tests passed in this
      implementation worktree.
  - Evidence: commands listed under the completed items above.
- [x] Touched-file static check passed after the final public signature change.
  - Evidence: `pnpm exec vp check --no-fmt ...` over the touched implementation, test, example,
    spec, and plan files passed.
