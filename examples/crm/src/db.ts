import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';

import * as schema from './schema.js';

// The CRM demo uses an in-process PGlite database wrapped by Drizzle.

/** The CRM runtime database: Drizzle over PGlite, typed by the schema. */
export type CrmDb = PgliteDatabase<typeof schema>;

const SCHEMA_DDL = [
  // Presentational fields carry defaults so the demo forms can keep their inputs small.
  "CREATE TABLE contacts (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, owner_id text NOT NULL, deal_count integer NOT NULL, company text NOT NULL DEFAULT 'Independent', title text NOT NULL DEFAULT 'Contact');",
  "CREATE TABLE deals (id text PRIMARY KEY, contact_id text NOT NULL, stage text NOT NULL, amount integer NOT NULL, owner_id text NOT NULL, title text NOT NULL DEFAULT 'New opportunity');",
  'CREATE TABLE activities (id serial PRIMARY KEY, deal_id text NOT NULL, kind text NOT NULL, note text NOT NULL);',
  // closeDeal uses this to show a server-computed value in the returned fragment.
  'CREATE FUNCTION compute_commission(amount integer) RETURNS integer AS $$ SELECT (amount * 8 / 10)::int $$ LANGUAGE sql IMMUTABLE;',
].join('\n');

const SEED_CONTACTS =
  'INSERT INTO contacts (id, name, email, owner_id, deal_count, company, title) VALUES ' +
  "('c1', 'Ada Lovelace', 'ada@example.com', 'u1', 1, 'Analytical Engines', 'Head of Engineering'), " +
  "('c2', 'Grace Hopper', 'grace@example.com', 'u1', 1, 'Naval Systems', 'VP Operations');";

const SEED_DEALS =
  'INSERT INTO deals (id, contact_id, stage, amount, owner_id, title) VALUES ' +
  "('d1', 'c1', 'open', 5000, 'u1', 'Analytical Engines — Platform license'), " +
  "('d2', 'c2', 'won', 12000, 'u1', 'Naval Systems — Annual renewal');";

/** Create a fresh, seeded CRM database (DDL + a starter contact/deal book). */
export async function createCrmDb(): Promise<CrmDb> {
  const client = new PGlite();
  await client.waitReady;
  await client.exec(SCHEMA_DDL);
  await client.exec(SEED_CONTACTS);
  await client.exec(SEED_DEALS);
  return drizzle(client, { schema });
}
