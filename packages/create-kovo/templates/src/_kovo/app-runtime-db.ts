import { createPostgresAppRuntimeDb, declareSecretReadCapability } from '@kovojs/server';

import * as schema from '../schema.js';
import type { AppDb, AppReadonlyDb } from '../db.js';

const SEED_CONTACTS =
  'INSERT INTO contacts (id, name, email, company) VALUES ' +
  "('c1', 'Ada Lovelace', 'ada@example.com', 'Analytical Engines'), " +
  "('c2', 'Grace Hopper', 'grace@example.com', 'Naval Systems'), " +
  "('c3', 'Alan Turing', 'alan@example.com', 'Bletchley Park') " +
  'ON CONFLICT (id) DO NOTHING;';

const appDatabase = createPostgresAppRuntimeDb({
  schema,
  seedSql: SEED_CONTACTS,
});

export { declareSecretReadCapability };

/** Read-only app DB value re-exported by src/db.ts for endpoint/user-authored reads. */
export const appRuntimeReadonlyDb: AppReadonlyDb = appDatabase.readonlyDb;
export const appRuntimeDbReady: Promise<void> = appDatabase.ready;

/** Framework construction/auth adapter hook; do not import this into endpoint/webhook/task code. */
export function appRuntimeDbProvider(request?: unknown): AppDb {
  return appDatabase.db(request);
}
