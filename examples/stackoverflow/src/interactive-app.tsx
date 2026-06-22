/** @jsxImportSource @kovojs/server */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
import { componentLiveTargetRenderer, type LiveTargetRenderer } from '@kovojs/server/internal/wire';

import { QuestionDetailRegion } from './components/question-detail.js';
import { QuestionListRegion } from './components/question-list.js';
import { TaggedQuestionsRegion } from './components/tagged-questions.js';
import { TagsPage } from './components/tags-page.js';
import { UserProfileRegion } from './components/user-profile.js';
import { UsersPage } from './components/users-page.js';
import { SoShell, type NavSection } from './components/chrome.js';
import { homeRail, questionRail, withRail } from './components/right-rail.js';
import { createSoDb, type SoDb } from './db.js';
import { seedSoDemo } from './demo-data.js';
import { postAnswerMutation, postQuestionMutation, voteUpMutation } from './mutations.js';
import {
  answerList,
  questionAnswers,
  questionDetail,
  questionList,
  questionScore,
} from './queries.js';
import { soTheme } from './theme.js';

// SPEC.md §9.1: KovOverflow — the Stack Overflow example as a fully interactive
// Kovo app. It registers the postQuestion / postAnswer / voteUp mutations and
// lets generated live-target renderers refresh visible query-backed regions from
// server truth. The native `enhance` forms POST to `/_m/*`; served by the Node
// server (scripts/serve.mjs), the inline loader morphs the re-rendered region.

const soRoot = fileURLToPath(new URL('../', import.meta.url));
const soStylesheets = [
  stylesheet('./styles.css', {
    href: stackOverflowStylesheetHref(),
    theme: soTheme,
  }),
] as const;
const demoSession = { id: 'demo-session', user: { id: 'demo-viewer', roles: ['member'] as const } };
const soStaticQuestionPaths = Array.from({ length: 14 }, (_unused, index) => `/questions/q${index + 1}`);

// One layout per nav section so the shell can highlight the active sidebar item
// without threading the request URL through the render slots.
const soLayout = (active: NavSection) =>
  layout({
    render: (_queries, _state, { children }) => <SoShell active={active}>{children}</SoShell>,
  });
const QuestionsLayout = soLayout('questions');
const TagsLayout = soLayout('tags');
const UsersLayout = soLayout('users');

// SPEC.md §4.2: the source-served route still needs the same derived component
// identities as lowered components so runtime root stamps advertise morphable
// live targets in the full GET document.
QuestionDetailRegion.name = 'components/question-detail/question-detail-region';
QuestionListRegion.name = 'components/question-list/question-list-region';

const sourceLiveTargetRenderers = [
  stampSourceLiveTargetRenderer(
    componentLiveTargetRenderer({
      component: QuestionListRegion,
      componentId: QuestionListRegion.name,
    }),
    { deps: 'questionList questionScore', target: 'question-list-region' },
  ),
  stampSourceLiveTargetRenderer(
    componentLiveTargetRenderer({
      component: QuestionDetailRegion,
      componentId: QuestionDetailRegion.name,
    }),
    { deps: 'questionAnswers questionDetail', target: 'question-detail-region' },
  ),
] as const;

function stampSourceLiveTargetRenderer<Request>(
  renderer: LiveTargetRenderer<Request>,
  attrs: { deps: string; target: string },
): LiveTargetRenderer<Request> {
  return {
    ...renderer,
    async render(context) {
      const html = await renderer.render(context);
      const props =
        Object.keys(context.props).length === 0 ? undefined : JSON.stringify(context.props);
      return stampSourceRegionRoot(html, {
        component: renderer.component,
        deps: attrs.deps,
        ...(props === undefined ? {} : { props }),
        target: attrs.target,
      });
    },
  };
}

