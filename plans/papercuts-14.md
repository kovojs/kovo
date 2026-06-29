# Papercuts 14

Created 2026-06-29. Source of truth remains `SPEC.md`; this ledger captures
dogfood findings after `plans/papercuts-13.md` and `plans/bugz-11.md`.

## Scope

Dogfooded linked local apps under
`/Users/mini/kovo-dogfood-20260629-exhaustive`: `base-pristine`,
`live-optimistic-cache`, `auth-access-shells`, `endpoints-files-export`,
`dynamic-routes-hmr`, and `ui-headless-style-a11y`.

The baseline starter passed `pnpm run check`, `pnpm run test`,
`pnpm run build:prod`, and a dev HTTP smoke. The security/soundness finding
from this pass is filed in `plans/bugz-12.md`.

## Issues

### A. Production Build Parity

- [ ] **Production build transforms lowered component TSX to a classic
      `createElement` import from `@kovojs/server`.** (high, framework
      dev-tooling; found by `live-optimistic-cache`)
  - Observed behavior: a query-backed component app passed `vp check`, tests,
    and dev smoke, but `pnpm run build:prod` failed during `kovo build` with
    `[MISSING_EXPORT] "createElement" is not exported by
    "../../kovo/packages/server/src/index.ts"` at `src/components/contacts.tsx`.
  - Root cause: `packages/compiler/src/lower/structural-jsx.ts:205-221` inserts
    `escapeText` helper imports at the offset from
    `packages/compiler/src/lower/structural-jsx.ts:1975-1977`, which accounts
    only for the leading `@jsxImportSource` pragma. In the dogfood component the
    helper import was inserted between `@jsxImportSource @kovojs/server` and
    `@jsxRuntime automatic`, so the later Vite JSX transform missed the
    automatic-runtime directive and emitted a classic `createElement` import from
    the `@kovojs/server` barrel. `packages/compiler/src/vite.ts:423-426` returns
    that lowered server source to Vite; `packages/server/src/index.ts` does not
    export `createElement`, while `packages/server/src/jsx-runtime.ts:116-213`
    exposes the automatic JSX ABI.
  - Why it matters: SPEC §9.5 / §11.1 require deploy/build parity for valid
    TSX apps. A normal component using keyed rows, mutation forms, and
    query-backed regions can work in dev/test but fail to produce a deployable
    build.
  - Repro evidence:
    `/Users/mini/kovo-dogfood-20260629-exhaustive/live-optimistic-cache`
    `rm -rf .kovo/cache && pnpm run build:prod` exited 1 with the
    `createElement` missing export. The independent verifier also inspected the
    compiler cache and confirmed the lowered source displaced `@jsxRuntime
    automatic` after an import.
  - Acceptance: compiler helper import insertion preserves all leading JSX
    pragmas before imports, and `live-optimistic-cache` `pnpm run build:prod`
    succeeds after clearing `.kovo/cache`; focused compiler coverage proves
    files with both `@jsxImportSource` and `@jsxRuntime automatic` remain on the
    automatic JSX runtime.

### B. Error Shell Contract

- [x] **Route guard 403 responses ignore JSX/string `errorShells.forbidden`
      renderers.** (med, framework runtime contract; found by
      `auth-access-shells`)
  - Observed behavior: the app configured `createApp({ errorShells: {
    forbidden } })`, where the forbidden shell renders `Access denied`, and
    `/admin` used `guards.all(appAuthed, guards.role('admin'))`. A signed-in
    non-admin request returned status 403, but the body was the framework
    fallback `<h1>Forbidden</h1><p>Forbidden</p>`.
  - Root cause: `packages/server/src/app-document.ts:109-116` wires route guard
    forbidden rendering through `renderAppErrorDocumentResponse(...)`, and
    `packages/server/src/app-document.ts:319-322` invokes the configured shell.
    `packages/server/src/app-document.ts:345-363` then assumes the shell return
    is a `RoutePageResponse` object and reads `response.body` /
    `response.headers`; `packages/server/src/app-document.ts:390-395` calls
    `Object.entries(headers)`, so a JSX/string shell with no `headers` throws.
    The catch reports an `error-shell` failure and falls back to the generic
    document from `packages/server/src/document-core.ts:601-605`.
  - Why it matters: SPEC §6.5 / §9.5 say authenticated-but-unauthorized
    failures render the app's 403 shell. Apps lose branded/no-internals UX for a
    common guard-denial path even though the status remains fail-closed.
  - Repro evidence:
    `/Users/mini/kovo-dogfood-20260629-exhaustive/auth-access-shells`
    `pnpm run test` failed exactly one assertion: the 403 body for `/admin`
    contained generic `Forbidden` markup instead of `Access denied`; the other
    eight auth/access tests passed.
  - Acceptance: configured error shells may return ordinary JSX/string bodies
    or full route response objects; route guard 403 denials render the app's
    forbidden shell with the normal document security/header floor. Add focused
    coverage for the JSX/string shell shape.
  - Evidence: `pnpm exec vitest run packages/server/src/app-document.test.ts --reporter=dot`
    passed on 2026-06-29; it proves route guard 403 denials render a configured
    plain forbidden shell body through the normal document path.

## Refuted / Covered Tracks

- `dynamic-routes-hmr` found no carry-forward issue: typed-read responses were
  not HMR-prefixed, reversible HMR edits updated and reverted correctly, and no
  duplicate live-renderer artifacts were found.
- `ui-headless-style-a11y` found no carry-forward issue: copied UI components,
  headless state attributes, mixed checkboxes, icons, and style provenance
  rendered and passed generated checks.
- Auth capability URLs, no-JS CSRF posts with exact form cookies, per-IP
  mutation rate limiting, and pre-dispatch body-size floors were rechecked in
  `auth-access-shells` and not carried forward.
- A live/optimistic summary-query KV302 concern was an app error: the query
  post-processed selected rows without declaring an output shape.

## Latest Verification

- `/Users/mini/kovo-dogfood-20260629-exhaustive/base-pristine`: `pnpm run
check`, `pnpm run test`, `pnpm run build:prod`, and dev HTTP smoke passed.
- `/Users/mini/kovo-dogfood-20260629-exhaustive/live-optimistic-cache`:
  `pnpm run test` passed; `rm -rf .kovo/cache && pnpm run build:prod`
  reproduced the `createElement` missing export.
- `/Users/mini/kovo-dogfood-20260629-exhaustive/auth-access-shells`: `pnpm run
check` and `pnpm run build:prod` passed; `pnpm run test` reproduced the single
  forbidden-shell assertion failure.
- `/Users/mini/kovo-dogfood-20260629-exhaustive/dynamic-routes-hmr`: `pnpm run
check`, `pnpm run test`, `pnpm run build:prod`, dev route/query smoke, and a
  reversible HMR edit passed.
- `/Users/mini/kovo-dogfood-20260629-exhaustive/ui-headless-style-a11y`: `pnpm
run check`, `pnpm run test`, `pnpm run build:prod`, `kovo add button badge
checkbox`, and a dev DOM smoke passed.
- Root monorepo repair after parallel link-local installs: `pnpm install`
  passed, and `pnpm --filter @kovojs/style exec node -e
  "console.log(require.resolve('@material/material-color-utilities'))"` resolved
  the style package's transitive dependency.
