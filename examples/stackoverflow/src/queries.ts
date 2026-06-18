import { query, s, type QueryLoadContext } from '@kovojs/server';
import { asc, eq, sum } from 'drizzle-orm';

import { answer, question, vote } from './domains.js';
import type { SoDb, SoRequest } from './runtime.js';
import { answers, questions, votes } from './schema.js';
import type { QuestionAnswersResult, QuestionDetailResult } from './types.js';

// Typed reads for the demo. The Drizzle selects stay inline so the generated
// StackOverflow artifacts can inspect the query shapes.

type SoQueryLoadContext = QueryLoadContext<SoRequest> & { db?: SoDb };

// The list is ordered by stable id so a vote changes the score without reshuffling
// rows while a fragment response is being applied.
export const questionList = query('questionList', {
  load: async (_input: unknown, context?: SoQueryLoadContext) => {
    const db = requireSoQueryDb(context);
    const items = await db
      .select({
        authorId: questions.authorId,
        authorName: questions.authorName,
        body: questions.body,
        createdAt: questions.createdAt,
        id: questions.id,
        tags: questions.tags,
        title: questions.title,
        score: questions.score,
        answerCount: questions.answerCount,
      })
      .from(questions)
      .orderBy(questions.id);
    // Keep the explicit property for the artifact generator.
    return { items: items };
  },
  reads: [question],
});

// All answers, ordered by stable id.
export const answerList = query('answerList', {
  load: async (_input: unknown, context?: SoQueryLoadContext) => {
    const db = requireSoQueryDb(context);
    const items = await db
      .select({
        id: answers.id,
        questionId: answers.questionId,
        body: answers.body,
        score: answers.score,
      })
      .from(answers)
      .orderBy(answers.id);
    return { items: items };
  },
  reads: [answer],
});

export const questionDetail = query('questionDetail', {
  args: s.object({ id: s.string() }),
  load: async (input: { id: string }, context?: SoQueryLoadContext): Promise<QuestionDetailResult | null> => {
    const db = requireSoQueryDb(context);
    const [row] = await db
      .select({
        id: questions.id,
        title: questions.title,
        body: questions.body,
        authorId: questions.authorId,
        score: questions.score,
        answerCount: questions.answerCount,
        authorName: questions.authorName,
        tags: questions.tags,
        createdAt: questions.createdAt,
      })
      .from(questions)
      .where(eq(questions.id, input.id))
      .limit(1);
    return row ?? null;
  },
  reads: [question],
});

export const questionAnswers = query('questionAnswers', {
  args: s.object({ questionId: s.string() }),
  load: async (
    input: { questionId: string },
    context?: SoQueryLoadContext,
  ): Promise<QuestionAnswersResult> => {
    const db = requireSoQueryDb(context);
    return db
      .select({
        id: answers.id,
        questionId: answers.questionId,
        body: answers.body,
        score: answers.score,
        accepted: answers.accepted,
        authorId: answers.authorId,
        authorName: answers.authorName,
        createdAt: answers.createdAt,
      })
      .from(answers)
      .where(eq(answers.questionId, input.questionId))
      .orderBy(asc(answers.id));
  },
  reads: [answer],
});

// Total score across all question votes.
export const questionScore = query('questionScore', {
  load: async (_input: unknown, context?: SoQueryLoadContext) => {
    const db = requireSoQueryDb(context);
    const rows = await db.select({ value: sum(votes.value) }).from(votes);
    return { score: Number(rows[0]?.value ?? 0) };
  },
  reads: [vote],
});

function requireSoQueryDb(context?: SoQueryLoadContext): SoDb {
  const db = context?.db ?? context?.request?.db;
  if (!db) {
    throw new Error('stackoverflow query loaders require context.db or request.db');
  }
  return db;
}
