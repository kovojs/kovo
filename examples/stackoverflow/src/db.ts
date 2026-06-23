import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';

import * as schema from './schema.js';

// The demo runs against an in-process PGlite database wrapped by Drizzle.

/** The Stack Overflow runtime database: Drizzle over PGlite, typed by the schema. */
export type SoDb = PgliteDatabase<typeof schema>;

// The presentational columns carry SQL DEFAULTs (mirroring the Drizzle
// `.default(...)` in schema.ts) so inserts that omit them — the demo seed and
// postQuestion / postAnswer mutation handlers — stay valid. No query selects
// session_id directly; it scopes shared hosted-demo state.
export const SCHEMA_DDL = [
  "CREATE TABLE questions (session_id text NOT NULL, id text NOT NULL, title text NOT NULL, body text NOT NULL, author_id text NOT NULL, score integer NOT NULL, answer_count integer NOT NULL, author_name text NOT NULL DEFAULT 'Anonymous', tags text NOT NULL DEFAULT '', created_at text NOT NULL DEFAULT '', PRIMARY KEY (session_id, id));",
  "CREATE TABLE answers (session_id text NOT NULL, id text NOT NULL, question_id text NOT NULL, author_id text NOT NULL, body text NOT NULL, score integer NOT NULL, accepted boolean NOT NULL, author_name text NOT NULL DEFAULT 'Anonymous', created_at text NOT NULL DEFAULT '', PRIMARY KEY (session_id, id));",
  'CREATE TABLE votes (id serial PRIMARY KEY, session_id text NOT NULL, target_type text NOT NULL, target_id text NOT NULL, user_id text NOT NULL, value integer NOT NULL);',
].join('\n');

/** Create a fresh Stack Overflow database. Session seeds are inserted by demo-data.ts. */
export async function createSoDb(): Promise<SoDb> {
  const client = new PGlite();
  await client.waitReady;
  await client.exec(SCHEMA_DDL);
  return drizzle(client, { schema });
}
