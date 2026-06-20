import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';

import * as schema from './schema.js';

// The app database: Drizzle over an in-process PGlite (real Postgres, compiled to
// WASM — no external server to run). `createAppDb()` returns a fresh, seeded
// instance: per request for the stateless demo, fresh per test for isolation.
//
// It is synchronous: PGlite runs operations in submission order, so the DDL/seed
// `exec`s enqueue ahead of any later query without blocking construction.

/** The app runtime database, typed by the Drizzle schema. */
export type AppDb = PgliteDatabase<typeof schema>;

const SCHEMA_DDL = [
  // App domain.
  "CREATE TABLE contacts (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, company text NOT NULL DEFAULT '');",
  // Better Auth tables (column names match src/schema.ts).
  'CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, "emailVerified" boolean NOT NULL DEFAULT false, image text, "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now());',
  'CREATE TABLE "session" (id text PRIMARY KEY, "expiresAt" timestamp NOT NULL, token text NOT NULL UNIQUE, "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now(), "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE);',
  'CREATE TABLE "account" (id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamp, "refreshTokenExpiresAt" timestamp, scope text, password text, "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now());',
  'CREATE TABLE "verification" (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamp NOT NULL, "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now());',
].join('\n');

const SEED_CONTACTS =
  'INSERT INTO contacts (id, name, email, company) VALUES ' +
  "('c1', 'Ada Lovelace', 'ada@example.com', 'Analytical Engines'), " +
  "('c2', 'Grace Hopper', 'grace@example.com', 'Naval Systems'), " +
  "('c3', 'Alan Turing', 'alan@example.com', 'Bletchley Park');";

/** Create a fresh, seeded app database (DDL + a few demo contacts). */
export function createAppDb(): AppDb {
  const client = new PGlite();
  // Fire-and-queue: PGlite runs operations in submission order.
  void client.exec(SCHEMA_DDL);
  void client.exec(SEED_CONTACTS);
  return drizzle(client, { schema });
}

/** The running app database. The stateless server reads/writes this per request. */
export const appDb = createAppDb();
