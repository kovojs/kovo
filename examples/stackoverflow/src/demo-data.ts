import type { SoDb } from './db.js';
import { answers, questions, votes } from './schema.js';

// Realistic Q&A book layered on top of the minimal createSoDb() seed (which the
// §10.5 commuting tests depend on, so it stays untouched). This enriches ONLY
// the app-shell / serve surface so the UI reads like a real Q&A site rather than
// a two-row fixture. Ids never collide with the base seed's q1/q2/a1.

const DEMO_QUESTIONS = [
  { id: 'q3', title: 'Why does my useEffect run twice in development?', body: 'I see my effect fire twice on mount. Is something wrong with my code?', authorId: 'u3', score: 8, answerCount: 2 },
  { id: 'q4', title: "What's the difference between let and const in JavaScript?", body: 'When should I reach for one over the other?', authorId: 'u4', score: 15, answerCount: 3 },
  { id: 'q5', title: 'How do I center a div?', body: 'The eternal question. What is the modern, reliable way?', authorId: 'u5', score: 42, answerCount: 4 },
  { id: 'q6', title: 'What is a closure, in plain terms?', body: 'I keep hearing the word but the definitions confuse me.', authorId: 'u6', score: 23, answerCount: 1 },
  { id: 'q7', title: 'How do I undo the last git commit?', body: 'I committed too early and want the changes back in my working tree.', authorId: 'u3', score: 31, answerCount: 2 },
];

const DEMO_ANSWERS = [
  { id: 'a2', questionId: 'q3', authorId: 'u4', body: 'React 18 StrictMode intentionally double-invokes effects in development to surface missing cleanup.', score: 12, accepted: true },
  { id: 'a3', questionId: 'q3', authorId: 'u5', body: 'It only happens in dev — production mounts once.', score: 4, accepted: false },
  { id: 'a4', questionId: 'q4', authorId: 'u6', body: 'const cannot be reassigned; let can. Both are block-scoped.', score: 9, accepted: true },
  { id: 'a5', questionId: 'q4', authorId: 'u3', body: 'Note const still allows mutating the object it points at.', score: 5, accepted: false },
  { id: 'a6', questionId: 'q4', authorId: 'u4', body: 'Prefer const by default; reach for let only when you reassign.', score: 7, accepted: false },
  { id: 'a7', questionId: 'q5', authorId: 'u3', body: 'Flexbox: display:flex; justify-content:center; align-items:center;', score: 20, accepted: true },
  { id: 'a8', questionId: 'q5', authorId: 'u4', body: 'Grid one-liner: display:grid; place-items:center;', score: 11, accepted: false },
  { id: 'a9', questionId: 'q5', authorId: 'u5', body: 'For a fixed-width block, margin-inline:auto still works.', score: 3, accepted: false },
  { id: 'a10', questionId: 'q5', authorId: 'u6', body: 'Absolute + translate(-50%,-50%) when you must.', score: 2, accepted: false },
  { id: 'a11', questionId: 'q6', authorId: 'u4', body: 'A closure is a function bundled with the variables it captured from its defining scope.', score: 14, accepted: true },
  { id: 'a12', questionId: 'q7', authorId: 'u5', body: 'git reset --soft HEAD~1 keeps your changes staged.', score: 18, accepted: true },
  { id: 'a13', questionId: 'q7', authorId: 'u6', body: 'For shared history, prefer git revert so you do not rewrite commits.', score: 9, accepted: false },
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
}
