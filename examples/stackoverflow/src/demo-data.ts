import { and, eq } from 'drizzle-orm';

import type { SoDb } from './db.js';
import { DEMO_ANSWER_ROWS, DEMO_QUESTION_ROWS } from './directory.js';
import { answers, questions, votes } from './schema.js';

// The richer KovOverflow dataset is inserted per browser session. q1/q2 + a1
// are seeded first for focused tests, then dressed up and expanded with q3…q14
// plus their answers so the served app reads like a real Q&A site. Author
// identities, reputations, tags, and timestamps all come from ./directory.ts.

const BASE_QUESTION_ROWS = [
  {
    id: 'q1',
    title: 'How do I derive optimistic updates?',
    body: 'Compiler-derived from Drizzle.',
    authorId: 'u1',
    score: 3,
    answerCount: 1,
  },
  {
    id: 'q2',
    title: 'How do I keep demo state isolated?',
    body: 'Use a fresh in-memory database per run.',
    authorId: 'u2',
    score: 1,
    answerCount: 0,
  },
] as const;

const BASE_ANSWER_ROWS = [
  {
    id: 'a1',
    questionId: 'q1',
    authorId: 'u2',
    body: 'Use deriveOptimistic.',
    score: 2,
    accepted: false,
  },
] as const;

// Presentation overlay for the two base-seed questions. The tests rely on q1/q2
// existing and on q1 being the first row by id (with a votable score and an
// answer count they can move), but not on the specific values — so we make them
// look like real, well-received questions here.
const DEMO_BASE_QUESTION_OVERLAY = [
  {
    id: 'q1',
    title: 'How do I derive optimistic UI updates straight from a Drizzle mutation?',
    authorId: 'u1',
    authorName: 'Dana Whitfield',
    tags: 'kovo,optimistic-ui,drizzle',
    createdAt: '2026-06-14T18:20:00Z',
    score: 47,
    answerCount: 2,
    body: "I want an upvote to update the count the instant it's clicked and then reconcile with the server, but I don't want to hand-write the merge for every mutation. Can the framework read my Drizzle write and derive the optimistic patch from the query it affects?",
  },
  {
    id: 'q2',
    title: "What's the cleanest way to isolate per-session state for demos and tests?",
    authorId: 'u2',
    authorName: 'Theo Park',
    tags: 'testing,pglite,state',
    createdAt: '2026-06-08T08:05:00Z',
    score: 18,
    answerCount: 1,
    body: 'Each run of my example app should start from a clean slate so tests and live demos are deterministic and never leak state between visitors. What is the cleanest way to give every session its own throwaway database?',
  },
] as const;

// The base seed's a1 is q1's accepted answer; richer answers (incl. a second
// answer on q1 and a first answer on q2) are added on top.
const DEMO_BASE_ANSWER_OVERLAY = [
  {
    id: 'a1',
    authorId: 'u4',
    authorName: 'Marcus Webb',
    createdAt: '2026-06-14T19:02:00Z',
    score: 36,
    accepted: true,
    body: "Yes — that's the headline feature. The compiler reads the Drizzle mutation's write set, joins it with the read set of each affected query, and generates the optimistic transform for you. The count moves on click and then settles to server truth when the refreshed fragment comes back. No hand-written merge code.",
  },
] as const;

const DEMO_EXTRA_ANSWER_ROWS = [
  {
    id: 'a-q1-2',
    questionId: 'q1',
    authorId: 'u3',
    authorName: 'Priya Nair',
    body: 'One nuance worth knowing: collection queries get the derived optimistic update, but detail queries wait for the refreshed server fragment. So a vote bumps the list instantly, while the question page reconciles a beat later when the fragment lands. You rarely notice, but it explains the timing if you ever do.',
    score: 12,
    accepted: false,
    createdAt: '2026-06-14T20:31:00Z',
  },
  {
    id: 'a-q2-1',
    questionId: 'q2',
    authorId: 'u4',
    authorName: 'Marcus Webb',
    body: 'Mint a fresh in-process Postgres (PGlite) per session and key it by a cookie. Seed it once on creation, route that visitor’s requests to their instance, and evict on idle so memory stays bounded. Every visitor — and every test — gets a clean, isolated slate with zero cross-talk.',
    score: 14,
    accepted: true,
    createdAt: '2026-06-08T09:12:00Z',
  },
];

// A spread of upvotes across the seeded questions. Only the running total feeds
// the UI (the "votes cast across the community" line), so the exact rows are
// presentational — but they reference real question ids.
const VOTE_TARGETS = ['q3', 'q5', 'q5', 'q7', 'q11', 'q14', 'q14', 'q4', 'q6', 'q9', 'q10', 'q5'];
const DEMO_VOTES = VOTE_TARGETS.map((targetId, index) => ({
  targetType: 'question' as const,
  targetId,
  userId: `u${(index % 6) + 1}`,
  value: 1,
}));

/** Insert the richer demo dataset for one KovOverflow browser session. */
export async function seedSoDemo(db: SoDb, sessionId: string): Promise<void> {
  const scope = <Row extends object>(row: Row) => ({ ...row, sessionId });

  await db.insert(questions).values(BASE_QUESTION_ROWS.map(scope));
  await db.insert(answers).values(BASE_ANSWER_ROWS.map(scope));
  await db.insert(questions).values(DEMO_QUESTION_ROWS.map(scope));
  await db.insert(answers).values(DEMO_ANSWER_ROWS.map(scope));
  await db.insert(answers).values(DEMO_EXTRA_ANSWER_ROWS.map(scope));
  await db.insert(votes).values(DEMO_VOTES.map(scope));

  // Dress up the two base-seed questions for the served demo.
  for (const overlay of DEMO_BASE_QUESTION_OVERLAY) {
    await db
      .update(questions)
      .set({
        title: overlay.title,
        authorId: overlay.authorId,
        authorName: overlay.authorName,
        tags: overlay.tags,
        createdAt: overlay.createdAt,
        score: overlay.score,
        answerCount: overlay.answerCount,
        body: overlay.body,
      })
      .where(and(eq(questions.sessionId, sessionId), eq(questions.id, overlay.id)));
  }
  for (const overlay of DEMO_BASE_ANSWER_OVERLAY) {
    await db
      .update(answers)
      .set({
        authorId: overlay.authorId,
        authorName: overlay.authorName,
        createdAt: overlay.createdAt,
        score: overlay.score,
        accepted: overlay.accepted,
        body: overlay.body,
      })
      .where(and(eq(answers.sessionId, sessionId), eq(answers.id, overlay.id)));
  }
}
