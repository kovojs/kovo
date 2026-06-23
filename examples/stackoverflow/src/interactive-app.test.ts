import '../../../tests/example-generated-graphs.setup.js';

import { readFileSync } from 'node:fs';

import { and, asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { csrfToken } from '@kovojs/server';

import { buildSoInteractiveApp } from './interactive-app.js';
import { soCsrf } from './mutations.js';
import { answers, questions } from './schema.js';

const questionListTarget = 'question-list-region';
const questionListComponent = 'components/question-list/question-list-region';
const questionDetailTarget = 'question-detail-region';
const questionDetailComponent = 'components/question-detail/question-detail-region';
const demoSessionHeader = 'x-kovo-demo-sid';

function withCsrf(fields: Record<string, string>): Record<string, string> {
  return withSessionCsrf('demo-session', fields);
}

function withSessionCsrf(
  sessionId: string,
  fields: Record<string, string>,
): Record<string, string> {
  return {
    csrf: csrfToken({ session: { id: sessionId } }, soCsrf),
    ...fields,
  };
}

function liveHeader(
  target: string,
  component: string,
  props: Record<string, unknown> = {},
): string {
  return `${target}#${component}:${JSON.stringify(props)}`;
}

function browserCollectedLiveHeaders(html: string): { targets: string; liveTargets: string } {
  const targets = new Set<string>();
  const liveTargets = new Map<string, string>();

  for (const tag of html.matchAll(/<[^>]*\bkovo-deps=(?:"[^"]*"|'[^']*')[^>]*>/g)) {
    const attrs = readTagAttributes(tag[0]);
    const deps = readDeps(attrs['kovo-deps']);
    const target = attrs['kovo-fragment-target'] ?? attrs.id ?? attrs['kovo-c'];
    if (!target) continue;

    targets.add(deps.length > 0 ? `${target}=${deps.join(' ')}` : target);
    if (!liveTargets.has(target)) {
      liveTargets.set(
        target,
        `${target}#${attrs['kovo-live-component'] ?? attrs['kovo-c'] ?? target}:${decodeHtmlAttribute(attrs['kovo-props'] ?? '{}')}`,
      );
    }
  }

  return {
    liveTargets: [...liveTargets.values()].join('; '),
    targets: [...targets].join('; '),
  };
}

function readDeps(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((dep) => dep.trim())
    .filter(Boolean);
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

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

async function postForm(
  handler: (request: Request) => Promise<Response>,
  key: string,
  fields: Record<string, string>,
  targets: string,
  liveTargets: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; html: string }> {
  const response = await handler(
    new Request(`http://example.test/_m/${key}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': `${key}-${Object.values(fields).join('-')}`,
        'Kovo-Live-Targets': liveTargets,
        'Kovo-Targets': targets,
        ...headers,
      },
      body: new URLSearchParams(fields),
    }),
  );
  return { status: response.status, html: await response.text() };
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
        deps: 'questionList questionScore',
        route: '/',
        target: questionListTarget,
      },
      {
        deps: 'questionAnswers questionDetail',
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
      expect(html).not.toContain('<kovo-fragment');
    }
  });

  it('voteUp persists to PGlite and the fragment wire reflects the new score', async () => {
    const { db, handler } = await buildSoInteractiveApp();

    const [first] = await db.select().from(questions).orderBy(asc(questions.id)).limit(1);
    if (!first) throw new Error('seed produced no questions');
    const before = first.score;

    const response = await handler(
      new Request('http://example.test/_m/voteUp', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'Kovo-Fragment': 'true',
          'Kovo-Idem': 'test-vote-1',
          'Kovo-Live-Targets': liveHeader(questionListTarget, questionListComponent),
          'Kovo-Targets': `${questionListTarget}=questionList questionScore`,
        },
        body: new URLSearchParams(
          withCsrf({ id: 'v-test', targetId: first.id, userId: 'demo-viewer' }),
        ),
      }),
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<kovo-query name="questionList"');
    expect(html).toContain('<kovo-query name="questionScore"');

    // The real row was updated.
    const [after] = await db.select().from(questions).where(eq(questions.id, first.id)).limit(1);
    expect(after?.score).toBe(before + 1);

    // And the fragment HTML carries the incremented score (server truth).
    expect(html).toContain(String(before + 1));
  });

  it('postAnswer inserts the answer, bumps the count, and re-renders the detail region', async () => {
    const { db, handler } = await buildSoInteractiveApp();
    const [question] = await db.select().from(questions).orderBy(asc(questions.id)).limit(1);
    if (!question) throw new Error('seed produced no questions');
    const beforeCount = question.answerCount;

    const { status, html } = await postForm(
      handler,
      'postAnswer',
      withCsrf({
        id: 'a-test-1',
        questionId: question.id,
        body: 'A fresh demo answer.',
        authorId: 'demo-viewer',
      }),
      `${questionDetailTarget}=questionAnswers questionDetail`,
      liveHeader(questionDetailTarget, questionDetailComponent, { questionId: question.id }),
    );

    expect(status).toBe(200);
    expect(html).toContain('<kovo-query name="questionAnswers"');
    expect(html).toContain('<kovo-query name="questionDetail"');
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

    const page = await handler(
      new Request(`http://example.test/questions/${question.id}`, {
        headers: { Accept: 'text/html' },
      }),
    );
    const headers = browserCollectedLiveHeaders(await page.text());
    const detailTarget = `${questionDetailTarget}:${question.id}`;
    expect(headers.targets).toContain(`${detailTarget}=questionAnswers questionDetail`);
    expect(headers.liveTargets).toContain(
      liveHeader(detailTarget, questionDetailComponent, { questionId: question.id }),
    );

    const { status, html } = await postForm(
      handler,
      'postAnswer',
      withCsrf({
        id: 'a-browser-header-1',
        questionId: question.id,
        body: 'Visible without refresh.',
        authorId: 'demo-viewer',
      }),
      headers.targets,
      headers.liveTargets,
    );

    expect(status).toBe(200);
    expect(html).toContain(`<kovo-fragment target="${detailTarget}"`);
    expect(html).toContain('Visible without refresh.');
  });

  it('postQuestion inserts the question and re-renders the list region', async () => {
    const { db, handler } = await buildSoInteractiveApp();
    const before = (await db.select().from(questions)).length;

    const { status, html } = await postForm(
      handler,
      'postQuestion',
      withCsrf({
        id: 'q-test-1',
        title: 'How do I demo Kovo?',
        body: 'Asking for a friend.',
        authorId: 'demo-viewer',
      }),
      `${questionListTarget}=questionList questionScore`,
      liveHeader(questionListTarget, questionListComponent),
    );

    expect(status).toBe(200);
    expect(html).toContain('<kovo-query name="questionList"');
    expect(html).toContain('How do I demo Kovo?');

    const rows = await db.select().from(questions);
    expect(rows).toHaveLength(before + 1);
    expect(rows.some((row) => row.id === 'q-test-1')).toBe(true);
  });

  it('postQuestion typed failure re-renders the list form with duplicate-title state', async () => {
    const { db, handler } = await buildSoInteractiveApp();
    const [question] = await db.select().from(questions).orderBy(asc(questions.id)).limit(1);
    if (!question) throw new Error('seed produced no questions');

    const { status, html } = await postForm(
      handler,
      'postQuestion',
      withCsrf({
        id: 'q-duplicate-title',
        title: question.title,
        body: 'Asking again should surface a typed form failure.',
        authorId: 'demo-viewer',
      }),
      `${questionListTarget}=questionList questionScore`,
      liveHeader(questionListTarget, questionListComponent),
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

    await handler(
      new Request('http://example.test/', {
        headers: { Accept: 'text/html', [demoSessionHeader]: sessionA },
      }),
    );
    await handler(
      new Request('http://example.test/', {
        headers: { Accept: 'text/html', [demoSessionHeader]: sessionB },
      }),
    );

    const { status } = await postForm(
      handler,
      'postQuestion',
      withSessionCsrf(sessionA, {
        id: 'q-session-a-only',
        title,
        body: 'This should not appear in another browser session.',
        authorId: 'demo-viewer',
      }),
      `${questionListTarget}=questionList questionScore`,
      liveHeader(questionListTarget, questionListComponent),
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
