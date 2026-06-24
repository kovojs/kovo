import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema.js';

// The app database: Drizzle over in-process SQLite through better-sqlite3. This
// opt-in scaffold uses Kovo's blessed SQLite path; Postgres remains the default.

/** The app runtime database, typed by the Drizzle schema. */
export type AppDb = BetterSQLite3Database<typeof schema>;

const SCHEMA_DDL = [
  // App domain.
  "CREATE TABLE contacts (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, company text NOT NULL DEFAULT '');",
  // Better Auth tables (column names match src/schema.ts). SQLite stores booleans
  // as integer mode columns and dates as ISO text timestamps.
  'CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, "emailVerified" integer NOT NULL DEFAULT 0, image text, "createdAt" text NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\')), "updatedAt" text NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\')));',
  'CREATE TABLE "session" (id text PRIMARY KEY, "expiresAt" text NOT NULL, token text NOT NULL UNIQUE, "createdAt" text NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\')), "updatedAt" text NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\')), "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE);',
  'CREATE TABLE "account" (id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" text, "refreshTokenExpiresAt" text, scope text, password text, "createdAt" text NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\')), "updatedAt" text NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\')));',
  'CREATE TABLE "verification" (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" text NOT NULL, "createdAt" text NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\')), "updatedAt" text NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\')));',
].join('\n');

const SEED_CONTACTS =
  'INSERT INTO contacts (id, name, email, company) VALUES ' +
  "('c1', 'Ada Lovelace', 'ada@example.com', 'Analytical Engines'), " +
  "('c2', 'Grace Hopper', 'grace@example.com', 'Naval Systems'), " +
  "('c3', 'Alan Turing', 'alan@example.com', 'Bletchley Park');";

/** Create a fresh, seeded app database (DDL + a few demo contacts). */
export function createAppDb(): AppDb {
  const client = new Database(':memory:');
  client.exec(SCHEMA_DDL);
  client.exec(SEED_CONTACTS);
  return drizzle({ client, schema });
}

/** The running app database. The stateless server reads/writes this per request. */
export const appDb = createAppDb();
