# TOCTOU Atomicity Boundary

Kovo's TOCTOU protection has three layers, and they are intentionally not the same
claim.

1. `kovo({ atomic })` and `kovo({ version })` declare which table columns are
   contended. KV429 uses those facts to reject read-then-write mutation code that
   lacks a compare-and-set, version guard, row lock, or serializable transaction
   proof.
2. `compareAndSet(...)` and typed `kovoConflict(...)` make zero-row guarded
   updates a typed HTTP 409 mutation conflict, so enhanced and no-JS mutation
   flows re-render through the normal failure lifecycle instead of silently
   committing stale state.
3. Database constraints remain the fail-closed backstop. Use `CHECK`, `UNIQUE`,
   foreign-key, exclusion, and equivalent engine constraints for invariants the
   database can enforce directly.

For a single-row inventory update, the application should both guard the update
and keep the invariant in the database:

```ts
export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    reserved: integer('reserved').notNull(),
    stock: integer('stock').notNull(),
    version: integer('version').notNull(),
  },
  (table) => ({
    ...kovo({
      atomic: [(t) => t.stock, (t) => t.reserved],
      domain: 'product',
      key: (t) => t.id,
      version: (t) => t.version,
    }),
    stockNonNegative: check('products_stock_non_negative', sql`${table.stock} >= 0`),
  }),
);
```

The guarded update closes the lost-update window for the request that read stale
state. The `CHECK` constraint closes the lower-level invariant if a different code
path, migration, import, or manual database write bypasses the helper.

Multi-row or aggregate invariants are outside the by-construction CAS claim. For
those, use a transaction with row locks such as `forUpdate`, serializable
isolation, or a database-level exclusion/unique constraint that represents the
whole invariant. KV429 may accept those as explicit proofs, but plain
READ COMMITTED mutation transactions are not proof of atomicity.
