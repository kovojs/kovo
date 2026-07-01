import type { Reader } from '@kovojs/server';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { appRuntimeReadonlyDb } from './_kovo/app-runtime-db.js';
import type * as schema from './schema.js';

// App-facing database surface. SPEC §9.4 and §10.3 make endpoint/query reads the
// safe public shape; raw creation and the write-capable provider live under
// src/_kovo/app-runtime-db.ts for framework-owned app construction/auth wiring.

/** The app runtime database, typed by the Drizzle schema. */
export type AppDb = BetterSQLite3Database<typeof schema>;
export type AppReadonlyDb = Reader<AppDb>;

/** The running app read surface. Endpoint/user-authored reads should import this value. */
export const readonlyAppDb: AppReadonlyDb = appRuntimeReadonlyDb;
