import { runWithStackOverflowGeneratedGraphs } from '../../../tests/example-generated-graphs.setup.js';

import { readFileSync } from 'node:fs';

import { and, asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  decodeFrameworkQueryDependencyToken,
  encodeFrameworkLiveTargetHeader,
  encodeFrameworkTargetHeader,
  type FrameworkQueryDependencyIdentity,
} from '@kovojs/core/internal/wire-input-grammar';
import { createExampleTestRequestHandler } from '../../../tests/example-raw-request-handler.js';

import type { BuildSoInteractiveAppOptions } from './interactive-app.js';
import { answers, questions, votes } from './schema.js';

const questionListTarget = 'question-list-region';
const questionDetailTarget = 'question-detail-region';
const questionDetailComponent = 'components/question-detail/question-detail-region';
const demoSessionHeader = 'x-kovo-demo-sid';

async function buildSoInteractiveApp(options: BuildSoInteractiveAppOptions = {}) {
  return runWithStackOverflowGeneratedGraphs(async () => {
    const { buildSoInteractiveApp: buildSoInteractiveApplication } =
      await import('./interactive-app.js');
    const application = await buildSoInteractiveApplication(options);
    return { ...application, handler: createExampleTestRequestHandler(application.app) };
  });
}

function withCsrf(mutation: string, fields: Record<string, string>): Record<string, string> {
  return withSessionCsrf('demo-session', mutation, fields);
}

function withSessionCsrf(
  _sessionId: string,
  _mutation: string,
  fields: Record<string, string>,
): Record<string, string> {
  return fields;
}

interface BrowserCollectedLiveHeaders {
  buildToken: string;
  csrfTokens: Readonly<Record<string, string>>;
  currentUrl: string;
  idemTokens: Readonly<Record<string, string>>;
  liveTargets: string;
  targets: string;
}

async function browserCollectedLiveHeadersForRoute(
  handler: (request: Request) => Promise<Response>,
  route: string,
  headers: Record<string, string> = {},
): Promise<BrowserCollectedLiveHeaders> {
  const currentUrl = `http://example.test${route}`;
  const response = await handler(
    new Request(currentUrl, {
      headers: { Accept: 'text/html', ...headers },
    }),
  );
  const html = await response.text();
  const mutationFields = readMutationSecurityFields(html);
  return {
    buildToken: readDocumentBuildToken(html),
    csrfTokens: mutationFields.csrf,
    currentUrl,
    idemTokens: mutationFields.idem,
    ...browserCollectedLiveHeaders(html),
  };
}

function readMutationSecurityFields(html: string): {
  csrf: Readonly<Record<string, string>>;
  idem: Readonly<Record<string, string>>;
} {
  const csrf: Record<string, string> = {};
  const idem: Record<string, string> = {};
  for (const match of html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)) {
    const openingTag = match[0].slice(0, match[0].indexOf('>') + 1);
    const action = readTagAttributes(openingTag).action;
    if (!action?.startsWith('/_m/')) continue;
    for (const input of match[0].matchAll(/<input\b[^>]*>/g)) {
      const attrs = readTagAttributes(input[0]);
      if (attrs.name === 'csrf' && attrs.value) {
        csrf[action.slice('/_m/'.length)] = attrs.value;
      }
      if (attrs.name === 'Kovo-Idem' && attrs.value) {
        idem[action.slice('/_m/'.length)] = attrs.value;
      }
    }
  }
  return { csrf, idem };
}

