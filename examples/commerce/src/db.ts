import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';

// SPEC.md §14 / §11.5: the commerce reference app runs on real Postgres semantics
// via the in-process PGlite driver wrapped by Drizzle (the same engine the pglite
// test harness uses). `createCommerceDb()` returns a fresh, seeded instance — used
// per request for the stateless demo and fresh per test for isolation.
//
// It is synchronous: PGlite processes operations FIFO, so firing the DDL + seed
// `exec`s without awaiting (they enqueue before any later query) lets module-level
// app/shell construction stay synchronous while reads/writes remain async.

/** The commerce runtime database: Drizzle over PGlite. */
export type CommerceDb = PgliteDatabase;

const SCHEMA_DDL = [
  "CREATE TABLE products (id text PRIMARY KEY, name text NOT NULL DEFAULT 'Sample Product', category text NOT NULL DEFAULT 'General', emoji text NOT NULL DEFAULT '📦', stock integer NOT NULL, unit_price integer NOT NULL);",
  'CREATE TABLE cart_items (id serial PRIMARY KEY, product_id text NOT NULL, qty integer NOT NULL, unit_price integer NOT NULL);',
  'CREATE TABLE orders (id text PRIMARY KEY, product_id text NOT NULL, qty integer NOT NULL, total integer NOT NULL, user_id text NOT NULL);',
].join('\n');

const SEED_PRODUCTS =
  'INSERT INTO products (id, name, category, emoji, stock, unit_price) VALUES ' +
  "('p1', 'Aero Wireless Keyboard', 'Peripherals', '⌨️', 5, 1499), " +
  "('p2', 'Lumen 4K Monitor', 'Displays', '🖥️', 2, 2599), " +
  "('p3', 'Pulse USB-C Hub', 'Accessories', '🔌', 8, 399);";

/** Create a fresh, seeded commerce database (DDL + the starter product catalog). */
export function createCommerceDb(): CommerceDb {
  const client = new PGlite();
  // Fire-and-queue: PGlite runs operations in submission order, so these land
  // before any later select/insert without blocking construction.
  void client.exec(SCHEMA_DDL);
  void client.exec(SEED_PRODUCTS);
  return drizzle({ client });
}
