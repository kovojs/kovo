# App-scoped test harness v2

Status: technical-preview breaking batch for `@kovojs/test` 0.2.

## What changed

- `createKovoTestHarness` is now asynchronous and takes
  `(importedApp, { artifact, projectRoot, ...fixtures })`.
- Mutation input/error/result, query input/result, route keys, request, and DB types are inferred
  from the imported opaque app.
- Runtime read/touch facts come only from a completion- and digest-verified build artifact.
- `@kovojs/test/postgres` now owns the Postgres RLS test runtime.
- `@kovojs/test/csrf` now owns the focused mutation-token helper.
- `@kovojs/server/testing` and `@kovojs/test/test-case` were removed.
- Playwright, PGlite, native SQLite, compiler, browser, and Vite are optional peers rather than
  required by the ordinary harness install.

## Why

The old harness accepted caller-authored pages and graph facts, so the same test could invent both
the claim and its evidence. It also inferred only a free-standing DB generic, trusted nearby
artifacts, duplicated test registration, and installed every backend/browser engine.

The replacement separates compile-time app contracts from runtime build evidence. A test cannot
execute against a stale, partial, failed, wrong-lockfile, wrong-posture, or wrong-app graph, and a
starter pays only for the harness dependency it actually uses.

## Migration

Run the checked migration batch before upgrading. Mechanical imports move as follows:

| Old home                                                                | New home                |
| ----------------------------------------------------------------------- | ----------------------- |
| `@kovojs/server/testing` Postgres runtime and `KovoPostgresTest*` types | `@kovojs/test/postgres` |
| `@kovojs/server/testing` `mutationCsrfTokenForTesting`                  | `@kovojs/test/csrf`     |

Old `createKovoTestHarness({ ... })`, `@kovojs/test/test-case`, and
`renderWithRequestForTesting` call sites require manual migration because syntax cannot infer the
correct imported app, artifact, project root, or request/rendering posture.

Build before testing, import the exact app, and pass absolute URLs:

```ts
const harness = await createKovoTestHarness(app, {
  artifact: new URL('../dist/.kovo/graph.json', import.meta.url),
  projectRoot: new URL('../', import.meta.url),
  db,
});
```

Rollback is a source rollback of this batch plus its API decision/migration ledger checkpoint.
Do not reintroduce graph discovery or caller-supplied touch facts as a compatibility mode.
