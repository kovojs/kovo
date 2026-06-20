import { kovo } from '@kovojs/drizzle';
import { boolean, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';

// Drizzle tables for the Stack Overflow clone. The kovo({ domain, key })
// annotations let the generated graph connect mutations to refreshed queries.

// Presentational columns carry defaults so simple inserts can omit them.
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
  kovo({ domain: 'question', key: (t) => t.id }),
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
  kovo({ domain: 'answer', key: (t) => t.id }),
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
  kovo({ domain: 'vote', key: (t) => t.id }),
);
