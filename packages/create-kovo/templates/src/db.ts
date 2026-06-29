import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';

// The app database: Drizzle over an in-process PGlite (real Postgres, compiled to
// WASM — no external server to run). `createAppDb()` opens a persistent data
// directory and idempotently seeds demo contacts.
//
// It is synchronous: PGlite runs operations in submission order, so the DDL/seed
// `exec`s enqueue ahead of any later query without blocking construction.

/** The app runtime database. */
export type AppDb = PgliteDatabase;

const SCHEMA_DDL = [
  // App domain.
  "CREATE TABLE IF NOT EXISTS contacts (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, company text NOT NULL DEFAULT '');",
  // Better Auth tables (column names match src/schema.ts).
  'CREATE TABLE IF NOT EXISTS "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, "emailVerified" boolean NOT NULL DEFAULT false, image text, "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now());',
  'CREATE TABLE IF NOT EXISTS "session" (id text PRIMARY KEY, "expiresAt" timestamp NOT NULL, token text NOT NULL UNIQUE, "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now(), "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE);',
  'CREATE TABLE IF NOT EXISTS "account" (id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamp, "refreshTokenExpiresAt" timestamp, scope text, password text, "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now());',
  'CREATE TABLE IF NOT EXISTS "verification" (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamp NOT NULL, "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now());',
].join('\n');

const SEED_CONTACTS =
  'INSERT INTO contacts (id, name, email, company) VALUES ' +
  "('c1', 'Ada Lovelace', 'ada@example.com', 'Analytical Engines'), " +
  "('c2', 'Grace Hopper', 'grace@example.com', 'Naval Systems'), " +
  "('c3', 'Alan Turing', 'alan@example.com', 'Bletchley Park') " +
  'ON CONFLICT (id) DO NOTHING;';

const DEFAULT_DATA_DIR = '.kovo/pglite';

/** Create the app database (DDL + a few demo contacts). */
export function createAppDb(): AppDb {
  const client = new PGlite(process.env.KOVO_DATA_DIR ?? DEFAULT_DATA_DIR);
  // Fire-and-queue: PGlite runs operations in submission order.
  void client.exec(SCHEMA_DDL);
  void client.exec(SEED_CONTACTS);
  return drizzle({ client });
}

/** The running app database. The server reads/writes this singleton per request. */
export const appDb = createAppDb();
