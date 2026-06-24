# Kovo Stack Overflow Example

A multi-page Q&A site — a ranked question list and per-question answers — over a
real Drizzle/PGlite database. This example sits at the **fully compiler-derived**
end of the optimism spectrum: every optimistic update (voting, posting answers
and questions) is **derived by the compiler**, with no hand-written merge code.

## What it demonstrates

- **Server-rendered MPA, zero hydration** (`src/interactive-app.tsx`): a
  `createApp()` with a shared `layout()` chrome and routes for the question list
  and each question (`/questions/:id`). Native `enhance` forms POST to `/_m/*`
  and the inline loader morphs the re-rendered region (SPEC §9.1).
- **Typed queries** (`src/queries.ts`) over Drizzle (`src/schema.ts`,
  `src/model.ts`, `src/db.ts`) backed by PGlite, each naming the domains it reads.
- **Fully derived optimism** (`src/mutations.ts` +
  `src/generated/optimistic/`): `vote-up`, `post-answer`, `post-question` —
  optimistic updates the compiler derives from the mutation write set joined with
  the query read set (SPEC §10.2 / §11.1). No hand-written merges.
- **Components** (`src/components/`): `question-list`, `question-detail`,
  `chrome` — styled with `@kovojs/style` tokens (`src/theme.ts`).
- **Interactive app tests** (`src/interactive-app.test.ts`) cover routes and
  mutation refresh behavior through compiler-emitted live targets.

`src/generated/**` are compiler **artifacts** (lowered components, optimistic
stamps, `graph.json`) — author the TSX/TS sources, not the lowered IR (SPEC §5.2).

## Run

```bash
# Dev server (Vite-plus toolchain runner):
pnpm --filter @kovojs/example-stackoverflow dev       # vp dev

# Run the tests:
pnpm --filter @kovojs/example-stackoverflow test       # vitest --run

# Build and serve:
pnpm --filter @kovojs/example-stackoverflow build       # vp build
pnpm --filter @kovojs/example-stackoverflow start       # node scripts/serve.mjs
```

`vp` is the Vite-plus toolchain runner; `kovo` is the framework CLI. This example
drives its build through `vp`.
