# Papercuts 15

Created 2026-06-29. Source of truth remains `SPEC.md`; this ledger captures a fresh
starter dogfood pass against local packages after `bugz-14` and `papercuts-super-5`
were locally closed.

## Scope

Fresh SQLite starter at `/Users/mini/kovo-dogfood-20260629-100303`, scaffolded from
the local `create-kovo` dist, linked to the local monorepo, installed with pnpm, and
run through generated `test`, `check`, `build:prod`, and dev HTTP smoke workflows.

## Issues

### A. Build preflight optimistic coverage loses component query consumers

- [x] **A1 — `kovo build` rejects the generated starter with fatal KV310 even though the starter declares a hand-written optimistic transform for the invalidated contact query.** (high, build-tooling; found by fresh starter baseline)
  - Observed behavior: `pnpm run build:prod` in the fresh starter failed with `ERROR BUILD_FATAL KV310 mutations/add-contact -> queries/contacts-query Invalidated query lacks optimistic transform.`
  - Root cause: build preflight created a check graph before the production component compile and did not include component query-consumer facts. KV310's dead-transform filter therefore saw pages but no query consumers and discarded the valid hand-written `queries/contacts-query` transform. The fix adds source-derived component query-consumer facts to `packages/cli/src/commands/build-export.ts` and exposes the internal compiler scanners used to resolve component query aliases to source-derived query keys.
  - Why it matters: the default starter's deploy gate failed after scaffold, despite the app following the intended §10.6 optimistic coverage contract.
  - Acceptance: a starter-shaped component alias (`queries: { contacts: contactsQuery }`) must count as a consumer of the source-derived query key (`queries/contacts-query`) during `kovo build` preflight, and the generated starter `pnpm run check` must pass.
  - Evidence: `pnpm exec vitest run packages/cli/src/index.kovo-build.test.ts -t "source-derived component query consumers" --reporter=dot`; `pnpm run build:prod` and `pnpm run check` in `/Users/mini/kovo-dogfood-20260629-100303`.

## Refuted / Not Carried Forward

- Scaffold/install still prints Node's `[DEP0169] url.parse()` warning and a Better Auth/Drizzle peer warning. They did not block install, dev, test, check, or build in this pass, and are not carried as distinct framework papercuts here.

## Latest Verification

- `pnpm run test` in `/Users/mini/kovo-dogfood-20260629-100303`: generated starter tests passed.
- `pnpm run check` in `/Users/mini/kovo-dogfood-20260629-100303`: generated `vp check`, sound subset, `build:prod`, and endpoint-posture gates passed.
- Dev smoke: `curl -i http://127.0.0.1:5173/` returned `303 Location: /login?next=%2F`; `curl -i http://127.0.0.1:5173/api/health` returned `200 {"ok":true}`.
- `pnpm install` at repo root repaired link-local dogfood workspace effects; `node -e "console.log(require.resolve('@material/material-color-utilities', { paths: ['packages/style'] }))"` resolves through the monorepo store.
