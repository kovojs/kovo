import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';

import * as schema from './schema.js';

// The demo runs against an in-process PGlite database wrapped by Drizzle.

/** The Stack Overflow runtime database: Drizzle over PGlite, typed by the schema. */
export type SoDb = PgliteDatabase<typeof schema>;

// The presentational columns carry SQL DEFAULTs (mirroring the Drizzle
// `.default(...)` in schema.ts) so inserts that omit them — the base seed below,
// the demo seed, and the postQuestion / postAnswer mutation handlers — stay
// valid. No query selects these columns, so derived optimism is unaffected.
export const SCHEMA_DDL = [
  "CREATE TABLE questions (id text PRIMARY KEY, title text NOT NULL, body text NOT NULL, author_id text NOT NULL, score integer NOT NULL, answer_count integer NOT NULL, author_name text NOT NULL DEFAULT 'Anonymous', tags text NOT NULL DEFAULT '', created_at text NOT NULL DEFAULT '');",
  "CREATE TABLE answers (id text PRIMARY KEY, question_id text NOT NULL, author_id text NOT NULL, body text NOT NULL, score integer NOT NULL, accepted boolean NOT NULL, author_name text NOT NULL DEFAULT 'Anonymous', created_at text NOT NULL DEFAULT '');",
  'CREATE TABLE votes (id serial PRIMARY KEY, target_type text NOT NULL, target_id text NOT NULL, user_id text NOT NULL, value integer NOT NULL);',
].join('\n');

export const SEED_QUESTIONS = [
  'INSERT INTO questions (id, title, body, author_id, score, answer_count) VALUES',
  "  ('q1', 'How do I derive optimistic updates?', 'Compiler-derived from Drizzle.', 'u1', 3, 1),",
  "  ('q2', 'How do I keep demo state isolated?', 'Use a fresh in-memory database per run.', 'u2', 1, 0);",
].join('\n');

export const SEED_ANSWERS =
  "INSERT INTO answers (id, question_id, author_id, body, score, accepted) VALUES ('a1', 'q1', 'u2', 'Use deriveOptimistic.', 2, false);";

/** Create a fresh, seeded Stack Overflow database. */
export async function createSoDb(): Promise<SoDb> {
  const client = new PGlite();
  await client.waitReady;
  await client.exec(SCHEMA_DDL);
  await client.exec(SEED_QUESTIONS);
  await client.exec(SEED_ANSWERS);
  return drizzle(client, { schema });
}
