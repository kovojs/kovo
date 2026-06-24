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
  type RoutePageResult,
  type StylesheetAsset,
} from '@kovojs/server';
import { eq } from 'drizzle-orm';

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
import { questions } from './schema.js';
import { soTheme } from './theme.js';

// SPEC.md §9.1: KovOverflow — the Stack Overflow example as a fully interactive
// Kovo app. It registers the postQuestion / postAnswer / voteUp mutations and
// lets generated live-target renderers refresh visible query-backed regions from
// server truth. The native `enhance` forms POST to `/_m/*`; served by the Node
// server (scripts/serve.mjs), the inline loader morphs the re-rendered region.

const soRoot = fileURLToPath(new URL('../', import.meta.url));
const soCriticalCss = stackOverflowCriticalCss();
const SO_DEMO_SESSION_HEADER = 'x-kovo-demo-sid';
const SO_DEMO_SESSION_COOKIE = 'kovo_demo_sid';
export const FALLBACK_SO_DEMO_SESSION_ID = 'demo-session';
const soStaticQuestionPaths = Array.from(
  { length: 14 },
  (_unused, index) => `/questions/q${index + 1}`,
);

// One layout per nav section so the shell can highlight the active sidebar item
// without threading the request URL through the render slots.
const soLayout = (active: NavSection) =>
  layout({
    render: (_queries, _state, { children }) => <SoShell active={active}>{children}</SoShell>,
  });
const QuestionsLayout = soLayout('questions');
const TagsLayout = soLayout('tags');
const UsersLayout = soLayout('users');

interface StackOverflowStylesheetManifest {
  app: readonly StylesheetAsset[];
  fragments: Readonly<Record<string, readonly StylesheetAsset[]>>;
  href?: string;
  routes: Readonly<Record<string, readonly StylesheetAsset[]>>;
}

function stackOverflowStylesheetManifest(): StackOverflowStylesheetManifest {
  const manifestPath = resolve(stackOverflowDistRoot(), 'stackoverflow-css-manifest.json');
  if (!existsSync(manifestPath)) return emptyStackOverflowStylesheetManifest();

  try {
    return stackOverflowStylesheetManifestFromJson(JSON.parse(readFileSync(manifestPath, 'utf8')));
  } catch {
    return emptyStackOverflowStylesheetManifest();
  }
}

function stackOverflowStylesheetManifestFromJson(value: unknown): StackOverflowStylesheetManifest {
  if (!isRecord(value)) return emptyStackOverflowStylesheetManifest();
  const href =
    typeof value.href === 'string' && localAssetHref(value.href) ? value.href : undefined;
  const app = stylesheetAssetList(value.app);
  const routes = stylesheetAssetMap(value.routes);
  const fragments = stylesheetAssetMap(value.fragments);

  return {
    app,
    fragments,
    ...(href === undefined ? {} : { href }),
    routes,
  };
}

function emptyStackOverflowStylesheetManifest(): StackOverflowStylesheetManifest {
  return { app: [], fragments: {}, routes: {} };
}

function stackOverflowDistRoot(): string {
  return process.env.KOVO_SO_CSS_DIST
    ? resolve(process.env.KOVO_SO_CSS_DIST)
    : resolve(soRoot, 'dist');
}

function stackOverflowBaseStylesheets(
  manifest: StackOverflowStylesheetManifest,
): readonly StylesheetAsset[] {
  return [
    stylesheet('./styles.css', {
      ...(soCriticalCss === undefined ? {} : { criticalCss: soCriticalCss }),
      href: manifest.href ?? '/assets/styles.css',
      theme: soTheme,
    }),
    ...deferredStylesheetRefs(manifest.app),
  ];
}

function stackOverflowRouteStylesheets(
  manifest: StackOverflowStylesheetManifest,
  routePath: string,
): readonly StylesheetAsset[] {
  return [
    ...stackOverflowBaseStylesheets(manifest),
    ...deferredStylesheetRefs(manifest.routes[routePath] ?? []),
  ];
}

function stylesheetAssetMap(value: unknown): Readonly<Record<string, readonly StylesheetAsset[]>> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, assets]) => [key, stylesheetAssetList(assets)]),
  );
}

function stylesheetAssetList(value: unknown): readonly StylesheetAsset[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isStylesheetAsset);
}

function deferredStylesheetRefs(assets: readonly StylesheetAsset[]): readonly StylesheetAsset[] {
  return assets.map((asset) => ({
    deferFull: true,
    href: asset.href,
    ...(asset.preload === undefined ? {} : { preload: asset.preload }),
  }));
}

function isStylesheetAsset(value: unknown): value is StylesheetAsset {
  if (!isRecord(value) || typeof value.href !== 'string' || !localAssetHref(value.href)) {
    return false;
  }
  return (
    (value.criticalCss === undefined || typeof value.criticalCss === 'string') &&
    (value.deferFull === undefined || typeof value.deferFull === 'boolean') &&
    (value.preload === undefined || typeof value.preload === 'boolean')
  );
}

