# @kovojs/test

App-scoped tests for Kovo. TypeScript infers the imported app's mutation, query, route, request,
and database contracts; runtime verification reads touch and query facts only from an explicit,
digest-verified successful-build artifact.

```sh
pnpm add -D @kovojs/test
kovo build ./src/app.tsx
kovo test
```

```ts
// Source: examples/crm/src/testing.ts
import { createKovoTestHarness } from '@kovojs/test/harness';

const harness = await createKovoTestHarness(crmApp, {
  artifact: new URL('../dist/.kovo/graph.json', import.meta.url),
  db,
  projectRoot: new URL('../', import.meta.url),
  request: { session: { id: 'test-session', user: { id: 'u1', roles: ['sales'] } } },
});

const contacts = await harness.query(contactListQuery);
```

The harness rejects relative, stale, partial, failed-build, wrong-lockfile, wrong-posture, and
wrong-app artifacts before executing a handler. It never discovers or accepts caller-authored
touch/read facts.

For `page()` or `request()`, pass the explicit `baseUrl` of a separately bootstrapped app. Those
methods exercise the HTTP wire and reject a different request origin; direct `query()` and
`exec()` tests stay in-process.

Engine-specific helpers live behind separate entry points:

- `@kovojs/test/postgres` — owner/admin/system RLS tests on ephemeral PGlite.
- `@kovojs/test/pglite` — direct PGlite fixtures.
- `@kovojs/test/sqlite` — native SQLite fixtures.
- `@kovojs/test/csrf` — mutation-bound tokens for focused synthetic request tests.

The ordinary `@kovojs/test/harness` install path does not require Playwright, PGlite, or
`better-sqlite3`.

## Reference

- API: `/api/test/`
- Guide: `/guides/testing/`