function stampSourceRegionRoot(
  html: string,
  attrs: { component: string; deps: string; props?: string; target: string },
): string {
  const opening = /^<([A-Za-z][A-Za-z0-9:-]*)([^>]*)>/.exec(html);
  if (!opening) return html;
  const renderedAttrs = [
    `kovo-c="${attrs.target}"`,
    `kovo-deps="${attrs.deps}"`,
    `kovo-fragment-target="${attrs.target}"`,
    `kovo-live-component="${attrs.component}"`,
    attrs.props === undefined ? '' : `kovo-props="${escapeSourceAttribute(attrs.props)}"`,
  ]
    .filter(Boolean)
    .join(' ');

  return `<${opening[1]} ${renderedAttrs}${opening[2]}>${html.slice(opening[0].length)}`;
}

function escapeSourceAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function stackOverflowStylesheetHref(): string {
  const manifestPath = resolve(soRoot, 'dist/stackoverflow-css-manifest.json');
  if (!existsSync(manifestPath)) return '/assets/styles.css';

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { href?: unknown };
    return typeof manifest.href === 'string' && manifest.href.startsWith('/assets/')
      ? manifest.href
      : '/assets/styles.css';
  } catch {
    return '/assets/styles.css';
  }
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
 * Build the interactive KovOverflow app over a (seeded) PGlite database. Pass an
 * existing `db` to share state with an already-rendered shell; otherwise a fresh
 * seeded database is created. The returned handler is what the Node server
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
    meta: { description: 'Question detail', title: 'Question · KovOverflow' },
    params: s.object({ id: s.string() }),
    staticPaths: soStaticQuestionPaths,
    page({ params }: { params: { id: string } }) {
      return withRail(<QuestionDetailRegion questionId={params.id} />, questionRail(params.id));
    },
    layout: QuestionsLayout,
    stylesheets: soStylesheets,
  });

  const taggedQuestionsRoute = route('/questions/tagged/:tag', {
    meta: { description: 'Questions filtered by tag', title: 'Tagged questions · KovOverflow' },
    params: s.object({ tag: s.string() }),
    page({ params }: { params: { tag: string } }) {
      return <TaggedQuestionsRegion tag={params.tag} />;
    },
    layout: TagsLayout,
    stylesheets: soStylesheets,
  });

  const userProfileRoute = route('/users/:id', {
    meta: { description: 'Member profile', title: 'User · KovOverflow' },
    params: s.object({ id: s.string() }),
    page({ params }: { params: { id: string } }) {
      return <UserProfileRegion userId={params.id} />;
    },
    layout: UsersLayout,
    stylesheets: soStylesheets,
  });

  const app = createApp({
    clientModules: createMemoryVersionedClientModuleRegistry(),
    db: () => database,
    document: { lang: 'en-US' },
    liveTargetRenderers: sourceLiveTargetRenderers,
    mutations: [voteUpMutation, postAnswerMutation, postQuestionMutation],
    queries: [questionList, answerList, questionDetail, questionAnswers, questionScore],
    routes: [
      route('/', {
        meta: {
          description: 'Top developer questions and answers.',
          title: 'Questions · KovOverflow',
        },
        page() {
          return withRail(<QuestionListRegion />, homeRail());
        },
        layout: QuestionsLayout,
        stylesheets: soStylesheets,
      }),
      taggedQuestionsRoute,
      questionDetailRoute,
      route('/tags', {
        meta: { description: 'Browse questions by tag.', title: 'Tags · KovOverflow' },
        page() {
          return <TagsPage />;
        },
        layout: TagsLayout,
        stylesheets: soStylesheets,
      }),
      route('/users', {
        meta: { description: 'The KovOverflow community.', title: 'Users · KovOverflow' },
        page() {
          return <UsersPage />;
        },
        layout: UsersLayout,
        stylesheets: soStylesheets,
      }),
      userProfileRoute,
    ],
    sessionProvider: () => demoSession,
  });

  const handler: RequestHandler = createRequestHandler(app);

  return { app, db: database, handler };
}
