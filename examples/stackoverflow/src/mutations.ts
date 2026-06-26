import { guards, mutation, s, type MutationContext } from '@kovojs/server';
import { and, eq, sql } from 'drizzle-orm';

import type { SoDb } from './db.js';
import { type QuestionListItem, type SoRequest } from './model.js';
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
  input: s.object({
    id: s.string(),
    targetId: s.string(),
  }),
  csrf: soCsrf,
  guard: guards.authed<SoRequest>(),
  // SPEC §10.4/§10.6: this optimistic map is exhaustiveness-checked (KV310) against the GENERATED
  // `@kovojs/core` InvalidationSets in `src/generated/registry.d.ts`. voteUp touches the
  // question + vote domains, so the generator derives `voteUp: questionDetail | questionList |
  // questionScore`; omitting any entry below is a `tsc` error — with NO hand-authored
  // `declare module` to drift from the real invalidation graph (capability-gaps §3). The draft
  // types come from each query loader via `QueryRegistry` (the single source of truth).
  optimistic: {
    // The ranked list bumps the voted question's score the instant the upvote is clicked.
    // `item` is annotated so the example still type-checks before the generated registry exists
    // (e.g. a bare `vp check`); `typecheck-examples` regenerates it and enforces KV310.
    questionList(draft, input) {
      const target = draft.items.find((item: QuestionListItem) => item.id === input.targetId);
      if (target) target.score += 1;
    },
    // The aggregate vote total moves immediately, then settles to server truth on reconcile.
    questionScore(draft, _input) {
      draft.score += 1;
    },
    // The question detail region reconciles to the refreshed server fragment (SPEC §10.4).
    questionDetail: 'await-fragment',
  },
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
