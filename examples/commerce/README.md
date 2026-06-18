# Kovo Commerce Example

A full Kovo storefront — product grid, cart badge, and order history — running
live next to the authored components, queries, and derived optimism that drive
it. This example sits at the **auth/transactions** end of the optimism spectrum:
the compiler derives most optimistic UI, layered with **authentication** and
**transactional mutations** (add-to-cart) over a real Drizzle database.

## What it demonstrates

- **Server-rendered MPA, zero hydration** — every page (`src/app.tsx`) is a
  `createApp()` route composing TSX components; no client framework.
- **Typed queries** (`src/queries.ts`) over Drizzle (`src/schema.ts`, `src/db.ts`):
  product grid pagination, cart count, and order history, each naming the
  domains it reads so the compiler can prove invalidation.
- **Authentication** via `@kovojs/better-auth`: session provider, sign-in /
  sign-out mutations with CSRF, and guarded routes (`src/domain.ts`,
  `src/components/auth-forms.tsx`).
- **Derived optimism + transactions** — the add-to-cart mutation produces an
  optimistic cart-badge update the compiler derives
  (`src/generated/optimistic/cart-add.ts`) from the mutation's write set joined
  with the query read set (SPEC §10.2 / §11.1).
- **Components** (`src/components/`): `product-grid`, `cart-badge`,
  `order-history`, `auth-forms` — styled with `@kovojs/style` tokens.

`src/generated/**` (lowered components, optimistic stamps, the dataflow graph)
are compiler **artifacts** — inspect them, but author the TSX/TS sources, not
the lowered IR (SPEC §5.2).

## Run

```bash
# Dev server (Vite-plus toolchain runner):
pnpm --filter @kovojs/example-commerce dev      # vp dev

# Run the tests:
pnpm --filter @kovojs/example-commerce test      # vp test

# Production build via the Kovo framework CLI, then serve:
pnpm --filter @kovojs/example-commerce build      # kovo build ./src/app.tsx --preset node
pnpm --filter @kovojs/example-commerce start      # node dist/server/server.mjs
```

`vp` is the Vite-plus toolchain runner (dev/test/demo); `kovo` is the framework
CLI used for the production build. The demo embedded in the docs site is built
with `pnpm run build:demo` / `serve:demo`.
