import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// App-facing database surface. SPEC §9.4 and §10.3 make endpoint/query reads the
// safe public shape; raw creation and the write-capable provider live under
// src/_kovo/app-runtime-db.ts for framework-owned app construction/auth wiring.

/** The app runtime database. */
export type AppDb = BetterSQLite3Database;
