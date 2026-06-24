import { publicAccess, query, s, type QueryLoadContext } from '@kovojs/server';
import { and, asc, eq, sum } from 'drizzle-orm';

import type { SoDb } from './db.js';
import { type QuestionAnswersResult, type QuestionDetailResult, type SoRequest } from './model.js';
import { answers, questions, votes } from './schema.js';

// Drizzle selects stay inline so the generated StackOverflow artifacts can
// inspect query shapes and register derived query-read domains.

type SoQueryLoadContext = QueryLoadContext<SoRequest> & { db?: SoDb };

// The list is ordered by stable id so a vote changes the score without reshuffling
// rows while a fragment response is being applied.
//
// Reads are public Q&A browsing (KV436 access decision, SPEC §10.2): every visitor
// gets an auto-provisioned demo session, so there is no authentication wall on reads.
const PUBLIC_QA_READ = 'public Q&A browsing';

export const questionList = query('questionList', {
  access: publicAccess(PUBLIC_QA_READ),
  load: async (_input: unknown, context?: SoQueryLoadContext) => {
    const db = requireSoQueryDb(context);
    const sessionId = context?.request?.session?.id;
    if (!sessionId) {
      throw new Error('stackoverflow query loaders require request.session.id');
    }
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
      .where(eq(questions.sessionId, sessionId))
      .orderBy(questions.id);
    // Keep the explicit property for the artifact generator.
    return { items: items };
  },
});

// All answers, ordered by stable id.
export const answerList = query('answerList', {
  access: publicAccess(PUBLIC_QA_READ),
  load: async (_input: unknown, context?: SoQueryLoadContext) => {
    const db = requireSoQueryDb(context);
    const sessionId = context?.request?.session?.id;
    if (!sessionId) {
      throw new Error('stackoverflow query loaders require request.session.id');
    }
    const items = await db
      .select({
        id: answers.id,
        questionId: answers.questionId,
        body: answers.body,
        score: answers.score,
      })
      .from(answers)
      .where(eq(answers.sessionId, sessionId))
      .orderBy(answers.id);
    return { items: items };
  },
});

export const questionDetail = query('questionDetail', {
  access: publicAccess(PUBLIC_QA_READ),
  args: s.object({ id: s.string() }),
  load: async (
    input: { id: string },
    context?: SoQueryLoadContext,
  ): Promise<QuestionDetailResult | null> => {
    const db = requireSoQueryDb(context);
    const sessionId = context?.request?.session?.id;
    if (!sessionId) {
      throw new Error('stackoverflow query loaders require request.session.id');
    }
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
      .where(and(eq(questions.sessionId, sessionId), eq(questions.id, input.id)))
      .limit(1);
    return row ?? null;
  },
});

export const questionAnswers = query('questionAnswers', {
  access: publicAccess(PUBLIC_QA_READ),
  args: s.object({ questionId: s.string() }),
  load: async (
    input: { questionId: string },
    context?: SoQueryLoadContext,
  ): Promise<QuestionAnswersResult> => {
    const db = requireSoQueryDb(context);
    const sessionId = context?.request?.session?.id;
    if (!sessionId) {
      throw new Error('stackoverflow query loaders require request.session.id');
    }
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
      .where(and(eq(answers.sessionId, sessionId), eq(answers.questionId, input.questionId)))
      .orderBy(asc(answers.id));
  },
});

// Total score across all question votes.
export const questionScore = query('questionScore', {
  access: publicAccess(PUBLIC_QA_READ),
  load: async (_input: unknown, context?: SoQueryLoadContext) => {
    const db = requireSoQueryDb(context);
    const sessionId = context?.request?.session?.id;
    if (!sessionId) {
      throw new Error('stackoverflow query loaders require request.session.id');
    }
    const rows = await db
      .select({ value: sum(votes.value) })
      .from(votes)
      .where(eq(votes.sessionId, sessionId));
    return { score: Number(rows[0]?.value ?? 0) };
  },
});

function requireSoQueryDb(context?: SoQueryLoadContext): SoDb {
  const db = context?.db ?? context?.request?.db;
  if (!db) {
    throw new Error('stackoverflow query loaders require context.db or request.db');
  }
  return db;
}
