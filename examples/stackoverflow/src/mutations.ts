import { s } from '@kovojs/server';
import { and, eq, sql } from 'drizzle-orm';

import { app } from './kovo.js';
import { answer, question, vote } from './model.js';
import { questionDetail } from './queries.js';
import { answers, questions, votes } from './schema.js';

// Drizzle writes stay inline so compiler-owned app facts can attribute each effect to the exact
// mutation handle without hand-authored request/context types or registry augmentation.

const duplicateTitleError = s.object({ title: s.string() });
const postQuestionInput = s.object({
  id: s.string(),
  title: s.string(),
  body: s.string(),
});
const postAnswerInput = s.object({
  id: s.string(),
  questionId: s.string(),
  body: s.string(),
});
const voteUpInput = s.object({
  id: s.string(),
  targetId: s.string(),
});

export const postQuestionMutation = app.mutation({
  access: [app.authenticated],
  errors: {
    DUPLICATE_TITLE: duplicateTitleError,
  },
  input: postQuestionInput,
  registry: { touches: [question] },
  async handler({ id, title, body }, request, context) {
    const sessionId = request.session.id;
    const [existing] = await request.db
      .select({ id: questions.id })
      .from(questions)
      .where(and(eq(questions.sessionId, sessionId), eq(questions.title, title)))
      .limit(1);
    if (existing) {
      return context.fail('DUPLICATE_TITLE', { title });
    }

    await request.db.insert(questions).values({
      answerCount: 0,
      authorId: request.session.user.id,
      authorName: 'Anonymous',
      body,
      createdAt: '',
      id,
      score: 0,
      sessionId,
      tags: '',
      title,
    });
    return { id };
  },
});

export const postAnswerMutation = app.mutation({
  access: [app.authenticated],
  input: postAnswerInput,
  registry: { touches: [answer, question] },
  async handler({ id, questionId, body }, request) {
    const sessionId = request.session.id;
    await request.db.insert(answers).values({
      accepted: false,
      authorId: request.session.user.id,
      body,
      id,
      questionId,
      score: 0,
      sessionId,
    });
    await request.db
      .update(questions)
      .set({ answerCount: sql`${questions.answerCount} + ${1}` })
      .where(and(eq(questions.sessionId, sessionId), eq(questions.id, questionId)));
    return { id };
  },
});

export const voteUpMutation = app.mutation({
  access: [app.authenticated],
  input: voteUpInput,
  // The keyed whole-row query remains the named Stage-2 punt. Query-list and score optimism are
  // compiler-derived from the inline UPDATE/INSERT effects; the app does not repeat registry keys.
  optimistic: [
    questionDetail.optimistic(voteUpInput, {
      keys: (input) => [{ id: input.targetId }],
      apply(value) {
        return value ? { ...value, score: value.score + 1 } : null;
      },
    }),
  ],
  registry: { touches: [question, vote] },
  async handler({ id, targetId }, request) {
    const sessionId = request.session.id;
    await request.db.insert(votes).values({
      sessionId,
      targetType: 'question',
      targetId,
      userId: request.session.user.id,
      value: 1,
    });
    await request.db
      .update(questions)
      .set({ score: sql`${questions.score} + ${1}` })
      .where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));
    return { id };
  },
});
