import { jiso } from '@jiso/drizzle';
import { boolean, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';

// SPEC.md §10.1 (schema as domain registry) + §11.1: the Drizzle-blessed data
// layer for the Stack Overflow clone. Each table carries its jiso({ domain, key })
// annotation, so the §10.5 static extractor derives the touch graph, algebraic
// query shapes, and symbolic write effects directly from this source — the
// derived-optimism transforms in generated/optimistic/ are produced from these
// tables + the query loaders + the mutation handlers, never hand-authored.

export const questions = pgTable(
  'questions',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    authorId: text('author_id').notNull(),
    score: integer('score').notNull(),
    answerCount: integer('answer_count').notNull(),
  },
  jiso({ domain: 'question', key: 'id' }),
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
  },
  jiso({ domain: 'answer', key: 'id' }),
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
  jiso({ domain: 'vote', key: 'id' }),
);
