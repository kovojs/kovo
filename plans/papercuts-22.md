# Papercuts 22

Created 2026-07-01. Source of truth remains `SPEC.md`. This ledger captures the non-security
result of an exhaustive local dogfood pass after `plans/fundamental-fixes.md` and
`plans/capability-surface-redesign.md` were marked complete. The one confirmed security/soundness
gap from this pass is filed in `plans/bugz-23.md`.

## Scope

Fresh linked SQLite apps under `/Users/mini/kovo-dogfood-fundamental-20260630-234210/*` exercised
the baseline starter, query write reachability, production artifact/runtime contracts, webhook
mutation dispatch, starter DB narrowing, island deploy/hydration, static export, and direct DB
fact enforcement. Existing untracked `plans/claude-bugz-25.md` and
`plans/claude-papercuts-23.md` were already present and were left untouched rather than mixing
their broader scope with this focused sweep.

## Issues

- No new non-security papercuts are carried forward from this sweep. The confirmed build/check
  gap is a soundness issue and is routed to `plans/bugz-23.md`.

## Refuted / Not Carried Forward

- Query write reachability held: direct writes, aliases, raw methods, computed members, and legacy
  query-write spellings failed with KV406/KV433, while safe reads stayed green in
  `query-write-reachability`.
- Production runtime contracts held: cache-free builds reflected source edits, SSR/`/_q`/enhanced
  mutation warning limits matched, Defer streamed/islanded errors correctly, and no stale artifact
  false-green reproduced in `prod-runtime-contracts`.
- Webhook mutation dispatch held: `context.runMutation(...)` with replay/idempotency wrote once and
  replayed once; negative raw webhook writes and undeclared `recordChange(...)` failed with KV330/KV402
  in `webhook-mutation-dispatch`.
- Starter DB narrowing held for the authored starter surface: `src/db.ts` exposes only
  `readonlyAppDb`, the sound-subset check passed, and cache-free production build passed in
  `starter-islands-export`.
- Island deploy and hydration held: the production artifact emitted
  `dist/.kovo/client/c/__v/.../src/components/sie-counter.client.js`, the served document referenced
  it, and a Playwright smoke against `dist/server/server.mjs` updated `Count 0` to `Count 1` with no
  `/_m` or `/_q` request.
- Static export reproduced an existing duplicate, not a new issue: `kovo export
./static-export/export-app.tsx --root public --out dist-export-publicroot --skip-non-exportable`
  exited 0 and copied `sie-public.svg`, but the exported document linked `/assets/export.css` without
  writing `dist-export-publicroot/assets/export.css`, matching open `plans/papercuts-21.md` A1.

## Latest Verification

- `pnpm --filter create-kovo run build:dist`; baseline scaffold `check`, `test`, cache-free
  production build, and dev HTTP smoke passed.
- Focused app checks: `query-write-reachability`, `prod-runtime-contracts`, `webhook-mutation-dispatch`,
  and `starter-islands-export` ran the commands named above.
- Monorepo repair after multi-app link-local installs: `pnpm install` at the repo root passed, and
  `require.resolve('@material/material-color-utilities', { paths: ['/Users/mini/kovo/packages/style'] })`
  resolves.
