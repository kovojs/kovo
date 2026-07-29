# @kovojs/drizzle

Drizzle integration for Kovo's data layer. It annotates tables with domains,
owners, secret fields, governed columns, and concurrency facts so Kovo can derive
read/write graphs from ordinary Drizzle queries.

```sh
pnpm add @kovojs/drizzle drizzle-orm
```

```ts
import { kovo } from '@kovojs/drizzle';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';

export const carts = pgTable(
  'carts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    version: integer('version').notNull(),
  },
  kovo((columns) => ({
    domain: 'cart',
    key: columns.id,
    owner: columns.userId,
    version: columns.version,
  })),
);
```

## Analyzer summary candidates

Use `kovoAnalyzerSummary` only for a direct local helper that projects a private
principal from Kovo's request/context carrier:

```ts
import { kovoAnalyzerSummary } from '@kovojs/drizzle';

function requireSessionId(context: { request: { session: { id: string } } }) {
  return context.request.session.id;
}

kovoAnalyzerSummary(requireSessionId, {
  returns: { kind: 'session', path: 'id' },
});
```

The marker is a candidate, not a provenance assertion. Kovo inspects the exact
same-file body and accepts only one direct function declaration or a `const`
initialized directly by an arrow/function expression. The helper must have one
identifier parameter and return only the matching literal `guard`, `session`, or
`tenant` property chain. Object properties and methods, imports, aliased marker
targets, mutable bindings, general bodies, and mismatched declarations fail closed as
unknown. One direct immutable same-file `const alias = requireSessionId` may preserve
the proven identity when invoked; property, destructured/container, chained, opaque,
imported, or mutable aliases do not. There is no general `server` summary kind.

## Compatibility and package boundary

The human API is the package root. The `./internal/*` exports are framework-to-framework
contracts and are not app compatibility promises.

The package manifest supports `drizzle-orm >=1.0.0-rc.4 <2`. The repository's finite,
executable compatibility fixture is exactly `1.0.0-rc.4`, which is both the minimum and
the development version. Drizzle `0.45.x` is outside this adapter's peer range even though
another Kovo integration may install it independently. After creating the canonical packed
release manifest, `pnpm run check:packed-drizzle-consumer` installs that exact fixture and
compiles Postgres and SQLite annotations against the tarball.

## Reference

- API: `/api/drizzle/`
- Guide: `/guides/data-layer/`
