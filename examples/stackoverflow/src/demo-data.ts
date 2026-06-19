import { eq } from 'drizzle-orm';

import type { SoDb } from './db.js';
import { answers, questions, votes } from './schema.js';

// Presentation-only enrichment for the two base-seed rows (q1/q2 + a1) created by
// createSoDb(). The focused tests rely on those rows existing with their base
// title/score, but not on author/tags/timestamps — so the served demo dresses
// them up here without touching the test seed in db.ts.
const DEMO_BASE_OVERLAY = [
  {
    id: 'q1',
    authorName: 'Dana Whitfield',
    tags: 'kovo,optimistic-ui,drizzle',
    createdAt: '2026-06-16T18:20:00Z',
    body: 'I want the upvote count to update instantly on click and reconcile with the server. Can Kovo derive the optimistic update straight from my Drizzle mutation instead of me hand-writing it?',
  },
  {
    id: 'q2',
    authorName: 'Theo Park',
    tags: 'testing,pglite,state',
    createdAt: '2026-06-16T08:05:00Z',
    body: 'Each run of my example app should start from a clean slate so tests and demos are deterministic. What is the cleanest way to isolate per-session state?',
  },
] as const;

const DEMO_ANSWER_OVERLAY = [
  {
    id: 'a1',
    authorName: 'Marcus Webb',
    createdAt: '2026-06-16T19:02:00Z',
    body: "Kovo's compiler reads the Drizzle mutation and generates the optimistic patch for you — call deriveOptimistic on the mutation and the count moves on click, then settles to server truth when the fragment comes back.",
  },
] as const;

// Realistic Q&A data layered on top of the tiny createSoDb() seed. It makes the
// served app read like a real Q&A site without changing the base rows used by the
// focused tests.

const DEMO_QUESTIONS = [
  {
    id: 'q3',
    title: 'Why does my useEffect run twice in development?',
    body: 'I see my effect fire twice on mount. Is something wrong with my code, or is this expected behavior in React 18?',
    authorId: 'u3',
    authorName: 'Priya Nair',
    tags: 'react,hooks,useeffect',
    createdAt: '2026-06-12T09:24:00Z',
    score: 8,
    answerCount: 2,
  },
  {
    id: 'q4',
    title: "What's the difference between let and const in JavaScript?",
    body: 'When should I reach for one over the other? Are there performance implications I should know about?',
    authorId: 'u4',
    authorName: 'Marcus Webb',
    tags: 'javascript,es6,variables',
    createdAt: '2026-06-13T14:10:00Z',
    score: 15,
    answerCount: 3,
  },
  {
    id: 'q5',
    title: 'How do I center a div?',
    body: 'The eternal question. What is the modern, reliable way to center a block both horizontally and vertically?',
    authorId: 'u5',
    authorName: 'Sofia Alvarez',
    tags: 'css,flexbox,layout',
    createdAt: '2026-06-14T08:02:00Z',
    score: 42,
    answerCount: 4,
  },
  {
    id: 'q6',
    title: 'What is a closure, in plain terms?',
    body: 'I keep hearing the word but the textbook definitions confuse me. Can someone explain it without jargon?',
    authorId: 'u6',
    authorName: 'Liam OConnor',
    tags: 'javascript,closures,scope',
    createdAt: '2026-06-15T17:45:00Z',
    score: 23,
    answerCount: 1,
  },
  {
    id: 'q7',
    title: 'How do I undo the last git commit?',
    body: 'I committed too early and want the changes back in my working tree without losing them.',
    authorId: 'u3',
    authorName: 'Priya Nair',
    tags: 'git,version-control',
    createdAt: '2026-06-16T11:30:00Z',
    score: 31,
    answerCount: 2,
  },
];

