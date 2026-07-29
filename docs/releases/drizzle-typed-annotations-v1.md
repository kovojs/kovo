# Drizzle typed annotations v1

Kovo Drizzle annotations now receive the table's concrete columns:

```ts
export const entries = pgTable(
  'entries',
  {
    accountId: text('account_id').notNull(),
    id: text('id').notNull(),
    secret: text('secret').notNull(),
  },
  kovo((columns) => ({
    domain: 'entry',
    key: [columns.accountId, columns.id],
    ownerVia: {
      fk: columns.accountId,
      parent: accounts,
      parentKey: accounts.id,
    },
    secret: [columns.secret],
  })),
);
```

Strings and selector callbacks are no longer column references. The callback's private type
witness rejects typos and columns from another table during ordinary TypeScript authoring.
`ownerVia.parentKey` is tied to the declared parent table, and fan-out `via` values are tied to the
annotated table. Ordered arrays preserve composite row keys. Runtime extraction independently
requires the exact Drizzle column objects; matching `{ table, name }` lookalikes fail closed.

Kovo SQL handles now extend Drizzle's typed `SQL<T>` bridge with private constructor witnesses.
Structural `getSQL()` lookalikes are rejected, and the public declarations no longer expose
unparameterized `any` returns.

The runtime metadata extractor and its seven supporting types moved from the package root to
framework-internal assembly. Application code should declare schema intent through `kovo`; it
should not consume or construct runtime security metadata.

The supported Drizzle peer range is `>=1.0.0-rc.4 <2`; the executable minimum/development fixture
is `1.0.0-rc.4`. Release validation installs the canonical `@kovojs/drizzle` tarball and compiles
both Postgres and SQLite consumers with `pnpm run check:packed-drizzle-consumer`.

Before upgrading, run:

```sh
node scripts/migrate-drizzle-api-v1.mjs --check src
```

The migration rewrites direct annotation objects, simple selectors, direct string column names,
ordered composite keys, owner-via links, and fan-out edges. It refuses dynamic composition,
ambiguous bindings, dynamic imports, and removed runtime-metadata imports because choosing an
application or adapter replacement requires author intent. Resolve every source-anchored refusal,
then run:

```sh
node scripts/migrate-drizzle-api-v1.mjs --write src
```

Rollback requires a clean worktree: restore the prior Kovo and Drizzle package versions, then
reverse only the files reported as rewritten by the structured migration result.