function browserCollectedLiveHeaders(
  html: string,
): Pick<BrowserCollectedLiveHeaders, 'liveTargets' | 'targets'> {
  const targets = new Set<string>();
  const liveTargets = new Map<string, string>();

  for (const tag of html.matchAll(/<[^>]*\bkovo-deps=(?:"[^"]*"|'[^']*')[^>]*>/g)) {
    const attrs = readTagAttributes(tag[0]);
    const deps = readDeps(attrs['kovo-deps']);
    const target = attrs['kovo-fragment-target'] ?? attrs.id ?? attrs['kovo-c'];
    if (!target) continue;

    targets.add(encodeFrameworkTargetHeader([{ deps, target }]));
    if (!liveTargets.has(target)) {
      liveTargets.set(
        target,
        encodeFrameworkLiveTargetHeader([
          {
            attestation: attrs['kovo-live-token'] ?? '',
            component: attrs['kovo-live-component'] ?? attrs['kovo-c'] ?? target,
            propsSource: attrs['kovo-props'],
            target,
          },
        ]),
      );
    }
  }

  return {
    liveTargets: [...liveTargets.values()].join('; '),
    targets: [...targets].join('; '),
  };
}

function readDeps(value: string | undefined): FrameworkQueryDependencyIdentity[] {
  return (value ?? '')
    .split(' ')
    .filter(Boolean)
    .map((token) => {
      const dependency = decodeFrameworkQueryDependencyToken(token);
      if (!dependency) {
        throw new Error(`StackOverflow document carried invalid kovo-deps token ${token}.`);
      }
      return dependency;
    });
}

function readTagAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/\s([A-Za-z_:][\w:.-]*)=(?:"([^"]*)"|'([^']*)')/g)) {
    const name = match[1];
    if (!name) continue;
    attrs[name] = decodeHtmlAttribute(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

function readDocumentBuildToken(html: string): string {
  for (const match of html.matchAll(/<meta\b[^>]*>/g)) {
    const attrs = readTagAttributes(match[0]);
    if (attrs.name === 'kovo-build' && attrs.content) return attrs.content;
  }
  throw new Error('StackOverflow document did not carry its Kovo build identity.');
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

function decodeHtmlText(value: string): string {
  return decodeHtmlAttribute(value);
}

function readKovoQuery<T>(html: string, name: string): T {
  const pattern = new RegExp(`<kovo-query\\s+name="${name}"[^>]*>([\\s\\S]*?)<\\/kovo-query>`);
  const match = pattern.exec(html);
  if (!match) throw new Error(`expected <kovo-query name="${name}"> in response`);
  return JSON.parse(decodeHtmlText(match[1] ?? '')) as T;
}

async function postForm(
  handler: (request: Request) => Promise<Response>,
  key: string,
  fields: Record<string, string>,
  live: BrowserCollectedLiveHeaders,
  headers: Record<string, string> = {},
): Promise<{ status: number; html: string }> {
  const response = await handler(
    new Request(`http://example.test/_m/${key}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        // Same-origin Origin header a real browser always sends; the CSRF Origin
        // floor (SPEC §9.5) rejects header-less POSTs with 422. Node fetch omits it.
        Origin: 'http://example.test',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': requiredMutationIdem(live, key),
        'Kovo-Current-Url': live.currentUrl,
        'Kovo-Build': live.buildToken,
        'Kovo-Live-Targets': live.liveTargets,
        'Kovo-Targets': live.targets,
        Referer: live.currentUrl,
        ...headers,
      },
      body: new URLSearchParams({
        ...fields,
        csrf: requiredMutationCsrf(live, key),
      }),
    }),
  );
  return { status: response.status, html: await response.text() };
}

function requiredMutationCsrf(live: BrowserCollectedLiveHeaders, key: string): string {
  const token = live.csrfTokens[key];
  if (!token) throw new Error(`StackOverflow document omitted the CSRF field for ${key}.`);
  return token;
}

function requiredMutationIdem(live: BrowserCollectedLiveHeaders, key: string): string {
  const token = live.idemTokens[key];
  if (!token) throw new Error(`StackOverflow document omitted the idempotency field for ${key}.`);
  return token;
}

describe('stackoverflow interactive app', () => {
  it('keeps authored global CSS limited to app resets', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(css).not.toContain('./generated/');
    expect(css).not.toContain('.bg-slate-50');
    expect(css).not.toContain('.text-slate-900');
    expect(css).not.toContain('.rounded-lg');
    expect(css).not.toContain('.grid {');
  });

  it('keeps route critical CSS to used theme variables and app reset rules', async () => {
    const { handler } = await buildSoInteractiveApp();
    const response = await handler(new Request('http://example.test/questions/q3'));
    const html = await response.text();
    const criticalCss = [
      ...html.matchAll(/<style[^>]*data-kovo-critical-href="[^"]*"[^>]*>([\s\S]*?)<\/style>/g),
    ]
      .map((match) => match[1] ?? '')
      .join('\n');

    expect(response.status).toBe(200);
    expect(Buffer.byteLength(criticalCss, 'utf8')).toBeLessThan(2_000);
    expect(criticalCss).toContain('--kovo-theme-sys-color-surface:');
    expect(criticalCss).toContain('--kovo-theme-sys-color-on-surface:');
    expect(criticalCss).toContain('font-family:');
    expect(criticalCss).not.toContain('--kovo-theme-ref-palette-primary-40:');
    expect(criticalCss).not.toContain('--kovo-theme-sys-color-primary:');
    expect(criticalCss).not.toContain('--kovo-theme-sys-shape-corner-medium:');
  });

  it('serves every authored route as no-JS full HTML documents', async () => {
    const { handler } = await buildSoInteractiveApp();
    const routes = [
      {
        deps: 'queries%2Fquestion-list queries%2Fquestion-score',
        route: '/',
        target: questionListTarget,
      },
      {
        deps: 'queries%2Fquestion-answers queries%2Fquestion-detail',
        route: '/questions/q1',
        target: `${questionDetailTarget}:q1`,
      },
    ];

    for (const { deps, route, target } of routes) {
      const response = await handler(
        new Request(`http://example.test${route}`, {
          headers: { Accept: 'text/html' },
        }),
      );
      const html = await response.text();
      expect(response.status, html).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('<main');
      expect(html).toContain(`kovo-fragment-target="${target}"`);
      expect(html).toContain(`kovo-deps="${deps}"`);
      expect(html).toContain(
        '<kovo-defer target="stackoverflow-right-rail" state="pending" data-kovo-region-priority="visible">',
      );
      expect(html).toContain('<kovo-fragment target="stackoverflow-right-rail" priority="visible"');
      expect(html.indexOf('<kovo-defer target="stackoverflow-right-rail"')).toBeLessThan(
        html.indexOf('--kovo-boundary'),
      );
      if (route === '/questions/q1') {
        expect(html).toContain(
          '<kovo-defer target="question-detail-secondary:q1" state="pending" data-kovo-region-priority="after-paint">',
        );
        expect(html).toContain('<kovo-fragment target="question-detail-secondary:q1"');
        expect(html).toContain('No hand-written merge code.');
        expect(html).toContain('Your Answer');
      } else {
        expect(html).toContain('Hot Network Questions');
      }
    }
  });

  it('voteUp response reconciles derived optimism to committed PGlite query truth', async () => {
    const { db, handler } = await buildSoInteractiveApp();

    const [first] = await db.select().from(questions).orderBy(asc(questions.id)).limit(1);
    if (!first) throw new Error('seed produced no questions');
    const before = first.score;
    const beforeVoteTotal = (await db.select().from(votes)).reduce(
      (total, row) => total + row.value,
      0,
    );
    const live = await browserCollectedLiveHeadersForRoute(handler, '/');

    const response = await handler(
      new Request('http://example.test/_m/mutations/vote-up-mutation', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          Origin: 'http://example.test',
          'Kovo-Fragment': 'true',
          'Kovo-Idem': requiredMutationIdem(live, 'mutations/vote-up-mutation'),
          'Kovo-Current-Url': live.currentUrl,
          'Kovo-Build': live.buildToken,
          'Kovo-Live-Targets': live.liveTargets,
          'Kovo-Targets': live.targets,
          Referer: live.currentUrl,
        },
        body: new URLSearchParams({
          id: 'v-test',
          targetId: first.id,
          userId: 'demo-viewer',
          csrf: requiredMutationCsrf(live, 'mutations/vote-up-mutation'),
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/vnd.kovo.fragment+html; charset=utf-8');
    const html = await response.text();
    const questionList = readKovoQuery<{
      items: readonly { id: string; score: number; sessionId?: string }[];
    }>(html, 'queries/question-list');
    const questionScore = readKovoQuery<{ score: number }>(html, 'queries/question-score');
    const responseQuestion = questionList.items.find((item) => item.id === first.id);
    if (!responseQuestion) throw new Error(`response omitted voted question ${first.id}`);

    // The real row was updated.
    const [after] = await db.select().from(questions).where(eq(questions.id, first.id)).limit(1);
    expect(after?.score).toBe(before + 1);
    const afterVoteTotal = (await db.select().from(votes)).reduce(
      (total, row) => total + row.value,
      0,
    );
    expect(afterVoteTotal).toBe(beforeVoteTotal + 1);

    // The response query chunks are the server-truth reconcile payload for the
    // derived exact-row optimistic transition: score and aggregate both settle to
    // the committed PGlite values without shipping private session scope.
    expect(responseQuestion.score).toBe(before + 1);
    expect(responseQuestion.sessionId).toBeUndefined();
    expect(questionScore.score).toBe(afterVoteTotal);
    expect(questionScore.score).toBe(beforeVoteTotal + 1);
    expect(html).not.toContain('demo-session');
    expect(html).not.toContain('sessionId');
    expect(html).not.toContain('session_id');

    // And the fragment HTML carries the incremented score for DOM morphing.
    expect(html).toContain(String(before + 1));
  });

  it('postAnswer inserts the answer, bumps the count, and re-renders the detail region', async () => {
    const { db, handler } = await buildSoInteractiveApp();
    const [question] = await db.select().from(questions).orderBy(asc(questions.id)).limit(1);
    if (!question) throw new Error('seed produced no questions');
    const beforeCount = question.answerCount;
    const live = await browserCollectedLiveHeadersForRoute(handler, `/questions/${question.id}`);

    const { status, html } = await postForm(
      handler,
      'mutations/post-answer-mutation',
      withCsrf('mutations/post-answer-mutation', {
        id: 'a-test-1',
        questionId: question.id,
        body: 'A fresh demo answer.',
        authorId: 'demo-viewer',
      }),
      live,
    );

    expect(status).toBe(200);
    expect(html).toContain('<kovo-query name="queries/question-answers"');
    expect(html).toContain('<kovo-query name="queries/question-detail"');
    expect(html).toContain('A fresh demo answer.');

    const inserted = await db.select().from(answers).where(eq(answers.id, 'a-test-1'));
    expect(inserted).toHaveLength(1);
    const [after] = await db.select().from(questions).where(eq(questions.id, question.id)).limit(1);
    expect(after?.answerCount).toBe(beforeCount + 1);
  });

  it('postAnswer refreshes when submitted with the live headers collected from the full document', async () => {
    const { db, handler } = await buildSoInteractiveApp();
    const [question] = await db.select().from(questions).orderBy(asc(questions.id)).limit(1);
    if (!question) throw new Error('seed produced no questions');

    const headers = await browserCollectedLiveHeadersForRoute(handler, `/questions/${question.id}`);
    const detailTarget = `${questionDetailTarget}:${question.id}`;
    expect(headers.targets).toContain(
      `${encodeURIComponent(detailTarget)}=queries%2Fquestion-answers queries%2Fquestion-detail`,
    );
    expect(headers.liveTargets).toContain(
      `${encodeURIComponent(detailTarget)}#${encodeURIComponent(questionDetailComponent)}@`,
    );
    expect(headers.liveTargets).toContain(`:${JSON.stringify({ questionId: question.id })}`);

    const { status, html } = await postForm(
      handler,
      'mutations/post-answer-mutation',
      withCsrf('mutations/post-answer-mutation', {
        id: 'a-browser-header-1',
        questionId: question.id,
        body: 'Visible without refresh.',
        authorId: 'demo-viewer',
      }),
      headers,
    );

    expect(status).toBe(200);
    expect(html).toContain(`<kovo-fragment target="${detailTarget}"`);
    expect(html).toContain('Visible without refresh.');
  });

  it('postQuestion inserts the question and re-renders the list region', async () => {
    const { db, handler } = await buildSoInteractiveApp();
    const before = (await db.select().from(questions)).length;
    const live = await browserCollectedLiveHeadersForRoute(handler, '/');

    const { status, html } = await postForm(
      handler,
      'mutations/post-question-mutation',
      withCsrf('mutations/post-question-mutation', {
        id: 'q-test-1',
        title: 'How do I demo Kovo?',
        body: 'Asking for a friend.',
        authorId: 'demo-viewer',
      }),
      live,
    );

    expect(status).toBe(200);
    expect(html).toContain('<kovo-query name="queries/question-list"');
    expect(html).toContain('How do I demo Kovo?');

    const rows = await db.select().from(questions);
    expect(rows).toHaveLength(before + 1);
    expect(rows.some((row) => row.id === 'q-test-1')).toBe(true);
  });

  it('postQuestion typed failure re-renders the list form with duplicate-title state', async () => {
    const { db, handler } = await buildSoInteractiveApp();
    const [question] = await db.select().from(questions).orderBy(asc(questions.id)).limit(1);
    if (!question) throw new Error('seed produced no questions');
    const live = await browserCollectedLiveHeadersForRoute(handler, '/');

    const { status, html } = await postForm(
      handler,
      'mutations/post-question-mutation',
      withCsrf('mutations/post-question-mutation', {
        id: 'q-duplicate-title',
        title: question.title,
        body: 'Asking again should surface a typed form failure.',
        authorId: 'demo-viewer',
      }),
      live,
    );

    expect(status).toBe(422);
    expect(html).toContain(`target="${questionListTarget}"`);
    expect(html).toContain('data-error-code="DUPLICATE_TITLE"');
    expect(html).toContain(`A question titled "${question.title}" already exists.`);
  });

  it('shares one handler while keeping browser sessions isolated by session id', async () => {
    const { db, handler } = await buildSoInteractiveApp();
    const sessionA = 'session-a';
    const sessionB = 'session-b';
    const title = 'Session A only question';

    const live = await browserCollectedLiveHeadersForRoute(handler, '/', {
      [demoSessionHeader]: sessionA,
    });
    await handler(
      new Request('http://example.test/', {
        headers: { Accept: 'text/html', [demoSessionHeader]: sessionB },
      }),
    );

    const { status } = await postForm(
      handler,
      'mutations/post-question-mutation',
      withSessionCsrf(sessionA, 'mutations/post-question-mutation', {
        id: 'q-session-a-only',
        title,
        body: 'This should not appear in another browser session.',
        authorId: 'demo-viewer',
      }),
      live,
      { [demoSessionHeader]: sessionA },
    );

    expect(status).toBe(200);

    const rowsA = await db
      .select()
      .from(questions)
      .where(and(eq(questions.sessionId, sessionA), eq(questions.id, 'q-session-a-only')));
    const rowsB = await db
      .select()
      .from(questions)
      .where(and(eq(questions.sessionId, sessionB), eq(questions.id, 'q-session-a-only')));
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(0);

    const sessionBHome = await handler(
      new Request('http://example.test/', {
        headers: { Accept: 'text/html', [demoSessionHeader]: sessionB },
      }),
    );
    expect(await sessionBHome.text()).not.toContain(title);
  });
});
