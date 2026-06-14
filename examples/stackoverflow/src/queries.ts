import { query, type QueryLoadContext } from '@jiso/server';
import { sum } from 'drizzle-orm';

import { answer, question, vote } from './domains.js';
import type { SoDb, SoRequest } from './runtime.js';
import { answers, questions, votes } from './schema.js';

// SPEC.md §10.2 / §10.5 Stage 2: typed reads declared once. Each loader INLINES
// its Drizzle select directly in the `query('key', { load })` body so the static
// extractor (extractAlgebraicShapesFromProject) classifies the AlgebraicQueryShape
// — the extractor does NOT trace into delegated helper functions. The db is taken
// from the query lifecycle context (context.db / context.request.db), typed SoDb
// (a real PgliteDatabase) so the receiver is a provable Drizzle surface.

type SoQueryLoadContext = QueryLoadContext<SoRequest> & { db?: SoDb };

// questionList — AGG over questions, ordered by the stable primary key.
// (We deliberately order by `id`, not `score DESC`: an UPDATE of an orderBy
// column moves the row, so voteUp×questionList would punt with `opaque-orderby`
// per SPEC.md §10.5. Ordering by the key keeps every (mutation×query) pair
// soundly derivable — the point of this focused showcase.)
export const questionList = query('questionList', {
  load: async (_input: unknown, context?: SoQueryLoadContext) => {
    const db = requireSoQueryDb(context);
    const items = await db
      .select({
        id: questions.id,
        title: questions.title,
        score: questions.score,
        answerCount: questions.answerCount,
      })
      .from(questions)
      .orderBy(questions.id);
    // EXPLICIT `items: items` (NOT shorthand `{ items }`, which the extractor skips).
    return { items: items };
  },
  reads: [question],
});

// answerList — AGG over answers, ordered by the stable primary key. Ships all
// answers (input-parameterized filters are out of scope for this example).
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

// questionScore — SUM of all vote values. The scalar is projected out of the
// `[{ value }]` aggregate result; the extractor classifies `score` as SUM.
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
