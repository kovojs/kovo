---
title: CRM walkthrough
description: Read the CRM example as a multi-page dashboard with layouts, aggregate queries, mixed optimism, and graph assertions.
order: 7.3
---

# CRM walkthrough

The CRM example is a sales dashboard over Drizzle/PGlite: pipeline, contacts, and per-deal detail.
It demonstrates nested app shape, aggregate reads, parameterized routes, and a practical mix of
compiler-derived and hand-written optimistic updates. The live page is [Examples > CRM](/examples/crm/).

## What to read first

| File | Why it matters |
| ---- | -------------- |
| `examples/crm/src/interactive-app.tsx` | `createApp()`, shared `layout()`, routes, and app registration. |
| `examples/crm/src/components/chrome.tsx` | Shared app frame and navigation. |
| `examples/crm/src/components/pipeline.tsx` | Dashboard region and pipeline forms. |
| `examples/crm/src/components/contacts.tsx` | Contact list and creation flow. |
| `examples/crm/src/components/deal-detail.tsx` | Parameterized route/detail rendering. |
| `examples/crm/src/queries.ts` | Aggregate and detail reads over Drizzle. |
| `examples/crm/src/mutations.ts` | Create/move/close deal writes and optimistic behavior. |
| `examples/crm/src/graph.test.ts` | Assertions over the emitted app graph. |

## Route and layout shape

CRM uses a shared `layout()` for the dashboard frame, then routes the main regions under it. Keep
that distinction when copying the pattern: layout owns shell/chrome; routes own access, params, and
page facts; components own the dashboard body.

## Query composition

The dashboard screen mixes aggregate counts, grouped deals, contacts, and detail records. The query
module keeps those reads named and scoped, which makes the graph explainable when a mutation touches
one domain but not another.

## Mixed optimism

CRM is intentionally not "all derived" or "all manual." Some mutations are compiler-derivable.
Others use hand-written patches because the visible summary is product-specific, or use an
`await-fragment` path when the server result should win before morphing a region. That is the model
to follow for complex dashboards: derive the ordinary cases, write the domain merge where the
product rule is the important part, and test both.

## Run and verify

```sh
pnpm --filter @kovojs/example-crm dev
pnpm --filter @kovojs/example-crm test
pnpm --filter @kovojs/example-crm build
pnpm --filter @kovojs/example-crm start
```

For graph workflows:

```sh
pnpm --filter @kovojs/example-crm run emit-graph
pnpm --filter @kovojs/example-crm test -- src/graph.test.ts
```

The graph test is the key read: it turns the dashboard's "what refreshes what" rules into CI
evidence.
