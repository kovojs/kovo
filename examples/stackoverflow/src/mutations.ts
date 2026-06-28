import { guards, mutation, s, type MutationContext } from '@kovojs/server';
import { and, eq, sql } from 'drizzle-orm';

import type { SoDb } from './db.js';
import {
  type PostAnswerInput,
  type PostQuestionInput,
  type SoRequest,
  type VoteUpInput,
} from './model.js';
import { questionDetail } from './queries.js';
import { answers, questions, votes } from './schema.js';

// Top-level mutation handlers for the demo. Drizzle writes stay inline so the
// generated StackOverflow artifacts can read the write effects.

// Insert a new question; score and answer count start at zero.
export async function postQuestion(
  { id, title, body }: PostQuestionInput,
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
  { id, questionId, body }: PostAnswerInput,
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
  { id, targetId }: VoteUpInput,
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

export const postQuestionMutation = mutation({
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

export const postAnswerMutation = mutation({
  input: s.object({
    id: s.string(),
    questionId: s.string(),
    body: s.string(),
  }),
  csrf: soCsrf,
  guard: guards.authed<SoRequest>(),
  handler: postAnswer,
});

export const voteUpMutation = mutation({
  input: s.object({
    id: s.string(),
    targetId: s.string(),
  }),
  csrf: soCsrf,
  guard: guards.authed<SoRequest>(),
  // SPEC §10.4/§10.5/§10.6: this optimistic map is exhaustiveness-checked (KV310) against the
  // GENERATED `@kovojs/core` registry in `src/generated/registry.d.ts`. voteUp touches the
  // question + vote domains, so the generator derives `InvalidationSets[voteUp] = questionDetail |
  // questionList | questionScore`. Of those, the §10.5 deriver COMPILER-DERIVES `questionList`
  // (UPDATE × AGG → guarded exact-row `score += 1`) and `questionScore` (INSERT × SUM →
  // `score += 1`) from the Drizzle write effects + query shapes, so the generator emits them into
  // `OptimisticDerivationSets[voteUp]` and the author does NOT hand-write them — they are OPTIONAL
  // here (omitting them is no longer a `tsc` error). Only the NAMED-punt pair below stays
  // hand-written; with NO hand-authored `declare module` to drift from the real invalidation graph
  // (capability-gaps §1/§3). The draft types come from each query loader via `QueryRegistry`.
  optimistic: {
    // PUNTED by the §10.5 deriver (`kovo explain --optimistic`: OPTIMISTIC-PUNT questionDetail) —
    // its loader returns a keyed WHOLE row (`return row ?? null`), a scalar-from-keyed-row return
    // the Stage-2 classifier does not yet model, AND a derived keyed `{ keys, transform }` is not
    // yet emittable, so it stays REQUIRED and hand-written. The question-detail page is a KEYED
    // query: `questionDetail:q3` vs `questionDetail:q7` coexist (SPEC §10.2). Optimism is keyed to
    // the query (§10.4), so the transform says WHICH instance it predicts — `keys` derives that
    // instance key from the voted question id (`input.targetId`), exactly as `questionDetail`'s
    // own WHERE eq-predicate resolves `id` from args (§10.2). Server truth reconciles by
    // `kovo-key` (§13.2). `draft` is `QuestionDetailResult | null` (loader returns `row ?? null`).
    [questionDetail.key]: {
      keys: (input) => ({ id: input.targetId }),
      transform(draft, _input) {
        if (draft) draft.score += 1;
      },
    },
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