const DEMO_ANSWERS = [
  {
    id: 'a2',
    questionId: 'q3',
    authorId: 'u4',
    authorName: 'Marcus Webb',
    createdAt: '2026-06-12T10:05:00Z',
    body: 'React 18 StrictMode intentionally double-invokes effects in development to surface missing cleanup. Your code is fine — production mounts once.',
    score: 12,
    accepted: true,
  },
  {
    id: 'a3',
    questionId: 'q3',
    authorId: 'u5',
    authorName: 'Sofia Alvarez',
    createdAt: '2026-06-12T12:40:00Z',
    body: 'It only happens in dev — production mounts once. Make sure your effects clean up after themselves and you can ignore the double fire.',
    score: 4,
    accepted: false,
  },
  {
    id: 'a4',
    questionId: 'q4',
    authorId: 'u6',
    authorName: 'Liam OConnor',
    createdAt: '2026-06-13T15:00:00Z',
    body: 'const cannot be reassigned; let can. Both are block-scoped. There is no meaningful performance difference between them.',
    score: 9,
    accepted: true,
  },
  {
    id: 'a5',
    questionId: 'q4',
    authorId: 'u3',
    authorName: 'Priya Nair',
    createdAt: '2026-06-13T16:20:00Z',
    body: 'Note const still allows mutating the object it points at — it only freezes the binding, not the value.',
    score: 5,
    accepted: false,
  },
  {
    id: 'a6',
    questionId: 'q4',
    authorId: 'u4',
    authorName: 'Marcus Webb',
    createdAt: '2026-06-13T18:55:00Z',
    body: 'Prefer const by default; reach for let only when you genuinely reassign. It makes intent clearer to readers.',
    score: 7,
    accepted: false,
  },
  {
    id: 'a7',
    questionId: 'q5',
    authorId: 'u3',
    authorName: 'Priya Nair',
    createdAt: '2026-06-14T08:30:00Z',
    body: 'Flexbox: display:flex; justify-content:center; align-items:center; on the parent does it cleanly.',
    score: 20,
    accepted: true,
  },
  {
    id: 'a8',
    questionId: 'q5',
    authorId: 'u4',
    authorName: 'Marcus Webb',
    createdAt: '2026-06-14T09:15:00Z',
    body: 'Grid one-liner: display:grid; place-items:center; — even shorter than the flexbox version.',
    score: 11,
    accepted: false,
  },
  {
    id: 'a9',
    questionId: 'q5',
    authorId: 'u5',
    authorName: 'Sofia Alvarez',
    createdAt: '2026-06-14T10:40:00Z',
    body: 'For a fixed-width block, margin-inline:auto still works for horizontal centering.',
    score: 3,
    accepted: false,
  },
  {
    id: 'a10',
    questionId: 'q5',
    authorId: 'u6',
    authorName: 'Liam OConnor',
    createdAt: '2026-06-14T13:05:00Z',
    body: 'Absolute + translate(-50%,-50%) when you must position over other content.',
    score: 2,
    accepted: false,
  },
  {
    id: 'a11',
    questionId: 'q6',
    authorId: 'u4',
    authorName: 'Marcus Webb',
    createdAt: '2026-06-15T18:20:00Z',
    body: 'A closure is a function bundled with the variables it captured from its defining scope. The function keeps access to them even after that scope returns.',
    score: 14,
    accepted: true,
  },
  {
    id: 'a12',
    questionId: 'q7',
    authorId: 'u5',
    authorName: 'Sofia Alvarez',
    createdAt: '2026-06-16T11:50:00Z',
    body: 'git reset --soft HEAD~1 keeps your changes staged so you can re-commit them cleanly.',
    score: 18,
    accepted: true,
  },
  {
    id: 'a13',
    questionId: 'q7',
    authorId: 'u6',
    authorName: 'Liam OConnor',
    createdAt: '2026-06-16T12:30:00Z',
    body: 'For shared history, prefer git revert so you do not rewrite commits other people already pulled.',
    score: 9,
    accepted: false,
  },
];

const DEMO_VOTES = Array.from({ length: 8 }, (_unused, index) => ({
  targetType: 'question' as const,
  targetId: `q${(index % 5) + 3}`,
  userId: `u${(index % 4) + 1}`,
  value: 1,
}));

/** Insert the richer demo dataset into a freshly-created Stack Overflow db. */
export async function seedSoDemo(db: SoDb): Promise<void> {
  await db.insert(questions).values(DEMO_QUESTIONS);
  await db.insert(answers).values(DEMO_ANSWERS);
  await db.insert(votes).values(DEMO_VOTES);

  // Dress up the base-seed rows for the served demo (see DEMO_BASE_OVERLAY).
  for (const overlay of DEMO_BASE_OVERLAY) {
    await db
      .update(questions)
      .set({
        authorName: overlay.authorName,
        tags: overlay.tags,
        createdAt: overlay.createdAt,
        body: overlay.body,
      })
      .where(eq(questions.id, overlay.id));
  }
  for (const overlay of DEMO_ANSWER_OVERLAY) {
    await db
      .update(answers)
      .set({ authorName: overlay.authorName, createdAt: overlay.createdAt, body: overlay.body })
      .where(eq(answers.id, overlay.id));
  }
}
