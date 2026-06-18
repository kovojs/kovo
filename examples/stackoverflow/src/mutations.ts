import { mutation, s, type MutationContext } from '@kovojs/server';
import { eq, sql } from 'drizzle-orm';

import { answer, question, vote, type SoRequest } from './model.js';
import { answers, questions, votes } from './schema.js';

// Top-level mutation handlers for the demo. Drizzle writes stay inline so the
// generated StackOverflow artifacts can read the write effects.

// Insert a new question; score and answer count start at zero.
export async function postQuestion(
  { id, title, body, authorId }: { id: string; title: string; body: string; authorId: string },
  request: SoRequest,
  context: MutationContext<{ DUPLICATE_TITLE: typeof duplicateTitleError }>,
) {
  const db = request.db;
  const [existing] = await db.select().from(questions).where(eq(questions.title, title)).limit(1);
  if (existing) {
    return context.fail('DUPLICATE_TITLE', { title });
  }

  await db.insert(questions).values({
    answerCount: 0,
    authorId,
    authorName: 'Anonymous',
    body,
    createdAt: '',
    id,
    score: 0,
    tags: '',
    title,
  });
  return { id };
}

// Insert an answer and bump the question's answer count.
export async function postAnswer(
  {
    id,
    questionId,
    body,
    authorId,
  }: { id: string; questionId: string; body: string; authorId: string },
  request: SoRequest,
): Promise<{ id: string }> {
  const db = request.db;
  await db.insert(answers).values({ id, questionId, body, authorId, score: 0, accepted: false });
  await db
    .update(questions)
    .set({ answerCount: sql`${questions.answerCount} + ${1}` })
    .where(eq(questions.id, questionId));
  return { id };
}

// Insert an upvote and bump the target question's score.
export async function voteUp(
  { id, targetId, userId }: { id: string; targetId: string; userId: string },
  request: SoRequest,
): Promise<{ id: string }> {
  const db = request.db;
  await db.insert(votes).values({ targetType: 'question', targetId, userId, value: 1 });
  await db
    .update(questions)
    .set({ score: sql`${questions.score} + ${1}` })
    .where(eq(questions.id, targetId));
  return { id };
}

// mutation() definitions used by the app shell and generated graph.

export interface SoCsrfRequest {
  session?: { id?: string } | null;
}

export const EXAMPLE_ONLY_SO_CSRF_SECRET = 'stackoverflow-reference-demo-csrf-secret';

export const soCsrf = {
  field: 'csrf',
  secret: EXAMPLE_ONLY_SO_CSRF_SECRET,
  sessionId(request: SoCsrfRequest) {
    return request.session?.id;
  },
};

const duplicateTitleError = s.object({ title: s.string() });

export const postQuestionMutation = mutation('postQuestion', {
  input: s.object({
    id: s.string(),
    title: s.string(),
    body: s.string(),
    authorId: s.string(),
  }),
  csrf: soCsrf,
  errors: {
    DUPLICATE_TITLE: duplicateTitleError,
  },
  registry: { touches: [question] },
  handler: postQuestion,
});

export const postAnswerMutation = mutation('postAnswer', {
  input: s.object({
    id: s.string(),
    questionId: s.string(),
    body: s.string(),
    authorId: s.string(),
  }),
  csrf: soCsrf,
  registry: { touches: [answer, question] },
  handler: postAnswer,
});

export const voteUpMutation = mutation('voteUp', {
  input: s.object({
    id: s.string(),
    targetId: s.string(),
    userId: s.string(),
  }),
  csrf: soCsrf,
  registry: { touches: [vote, question] },
  handler: voteUp,
});
