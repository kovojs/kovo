import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { buildSoInteractiveApp } from './interactive-app.js';
import { answers, questions } from './schema.js';

const questionListTarget = 'question-list-region';
const questionListComponent = 'components/question-list/question-list-region';
const questionDetailTarget = 'question-detail-region';
const questionDetailComponent = 'components/question-detail/question-detail-region';

function liveHeader(target: string, component: string, props: Record<string, unknown> = {}): string {
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
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': `${key}-${Object.values(fields).join('-')}`,
        'Kovo-Live-Targets': liveTargets,
        'Kovo-Targets': targets,
      },
      body: new URLSearchParams(fields),
    }),
  );
  return { status: response.status, html: await response.text() };
}

// SPEC.md §9.1: the interactive app's voteUp endpoint runs the REAL Drizzle
// mutation against PGlite and returns the fragment wire — the same handler the
// in-browser backend serves inside the static export. This proves the server
// half of the round-trip (no browser): a POST /_m/voteUp increments the persisted
// score AND the re-rendered fragment carries the new value.

describe('stackoverflow interactive app', () => {
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
        body: new URLSearchParams({ id: 'v-test', targetId: first.id, userId: 'demo-viewer' }),
      }),
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    // It is a fragment-wire response targeting the question region.
    expect(html).toContain(`target="${questionListTarget}"`);

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
      {
        id: 'a-test-1',
        questionId: question.id,
        body: 'A fresh demo answer.',
        authorId: 'demo-viewer',
      },
      `${questionDetailTarget}=answers question`,
      liveHeader(questionDetailTarget, questionDetailComponent, { questionId: question.id }),
    );

    expect(status).toBe(200);
    expect(html).toContain(`target="${questionDetailTarget}"`);
    expect(html).toContain('A fresh demo answer.');

    const inserted = await db.select().from(answers).where(eq(answers.id, 'a-test-1'));
    expect(inserted).toHaveLength(1);
    const [after] = await db.select().from(questions).where(eq(questions.id, question.id)).limit(1);
    expect(after?.answerCount).toBe(beforeCount + 1);
  });

  it('postQuestion inserts the question and re-renders the list region', async () => {
    const { db, handler } = await buildSoInteractiveApp();
    const before = (await db.select().from(questions)).length;

    const { status, html } = await postForm(
      handler,
      'postQuestion',
      {
        id: 'q-test-1',
        title: 'How do I demo Kovo?',
        body: 'Asking for a friend.',
        authorId: 'demo-viewer',
      },
      `${questionListTarget}=questionList questionScore`,
      liveHeader(questionListTarget, questionListComponent),
    );

    expect(status).toBe(200);
    expect(html).toContain(`target="${questionListTarget}"`);
    expect(html).toContain('How do I demo Kovo?');

    const rows = await db.select().from(questions);
    expect(rows).toHaveLength(before + 1);
    expect(rows.some((row) => row.id === 'q-test-1')).toBe(true);
  });
});
