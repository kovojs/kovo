import { mutation, s } from '@kovojs/server';
import { eq, sql } from 'drizzle-orm';

import { answer, question, vote } from './domains.js';
import type { SoRequest } from './runtime.js';
import { answers, questions, votes } from './schema.js';

// SPEC.md §10.5 Stage 1: every mutation's write effect is extracted from the
// top-level handler functions below. The handlers destructure their input as the
// first param (so write values map to $input fields), receive a real
// PgliteDatabase via `request.db`, and INLINE the Drizzle writes (the extractor
// does NOT trace into delegated helpers). Self-referential column arithmetic uses
// a real sql template with BOTH operands interpolated — `sql`${col} + ${1}`` —
// which extracts as arith(col, +, 1); a literal `+ 1` inside the template would
// instead be Opaque and punt. The `mutation()` wrappers reference these handlers
// by identifier so the runtime/graph story and the static extraction agree.

// ── postQuestion: insert a new question (score/answerCount start at 0) ─────────
export async function postQuestion(
  { id, title, body, authorId }: { id: string; title: string; body: string; authorId: string },
  request: SoRequest,
): Promise<{ id: string }> {
  const db = request.db;
  await db.insert(questions).values({ id, title, body, authorId, score: 0, answerCount: 0 });
  return { id };
}

// ── postAnswer: insert an answer + bump the question's answerCount ─────────────
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

// ── voteUp: insert an upvote + bump the target question's score ────────────────
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

// ── mutation() definitions (runtime + graph surface) ──────────────────────────
// Each references its extracted handler by identifier; the registry pins the
// invalidated queries (by key) and the inferred touches come from the extracted
// touch graph (wired in app.ts).

// SPEC.md §6.4: this is a no-auth public demo with no server session to protect,
// so the mutations opt out of CSRF (`csrf: false`) — the enhance forms can POST
// without a token. A real app would keep CSRF on and render `csrfField`.
export const postQuestionMutation = mutation('postQuestion', {
  input: s.object({
    id: s.string(),
    title: s.string(),
    body: s.string(),
    authorId: s.string(),
  }),
  csrf: false,
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
  csrf: false,
  registry: { touches: [answer, question] },
  handler: postAnswer,
});

export const voteUpMutation = mutation('voteUp', {
  input: s.object({
    id: s.string(),
    targetId: s.string(),
    userId: s.string(),
  }),
  csrf: false,
  registry: { touches: [vote, question] },
  handler: voteUp,
});
