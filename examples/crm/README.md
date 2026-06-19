# Kovo CRM Example

A multi-page sales CRM — pipeline dashboard, contact book, and per-deal detail —
over a real Drizzle/PGlite database. This example sits in the **middle** of the
optimism spectrum: it mixes **compiler-derived** optimistic updates with a few
**hand-written** ones where the merge is too domain-specific to derive.

## What it demonstrates

- **Multi-page server-rendered app** (`src/interactive-app.tsx`): a `createApp()`
  with a shared `layout()` chrome and routes for the pipeline, contacts, and each
  deal (`/deals/:id`); zero hydration.
- **Typed queries** (`src/queries.ts`) over Drizzle (`src/schema.ts`, `src/model.ts`,
  `src/db.ts`) backed by PGlite, each declaring the domains it reads.
- **Mixed optimism** (`src/mutations.ts`): mutations declare inline optimistic
  patches next to their writes, mixing compiler-derivable rows with hand-written
  summaries and explicit `await-fragment` choices.
- **Components** (`src/components/`): `pipeline`, `contacts`, `deal-detail`,
  `chrome` — styled with `@kovojs/style` tokens (`src/theme.ts`).
- **Behavior graph** (`src/graph.ts`, `src/graph.test.ts`) the compiler proves and
  CI can check.

`src/generated/**` are compiler **artifacts** (lowered components, stamps,
`graph.json`) — author the TSX/TS sources, not the lowered IR (SPEC §5.2).

## Run

```bash
# Dev server (Vite-plus toolchain runner):
pnpm --filter @kovojs/example-crm dev       # vp dev

# Run the tests:
pnpm --filter @kovojs/example-crm test       # vitest --run

# Build and serve:
pnpm --filter @kovojs/example-crm build       # vp build
pnpm --filter @kovojs/example-crm start       # node scripts/serve.mjs
```

`vp` is the Vite-plus toolchain runner; `kovo` is the framework CLI. This example
drives its build through `vp`.
