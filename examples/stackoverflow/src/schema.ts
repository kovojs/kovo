import { kovo } from '@kovojs/drizzle';
import { boolean, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';

import { answer, question, vote } from './model.js';

// Drizzle tables for the Stack Overflow clone. The kovo({ domain, key })
// annotations let the generated graph connect mutations to refreshed queries.

// Presentational columns carry defaults so simple inserts can omit them.
export const questions = pgTable(
  'questions',
  {
    sessionId: text('session_id').notNull(),
    id: text('id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    authorId: text('author_id').notNull(),
    score: integer('score').notNull(),
    answerCount: integer('answer_count').notNull(),
    authorName: text('author_name').notNull().default('Anonymous'),
    tags: text('tags').notNull().default(''),
    createdAt: text('created_at').notNull().default(''),
  },
  kovo({ domain: question, key: 'sessionId,id' }),
);

export const answers = pgTable(
  'answers',
  {
    sessionId: text('session_id').notNull(),
    id: text('id').notNull(),
    questionId: text('question_id').notNull(),
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    score: integer('score').notNull(),
    accepted: boolean('accepted').notNull(),
    authorName: text('author_name').notNull().default('Anonymous'),
    createdAt: text('created_at').notNull().default(''),
  },
  kovo({ domain: answer, key: 'sessionId,id' }),
);

export const votes = pgTable(
  'votes',
  {
    id: serial('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    userId: text('user_id').notNull(),
    value: integer('value').notNull(),
  },
  kovo({ domain: vote, key: 'sessionId,id' }),
);
