import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';

import * as schema from './schema.js';

// SPEC.md §14 / §11.5: the CRM example runs on real Postgres semantics via the
// in-process PGlite driver wrapped by Drizzle (the same engine the pglite test
// harness uses). `createCrmDb()` returns a fresh, seeded instance — used per
// request for the stateless demo and fresh per test for isolation.

/** The CRM runtime database: Drizzle over PGlite, typed by the schema. */
export type CrmDb = PgliteDatabase<typeof schema>;

const SCHEMA_DDL = [
  'CREATE TABLE contacts (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, owner_id text NOT NULL, deal_count integer NOT NULL);',
  'CREATE TABLE deals (id text PRIMARY KEY, contact_id text NOT NULL, stage text NOT NULL, amount integer NOT NULL, owner_id text NOT NULL);',
  'CREATE TABLE activities (id serial PRIMARY KEY, deal_id text NOT NULL, kind text NOT NULL, note text NOT NULL);',
  // SPEC.md §10.5: closeDeal's `amount = compute_commission(amount)` is a raw sql
  // server compute the extractor classifies Opaque (the commission stays server
  // truth; the client awaits the fragment). Define it as a real Postgres function
  // so the served closeDeal mutation runs end-to-end — here, a 20% close fee.
  'CREATE FUNCTION compute_commission(amount integer) RETURNS integer AS $$ SELECT (amount * 8 / 10)::int $$ LANGUAGE sql IMMUTABLE;',
].join('\n');

const SEED_CONTACTS =
  'INSERT INTO contacts (id, name, email, owner_id, deal_count) VALUES ' +
  "('c1', 'Ada Lovelace', 'ada@example.com', 'u1', 1), " +
  "('c2', 'Grace Hopper', 'grace@example.com', 'u1', 1);";

const SEED_DEALS =
  'INSERT INTO deals (id, contact_id, stage, amount, owner_id) VALUES ' +
  "('d1', 'c1', 'open', 5000, 'u1'), " +
  "('d2', 'c2', 'won', 12000, 'u1');";

/** Create a fresh, seeded CRM database (DDL + a starter contact/deal book). */
export async function createCrmDb(): Promise<CrmDb> {
  const client = new PGlite();
  await client.waitReady;
  await client.exec(SCHEMA_DDL);
  await client.exec(SEED_CONTACTS);
  await client.exec(SEED_DEALS);
  return drizzle(client, { schema });
}
