import { route } from '@kovojs/server';
import { createApp, createRequestHandler } from '@kovojs/server/app-shell/core';
import { createMemoryVersionedClientModuleRegistry } from '@kovojs/server/app-shell/client-modules';
import type { RequestHandler } from '@kovojs/server';
import { asc, eq } from 'drizzle-orm';

import {
  QUESTION_LIST_TARGET,
  renderQuestionListPage,
  renderQuestionListRegion,
} from './components/question-list.js';
import { renderQuestionDetailPage, type AnswerDetail } from './components/question-detail.js';
import { createSoDb, type SoDb } from './db.js';
import { seedSoDemo } from './demo-data.js';
import {
  postAnswerMutation,
  postQuestionMutation,
  voteUpMutation,
} from './mutations.js';
import { questionList, questionScore } from './queries.js';
import { answers, questions } from './schema.js';

// SPEC.md §9.1/§9.5: the Stack Overflow example as a FULLY INTERACTIVE Kovo app.
// Unlike the read-only static-export shell (app-shell.ts), this registers the
// postQuestion / postAnswer / voteUp mutations and a `mutationResponse` that
// re-renders the affected fragment targets with server-truth query data. It is
// the same app whether it runs on a Node server (`pnpm start`) or inside the
// static export's in-browser backend (browser-backend.ts) — the request handler
// is pure Web Fetch, so the only difference is who calls it.

const soStylesheets = ['/assets/tailwind.css'] as const;

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

// The voteUp / postQuestion fragment payload: the question-list region re-rendered
// from server truth (post-mutation questionList rows + questionScore SUM).
async function renderQuestionListRegionFromDb(db: SoDb): Promise<string> {
  const context = { db, request: { db } };
  const [{ items }, { score: totalVotes }] = await Promise.all([
    questionList.load(undefined, context),
    questionScore.load(undefined, context),
  ]);
  return renderQuestionListRegion({ questions: items, totalVotes });
}

export interface SoInteractiveApp {
  app: ReturnType<typeof createApp>;
  db: SoDb;
  handler: RequestHandler;
}

export interface BuildSoInteractiveAppOptions {
  db?: SoDb;
  // When rendering the static export, the URL of the bundled in-browser backend.
  // Each page is wrapped in an `on:load` host that imports + installs it so the
  // export can serve its own mutation POSTs.
  backendModuleHref?: string;
}

/**
 * Build the interactive Stack Overflow app over a (seeded) PGlite database. Pass
 * an existing `db` to share state with an already-rendered shell; otherwise a
 * fresh seeded database is created.
 */
export async function buildSoInteractiveApp(
  options: BuildSoInteractiveAppOptions = {},
): Promise<SoInteractiveApp> {
  let db = options.db;
  if (!db) {
    db = await createSoDb();
    await seedSoDemo(db);
  }
  const database = db;

  const allQuestions = await database.select().from(questions).orderBy(asc(questions.id));

  const questionRoutes = allQuestions.map((question) =>
    route(`/questions/${question.id}`, {
      meta: { description: question.title, title: `${question.title} · DevOverflow` },
      async page() {
        const detailAnswers = await loadAnswersForQuestion(database, question.id);
        const [row] = await database
          .select()
          .from(questions)
          .where(eq(questions.id, question.id))
          .limit(1);
        return renderQuestionDetailPage({
          answers: detailAnswers,
          question: {
            id: question.id,
            title: row?.title ?? question.title,
            body: row?.body ?? question.body,
            authorId: row?.authorId ?? question.authorId,
            score: row?.score ?? question.score,
            answerCount: row?.answerCount ?? question.answerCount,
          },
        });
      },
      stylesheets: soStylesheets,
    }),
  );

  const backendModuleHref = options.backendModuleHref;
  const app = createApp({
    clientModules: createMemoryVersionedClientModuleRegistry(),
    document: { lang: 'en-US' },
    // SPEC.md §9.5: in the static export, wrap each page in a host whose
    // `on:load` imports the bundled in-browser backend, so the inline loader
    // stands up the mutation server before the viewer interacts.
    ...(backendModuleHref
      ? {
          renderRoute(value: unknown): string {
            const body = typeof value === 'string' ? value : '';
            return `<div on:load="${backendModuleHref}#installBackend">${body}</div>`;
          },
        }
      : {}),
    mutations: [voteUpMutation, postAnswerMutation, postQuestionMutation],
    queries: [questionList, questionScore],
    mutationResponse({ key }) {
      // SPEC.md §6.4: CSRF guards cross-origin form posts against a server
      // session. The example backend runs in the SAME browser context as the
      // page it serves (or a single-user demo server), so there is no
      // cross-origin session to protect — disable it for the no-auth demo.
      const csrf = false;
      // voteUp and postQuestion both change the ranked question region; re-render
      // it from server truth so every score / count reflects the committed write.
      if (key === voteUpMutation.key || key === postQuestionMutation.key) {
        return {
          csrf,
          fragmentRenderers: [
            {
              render: () => renderQuestionListRegionFromDb(database),
              stylesheets: soStylesheets,
              target: QUESTION_LIST_TARGET,
            },
          ],
        };
      }
      return { csrf };
    },
    routes: [
      route('/', {
        meta: {
          description: 'Top developer questions and answers.',
          title: 'Questions · DevOverflow',
        },
        async page() {
          const context = { db: database, request: { db: database } };
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

  const baseHandler = createRequestHandler(app);
  const handler: RequestHandler = (request) => {
    // SPEC.md §11.5: the mutation/query handlers read the Drizzle db off the
    // request. Attach it before dispatch (mirrors the commerce shell).
    Object.defineProperty(request, 'db', { configurable: true, value: database });
    return baseHandler(request);
  };

  return { app, db: database, handler };
}
