import { kovo } from '@kovojs/drizzle';
import { boolean, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';

// SPEC.md §10.1 (schema as domain registry) + §11.1: the Drizzle-blessed data
// layer for the Stack Overflow clone. Each table carries its kovo({ domain, key })
// annotation, so the §10.5 static extractor derives the touch graph, algebraic
// query shapes, and symbolic write effects directly from this source — the
// derived-optimism transforms in generated/optimistic/ are produced from these
// tables + the query loaders + the mutation handlers, never hand-authored.

// Presentational columns (authorName / tags / createdAt) carry `.default(...)`
// so the existing fixture inserts and the postQuestion / postAnswer handlers —
// which OMIT these columns — stay valid. They are deliberately NOT selected by
// any query loader in queries.ts, so the §10.5 algebraic shapes (and therefore
// the commuting-diagram proofs) are unaffected; they only enrich the rendered UI.
export const questions = pgTable(
  'questions',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    authorId: text('author_id').notNull(),
    score: integer('score').notNull(),
    answerCount: integer('answer_count').notNull(),
    authorName: text('author_name').notNull().default('Anonymous'),
    tags: text('tags').notNull().default(''),
    createdAt: text('created_at').notNull().default(''),
  },
  kovo({ domain: 'question', key: 'id' }),
);

export const answers = pgTable(
  'answers',
  {
    id: text('id').primaryKey(),
    questionId: text('question_id').notNull(),
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    score: integer('score').notNull(),
    accepted: boolean('accepted').notNull(),
    authorName: text('author_name').notNull().default('Anonymous'),
    createdAt: text('created_at').notNull().default(''),
  },
  kovo({ domain: 'answer', key: 'id' }),
);

export const votes = pgTable(
  'votes',
  {
    id: serial('id').primaryKey(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    userId: text('user_id').notNull(),
    value: integer('value').notNull(),
  },
  kovo({ domain: 'vote', key: 'id' }),
);
