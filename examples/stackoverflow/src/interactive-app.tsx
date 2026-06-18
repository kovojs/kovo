/** @jsxImportSource @kovojs/server */
import {
  createApp,
  createMemoryVersionedClientModuleRegistry,
  createRequestHandler,
  layout,
  route,
  s,
  stylesheet,
  type RequestHandler,
} from '@kovojs/server';

import { QuestionDetailRegion, questionDetailStyleCss } from './components/question-detail.js';
import { QuestionListRegion, questionListStyleCss } from './components/question-list.js';
import { SoShell, soChromeStyleCss } from './components/chrome.js';
import { createSoDb, type SoDb } from './db.js';
import { seedSoDemo } from './demo-data.js';
import { postAnswerMutation, postQuestionMutation, voteUpMutation } from './mutations.js';
import { soTheme } from './theme.js';

// SPEC.md §9.1: the Stack Overflow example as a fully interactive Kovo app. It
// registers the postQuestion / postAnswer / voteUp mutations and lets generated
// live-target renderers refresh visible query-backed regions from server truth.
// The native `enhance` forms POST to `/_m/*`; served by the Node server
// (scripts/serve.mjs), the inline loader morphs the re-rendered region.

const soStylesheets = [
  stylesheet('./styles.css', {
    criticalCss: [soChromeStyleCss, questionListStyleCss, questionDetailStyleCss],
    theme: soTheme,
  }),
] as const;
const demoSession = { id: 'demo-session', user: { id: 'demo-viewer', roles: ['member'] as const } };
const soStaticQuestionPaths = [
  '/questions/q1',
  '/questions/q2',
  '/questions/q3',
  '/questions/q4',
  '/questions/q5',
  '/questions/q6',
  '/questions/q7',
] as const;

const SoLayout = layout({
  render: (_queries, _state, { children }) => <SoShell>{children}</SoShell>,
});

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
  // questions posted at runtime are immediately viewable. SPEC.md §9.5 route
  // JSX composition lets the component query declarations load question +
  // answers from PGlite by `params.id`.
  const questionDetailRoute = route('/questions/:id', {
    meta: { description: 'Question detail', title: 'Question · DevOverflow' },
    params: s.object({ id: s.string() }),
    staticPaths: soStaticQuestionPaths,
    page({ params }: { params: { id: string } }) {
      return <QuestionDetailRegion questionId={params.id} />;
    },
    layout: SoLayout,
    stylesheets: soStylesheets,
  });

  const app = createApp({
    clientModules: createMemoryVersionedClientModuleRegistry(),
    db: () => database,
    document: { lang: 'en-US' },
    mutations: [voteUpMutation, postAnswerMutation, postQuestionMutation],
    routes: [
      route('/', {
        meta: {
          description: 'Top developer questions and answers.',
          title: 'Questions · DevOverflow',
        },
        page() {
          return <QuestionListRegion />;
        },
        layout: SoLayout,
        stylesheets: soStylesheets,
      }),
      questionDetailRoute,
    ],
    sessionProvider: () => demoSession,
  });

  const handler: RequestHandler = createRequestHandler(app);

  return { app, db: database, handler };
}
