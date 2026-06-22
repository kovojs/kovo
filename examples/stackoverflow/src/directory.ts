// Presentation directory for the KovOverflow demo: the people, the tags, and the
// richer Q&A seed rendered across the site. This module is intentionally
// Drizzle-free — it is pure content + lookup helpers so the chrome, the page
// components, and the seed loader (demo-data.ts) can all share one source of
// truth without pulling the database layer into render code.

export interface DemoUser {
  id: string;
  name: string;
  title: string;
  location: string;
  about: string;
  reputation: number;
  joinedAt: string;
  badges: { gold: number; silver: number; bronze: number };
  topTags: string[];
}

// The signed-in viewer. The demo is pre-authenticated as this person, so the
// top bar shows their avatar + reputation and every posted question/answer is
// attributed to them (mutations write authorId `demo-viewer`).
export const CURRENT_USER: DemoUser = {
  id: 'demo-viewer',
  name: 'Ada Whitfield',
  title: 'Full-stack developer',
  location: 'San Francisco, USA',
  about:
    'Building product UIs and the systems behind them. I like fast feedback loops, typed data, and answers that explain the why, not just the how.',
  reputation: 14238,
  joinedAt: '2024-03-08T00:00:00Z',
  badges: { gold: 4, silver: 37, bronze: 92 },
  topTags: ['typescript', 'reactjs', 'css'],
};

export const DEMO_USERS: DemoUser[] = [
  CURRENT_USER,
  {
    id: 'u4',
    name: 'Marcus Webb',
    title: 'Staff software engineer',
    location: 'London, UK',
    about:
      'Twenty years of shipping web apps. These days mostly TypeScript and Postgres. I answer to keep my own fundamentals sharp.',
    reputation: 219540,
    joinedAt: '2012-09-14T00:00:00Z',
    badges: { gold: 88, silver: 612, bronze: 940 },
    topTags: ['javascript', 'typescript', 'sql'],
  },
  {
    id: 'u3',
    name: 'Priya Nair',
    title: 'Frontend architect',
    location: 'Bengaluru, India',
    about:
      'React performance, design systems, and the occasional deep dive into how the browser actually paints. Mentoring is the best part of the job.',
    reputation: 124870,
    joinedAt: '2014-01-22T00:00:00Z',
    badges: { gold: 41, silver: 305, bronze: 488 },
    topTags: ['reactjs', 'javascript', 'performance'],
  },
  {
    id: 'u7',
    name: 'Yuki Tanaka',
    title: 'Systems engineer',
    location: 'Tokyo, Japan',
    about:
      'Databases, query planners, and making slow things fast. If your SQL is doing a sequential scan, I want to know about it.',
    reputation: 156320,
    joinedAt: '2013-05-03T00:00:00Z',
    badges: { gold: 52, silver: 410, bronze: 631 },
    topTags: ['sql', 'postgresql', 'python'],
  },
  {
    id: 'u5',
    name: 'Sofia Alvarez',
    title: 'UI engineer',
    location: 'Madrid, Spain',
    about:
      'CSS is a real programming language and I will die on that hill. Layout, animation, and accessibility are my home turf.',
    reputation: 87150,
    joinedAt: '2015-07-19T00:00:00Z',
    badges: { gold: 19, silver: 188, bronze: 274 },
    topTags: ['css', 'flexbox', 'html'],
  },
  {
    id: 'u1',
    name: 'Dana Whitfield',
    title: 'Platform engineer',
    location: 'Austin, USA',
    about:
      'I build the tools other engineers build on. Compilers, dev servers, and the unglamorous plumbing that makes things feel instant.',
    reputation: 68420,
    joinedAt: '2016-02-11T00:00:00Z',
    badges: { gold: 14, silver: 132, bronze: 210 },
    topTags: ['kovo', 'drizzle', 'typescript'],
  },
  {
    id: 'u6',
    name: "Liam O'Connor",
    title: 'Software developer',
    location: 'Dublin, Ireland',
    about:
      'Generalist who enjoys explaining the tricky bits — closures, floating point, the event loop — in plain language.',
    reputation: 53900,
    joinedAt: '2017-10-30T00:00:00Z',
    badges: { gold: 9, silver: 96, bronze: 171 },
    topTags: ['javascript', 'git', 'node.js'],
  },
  {
    id: 'u2',
    name: 'Theo Park',
    title: 'Backend developer',
    location: 'Seoul, South Korea',
    about:
      'APIs, data isolation, and reproducible tests. I care a lot about making local development match production.',
    reputation: 32700,
    joinedAt: '2018-04-06T00:00:00Z',
    badges: { gold: 6, silver: 71, bronze: 118 },
    topTags: ['python', 'testing', 'docker'],
  },
  {
    id: 'u8',
    name: 'Noah Bennett',
    title: 'Junior developer',
    location: 'Toronto, Canada',
    about:
      'Two years in and learning fast. I ask the questions I wish were already answered when I was stuck at 2am.',
    reputation: 2310,
    joinedAt: '2023-11-12T00:00:00Z',
    badges: { gold: 0, silver: 4, bronze: 23 },
    topTags: ['javascript', 'async-await', 'promises'],
  },
];

