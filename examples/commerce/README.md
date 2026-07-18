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
- **Local auth fixture**: a session provider, CSRF-protected sign-in/sign-out mutations, and guarded
  routes (`src/auth.ts`, `src/components/auth-forms.tsx`). The fixture is nonproduction;
  deployable apps use `@kovojs/better-auth`'s fixed SQLite/Postgres binding constructors.
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

The fixed `correct` test password is available only under `NODE_ENV=test`. Development requires an
explicit local-only acknowledgement and an operator-chosen, nondefault password of at least 16
characters. Requests must also have an exact loopback URL and framework-resolved loopback peer.
Never expose this fixture through a tunnel or reverse proxy; use fixed Better Auth bindings for a
deployable app.

```bash
# Dev server (Vite-plus toolchain runner):
KOVO_ENABLE_LOCAL_AUTH_FIXTURE=I_UNDERSTAND_THIS_IS_LOCAL_ONLY \
KOVO_LOCAL_AUTH_FIXTURE_PASSWORD='<unique local password, 16+ characters>' \
  pnpm --filter @kovojs/example-commerce dev

# Run the tests:
pnpm --filter @kovojs/example-commerce test      # vp test

# The framework build can still be inspected, but this local fixture deliberately refuses
# production authentication. Replace it with fixed bindings before serving a built app.
pnpm --filter @kovojs/example-commerce build
```

`vp` is the Vite-plus toolchain runner (dev/test/demo); `kovo` is the framework
CLI used for artifact inspection. The demo embedded in the docs site is built
with `pnpm run build:demo` / `serve:demo`.
