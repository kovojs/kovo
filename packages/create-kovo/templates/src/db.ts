import type { Reader } from '@kovojs/server';
import type { PgAsyncDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { EmptyRelations } from 'drizzle-orm/relations';

import { appRuntimeReadonlyDb } from './_kovo/app-runtime-db.js';

// App-facing database surface. SPEC §9.4 and §10.3 make endpoint/query reads the
// safe public shape; raw creation and the write-capable provider live under
// src/_kovo/app-runtime-db.ts for framework-owned app construction/auth wiring.

/** The app runtime database. */
export type AppDb = PgAsyncDatabase<PgQueryResultHKT, EmptyRelations>;
export type AppReadonlyDb = Reader<AppDb>;

/** The running app read surface. Endpoint/user-authored reads should import this value. */
export const readonlyAppDb: AppReadonlyDb = appRuntimeReadonlyDb;
