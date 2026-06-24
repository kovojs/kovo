import { guards, mutation, s, type MutationContext } from '@kovojs/server';
import { and, eq, sql } from 'drizzle-orm';

import type { SoDb } from './db.js';
import { type SoRequest } from './model.js';
import { answers, questions, votes } from './schema.js';

// Top-level mutation handlers for the demo. Drizzle writes stay inline so the
// generated StackOverflow artifacts can read the write effects.

// Insert a new question; score and answer count start at zero.
export async function postQuestion(
  { id, title, body }: { id: string; title: string; body: string },
  request: SoRequest,
  context: MutationContext<{ DUPLICATE_TITLE: typeof duplicateTitleError }>,
) {
  const db = request.db;
  const sessionId = request.session?.id;
  if (!sessionId) {
    throw new Error('stackoverflow mutations require request.session.id');
  }
  const existing = await findExistingQuestionTitle(db, sessionId, title);
  if (existing) {
    return context.fail('DUPLICATE_TITLE', { title });
  }
  const authorId = request.session?.user?.id;
  if (!authorId) {
    throw new Error('stackoverflow mutations require request.session.user.id');
  }

  await db.insert(questions).values({
    answerCount: 0,
    authorId,
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
}

// Insert an answer and bump the question's answer count.
export async function postAnswer(
  { id, questionId, body }: { id: string; questionId: string; body: string },
  request: SoRequest,
): Promise<{ id: string }> {
  const db = request.db;
  const sessionId = request.session?.id;
  if (!sessionId) {
    throw new Error('stackoverflow mutations require request.session.id');
  }
  const authorId = request.session?.user?.id;
  if (!authorId) {
    throw new Error('stackoverflow mutations require request.session.user.id');
  }
  await db.insert(answers).values({
    id,
    sessionId,
    questionId,
    body,
    authorId,
    score: 0,
    accepted: false,
  });
  await db
    .update(questions)
    .set({ answerCount: sql`${questions.answerCount} + ${1}` })
    .where(and(eq(questions.sessionId, sessionId), eq(questions.id, questionId)));
  return { id };
}

// Insert an upvote and bump the target question's score.
export async function voteUp(
  { id, targetId }: { id: string; targetId: string },
  request: SoRequest,
): Promise<{ id: string }> {
  const db = request.db;
  const sessionId = request.session?.id;
  if (!sessionId) {
    throw new Error('stackoverflow mutations require request.session.id');
  }
  const userId = request.session?.user?.id;
  if (!userId) {
    throw new Error('stackoverflow mutations require request.session.user.id');
  }
  await db.insert(votes).values({
    sessionId,
    targetType: 'question',
    targetId,
    userId,
    value: 1,
  });
  await db
    .update(questions)
    .set({ score: sql`${questions.score} + ${1}` })
    .where(and(eq(questions.sessionId, sessionId), eq(questions.id, targetId)));
  return { id };
}

// mutation() definitions used by the app shell and generated graph.

export interface SoCsrfRequest {
  session?: { id?: string } | null;
}

export const EXAMPLE_ONLY_SO_CSRF_SECRET = 'stackoverflow-reference-demo-csrf-secret';

export const soCsrf = {
  field: 'csrf',
  secret: exampleDeploymentSecret('KOVO_STACKOVERFLOW_CSRF_SECRET', EXAMPLE_ONLY_SO_CSRF_SECRET),
  sessionId(request: SoCsrfRequest) {
    return request.session?.id;
  },
};

const duplicateTitleError = s.object({ title: s.string() });

async function findExistingQuestionTitle(
  db: SoDb,
  sessionId: string,
  title: string,
): Promise<unknown> {
  const [existing] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.sessionId, sessionId), eq(questions.title, title)))
    .limit(1);
  return existing;
}

export const postQuestionMutation = mutation('postQuestion', {
  access: { kind: 'guard-chain', guards: [{ name: 'authed' }] },
  input: s.object({
    id: s.string(),
    title: s.string(),
    body: s.string(),
  }),
  csrf: soCsrf,
  errors: {
    DUPLICATE_TITLE: duplicateTitleError,
  },
  guard: guards.authed<SoRequest>(),
  handler: postQuestion,
});

export const postAnswerMutation = mutation('postAnswer', {
  access: { kind: 'guard-chain', guards: [{ name: 'authed' }] },
  input: s.object({
    id: s.string(),
    questionId: s.string(),
    body: s.string(),
  }),
  csrf: soCsrf,
  guard: guards.authed<SoRequest>(),
  handler: postAnswer,
});

export const voteUpMutation = mutation('voteUp', {
  access: { kind: 'guard-chain', guards: [{ name: 'authed' }] },
  input: s.object({
    id: s.string(),
    targetId: s.string(),
  }),
  csrf: soCsrf,
  guard: guards.authed<SoRequest>(),
  handler: voteUp,
});

function exampleDeploymentSecret(envName: string, fallback: string): string {
  const secret = process.env[envName];
  if (secret && secret !== fallback) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${envName} must be set to a deployment-specific secret in production.`);
  }
  return fallback;
}
