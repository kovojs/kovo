import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';

import * as schema from './schema.js';

// SPEC.md §14 / §11.5: the Stack Overflow clone runs on real Postgres semantics
// via the in-process PGlite driver wrapped by Drizzle (the same engine the §10.5
// pglite commuting-diagram harness uses). `createSoDb()` returns a fresh, seeded
// instance — fresh per test for isolation.

/** The Stack Overflow runtime database: Drizzle over PGlite, typed by the schema. */
export type SoDb = PgliteDatabase<typeof schema>;

export const SCHEMA_DDL = [
  'CREATE TABLE questions (id text PRIMARY KEY, title text NOT NULL, body text NOT NULL, author_id text NOT NULL, score integer NOT NULL, answer_count integer NOT NULL);',
  'CREATE TABLE answers (id text PRIMARY KEY, question_id text NOT NULL, author_id text NOT NULL, body text NOT NULL, score integer NOT NULL, accepted boolean NOT NULL);',
  'CREATE TABLE votes (id serial PRIMARY KEY, target_type text NOT NULL, target_id text NOT NULL, user_id text NOT NULL, value integer NOT NULL);',
].join('\n');

export const SEED_QUESTIONS = [
  'INSERT INTO questions (id, title, body, author_id, score, answer_count) VALUES',
  "  ('q1', 'How do I derive optimistic updates?', 'Compiler-derived from Drizzle.', 'u1', 3, 1),",
  "  ('q2', 'What is a commuting diagram?', 'patch(shape(s)) = shape(apply(s)).', 'u2', 1, 0);",
].join('\n');

export const SEED_ANSWERS =
  "INSERT INTO answers (id, question_id, author_id, body, score, accepted) VALUES ('a1', 'q1', 'u2', 'Use deriveOptimistic.', 2, false);";

/** Create a fresh, seeded Stack Overflow database (DDL + a couple of questions). */
export async function createSoDb(): Promise<SoDb> {
  const client = new PGlite();
  await client.waitReady;
  await client.exec(SCHEMA_DDL);
  await client.exec(SEED_QUESTIONS);
  await client.exec(SEED_ANSWERS);
  return drizzle(client, { schema });
}
