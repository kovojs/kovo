import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { QUESTION_LIST_TARGET } from './components/question-list.js';
import { buildSoInteractiveApp } from './interactive-app.js';
import { questions } from './schema.js';

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
          'Kovo-Targets': QUESTION_LIST_TARGET,
        },
        body: new URLSearchParams({ id: 'v-test', targetId: first.id, userId: 'demo-viewer' }),
      }),
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    // It is a fragment-wire response targeting the question region.
    expect(html).toContain(`target="${QUESTION_LIST_TARGET}"`);

    // The real row was updated.
    const [after] = await db.select().from(questions).where(eq(questions.id, first.id)).limit(1);
    expect(after?.score).toBe(before + 1);

    // And the fragment HTML carries the incremented score (server truth).
    expect(html).toContain(String(before + 1));
  });
});
