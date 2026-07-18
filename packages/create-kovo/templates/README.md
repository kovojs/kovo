# {{name}}

A Kovo starter: a small contact book that exercises the building blocks a real
CRM/ecommerce app needs — a typed database, queries, a guarded mutation with
optimistic UI, real authentication, and styled UI components — in as little code
as possible.

```sh
pnpm run dev         # kovo dev — bootstrap trust roots, then start Vite
pnpm run check       # vp check + sound-subset + endpoint posture + kovo build
pnpm run test        # vp test
pnpm run build:prod  # kovo build ./src/app.tsx → dist/server (node preset)
npm start            # NODE_ENV=production node dist/server/server.mjs
```

For local development, sign in at `/login` with `demo@example.com` and the
random `KOVO_DEMO_PASSWORD` value in your generated, gitignored `.env` file.

## What's here

| File                   | Building block                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/schema.ts`        | Drizzle tables. `contacts` carries a `kovo({ domain, key, authzPolicy })` annotation so the compiler can prove invalidation and authorization posture; the five Better Auth tables sit alongside it. |
| `src/db.ts`            | App-facing database types plus `readonlyAppDb` for read surfaces; raw PGlite creation and seeding live in the framework-owned `_kovo` runtime module.                                                |
| `src/queries.ts`       | `contactsQuery` — a typed read whose Drizzle select the compiler extracts.                                                                                                                           |
| `src/mutations.ts`     | `addContact` — a CSRF-protected, `authed`-guarded write with input validation and an optimistic list update.                                                                                         |
| `src/auth.ts`          | Real [Better Auth](https://better-auth.com) on the same PGlite/Drizzle database, wired into Kovo via `@kovojs/better-auth`.                                                                          |
| `src/components/*.tsx` | `@kovojs/ui` components (`Card`, `Button`, `Badge`) composing the contact list, add-contact form, and auth forms.                                                                                    |
| `src/app.tsx`          | The whole app: `createApp({ db, queries, mutations, routes, sessionProvider })` plus the routes. `vite.config.ts`'s `kovo({ app })` and `kovo build` both load this default export.                  |
| `src/theme.ts`         | `defineTheme` — change the seed/custom colors to retheme everything.                                                                                                                                 |

`kovo dev` bootstraps Kovo before loading the Vite config; `vp check` and `vp test`
retain the `kovo()` config integration, which
compiles the app and serves route documents and `/c/` handler modules (SPEC.md
§9.5). `pnpm run check` also runs `kovo build`, so the compiler-derived
dependency graph verifier runs before deploy — there is no hand-maintained graph
file.

`pnpm run check` also enforces the SPEC.md §6.6 sound TypeScript subset for app
source: strict TypeScript plus local bans on `any`, non-null assertions, and
unchecked `as` casts. Keep deliberate escapes outside starter app code until
they have a framework-owned audit path.

Install note: Better Auth currently marks `drizzle-orm@^0.45.2` as an optional
peer while this starter uses Drizzle `1.0.0-rc.4`. The resulting pnpm peer warning
is expected; Kovo's Better Auth adapter and starter tests cover this Drizzle 1.0
shape.

## Deploying

Local development defaults to embedded PGlite under `.kovo/pglite`. External
Postgres is the deploy path: keep one least-privilege runtime/login URL for app
requests, one dedicated system URL for framework replay/auth work, and a separate owner/admin URL
for setup and fallback posture checks. All three must target the same database on the same writable
primary. The scaffolded `.env.example` documents
the full DB surface: `KOVO_DATABASE_URL`, `KOVO_RUNTIME_DATABASE_URL`,
`KOVO_ADMIN_DATABASE_URL`, `KOVO_DB_SYSTEM_URL`, `KOVO_DB_DRIVER`, and `KOVO_DATA_DIR`.

### Deploying to Postgres

1. Generate or review migrations from your schema changes: `kovo db generate`.
2. Apply the reviewed SQL with the privileged URL: `kovo db migrate`.
3. Provision Kovo-managed roles, grants, and RLS posture: `kovo db provision`.
4. Verify the live runtime posture with `KOVO_RUNTIME_DATABASE_URL` plus
   `KOVO_DB_SYSTEM_URL` (preferred) or `KOVO_ADMIN_DATABASE_URL`: `kovo db check`.
5. Build and start the app with `KOVO_DATABASE_URL` and `KOVO_DB_SYSTEM_URL`.

Set `KOVO_RUNTIME_DATABASE_URL` to the same ordinary login as `KOVO_DATABASE_URL` unless your CI
uses an equivalent separate credential. Keep `KOVO_ADMIN_DATABASE_URL` scoped to setup and fallback
checks; do not put it in the app process. The app boots with the ordinary runtime login plus the
dedicated `kovo_system` login, never the owner/admin connection. `kovo db check` prefers that same
system URL when both authorities are present.

`kovo build ./src/app.tsx` reruns TypeScript and Kovo graph verification, then
emits a Node server under `dist/server` using the preset in `kovo.config.ts`
(Node by default; uncomment Vercel or Cloudflare). The generated `serve` and
`start` scripts set `NODE_ENV=production`; keep that posture in your process
manager so production blocks private-network egress by default, emits `Secure`
host-bound CSRF cookies, and refuses weak signing secrets. Production also
requires `BETTER_AUTH_URL` to be the app's canonical public HTTPS origin (for
example, `https://app.example.com`). Set `KOVO_CSRF_SECRET`/`BETTER_AUTH_SECRET`
to strong values in the target environment
(a fresh `KOVO_CSRF_SECRET` is generated into `.env` at scaffold time and is
gitignored). If you add client islands, configure the `retention` option in
`kovo.config.ts` once your deploy keeps prior `/c/__v/...` modules and prior-token
`/_q` reads available for at least 24 hours; otherwise `build:prod` fails KV417
instead of shipping a skew-prone artifact. PGlite persists under `.kovo/pglite` by default; set
`KOVO_DATA_DIR` to an absolute mounted volume path before deploy. Liveness comes
from BroadcastChannel plus refetch-on-focus, not a live bus (SPEC.md §9.3).
