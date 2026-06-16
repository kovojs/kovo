import { route, s } from '@kovojs/server';
import {
  createApp,
  createRequestHandler,
  type RequestHandler,
} from '@kovojs/server/app-shell/core';
import { createMemoryVersionedClientModuleRegistry } from '@kovojs/server/app-shell/client-modules';
import { asc, eq } from 'drizzle-orm';

import {
  QUESTION_LIST_TARGET,
  renderQuestionListPage,
  renderQuestionListRegion,
} from './components/question-list.js';
import {
  QUESTION_DETAIL_TARGET,
  renderQuestionDetailPage,
  renderQuestionDetailRegion,
  type AnswerDetail,
} from './components/question-detail.js';
import { createSoDb, type SoDb } from './db.js';
import { seedSoDemo } from './demo-data.js';
import { postAnswerMutation, postQuestionMutation, voteUpMutation } from './mutations.js';
import { questionList, questionScore } from './queries.js';
import { answers, questions } from './schema.js';

// SPEC.md §9.1: the Stack Overflow example as a FULLY INTERACTIVE Kovo app. It
// registers the postQuestion / postAnswer / voteUp mutations and a
// `mutationResponse` that re-renders the affected fragment targets with
// server-truth query data. The native `enhance` forms POST to `/_m/*`; served by
// the Node server (scripts/serve.mjs), the inline loader morphs the re-rendered
// region. voteUp re-renders the list region (on `/`) and the question card (on a
// detail page); postQuestion re-renders the list; postAnswer the detail region.

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

// The voteUp (on a detail page) / postAnswer fragment payload: the question detail
// region re-rendered from server truth (question card + answers + bumped count).
async function renderQuestionDetailRegionFromDb(db: SoDb, questionId: string): Promise<string> {
  const [row] = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
  if (!row) return '';
  const detailAnswers = await loadAnswersForQuestion(db, questionId);
  return renderQuestionDetailRegion({
    answers: detailAnswers,
    question: {
      id: row.id,
      title: row.title,
      body: row.body,
      authorId: row.authorId,
      score: row.score,
      answerCount: row.answerCount,
    },
  });
}

// Read a string field from the parsed mutation input (FormData for enhance-form
// posts, or a plain object for JSON posts).
function readInputField(rawInput: unknown, name: string): string | undefined {
  if (typeof FormData !== 'undefined' && rawInput instanceof FormData) {
    const value = rawInput.get(name);
    return typeof value === 'string' ? value : undefined;
  }
  if (rawInput && typeof rawInput === 'object' && name in rawInput) {
    const value = (rawInput as Record<string, unknown>)[name];
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

export interface SoInteractiveApp {
  app: ReturnType<typeof createApp>;
  db: SoDb;
  handler: RequestHandler;
}

export interface BuildSoInteractiveAppOptions {
  db?: SoDb;
}

/**
 * Build the interactive Stack Overflow app over a (seeded) PGlite database. Pass
 * an existing `db` to share state with an already-rendered shell; otherwise a
 * fresh seeded database is created. The returned handler is what the Node server
 * (scripts/serve.mjs) serves — mutations round-trip natively over PGlite.
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

  // SPEC.md §5.1: one parameterized detail route (not a route per seeded row), so
  // questions posted at runtime are immediately viewable. The page loads the
  // question + answers from PGlite by `params.id`.
  const questionDetailRoute = route('/questions/:id', {
    meta: { description: 'Question detail', title: 'Question · DevOverflow' },
    params: s.object({ id: s.string() }),
    async page({ params }: { params: { id: string } }) {
      const [row] = await database
        .select()
        .from(questions)
        .where(eq(questions.id, params.id))
        .limit(1);
      if (!row) {
        return renderQuestionDetailPage({
          answers: [],
          question: {
            id: params.id,
            title: 'Question not found',
            body: 'This question does not exist (it may have been a demo that reset).',
            authorId: 'system',
            score: 0,
            answerCount: 0,
          },
        });
      }
      const detailAnswers = await loadAnswersForQuestion(database, row.id);
      return renderQuestionDetailPage({
        answers: detailAnswers,
        question: {
          id: row.id,
          title: row.title,
          body: row.body,
          authorId: row.authorId,
          score: row.score,
          answerCount: row.answerCount,
        },
      });
    },
    stylesheets: soStylesheets,
  });

  const app = createApp({
    clientModules: createMemoryVersionedClientModuleRegistry(),
    document: { lang: 'en-US' },
    mutations: [voteUpMutation, postAnswerMutation, postQuestionMutation],
    queries: [questionList, questionScore],
    mutationResponse({ key, rawInput }) {
      // CSRF is disabled on the mutation definitions themselves (csrf: false in
      // mutations.ts — a no-auth demo). Here we only pick which fragment regions
      // to re-render from server truth.
      //
      // No per-fragment `stylesheets`: the page already loaded the app
      // stylesheet, and a fragment-leading <link> would become the morph root and
      // replace the region with a bare <link>. The re-rendered region reuses the
      // already-present Tailwind classes.
      const listRenderer = {
        render: () => renderQuestionListRegionFromDb(database),
        target: QUESTION_LIST_TARGET,
      };
      const detailRenderer = (questionId: string) => ({
        render: () => renderQuestionDetailRegionFromDb(database, questionId),
        target: QUESTION_DETAIL_TARGET,
      });

      // Return every plausibly-affected region; the inline loader applies only the
      // fragments whose target host exists in the current page (list on `/`,
      // detail on `/questions/:id`).
      const fragmentRenderers = [];
      if (key === voteUpMutation.key) {
        fragmentRenderers.push(listRenderer);
        const targetId = readInputField(rawInput, 'targetId');
        if (targetId) fragmentRenderers.push(detailRenderer(targetId));
      } else if (key === postQuestionMutation.key) {
        fragmentRenderers.push(listRenderer);
      } else if (key === postAnswerMutation.key) {
        const questionId = readInputField(rawInput, 'questionId');
        if (questionId) fragmentRenderers.push(detailRenderer(questionId));
      }

      return fragmentRenderers.length > 0 ? { fragmentRenderers } : undefined;
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
      questionDetailRoute,
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
