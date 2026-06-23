---
title: Dashboard/CRM app pattern
description: Structure a multi-page dashboard or CRM around layouts, aggregate queries, guarded writes, mixed optimism, and graph checks.
order: 7.45
---

# Dashboard/CRM app pattern

Use this pattern for operational apps: CRMs, admin dashboards, review queues, and internal tools
where many regions depend on related data but only some regions should refresh after each write.
The reference implementation is [Examples > CRM](/examples/crm/) and the walkthrough is
[CRM walkthrough](/guides/example-crm/).

## Route and layout shape

Keep app chrome in a shared `layout()` and keep access decisions in route declarations. The layout
owns navigation, shell styling, and any layout queries; each route owns params, guards, page metadata,
and the component that renders the route body. A deal detail route should read like a route fact,
not like a component side effect.

## Query composition

Name queries by product region: pipeline summary, grouped deals, contacts, deal detail, and any
activity stream. Aggregate queries are still first-class queries; avoid hiding them inside component
helpers because the graph needs stable names for review and for `kovo explain query`.

## Mutation forms and optimism

Dashboards usually need a mixed optimistic policy:

- Use compiler-derived transforms when the visible change is a direct write/read shape.
- Hand-write transforms when the product rule is the visible behavior, such as moving a deal between
  columns or updating a weighted summary.
- Declare `'await-fragment'` when the server result should win before a region morphs.

Keep forms ordinary POSTs bound to guarded mutations. Enhanced users get fragment/query patches;
no-JS users get the same server authority through the full-document path.

## Verification

Run the app gates and keep one graph assertion for each business-critical refresh rule:

```sh
pnpm --filter @kovojs/example-crm test
pnpm --filter @kovojs/example-crm run emit-graph
kovo explain mutation deal/move --optimistic graph.json
```

The review artifact should show guard chain, writes, invalidated queries, optimistic status, and
fragment consumers for the dashboard region you care about. SPEC sections 10.3, 10.4, and 11.4
define the refresh, optimism, and graph-proof contracts.
