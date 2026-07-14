import { postgresSchemaModule, type KovoPostgresAppRuntimeOptions } from '@kovojs/server';

import * as schema from '../schema.js';

// Vite represents ESM live bindings as namespace accessors. Normalize that genuine namespace once
// through the boot-pinned framework helper so runtime DDL/RLS and Better Auth share one immutable
// schema identity (SPEC §6.6/§10.3); ordinary authored getters remain rejected by the runtime.
export const appRuntimeSchema = postgresSchemaModule(schema);

const SEED_CONTACTS =
  'INSERT INTO contacts (id, name, email, company) VALUES ' +
  "('c1', 'Ada Lovelace', 'ada@example.com', 'Analytical Engines'), " +
  "('c2', 'Grace Hopper', 'grace@example.com', 'Naval Systems'), " +
  "('c3', 'Alan Turing', 'alan@example.com', 'Bletchley Park') " +
  'ON CONFLICT (id) DO NOTHING;';

/**
 * Side-effect-light runtime config shared by app boot and `kovo db` commands.
 * The CLI imports this object without constructing the database or authentication runtime.
 */
export const appRuntimeDbOptions = Object.freeze({
  schema: appRuntimeSchema,
  seedSql: SEED_CONTACTS,
}) satisfies KovoPostgresAppRuntimeOptions;
