import { route, s } from '@kovojs/server';
import {
  createApp,
  createRequestHandler,
  type RequestHandler,
} from '@kovojs/server/app-shell/core';
import { createMemoryVersionedClientModuleRegistry } from '@kovojs/server/app-shell/client-modules';

import { renderQuestionListPage, type QuestionRow } from './generated/question-list.js';
import { renderQuestionDetailPage } from './generated/question-detail.js';
import { liveTargetRenderers } from './generated/live-targets.js';
import { createSoDb, type SoDb } from './db.js';
import { seedSoDemo } from './demo-data.js';
import { postAnswerMutation, postQuestionMutation, voteUpMutation } from './mutations.js';
import { questionAnswers, questionDetail, questionList, questionScore } from './queries.js';
import { questions } from './schema.js';

// SPEC.md §9.1: the Stack Overflow example as a fully interactive Kovo app. It
// registers the postQuestion / postAnswer / voteUp mutations and lets generated
// live-target renderers refresh visible query-backed regions from server truth.
// The native `enhance` forms POST to `/_m/*`; served by the Node server
// (scripts/serve.mjs), the inline loader morphs the re-rendered region.

const soStylesheets = ['/assets/styles.css'] as const;
const soStaticQuestionPaths = [
  '/questions/q1',
  '/questions/q2',
  '/questions/q3',
  '/questions/q4',
  '/questions/q5',
  '/questions/q6',
  '/questions/q7',
] as const;

// Presentational enrichment for question rows. The proven `questionList` query
// (queries.ts) selects only the §10.5 columns; here we join the cosmetic
// authorName / tags / createdAt + a body excerpt from the questions table, keyed
// by id, so both the page render and the fragment re-render show rich rows. These
// columns are never read by a query loader, so derived optimism is unaffected; a
// runtime-posted question (no demo metadata) simply renders with defaults.
async function enrichQuestionRows(db: SoDb, items: QuestionListItemBare[]): Promise<QuestionRow[]> {
  const rows = await db
    .select({
      id: questions.id,
      authorName: questions.authorName,
      tags: questions.tags,
      createdAt: questions.createdAt,
      body: questions.body,
    })
    .from(questions);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return items.map((item) => {
    const meta = byId.get(item.id);
    const excerpt = meta?.body
      ? meta.body.length > 140
        ? `${meta.body.slice(0, 140).trimEnd()}…`
        : meta.body
      : undefined;
    return {
      ...item,
      ...(meta?.authorName ? { authorName: meta.authorName } : {}),
      ...(meta?.tags ? { tags: meta.tags } : {}),
      ...(meta?.createdAt ? { createdAt: meta.createdAt } : {}),
      ...(excerpt ? { excerpt } : {}),
    };
  });
}

interface QuestionListItemBare {
  id: string;
  title: string;
  score: number;
  answerCount: number;
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
    staticPaths: soStaticQuestionPaths,
    async page({ params }: { params: { id: string } }) {
      const context = { db: database, request: { db: database } };
      const [question, detailAnswers] = await Promise.all([
        questionDetail.load({ id: params.id }, context),
        questionAnswers.load({ questionId: params.id }, context),
      ]);
      if (!question) {
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
      return renderQuestionDetailPage({
        answers: detailAnswers,
        question,
      });
    },
    stylesheets: soStylesheets,
  });

  const app = createApp({
    clientModules: createMemoryVersionedClientModuleRegistry(),
    document: { lang: 'en-US' },
    liveTargetRenderers,
    mutations: [voteUpMutation, postAnswerMutation, postQuestionMutation],
    queries: [questionList, questionScore, questionDetail, questionAnswers],
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
          const enriched = await enrichQuestionRows(database, items);
          return renderQuestionListPage({ questions: enriched, totalVotes });
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
