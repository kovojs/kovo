import Database from 'better-sqlite3';
import { secret } from '@kovojs/core';
import { readonlyDb } from '@kovojs/server';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from '../schema.js';
import type { AppDb, AppReadonlyDb } from '../db.js';

// The framework-owned app database runtime for the opt-in SQLite scaffold.
// Postgres remains the default starter dialect.

interface CreatedAppRuntimeDb {
  db: AppDb;
  readonlyDb: AppReadonlyDb;
  ready: Promise<void>;
}

const SCHEMA_DDL = [
  // App domain.
  "CREATE TABLE contacts (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, company text NOT NULL DEFAULT '');",
  // Better Auth tables (column names match src/schema.ts). SQLite stores
  // booleans and Drizzle timestamp_ms dates as integer mode columns.
  'CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, "emailVerified" integer NOT NULL DEFAULT 0, image text, "createdAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)), "updatedAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)));',
  'CREATE TABLE "session" (id text PRIMARY KEY, "expiresAt" integer NOT NULL, token text NOT NULL UNIQUE, "createdAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)), "updatedAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)), "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE);',
  'CREATE TABLE "account" (id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" integer, "refreshTokenExpiresAt" integer, scope text, password text, "createdAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)), "updatedAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)));',
  'CREATE TABLE "verification" (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" integer NOT NULL, "createdAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)), "updatedAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)));',
].join('\n');

const SEED_CONTACTS =
  'INSERT INTO contacts (id, name, email, company) VALUES ' +
  "('c1', 'Ada Lovelace', 'ada@example.com', 'Analytical Engines'), " +
  "('c2', 'Grace Hopper', 'grace@example.com', 'Naval Systems'), " +
  "('c3', 'Alan Turing', 'alan@example.com', 'Bletchley Park');";
const SECRET_COLUMN_KEYS = new Set(['accessToken', 'idToken', 'password', 'refreshToken', 'token']);

function createAppRuntimeDb(): CreatedAppRuntimeDb {
  const client = new Database(':memory:');
  client.exec(SCHEMA_DDL);
  client.exec(SEED_CONTACTS);
  const db = drizzle({ client, schema });
  return {
    db,
    readonlyDb: readonlyDb(secretBoxingReadDb(db, SECRET_COLUMN_KEYS)),
    ready: Promise.resolve(),
  };
}

function secretBoxingReadDb<Db extends object>(db: Db, secretKeys: ReadonlySet<string>): Db {
  const readDb = {};
  for (const prop of ['$count', '$with', 'query', 'select', 'selectDistinct', 'with'] as const) {
    const item = Reflect.get(db, prop);
    if (typeof item === 'function') {
      Reflect.set(readDb, prop, (...args: unknown[]) =>
        wrapReadSurface(Reflect.apply(item, db, args), secretKeys),
      );
    } else if (item !== undefined) {
      Reflect.set(readDb, prop, item);
    }
  }
  return Object.assign({}, db, readDb);
}

function wrapReadSurface(value: unknown, secretKeys: ReadonlySet<string>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Promise) return value.then((result) => boxSecretRows(result, secretKeys));
  return new Proxy(value, {
    get(target, prop, receiver) {
      const item = Reflect.get(target, prop, receiver);
      if (prop === 'then' && typeof item === 'function') {
        return (
          onFulfilled?: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) =>
          Reflect.apply(item, target, [
            (result: unknown) => onFulfilled?.(boxSecretRows(result, secretKeys)),
            onRejected,
          ]);
      }
      if (typeof item !== 'function') return item;
      return (...args: unknown[]) => wrapReadSurface(Reflect.apply(item, target, args), secretKeys);
    },
  });
}

function boxSecretRows(value: unknown, secretKeys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((entry) => boxSecretRows(entry, secretKeys));
  if (value === null || typeof value !== 'object') return value;
  const boxed: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    boxed[key] =
      item === null || item === undefined
        ? item
        : secretKeys.has(key)
          ? secret(item)
          : boxSecretRows(item, secretKeys);
  }
  return boxed;
}

const appDatabase = createAppRuntimeDb();

/** Read-only app DB value re-exported by src/db.ts for endpoint/user-authored reads. */
export const appRuntimeReadonlyDb: AppReadonlyDb = appDatabase.readonlyDb;
export const appRuntimeDbReady: Promise<void> = appDatabase.ready;

/** Framework construction/auth adapter hook; do not import this into endpoint/webhook/task code. */
export function appRuntimeDbProvider(): AppDb {
  return appDatabase.db;
}
