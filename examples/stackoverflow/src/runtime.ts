import type { SoDb } from './db.js';

// Request-scoped data used by the query loaders and mutation handlers.
export type { SoDb } from './db.js';

export interface SoRequest {
  db: SoDb;
  session?: {
    id?: string;
    user?: { id?: string; roles?: readonly string[] } | null;
  } | null;
}
