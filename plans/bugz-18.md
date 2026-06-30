# Bugz 18

Created 2026-06-30 from the exhaustive `dogfood` pass after `main` commit
`5067ef534`. Source of truth remains `SPEC.md`; this ledger records newly verified,
distinct defects not already carried by earlier bugz/papercuts ledgers.

## Issues

- [ ] **B1 — Production client-island modules import `@kovojs/browser/generated`, so islands deploy and load but never hydrate in the `kovo build` artifact.** (high, framework/prod artifact; found by `dogfood-islands-deploy`)
  - Observed behavior: a default postgres starter with two client islands, documented deploy retention in `kovo.config.ts`, and a clean `rm -rf dist .kovo/cache && pnpm run build:prod` emits `/c/__v/.../src/components/islands.client.js` and serves it from `dist/server/server.mjs`, but browser execution fails with `Failed to resolve module specifier "@kovojs/browser/generated"`; local island state stays stale and no client-side handlers run.
  - Source pointer: `packages/compiler/src/emit/client.ts` emits `import { derive, handler } from '@kovojs/browser/generated';`; `packages/compiler/src/vite.ts` rewrites this for dev, but the production build artifact path does not.
  - Distinctness: related to earlier island-lowering/deploy ledgers, but this is the post-retention production artifact path: the module is emitted and referenced, yet browser resolution fails.
  - Acceptance: production client modules emitted by `kovo build` use browser-resolvable internal helper code or a served helper URL, and a prod artifact browser test proves island click/input hydrates with no unexpected `/_m` or `/_q` request for local state changes.

- [ ] **B2 — The default create-kovo postgres/PGlite starter stamps idempotency tokens but configures no mutation replay store, so duplicate enhanced POSTs can execute independently.** (high, starter/runtime integration; found by `dogfood-idempotency`)
  - Observed behavior: concurrent enhanced mutation POSTs with the same `Kovo-Idem` against a real generated postgres starter produce one success and one independent `409 STALE_VERSION` (`dev`: `[409, 200]`; prod artifact: `[200, 409]`) instead of reserving/coalescing and replaying the settled success.
  - Source pointer: generated `src/app.tsx` and `packages/create-kovo/templates/src/app.tsx` do not pass `mutationReplayStore`; framework replay is disabled without a store (`packages/server/src/replay.ts`), and `packages/server/src/app-mutation-request.ts` only threads replay when configured.
  - Distinctness: `plans/papercuts-super-8.md` recorded concurrency/idempotency as an uncovered gap; earlier replay ledgers covered implementation hardening, not the default starter shipping without replay wiring.
  - Acceptance: a fresh default postgres/PGlite starter configures a durable-enough local mutation replay store for dev/test/prod starter use, and generated-app tests prove duplicate same-idempotency enhanced POSTs coalesce/replay instead of executing twice.

## Latest Verification

- New finding evidence: dogfood apps under `/Users/mini/kovo-dogfood-islands-app-20260629174312` and `/Users/mini/kovo-dogfood-idempotency-20260629-174224/idem-app` reproduced B1/B2 against `origin/main` at `ae6de8814`.
- Baseline after prior repairs: `pnpm exec vitest run packages/server/src/deferred-stream.test.ts packages/server/src/deferred-region.test.ts packages/server/src/wire-fixtures.test.ts packages/server/src/document.test.ts packages/server/src/app-document.test.ts --run --reporter=dot`; `pnpm exec vitest --config vitest.browser.config.ts --run packages/browser/src/apply-deferred-stream.browser.test.ts packages/browser/src/inline-loader-navigation.browser.test.ts --reporter=dot`; `pnpm run check:vp`.
