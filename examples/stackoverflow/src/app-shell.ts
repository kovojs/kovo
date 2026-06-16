import { route } from '@kovojs/server';
import { createMemoryVersionedClientModuleRegistry } from '@kovojs/server/app-shell/client-modules';
import { createApp, createRequestHandler } from '@kovojs/server/app-shell/core';
import { toNodeHandler } from '@kovojs/server/app-shell/node';
import { asc, eq } from 'drizzle-orm';

import { renderQuestionDetailPage, type AnswerDetail } from './components/question-detail.js';
import { renderQuestionListPage } from './components/question-list.js';
import { createSoDb, type SoDb } from './db.js';
import { seedSoDemo } from './demo-data.js';
import { questionList, questionScore } from './queries.js';
import { answers, questions } from './schema.js';

// SPEC.md §9.5: the Stack Overflow example's public, read-only static-export
// shell. It replays a real multi-page Kovo app — a ranked question list and a
// per-question detail page with answers — over the seeded PGlite database. The
// mutation + DERIVED-optimism story (postQuestion, postAnswer, voteUp) lives in
// mutations.ts and generated/optimistic/; this shell renders the read side so
// the example is browsable in the docs without a running server.

const soStylesheets = ['/assets/tailwind.css'] as const;
const clientModules = createMemoryVersionedClientModuleRegistry();

async function loadAnswersForQuestion(db: SoDb, questionId: string): Promise<AnswerDetail[]> {
  const rows = await db
    .select()
    .from(answers)
    .where(eq(answers.questionId, questionId))
    .orderBy(asc(answers.id));
  return rows.map((row) => ({
    id: row.id,
    questionId: row.questionId,
    body: row.body,
    score: row.score,
    accepted: row.accepted,
    authorId: row.authorId,
  }));
}

export async function createSoStaticExportShell(): Promise<{
  app: ReturnType<typeof createApp>;
  db: SoDb;
}> {
  const db = await createSoDb();
  await seedSoDemo(db);

  const allQuestions = await db.select().from(questions).orderBy(asc(questions.id));

  const questionRoutes = allQuestions.map((question) =>
    route(`/questions/${question.id}`, {
      meta: { description: question.title, title: `${question.title} · DevOverflow` },
      async page() {
        const detailAnswers = await loadAnswersForQuestion(db, question.id);
        return renderQuestionDetailPage({
          answers: detailAnswers,
          question: {
            id: question.id,
            title: question.title,
            body: question.body,
            authorId: question.authorId,
            score: question.score,
            answerCount: question.answerCount,
          },
        });
      },
      stylesheets: soStylesheets,
    }),
  );

  const app = createApp({
    clientModules,
    document: { lang: 'en-US' },
    routes: [
      route('/', {
        meta: {
          description: 'Top developer questions and answers.',
          title: 'Questions · DevOverflow',
        },
        async page() {
          const context = { db, request: { db } };
          const [{ items }, { score: totalVotes }] = await Promise.all([
            questionList.load(undefined, context),
            questionScore.load(undefined, context),
          ]);
          return renderQuestionListPage({ questions: items, totalVotes });
        },
        stylesheets: soStylesheets,
      }),
      ...questionRoutes,
    ],
  });

  return { app, db };
}

const staticShell = await createSoStaticExportShell();

export const soStaticExportApp = staticShell.app;
export const soStaticExportDb = staticShell.db;

// A node handler over the same read-only app, so `pnpm start` / the dev server
// can serve the multi-page UI live.
export const soNodeHandler = toNodeHandler(createRequestHandler(soStaticExportApp));

export default soStaticExportApp;
