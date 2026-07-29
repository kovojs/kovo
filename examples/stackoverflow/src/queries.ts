import { s } from '@kovojs/server';
import { and, asc, eq, sum } from 'drizzle-orm';

import { app } from './kovo.js';
import {
  vote,
  type AnswerListResult,
  type QuestionAnswersResult,
  type QuestionDetailResult,
  type QuestionListResult,
  type QuestionScoreResult,
} from './model.js';
import { answers, questions, votes } from './schema.js';

// Drizzle selects stay inline so the generated StackOverflow artifacts can
// inspect query shapes and register derived query-read domains.

// SPEC §9.4/§10.3 (MARQUEE): `defineKovo({ db })` infers the framework-owned read-only handle at
// `context.db`. Write verbs are absent at the type level and throw at runtime; session scope rides
// the app-inferred request context.

// The list is ordered by stable id so a vote changes the score without reshuffling
// rows while a fragment response is being applied.
//
// Reads are public Q&A browsing (KV436 access decision, SPEC §10.2): every visitor
// gets an auto-provisioned demo session, so there is no authentication wall on reads.
const PUBLIC_QA_READ = 'public Q&A browsing';

export const questionList = app.query({
  access: app.publicAccess(PUBLIC_QA_READ),
  load: async (_input, context): Promise<QuestionListResult> => {
    const db = context.db;
    const sessionId = context.request.session?.id;
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
export const answerList = app.query({
  access: app.publicAccess(PUBLIC_QA_READ),
  load: async (_input, context): Promise<AnswerListResult> => {
    const db = context.db;
    const sessionId = context.request.session?.id;
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

export const questionDetail = app.query({
  access: app.publicAccess(PUBLIC_QA_READ),
  args: s.object({ id: s.string() }),
  load: async (input, context): Promise<QuestionDetailResult | null> => {
    const db = context.db;
    const sessionId = context.request.session?.id;
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

export const questionAnswers = app.query({
  access: app.publicAccess(PUBLIC_QA_READ),
  args: s.object({ questionId: s.string() }),
  load: async (input, context): Promise<QuestionAnswersResult> => {
    const db = context.db;
    const sessionId = context.request.session?.id;
    if (!sessionId) {
      throw new Error('stackoverflow query loaders require request.session.id');
    }
    const rows = await db
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
    return rows;
  },
});

// Total score across all question votes.
export const questionScore = app.query({
  access: app.publicAccess(PUBLIC_QA_READ),
  output: s.object({ score: s.number() }),
  reads: [vote],
  load: async (_input, context): Promise<QuestionScoreResult> => {
    const db = context.db;
    const sessionId = context.request.session?.id;
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
