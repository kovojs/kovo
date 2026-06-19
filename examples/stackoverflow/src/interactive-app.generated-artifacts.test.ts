import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { csrfToken } from '@kovojs/server';

import { buildSoInteractiveApp } from './interactive-app.generated-fixtures.js';
import { soCsrf } from './mutations.js';
import { answers, questions } from './schema.js';

const questionListTarget = 'question-list-region';
const questionListComponent = 'components/question-list/question-list-region';
const questionDetailTarget = 'question-detail-region';
const questionDetailComponent = 'components/question-detail/question-detail-region';
const demoCsrfRequest = { session: { id: 'demo-session' } };

function withCsrf(fields: Record<string, string>): Record<string, string> {
  return {
    csrf: csrfToken(demoCsrfRequest, soCsrf),
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

async function postForm(
  handler: (request: Request) => Promise<Response>,
  key: string,
  fields: Record<string, string>,
  targets: string,
  liveTargets: string,
): Promise<{ status: number; html: string }> {
  const response = await handler(
    new Request(`http://example.test/_m/${key}`, {
      body: new URLSearchParams(fields),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': `${key}-${Object.values(fields).join('-')}`,
        'Kovo-Live-Targets': liveTargets,
        'Kovo-Targets': targets,
      },
      method: 'POST',
    }),
  );
  return { status: response.status, html: await response.text() };
}

describe('stackoverflow generated app artifacts', () => {
  it('render generated live-target fragments for answer mutations', async () => {
    const { db, handler } = await buildSoInteractiveApp();
    const [question] = await db.select().from(questions).orderBy(asc(questions.id)).limit(1);
    if (!question) throw new Error('seed produced no questions');

    const { status, html } = await postForm(
      handler,
      'postAnswer',
      withCsrf({
        authorId: 'demo-viewer',
        body: 'A fresh demo answer.',
        id: 'a-test-1',
        questionId: question.id,
      }),
      `${questionDetailTarget}=answers question`,
      liveHeader(questionDetailTarget, questionDetailComponent, { questionId: question.id }),
    );

    expect(status).toBe(200);
    expect(html).toContain(`target="${questionDetailTarget}"`);
    expect(html).toContain('A fresh demo answer.');
    await expect(db.select().from(answers).where(eq(answers.id, 'a-test-1'))).resolves.toHaveLength(
      1,
    );
  });

  it('render generated live-target fragments for question mutations', async () => {
    const { db, handler } = await buildSoInteractiveApp();
    const before = (await db.select().from(questions)).length;

    const { status, html } = await postForm(
      handler,
      'postQuestion',
      withCsrf({
        authorId: 'demo-viewer',
        body: 'Asking for a friend.',
        id: 'q-test-1',
        title: 'How do I demo Kovo?',
      }),
      `${questionListTarget}=questionList questionScore`,
      liveHeader(questionListTarget, questionListComponent),
    );

    expect(status).toBe(200);
    expect(html).toContain(`target="${questionListTarget}"`);
    expect(html).toContain('How do I demo Kovo?');
    expect(await db.select().from(questions)).toHaveLength(before + 1);
  });

  it('render generated form-helper failure fragments for question mutations', async () => {
    const { db, handler } = await buildSoInteractiveApp();
    const [question] = await db.select().from(questions).orderBy(asc(questions.id)).limit(1);
    if (!question) throw new Error('seed produced no questions');

    const { status, html } = await postForm(
      handler,
      'postQuestion',
      withCsrf({
        authorId: 'demo-viewer',
        body: 'Asking again should surface a typed form failure.',
        id: 'q-duplicate-title',
        title: question.title,
      }),
      `${questionListTarget}=questionList questionScore`,
      liveHeader(questionListTarget, questionListComponent),
    );

    expect(status).toBe(422);
    expect(html).toContain(`target="${questionListTarget}"`);
    expect(html).toContain('data-error-code="DUPLICATE_TITLE"');
    expect(html).toContain(`A question titled "${question.title}" already exists.`);
  });
});
