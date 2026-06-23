---
title: StackOverflow walkthrough
description: Read the StackOverflow example as a forum/Q&A app with nested routes, fully derived optimism, and live-target regions.
order: 7.4
---

# StackOverflow walkthrough

The StackOverflow example is a forum/Q&A app over Drizzle/PGlite: ranked question list, tags,
users, question detail, votes, and answer posting. It demonstrates the fully compiler-derived end
of Kovo optimism. The live page is [Examples > Stack Overflow](/examples/stackoverflow/).

## What to read first

| File                                                        | Why it matters                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| `examples/stackoverflow/src/interactive-app.tsx`            | App declaration, layout, routes, and registered facts.        |
| `examples/stackoverflow/src/components/chrome.tsx`          | Shared app frame.                                             |
| `examples/stackoverflow/src/components/question-list.tsx`   | Ranked list region.                                           |
| `examples/stackoverflow/src/components/question-detail.tsx` | Detail route, answers, and vote forms.                        |
| `examples/stackoverflow/src/components/tags-page.tsx`       | Tag navigation pattern.                                       |
| `examples/stackoverflow/src/queries.ts`                     | Reads for list, detail, tags, users, and session-shaped data. |
| `examples/stackoverflow/src/mutations.ts`                   | Vote, answer, and question writes.                            |
| `examples/stackoverflow/src/kovo-graph.test.ts`             | Graph assertions for query/mutation coverage.                 |

## Nested routes and regions

The app is a server-rendered MPA with a shared layout and several route shapes. Question detail is
the best first read: it combines params, query-backed regions, forms, and region refreshes without
client hydration.

## Fully derived optimism

Voting and posting answers/questions are derived from the mutation write set joined with the query
read set. There is no hand-written merge code in the example's optimistic path. When your domain
matches this shape, prefer derived optimism and keep the proof in graph tests. SPEC section 10.2 and
SPEC section 11.1

## Session-isolated data

The example keeps session-sensitive reads scoped so one user's visible state does not leak into
another user's graph. Read the query module with that in mind: if a page depends on the session,
the query shape and route guard should make that dependency explicit.

## Run and verify

```sh
pnpm --filter @kovojs/example-stackoverflow dev
pnpm --filter @kovojs/example-stackoverflow test
pnpm --filter @kovojs/example-stackoverflow build
pnpm --filter @kovojs/example-stackoverflow start
```

For graph workflows:

```sh
pnpm --filter @kovojs/example-stackoverflow run emit-graph
pnpm --filter @kovojs/example-stackoverflow test -- src/kovo-graph.test.ts
```

Use this example when you need a forum/Q&A architecture: list and detail routes, session-aware
queries, mutation forms, derived optimism, and graph assertions that prove the refresh model.

For the reusable architecture recipe, see [Forum/Q&A app pattern](/guides/app-pattern-forum-qa/).