const USER_BY_ID = new Map(DEMO_USERS.map((user) => [user.id, user]));

export function userById(id: string | undefined): DemoUser | undefined {
  return id ? USER_BY_ID.get(id) : undefined;
}

/** The display name for an author id, mapping the signed-in viewer + known seed
 *  authors to their profile name and falling back to the stored column. */
export function displayName(authorId: string | undefined, fallback?: string): string {
  const user = userById(authorId);
  if (user) return user.name;
  if (fallback && fallback !== 'Anonymous') return fallback;
  return CURRENT_USER.name;
}

export function reputationOf(authorId: string | undefined, fallbackName?: string): number {
  const user = userById(authorId);
  if (user) return user.reputation;
  // Deterministic, plausible reputation for any unseeded author.
  const name = fallbackName ?? 'Anonymous';
  let hash = 7;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 37 + name.charCodeAt(index)) & 0x7fff;
  }
  return 200 + (hash % 9800);
}

// ── Tags ──────────────────────────────────────────────────────────────────────

export const TAG_DESCRIPTIONS: Record<string, string> = {
  javascript:
    'For questions about programming in ECMAScript (JavaScript/JS) and its different dialects/implementations.',
  typescript:
    'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript. Use for questions about its type system and tooling.',
  reactjs:
    'React is a JavaScript library for building user interfaces. Use for questions about components, hooks, and rendering.',
  css: 'CSS (Cascading Style Sheets) describes the presentation of structured documents. Use for layout, styling, and animation questions.',
  flexbox:
    'The CSS3 Flexible Box Layout module for laying out, aligning, and distributing space among items in a container.',
  html: 'HTML (HyperText Markup Language) is the markup language for structuring content on the web.',
  python:
    'Python is a dynamically typed, multipurpose programming language designed to be quick to learn and read.',
  sql: 'Structured Query Language (SQL) is a language for querying and modifying relational databases.',
  postgresql:
    'PostgreSQL is an open-source, object-relational database management system with a strong standards focus.',
  git: 'Git is an open-source distributed version control system. Use for questions about Git usage and workflows.',
  'version-control':
    'Tools and practices for tracking and managing changes to source code over time.',
  docker:
    'Docker packages applications into containers so they run the same everywhere. Use for build, image, and runtime questions.',
  'async-await':
    'Syntax for writing asynchronous, promise-based code as if it were synchronous.',
  promises:
    'A Promise represents the eventual completion (or failure) of an asynchronous operation and its resulting value.',
  closures:
    'A closure is a function bundled together with references to its surrounding state (its lexical scope).',
  scope: 'The region of a program where a binding (variable, function) is accessible.',
  hooks:
    'React Hooks let you use state and other React features without writing a class.',
  performance:
    'For questions about measuring and improving the speed and resource usage of code.',
  'node.js':
    'Node.js is an event-driven, non-blocking I/O runtime for executing JavaScript outside the browser.',
  testing:
    'For questions about software testing — unit, integration, and end-to-end — and test isolation.',
  json: 'JSON (JavaScript Object Notation) is a lightweight, language-independent data interchange format.',
  'floating-point':
    'For questions about the representation and arithmetic of real numbers on computers (IEEE 754).',
  kovo: 'Kovo is a compiler-first web framework with server-rendered, zero-hydration interactivity and derived optimistic UI.',
  drizzle:
    'Drizzle ORM is a lightweight, typed SQL query builder for TypeScript.',
  'optimistic-ui':
    'A UI pattern where the interface updates immediately on an action and reconciles with the server response.',
  pglite: 'PGlite is a WASM build of Postgres that runs in-process, in the browser or in Node.',
  state: 'For questions about managing application state across renders, requests, or sessions.',
  devops:
    'For questions spanning development and operations: build, deploy, and run pipelines.',
};

