# {{name}}

A Kovo starter: a small contact book that exercises the building blocks a real
CRM/ecommerce app needs — a typed database, queries, a guarded mutation with
optimistic UI, real authentication, and styled UI components — in as little code
as possible.

This app was scaffolded with the opt-in SQLite dialect. Postgres is the default
starter dialect; rerun `create-kovo` without `--dialect sqlite` for the PGlite
variant.

```sh
npm run dev      # vp dev — start the dev server
npm run check    # vp check — types + Kovo's compile/coverage checks
npm run test     # vp test
npm run build:prod   # kovo build ./src/app.tsx → dist/server (node preset)
npm start            # node dist/server/server.mjs
```

Sign in at `/login` with the seeded demo account **demo@example.com / password123**.

## What's here

| File                   | Building block                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/schema.ts`        | Drizzle SQLite tables. `contacts` carries a `kovo({ domain, key })` annotation so the compiler can prove invalidation; the four Better Auth tables sit alongside it.                |
| `src/db.ts`            | The database: Drizzle over in-process SQLite through `better-sqlite3`, created and seeded by `createAppDb()`.                                                                       |
| `src/queries.ts`       | `contactsQuery` — a typed read whose Drizzle select the compiler extracts.                                                                                                          |
| `src/mutations.ts`     | `addContact` — a CSRF-protected, `authed`-guarded write with input validation and an optimistic list update.                                                                        |
| `src/auth.ts`          | Real [Better Auth](https://better-auth.com) on the same SQLite/Drizzle database, wired into Kovo via `@kovojs/better-auth`.                                                         |
| `src/components/*.tsx` | `@kovojs/ui` components (`Card`, `Button`, `Badge`) composing the contact list, add-contact form, and auth forms.                                                                   |
| `src/app.tsx`          | The whole app: `createApp({ db, queries, mutations, routes, sessionProvider })` plus the routes. `vite.config.ts`'s `kovo({ app })` and `kovo build` both load this default export. |
| `src/theme.ts`         | `defineTheme` — change the seed/custom colors to retheme everything.                                                                                                                |

SQLite caveats: booleans are Drizzle `integer(..., { mode: 'boolean' })` columns,
timestamps are ISO text columns, and JSON should use `text(..., { mode: 'json' })`
when you add JSON fields. Those mappings are the blessed SQLite subset described
by the data-layer policy.

`vp dev`, `vp check`, and `vp test` run through the `kovo()` Vite plugin, which
compiles the app and serves route documents and `/c/` handler modules (SPEC.md
§9.5). The compiler-derived dependency graph is auditable with `kovo check` and
`kovo explain` against the built app — there is no hand-maintained graph file.

## Deploying

`kovo build ./src/app.tsx` emits a self-contained server under `dist/server`
using the preset in `kovo.config.ts` (Node by default; uncomment Vercel or
Cloudflare). Set `KOVO_CSRF_SECRET`/`BETTER_AUTH_SECRET` to strong values in the
target environment (a fresh `KOVO_CSRF_SECRET` is generated into `.env` at scaffold
time and is gitignored). The server is stateless; liveness comes from
BroadcastChannel + refetch-on-focus, not a live bus (SPEC.md §9.3).