function localAssetHref(value: string): boolean {
  return value.startsWith('/assets/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stackOverflowCriticalCss(): string | undefined {
  const sourcePath = resolve(soRoot, 'src/styles.css');
  if (!existsSync(sourcePath)) return undefined;

  try {
    return readFileSync(sourcePath, 'utf8');
  } catch {
    return undefined;
  }
}

export interface SoInteractiveApp {
  app: ReturnType<typeof createApp>;
  db: SoDb;
  handler: RequestHandler;
}

export interface BuildSoInteractiveAppOptions {
  db?: SoDb;
  onError?: NonNullable<Parameters<typeof createApp>[0]>['onError'];
}

/**
 * Build the interactive KovOverflow app over a PGlite database. The app keeps
 * one database handle and seeds each browser session's rows on first request, so
 * the hosted demo avoids rebuilding a full app/PGlite instance for every
 * cookieless visitor while preserving isolated public ids like q1/q2.
 */
export async function buildSoInteractiveApp(
  options: BuildSoInteractiveAppOptions = {},
): Promise<SoInteractiveApp> {
  const database = options.db ?? (await createSoDb());
  const ensureDemoSession = createSoDemoSessionSeeder(database);
  await ensureDemoSession(FALLBACK_SO_DEMO_SESSION_ID);
  const stylesheetManifest = stackOverflowStylesheetManifest();

  // SPEC.md §5.1: one parameterized detail route (not a route per seeded row), so
  // questions posted at runtime are immediately viewable. SPEC.md §9.5 route
  // JSX composition lets the component query declarations load question +
  // answers from PGlite by `params.id`.
  const questionDetailRoute = route('/questions/:id', {
    meta: { description: 'Question detail', title: 'Question · KovOverflow' },
    params: s.object({ id: s.string() }),
    staticPaths: soStaticQuestionPaths,
    page({ params }: { params: { id: string } }) {
      return withRail(
        <QuestionDetailRegion questionId={params.id} />,
        questionRail(params.id),
      ) as RoutePageResult;
    },
    layout: QuestionsLayout,
    stylesheets: stackOverflowRouteStylesheets(stylesheetManifest, '/questions/:id'),
  });

  const taggedQuestionsRoute = route('/questions/tagged/:tag', {
    meta: { description: 'Questions filtered by tag', title: 'Tagged questions · KovOverflow' },
    params: s.object({ tag: s.string() }),
    page({ params }: { params: { tag: string } }) {
      return <TaggedQuestionsRegion tag={params.tag} />;
    },
    layout: TagsLayout,
    stylesheets: stackOverflowRouteStylesheets(stylesheetManifest, '/questions/tagged/:tag'),
  });

  const userProfileRoute = route('/users/:id', {
    meta: { description: 'Member profile', title: 'User · KovOverflow' },
    params: s.object({ id: s.string() }),
    page({ params }: { params: { id: string } }) {
      return <UserProfileRegion userId={params.id} />;
    },
    layout: UsersLayout,
    stylesheets: stackOverflowRouteStylesheets(stylesheetManifest, '/users/:id'),
  });

  const app = createApp({
    clientModules: createMemoryVersionedClientModuleRegistry(),
    db: async (request) => {
      const sessionId = request.session?.id ?? FALLBACK_SO_DEMO_SESSION_ID;
      await ensureDemoSession(sessionId);
      return database;
    },
    document: { lang: 'en-US' },
    mutations: [voteUpMutation, postAnswerMutation, postQuestionMutation],
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    queries: [questionList, answerList, questionDetail, questionAnswers, questionScore],
    routes: [
      route('/', {
        meta: {
          description: 'Top developer questions and answers.',
          title: 'Questions · KovOverflow',
        },
        page() {
          return withRail(<QuestionListRegion />, homeRail()) as RoutePageResult;
        },
        layout: QuestionsLayout,
        stylesheets: stackOverflowRouteStylesheets(stylesheetManifest, '/'),
      }),
      taggedQuestionsRoute,
      questionDetailRoute,
      route('/tags', {
        meta: { description: 'Browse questions by tag.', title: 'Tags · KovOverflow' },
        page() {
          return <TagsPage />;
        },
        layout: TagsLayout,
        stylesheets: stackOverflowRouteStylesheets(stylesheetManifest, '/tags'),
      }),
      route('/users', {
        meta: { description: 'The KovOverflow community.', title: 'Users · KovOverflow' },
        page() {
          return <UsersPage />;
        },
        layout: UsersLayout,
        stylesheets: stackOverflowRouteStylesheets(stylesheetManifest, '/users'),
      }),
      userProfileRoute,
    ],
    sessionProvider: soDemoSessionProvider,
  });

  const handler: RequestHandler = createRequestHandler(app);

  return { app, db: database, handler };
}

function soDemoSessionProvider(request: Request) {
  const id =
    request.headers.get(SO_DEMO_SESSION_HEADER) ??
    readCookie(request.headers.get('cookie'), SO_DEMO_SESSION_COOKIE) ??
    FALLBACK_SO_DEMO_SESSION_ID;
  return { id, user: { id: 'demo-viewer', roles: ['member'] as const } };
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) continue;
    if (part.slice(0, eqIndex).trim() !== name) continue;
    return decodeURIComponent(part.slice(eqIndex + 1).trim());
  }
  return undefined;
}

function createSoDemoSessionSeeder(db: SoDb): (sessionId: string) => Promise<void> {
  const seeded = new Set<string>();
  const pending = new Map<string, Promise<void>>();

  return async function ensureSoDemoSession(sessionId: string): Promise<void> {
    if (seeded.has(sessionId)) return;
    const inFlight = pending.get(sessionId);
    if (inFlight) return inFlight;

    const seed = (async () => {
      const [existing] = await db
        .select({ id: questions.id })
        .from(questions)
        .where(eq(questions.sessionId, sessionId))
        .limit(1);
      if (!existing) {
        await seedSoDemo(db, sessionId);
      }
      seeded.add(sessionId);
    })().finally(() => {
      pending.delete(sessionId);
    });

    pending.set(sessionId, seed);
    return seed;
  };
}