const POPULAR_TAGS_ORDER = [
  'javascript',
  'reactjs',
  'typescript',
  'css',
  'python',
  'sql',
];

export function tagDescription(tag: string): string {
  return (
    TAG_DESCRIPTIONS[tag] ??
    `Questions tagged with “${tag}”. Use this tag for problems and discussion related to ${tag}.`
  );
}

/** Order tags for the tags index: curated popular tags first, then the rest by
 *  question count (desc) and finally alphabetically. */
export function orderTags(
  counts: { tag: string; count: number }[],
): { tag: string; count: number }[] {
  return [...counts].sort((left, right) => {
    const leftPopular = POPULAR_TAGS_ORDER.indexOf(left.tag);
    const rightPopular = POPULAR_TAGS_ORDER.indexOf(right.tag);
    if (leftPopular !== -1 || rightPopular !== -1) {
      if (leftPopular === -1) return 1;
      if (rightPopular === -1) return -1;
      return leftPopular - rightPopular;
    }
    if (right.count !== left.count) return right.count - left.count;
    return left.tag.localeCompare(right.tag);
  });
}

// ── Question + answer seed (q3 … q14; q1/q2 + a1 come from the base seed) ───────
// The shape matches the Drizzle insert in demo-data.ts. Bodies read like real
// Stack Overflow posts: a concrete problem, what was tried, and a clear ask.

export interface SeedQuestion {
  id: string;
  title: string;
  body: string;
  authorId: string;
  authorName: string;
  tags: string;
  score: number;
  answerCount: number;
  createdAt: string;
}

export interface SeedAnswer {
  id: string;
  questionId: string;
  authorId: string;
  authorName: string;
  body: string;
  score: number;
  accepted: boolean;
  createdAt: string;
}

