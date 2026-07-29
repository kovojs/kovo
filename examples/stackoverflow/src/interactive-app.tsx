/** @jsxImportSource @kovojs/server */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { s, stylesheet, type RoutePageResult, type StylesheetAsset } from '@kovojs/server';

import { QuestionDetailRegion } from './components/question-detail.js';
import { QuestionListRegion } from './components/question-list.js';
import { TaggedQuestionsRegion } from './components/tagged-questions.js';
import { TagsPage } from './components/tags-page.js';
import { UserProfileRegion } from './components/user-profile.js';
import { UsersPage } from './components/users-page.js';
import { SoShell } from './components/chrome.js';
import { homeRail, questionRail, withRail } from './components/right-rail.js';
import type { SoDb } from './db.js';
import { app, resetSoDatabase } from './kovo.js';
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
const soCriticalCss = stackOverflowCriticalCss();
const soStaticQuestionPaths = Array.from(
  { length: 14 },
  (_unused, index) => `/questions/q${index + 1}`,
);

// One layout per nav section so the shell can highlight the active sidebar item
// without threading the request URL through the render slots.
// Every section route is public Q&A browsing — visitors get an auto-provisioned demo
// session, so reads have no auth wall. The layouts carry the public access decision
// each child route inherits (KV436, SPEC §10.2); writes (votes/posts) stay guarded.
const QuestionsLayout = app.layout({
  access: app.publicAccess('public Q&A browsing'),
  render: (_queries, _state, { children }) => <SoShell active="questions">{children}</SoShell>,
});
const TagsLayout = app.layout({
  access: app.publicAccess('public Q&A browsing'),
  render: (_queries, _state, { children }) => <SoShell active="tags">{children}</SoShell>,
});
const UsersLayout = app.layout({
  access: app.publicAccess('public Q&A browsing'),
  render: (_queries, _state, { children }) => <SoShell active="users">{children}</SoShell>,
});

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

export interface BuildSoInteractiveAppOptions {
  db?: SoDb;
}

const stylesheetManifest = stackOverflowStylesheetManifest();
const publicBrowsing = app.publicAccess('public Q&A browsing');

// SPEC.md §5.1: one parameterized detail route (not a route per seeded row), so questions posted
// at runtime are immediately viewable.
const questionDetailRoute = app.route('/questions/:id', {
  access: publicBrowsing,
  meta: { description: 'Question detail', title: 'Question · KovOverflow' },
  params: s.object({ id: s.string() }),
  staticPaths: soStaticQuestionPaths,
  page({ params }) {
    return withRail(
      <QuestionDetailRegion questionId={params.id} />,
      questionRail(params.id),
    ) as RoutePageResult;
  },
  layout: QuestionsLayout,
  stylesheets: stackOverflowRouteStylesheets(stylesheetManifest, '/questions/:id'),
});

const taggedQuestionsRoute = app.route('/questions/tagged/:tag', {
  access: publicBrowsing,
  meta: { description: 'Questions filtered by tag', title: 'Tagged questions · KovOverflow' },
  params: s.object({ tag: s.string() }),
  page({ params }) {
    return <TaggedQuestionsRegion tag={params.tag} />;
  },
  layout: TagsLayout,
  stylesheets: stackOverflowRouteStylesheets(stylesheetManifest, '/questions/tagged/:tag'),
});

const userProfileRoute = app.route('/users/:id', {
  access: publicBrowsing,
  meta: { description: 'Member profile', title: 'User · KovOverflow' },
  params: s.object({ id: s.string() }),
  page({ params }) {
    return <UserProfileRegion userId={params.id} />;
  },
  layout: UsersLayout,
  stylesheets: stackOverflowRouteStylesheets(stylesheetManifest, '/users/:id'),
});

const homeRoute = app.route('/', {
  access: publicBrowsing,
  meta: {
    description: 'Top developer questions and answers.',
    title: 'Questions · KovOverflow',
  },
  page() {
    return withRail(<QuestionListRegion />, homeRail()) as RoutePageResult;
  },
  layout: QuestionsLayout,
  stylesheets: stackOverflowRouteStylesheets(stylesheetManifest, '/'),
});

const tagsRoute = app.route('/tags', {
  access: publicBrowsing,
  meta: { description: 'Browse questions by tag.', title: 'Tags · KovOverflow' },
  page() {
    return <TagsPage />;
  },
  layout: TagsLayout,
  stylesheets: stackOverflowRouteStylesheets(stylesheetManifest, '/tags'),
});

const usersRoute = app.route('/users', {
  access: publicBrowsing,
  meta: { description: 'The KovOverflow community.', title: 'Users · KovOverflow' },
  page() {
    return <UsersPage />;
  },
  layout: UsersLayout,
  stylesheets: stackOverflowRouteStylesheets(stylesheetManifest, '/users'),
});

export const soApp = app.assemble({
  layouts: [QuestionsLayout, TagsLayout, UsersLayout],
  mutations: [voteUpMutation, postAnswerMutation, postQuestionMutation],
  queries: [questionList, answerList, questionDetail, questionAnswers, questionScore],
  routes: [
    homeRoute,
    taggedQuestionsRoute,
    questionDetailRoute,
    tagsRoute,
    usersRoute,
    userProfileRoute,
  ],
});

/** Reset the test/development database and return the already-closed app token. */
export async function buildSoInteractiveApp(options: BuildSoInteractiveAppOptions = {}) {
  const db = await resetSoDatabase(options.db);
  return { app: soApp, db };
}
