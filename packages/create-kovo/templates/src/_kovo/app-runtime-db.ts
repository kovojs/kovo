import type { AppDb, CreatedAppDb } from '../db.js';
import '../db.js';

declare global {
  var __kovoStarterAppDatabase: CreatedAppDb | undefined;
}

function appRuntimeDatabase(): CreatedAppDb {
  const database = globalThis.__kovoStarterAppDatabase;
  if (!database) {
    throw new Error('Kovo starter runtime database was not initialized.');
  }
  return database;
}

/** Framework construction/auth adapter hook; do not import this into endpoint/webhook/task code. */
export function appRuntimeDbProvider(): AppDb {
  return appRuntimeDatabase().db;
}