export const DEMO_QUESTION_ROWS: SeedQuestion[] = [
  {
    id: 'q3',
    title: 'Why does my useEffect run twice on mount in development?',
    body: "I added a single useEffect with an empty dependency array, but in development it fires twice on mount. In production it only runs once. I'm not mutating state in a loop — is something wrong with my code, or is this expected?",
    authorId: 'u3',
    authorName: 'Priya Nair',
    tags: 'reactjs,hooks,javascript',
    score: 124,
    answerCount: 2,
    createdAt: '2026-05-28T09:24:00Z',
  },
  {
    id: 'q4',
    title: "What is the difference between `let` and `const` in JavaScript?",
    body: 'When should I reach for one over the other? I understand both are block-scoped, but I keep seeing teams default to const everywhere. Are there performance implications, or is it purely about intent?',
    authorId: 'u4',
    authorName: 'Marcus Webb',
    tags: 'javascript,scope',
    score: 89,
    answerCount: 3,
    createdAt: '2026-05-19T14:10:00Z',
  },
  {
    id: 'q5',
    title: 'How do I vertically and horizontally center a div?',
    body: 'The eternal question. I have a fixed-size card I want centered both ways inside a full-height container. What is the modern, reliable way to do this that does not fall apart on small screens?',
    authorId: 'u5',
    authorName: 'Sofia Alvarez',
    tags: 'css,flexbox,html',
    score: 312,
    answerCount: 4,
    createdAt: '2026-04-30T08:02:00Z',
  },
  {
    id: 'q6',
    title: 'What is a closure, in plain terms?',
    body: 'I keep hearing the word and reading textbook definitions full of jargon. Can someone explain what a closure actually is, with a small example of why it is useful in everyday code?',
    authorId: 'u6',
    authorName: "Liam O'Connor",
    tags: 'javascript,closures,scope',
    score: 156,
    answerCount: 2,
    createdAt: '2026-05-11T17:45:00Z',
  },
  {
    id: 'q7',
    title: 'How do I undo the most recent local Git commit?',
    body: 'I committed too early and want the changes back in my working tree so I can keep editing, without losing any work. I have not pushed yet. What is the safe command, and how does it differ from a hard reset?',
    authorId: 'u3',
    authorName: 'Priya Nair',
    tags: 'git,version-control',
    score: 241,
    answerCount: 2,
    createdAt: '2026-06-09T11:30:00Z',
  },
  {
    id: 'q8',
    title: 'How can I safely parse JSON from an untrusted source in Python?',
    body: "I'm reading JSON from a third-party webhook. json.loads works until the payload is malformed and then it throws and takes my worker down. What is the idiomatic way to parse defensively and validate the shape?",
    authorId: 'u2',
    authorName: 'Theo Park',
    tags: 'python,json',
    score: 64,
    answerCount: 2,
    createdAt: '2026-05-23T07:18:00Z',
  },
  {
    id: 'q9',
    title: 'What does the `key` prop actually do in a React list?',
    body: "Linting yells at me to add a key when I map over an array. Using the array index makes the warning go away. Is that fine, or is there a real bug waiting to happen? What is React doing with the key under the hood?",
    authorId: 'u5',
    authorName: 'Sofia Alvarez',
    tags: 'reactjs,performance',
    score: 98,
    answerCount: 1,
    createdAt: '2026-06-02T13:05:00Z',
  },
  {
    id: 'q10',
    title: 'Why is my async function returning a Promise instead of the value?',
    body: 'I marked my function async and returned the fetched value, but the caller gets a Promise object, not the data. Adding more async keywords did not help. What am I misunderstanding about how await works?',
    authorId: 'u8',
    authorName: 'Noah Bennett',
    tags: 'javascript,async-await,promises',
    score: 73,
    answerCount: 2,
    createdAt: '2026-06-12T19:40:00Z',
  },
  {
    id: 'q11',
    title: 'How do I select the latest row per group in SQL?',
    body: 'I have an events table with (user_id, created_at, payload). I want exactly one row per user — the most recent event. My GROUP BY either errors or returns mismatched columns. What is the canonical pattern in Postgres?',
    authorId: 'u7',
    authorName: 'Yuki Tanaka',
    tags: 'sql,postgresql',
    score: 187,
    answerCount: 2,
    createdAt: '2026-05-06T10:55:00Z',
  },
  {
    id: 'q12',
    title: 'How should I narrow a TypeScript discriminated union in an error path?',
    body: "I have a Result type that is either { ok: true; value: T } or { ok: false; error: E }. Inside the error branch TypeScript still thinks value might exist. How do I structure this so narrowing just works without casts?",
    authorId: 'u4',
    authorName: 'Marcus Webb',
    tags: 'typescript,javascript',
    score: 52,
    answerCount: 1,
    createdAt: '2026-06-04T16:22:00Z',
  },
  {
    id: 'q13',
    title: 'How do I move a Docker image to another machine without a registry?',
    body: "I built an image locally and need it on a server that can't reach my registry. I'd rather not rebuild it there. Is there a clean way to ship the built image directly over SSH?",
    authorId: 'u1',
    authorName: 'Dana Whitfield',
    tags: 'docker,devops',
    score: 41,
    answerCount: 2,
    createdAt: '2026-05-15T12:48:00Z',
  },
  {
    id: 'q14',
    title: 'Why does 0.1 + 0.2 not equal 0.3?',
    body: 'In the console, 0.1 + 0.2 gives 0.30000000000000004. This breaks an equality check in my pricing code. Is this a bug in the language, and how should I compare and store money safely?',
    authorId: 'u6',
    authorName: "Liam O'Connor",
    tags: 'javascript,floating-point',
    score: 268,
    answerCount: 2,
    createdAt: '2026-04-21T20:14:00Z',
  },
];

