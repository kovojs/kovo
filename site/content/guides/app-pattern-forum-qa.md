---
title: Forum/Q&A app pattern
description: Structure a forum or Q&A app around nested routes, session-aware reads, live regions, derived optimism, and graph checks.
order: 7.46
---

# Forum/Q&A app pattern

Use this pattern for forums, knowledge bases, issue trackers, and Q&A products where list pages,
detail pages, votes, answers, tags, and per-user state all need to stay coherent. The reference
implementation is [Examples > Stack Overflow](/examples/stackoverflow/) and the walkthrough is
[StackOverflow walkthrough](/guides/example-stackoverflow/).

## Route and layout shape

Keep the global frame in a shared `layout()`, then model list, tag, user, and detail pages as
separate routes. The question detail route is the central pattern: params identify the question,
queries load canonical data, forms post answers/votes, and fragment targets let just the affected
regions update.

## Query composition

Separate public facts from session-shaped facts. Ranked lists, tag counts, question bodies, and
answers can be shared. User vote state, draft permissions, and signed-in actions should be scoped
through explicit session-aware queries or guarded routes so the graph shows the boundary.

## Mutation forms and derived optimism

Forum writes often fit derived optimism: a vote or answer insert can be joined with the query read
set to predict the visible count, score, or new row. When a rank, moderation rule, or permission
check depends on server-only state, declare `'await-fragment'` for that query and let the response
be authoritative.

## Verification

Keep graph tests close to the app:

```sh
pnpm --filter @kovojs/example-stackoverflow test
pnpm --filter @kovojs/example-stackoverflow run emit-graph
kovo explain mutation answer/create --optimistic graph.json
```

The artifact should prove which queries refresh, which fragments morph, and which optimistic rows
are derived or punted. SPEC sections 9.3, 10.4, 10.5, and 11.4 define live refresh, optimistic
coverage, derivation, and graph assertions.
