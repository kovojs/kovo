---
title: Project structure
description: Tour the files in the current create-kovo scaffold and see where to extend them.
order: 5
---

# Project structure

A scaffolded Kovo project is a small authenticated app. Here is the shape `create-kovo` writes:

```txt
my-app/
|-- .env                    # generated local CSRF/auth secret, gitignored
|-- .env.example            # deployment secret template
|-- .github/workflows/ci.yml
|-- .gitignore
|-- kovo.config.ts          # production build preset
|-- package.json
|-- vite.config.ts          # Vite+ plus the Kovo plugin
|-- src/
|   |-- app.tsx             # createApp(), routes, layout, request handler
|   |-- app.test.ts         # focused app smoke test
|   |-- auth.ts             # Better Auth + Kovo session/mutation adapters
|   |-- db.ts               # Drizzle database setup and seed data
|   |-- mutations.ts        # guarded add-contact mutation
|   |-- queries.ts          # typed contact query
|   |-- schema.ts           # app tables plus Better Auth tables
|   |-- styles.css          # document CSS
|   |-- theme.ts            # typed theme tokens
|   `-- components/
|       |-- auth-forms.tsx  # sign-in/sign-out forms
|       `-- contacts.tsx    # query-backed contact region and add form
`-- tsconfig.json           # when your package manager/template writes one
```

The SQLite dialect swaps in `package.sqlite.json`, `src/db.sqlite.ts`, `src/schema.sqlite.ts`,
`src/auth.sqlite.ts`, and `README.sqlite.md` at scaffold time. The public file names stay the same
inside your generated app.

## The app entry

`src/app.tsx` is the center of the scaffold. It imports the database, session provider, mutations,
queries, route components, theme, and stylesheet, then creates the app:

```tsx
createApp({
  db: () => appDb,
  mutations: [addContact, appSignIn, appSignOut],
  queries: [contactsQuery],
  sessionProvider: (request) => appSessionProvider(request),
  routes: [homeRoute, loginRoute],
});
```

The home route redirects unauthenticated requests to `/login`; the login route renders the auth
form. Both use the same `layout()` and stylesheet declaration.

## Auth and secrets

`src/auth.ts` wires Better Auth through `@kovojs/better-auth`:

- `betterAuthSession()` adapts Better Auth's session into `request.session`.
- `betterAuthSignInEmailMutation()` and `betterAuthSignOutMutation()` create ordinary Kovo
  mutations for the auth forms.
- CSRF tokens bind to an anonymous id before login and to the session id after login.
- `seedDemoUser()` creates `demo@example.com / password123` for a fresh `vp dev`.

`create-kovo` writes a fresh `KOVO_CSRF_SECRET` into `.env` and refuses to let the app run with the
placeholder. In production, set `BETTER_AUTH_SECRET` or `KOVO_CSRF_SECRET` through the platform's
secret store.

## Data, queries, and mutations

`src/schema.ts` declares the app table and the Better Auth tables. The contact table is annotated so
the compiler can connect writes to query refreshes. `src/db.ts` creates the Drizzle database and
seeds local data. `src/queries.ts` owns the contact read; `src/mutations.ts` owns the guarded
add-contact write.

When adding product data, keep the same separation:

1. Add the table and domain metadata in `schema.ts`.
2. Seed or connect storage in `db.ts`.
3. Add typed reads in `queries.ts`.
4. Add guarded writes in `mutations.ts`.
5. Render the data from `components/`.

That path keeps the compiler's query/write extraction readable and gives tests one clear place to
assert each behavior.

## The graph workflow

The starter no longer asks you to hand-maintain a root `graph.json`. The app facts live in the
authored modules above; the Kovo compiler/build tools derive the graph from those facts. For larger
apps, add an explicit graph-emission script like the example apps do:

```sh
pnpm --filter @kovojs/example-commerce run build:demo
pnpm --filter @kovojs/example-crm run emit-graph
kovo explain query cart graph.json
kovo explain mutation cart/add --optimistic graph.json
```

`kovo explain` output is stable and diffable by design. When a product rule matters, assert it in a
test or graph script and run it in CI. The [kovo check & kovo explain guide](/guides/kovo-explain/)
walks through the recipes. SPEC section 11.4

## Styling

StyleX is the default component styling path. Author typed `@kovojs/style` objects in TSX, use
plain document CSS for fonts, page chrome, and theme tokens, and declare stylesheet hints for every
page, mutation fragment, and deferred stream so late HTML arrives styled. SPEC section 13.1

## Deployment shape

A Kovo app deploys as a stateless server: mutation responses are ordinary HTML over the wire and
the server keeps no record of what's on screen. `kovo build ./src/app.tsx` emits `dist/server`, and
`npm start` runs `dist/server/server.mjs` for the Node preset.

The [deployment guide](/guides/deployment/) covers the two real obligations: keeping versioned
`/c/*` client modules published across deploys, and not breaking the stateless-server guarantee.
SPEC section 9.5