export const DEMO_ANSWER_ROWS: SeedAnswer[] = [
  // q3 — useEffect twice
  {
    id: 'a-q3-1',
    questionId: 'q3',
    authorId: 'u4',
    authorName: 'Marcus Webb',
    body: "It's expected. React 18's StrictMode intentionally mounts, unmounts, and remounts every component once in development to surface effects that don't clean up after themselves. Your code is fine — production only runs it once. If the double-run causes a visible problem, that's the warning working: add a cleanup function that undoes whatever the effect did.",
    score: 142,
    accepted: true,
    createdAt: '2026-05-28T10:05:00Z',
  },
  {
    id: 'a-q3-2',
    questionId: 'q3',
    authorId: 'u5',
    authorName: 'Sofia Alvarez',
    body: 'To confirm it is StrictMode and not your code, temporarily remove <StrictMode> from your root and the double-invoke disappears. Keep StrictMode on, though — the effects it double-runs are exactly the ones that would leak subscriptions or timers in real usage.',
    score: 31,
    accepted: false,
    createdAt: '2026-05-28T12:40:00Z',
  },
  // q4 — let vs const
  {
    id: 'a-q4-1',
    questionId: 'q4',
    authorId: 'u6',
    authorName: "Liam O'Connor",
    body: 'const cannot be reassigned; let can. Both are block-scoped, both are hoisted to the top of their block in a "temporal dead zone". There is no meaningful performance difference — pick based on intent.',
    score: 64,
    accepted: true,
    createdAt: '2026-05-19T15:00:00Z',
  },
  {
    id: 'a-q4-2',
    questionId: 'q4',
    authorId: 'u3',
    authorName: 'Priya Nair',
    body: 'Worth stressing: const freezes the binding, not the value. const arr = [] still lets you arr.push(1). It only stops arr = somethingElse. That trips a lot of people up.',
    score: 28,
    accepted: false,
    createdAt: '2026-05-19T16:20:00Z',
  },
  {
    id: 'a-q4-3',
    questionId: 'q4',
    authorId: 'u4',
    authorName: 'Marcus Webb',
    body: 'Practical rule we use: const by default, reach for let only when you genuinely reassign, and never var. Readers can then assume a const name points at the same thing for the rest of the block.',
    score: 17,
    accepted: false,
    createdAt: '2026-05-19T18:55:00Z',
  },
  // q5 — center a div
  {
    id: 'a-q5-1',
    questionId: 'q5',
    authorId: 'u3',
    authorName: 'Priya Nair',
    body: 'Flexbox is the reliable answer: on the container, display: flex; justify-content: center; align-items: center. Three lines, works at every screen size, no magic numbers.',
    score: 205,
    accepted: true,
    createdAt: '2026-04-30T08:30:00Z',
  },
  {
    id: 'a-q5-2',
    questionId: 'q5',
    authorId: 'u4',
    authorName: 'Marcus Webb',
    body: 'Even shorter with grid: display: grid; place-items: center on the container centers a single child both ways. My go-to one-liner.',
    score: 96,
    accepted: false,
    createdAt: '2026-04-30T09:15:00Z',
  },
  {
    id: 'a-q5-3',
    questionId: 'q5',
    authorId: 'u5',
    authorName: 'Sofia Alvarez',
    body: 'If the element has a known width and you only need horizontal centering, margin-inline: auto is still the simplest tool and predates flexbox by a decade.',
    score: 34,
    accepted: false,
    createdAt: '2026-04-30T10:40:00Z',
  },
  {
    id: 'a-q5-4',
    questionId: 'q5',
    authorId: 'u6',
    authorName: "Liam O'Connor",
    body: 'When you must overlay it on other content, position: absolute; inset: 50% auto auto 50%; transform: translate(-50%, -50%) centers without affecting layout flow.',
    score: 12,
    accepted: false,
    createdAt: '2026-04-30T13:05:00Z',
  },
  // q6 — closures
  {
    id: 'a-q6-1',
    questionId: 'q6',
    authorId: 'u4',
    authorName: 'Marcus Webb',
    body: 'A closure is a function bundled with the variables it captured from the scope where it was defined. The function keeps access to those variables even after that outer scope has returned. The classic use: a makeCounter() that returns an increment function still able to read and update its private count.',
    score: 121,
    accepted: true,
    createdAt: '2026-05-11T18:20:00Z',
  },
  {
    id: 'a-q6-2',
    questionId: 'q6',
    authorId: 'u3',
    authorName: 'Priya Nair',
    body: 'A useful mental model: every function in JS "remembers" the environment it was born in. That remembered environment is the closure. It is how private state, memoization, and event handlers that "know" their data all work.',
    score: 39,
    accepted: false,
    createdAt: '2026-05-11T19:48:00Z',
  },
  // q7 — undo commit
  {
    id: 'a-q7-1',
    questionId: 'q7',
    authorId: 'u5',
    authorName: 'Sofia Alvarez',
    body: 'git reset --soft HEAD~1 undoes the commit but keeps every change staged, so you can edit and re-commit cleanly. Use --mixed (the default) if you also want them unstaged. Avoid --hard here — that throws the changes away, which is the opposite of what you want.',
    score: 198,
    accepted: true,
    createdAt: '2026-06-09T11:50:00Z',
  },
  {
    id: 'a-q7-2',
    questionId: 'q7',
    authorId: 'u1',
    authorName: 'Dana Whitfield',
    body: 'Important caveat: only reset commits you have not shared. If the commit was already pushed and others may have pulled it, use git revert instead so you add a new commit rather than rewriting history out from under them.',
    score: 57,
    accepted: false,
    createdAt: '2026-06-09T12:30:00Z',
  },
  // q8 — parse JSON safely in Python
  {
    id: 'a-q8-1',
    questionId: 'q8',
    authorId: 'u7',
    authorName: 'Yuki Tanaka',
    body: 'Wrap json.loads in a try/except json.JSONDecodeError and return/raise a domain error instead of letting it bubble up. Then validate the decoded shape separately — a well-formed JSON document can still be the wrong structure.',
    score: 51,
    accepted: true,
    createdAt: '2026-05-23T07:55:00Z',
  },
  {
    id: 'a-q8-2',
    questionId: 'q8',
    authorId: 'u4',
    authorName: 'Marcus Webb',
    body: 'For the validation half, reach for pydantic or a dataclass + a schema check. It turns "trust me, it has a user_id" into an explicit, typed boundary, and the error messages tell you exactly which field was wrong.',
    score: 22,
    accepted: false,
    createdAt: '2026-05-23T09:10:00Z',
  },
  // q9 — key prop
  {
    id: 'a-q9-1',
    questionId: 'q9',
    authorId: 'u3',
    authorName: 'Priya Nair',
    body: 'Keys let React match elements between renders so it can reorder and reuse DOM instead of rebuilding it. The array index is fine for a static list, but for anything that can reorder, insert, or delete, an index key causes React to associate the wrong state/DOM with the wrong item. Use a stable id from your data.',
    score: 88,
    accepted: true,
    createdAt: '2026-06-02T13:45:00Z',
  },
  // q10 — async returns a promise
  {
    id: 'a-q10-1',
    questionId: 'q10',
    authorId: 'u6',
    authorName: "Liam O'Connor",
    body: "An async function ALWAYS returns a Promise — that is the whole point. The caller has to await it (or .then it). You cannot synchronously unwrap an async value; the data does not exist yet when the function returns. Make the caller async and await the result.",
    score: 69,
    accepted: true,
    createdAt: '2026-06-12T20:10:00Z',
  },
  {
    id: 'a-q10-2',
    questionId: 'q10',
    authorId: 'u4',
    authorName: 'Marcus Webb',
    body: 'If the caller is at the top level (a module or script), you can use a top-level await in an ES module, or wrap the work in an immediately-invoked async function. But the rule stands: async results are always awaited, never read directly.',
    score: 24,
    accepted: false,
    createdAt: '2026-06-12T21:30:00Z',
  },
  // q11 — latest row per group
  {
    id: 'a-q11-1',
    questionId: 'q11',
    authorId: 'u4',
    authorName: 'Marcus Webb',
    body: "In Postgres, DISTINCT ON is the cleanest tool: SELECT DISTINCT ON (user_id) * FROM events ORDER BY user_id, created_at DESC. It keeps the first row per user_id in that ordering — i.e. the most recent event each.",
    score: 156,
    accepted: true,
    createdAt: '2026-05-06T11:25:00Z',
  },
  {
    id: 'a-q11-2',
    questionId: 'q11',
    authorId: 'u3',
    authorName: 'Priya Nair',
    body: 'The portable version (works outside Postgres) is a window function: ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) and keep where the row number = 1. Slightly more verbose but engine-agnostic.',
    score: 73,
    accepted: false,
    createdAt: '2026-05-06T12:40:00Z',
  },
  // q12 — discriminated union
  {
    id: 'a-q12-1',
    questionId: 'q12',
    authorId: 'u3',
    authorName: 'Priya Nair',
    body: 'Make ok the discriminant and check it before touching value: if (!result.ok) { return result.error } — after that guard, TypeScript narrows the remaining code to the ok branch and value is available with no cast. The key is that both members share the literal ok field with different boolean literals.',
    score: 44,
    accepted: true,
    createdAt: '2026-06-04T17:02:00Z',
  },
  // q13 — docker image without registry
  {
    id: 'a-q13-1',
    questionId: 'q13',
    authorId: 'u7',
    authorName: 'Yuki Tanaka',
    body: 'Pipe save into load over SSH: docker save myimage:tag | ssh user@host docker load. No registry, no rebuild, and it streams so you do not need a temp file on either side.',
    score: 38,
    accepted: true,
    createdAt: '2026-05-15T13:20:00Z',
  },
  {
    id: 'a-q13-2',
    questionId: 'q13',
    authorId: 'u2',
    authorName: 'Theo Park',
    body: 'If the link is flaky, do it in two steps so you can resume: docker save -o image.tar myimage:tag, scp it over, then docker load -i image.tar on the server. Add gzip for big images.',
    score: 14,
    accepted: false,
    createdAt: '2026-05-15T14:05:00Z',
  },
  // q14 — floating point
  {
    id: 'a-q14-1',
    questionId: 'q14',
    authorId: 'u4',
    authorName: 'Marcus Webb',
    body: 'Not a bug — it is IEEE 754. 0.1 and 0.2 have no exact binary representation, so their sum is the nearest representable double, which prints as 0.30000000000000004. Every language using doubles behaves the same way. Never compare floats with ===; compare within a small epsilon.',
    score: 231,
    accepted: true,
    createdAt: '2026-04-21T20:50:00Z',
  },
  {
    id: 'a-q14-2',
    questionId: 'q14',
    authorId: 'u7',
    authorName: 'Yuki Tanaka',
    body: 'For money specifically: stop using floats. Store integer cents (or use a decimal type), do the arithmetic in integers, and format for display at the very end. It sidesteps the whole class of rounding bugs.',
    score: 84,
    accepted: false,
    createdAt: '2026-04-21T22:14:00Z',
  },
];

// Static answer-count-by-author for the users index (answer authorship is not
// exposed by the answerList query, so it is summed from the seed here).
const ANSWER_COUNT_BY_USER = (() => {
  const counts = new Map<string, number>();
  for (const answer of DEMO_ANSWER_ROWS) {
    counts.set(answer.authorId, (counts.get(answer.authorId) ?? 0) + 1);
  }
  // The base seed contributes one accepted answer (a1) authored by Marcus Webb.
  counts.set('u4', (counts.get('u4') ?? 0) + 1);
  return counts;
})();

export function answersByUser(id: string): number {
  return ANSWER_COUNT_BY_USER.get(id) ?? 0;
}
