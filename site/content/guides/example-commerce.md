---
title: Commerce walkthrough
description: Read the Commerce example as an authenticated storefront built from routes, Drizzle queries, derived optimism, and transactional mutations.
order: 7.2
---

# Commerce walkthrough

The Commerce example is the largest starter-shaped app: an authenticated storefront with a product
grid, cart badge, order history, Better Auth forms, typed Drizzle reads, and a transactional
add-to-cart mutation. The live page is [Examples > Commerce](/examples/commerce/); the source lives
under `examples/commerce`.

## What to read first

| File                                       | Why it matters                                             |
| ------------------------------------------ | ---------------------------------------------------------- |
| `examples/commerce/src/app.tsx`            | `createApp()`, routes, auth wiring, document/layout facts. |
| `examples/commerce/src/domain.ts`          | Domain names used as invalidation currency.                |
| `examples/commerce/src/schema.ts`          | Product, cart, order, and auth tables.                     |
| `examples/commerce/src/db.ts`              | Drizzle/PGlite setup and seeded demo data.                 |
| `examples/commerce/src/queries.ts`         | Product grid, cart count, and order-history reads.         |
| `examples/commerce/src/components/*.tsx`   | TSX regions that render those reads and forms.             |
| `examples/commerce/scripts/emit-graph.mjs` | Graph emission used by docs/devtool workflows.             |

The generated files under `src/generated/**` are artifacts. Inspect them when you need to verify a
lowered component, client handler, optimistic transform, or graph edge, but keep authored code in
TS/TSX. SPEC section 5.2 makes hand-authored lowered IR invalid.

## App wiring

Start in `src/app.tsx`. The route list composes the storefront pages, Better Auth session provider,
sign-in/sign-out mutations, add-to-cart mutation, and query registry into one app. The important
pattern is the same as the starter: app facts are declared once, and the compiler derives the
render/query/mutation graph from those facts.

## Data and queries

The schema and domain modules define the data vocabulary. Queries in `src/queries.ts` read product
cards, cart count, and order history from Drizzle, and each query names the domains it observes.
Those names are how the compiler proves which regions must refresh after a write. SPEC section 11.1

## Mutations and optimism

Commerce sits at the auth/transaction end of the optimism spectrum. Add-to-cart writes through a
transaction, runs under the authenticated request, and lets the compiler derive the visible cart
badge update from the mutation write set and query read set. That is the current derived optimism
model, not future work.

## Run and verify

```sh
pnpm --filter @kovojs/example-commerce dev
pnpm --filter @kovojs/example-commerce test
pnpm --filter @kovojs/example-commerce build
pnpm --filter @kovojs/example-commerce start
```

For graph/debug workflows:

```sh
pnpm --filter @kovojs/example-commerce run build:demo
node examples/commerce/scripts/emit-graph.mjs
```

Use [Dataflow devtool](/guides/dataflow-devtool/) to mount or query the emitted graph alongside the
CRM and StackOverflow examples.
