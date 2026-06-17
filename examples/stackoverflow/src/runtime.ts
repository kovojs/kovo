import type { SoDb } from './db.js';

// SPEC.md §11.5: the request-scoped surface the query loaders and mutation
// handlers read the Drizzle database off of. Kept in a leaf module so both
// queries.ts and mutations.ts can type their `db` receiver as a real
// PgliteDatabase (SoDb) — the provable Drizzle surface the §10.5 extractor needs.
export type { SoDb } from './db.js';

export interface SoRequest {
  db: SoDb;
  session?: {
    id?: string;
    user?: { id?: string; roles?: readonly string[] } | null;
  } | null;
}
