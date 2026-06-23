# Data-Layer Policy

`SPEC.md` section 10 defines Kovo's data-plane behavior. This rule records the
standing implementation policy for adapters and inference.

Kovo core defines a capability interface, not a portability promise:

- Writes expose touch sets.
- Queries expose read sets, result types, and instance keys.
- Adapters implement what they can; declared touches and explicit invalidation
  remain the universal floor.

The v1 floor is:

- A domain layer with declared `touches`.
- Flat tags as the low-ceremony on-ramp.
- `invalidate()` as a linted escape hatch.
- `@kovojs/drizzle` as the blessed adapter, with touches inferred from ASTs,
  schema-as-registry, derived query shapes/keys, and hand-written optimism
  against the transform IR.
- Postgres as the default dialect and SQLite as the opt-in second blessed dialect.
- Parameterized SQL as the security floor on every framework-managed DB handle:
  scalar values bind separately from SQL text, and dynamic identifiers/keywords
  come only from typed allowlists or schema facts rather than request strings.

Drizzle coupling is managed by a pinned, conformance-tested subset of Drizzle's
surface. The extraction pass targets tables as first-argument identifiers, and
the suite must fail loudly on API drift.

The pinned dialect surface is:

- Postgres scaffold/reference: `pgTable`, `drizzle-orm/pg-core`, PGlite through
  `drizzle-orm/pglite`.
- SQLite scaffold/reference: `sqliteTable`, `drizzle-orm/sqlite-core`,
  `better-sqlite3` through `drizzle-orm/better-sqlite3`.
- SQLite type mappings: `integer(..., { mode: 'boolean' })` for booleans,
  `text(..., { mode: 'json' })` for JSON when needed, and ISO `text` timestamps.

Postgres and SQLite conformance must prove the same SQL-statement safety
behavior at the managed-handle boundary: parameter carriers stay distinct from
SQL text, and the adapter surface exposes enough metadata for Kovo to recognize
that separation. Other dialects or drivers stay outside the blessed floor until
they provide equivalent parameter metadata and conformance coverage.

Other Drizzle dialects or drivers are outside the blessed adapter floor until a
plan adds conformance fixtures, runtime verification, and policy coverage.

Raw SQL is a marked second-class citizen: it requires KV406 annotation and
runtime verification, is excluded from derived optimism, and must still respect
the SQL safety contract from `SPEC.md` §10.2/§10.3: never interpolate
request/form/query data into SQL text; use bound parameters for values and
typed allowlists/schema facts for identifiers. That is acceptable only because
the seam is explicit.
