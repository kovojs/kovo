---
title: Quickstart
description: Scaffold the current Kovo starter, sign in, and verify the app before extending it.
order: 2
---

# Quickstart

In a few minutes you'll have the current Kovo starter running: a signed-in contact book over a real
Drizzle database, Better Auth session handling, a guarded mutation, typed queries, styled
components, tests, CI, and production build wiring.

> **Status: pre-v1.** Kovo isn't on npm yet. The commands below describe the intended flow and work
> today inside the [Kovo repository](https://github.com/kovojs/kovo) as workspace packages. Until
> packages publish, clone the repo and work in a workspace member - that's all the
> [Tutorial](/tutorial/) does, and it runs against the real compiler.

## 1. Scaffold

```sh
pnpm create kovo my-app
cd my-app
pnpm install
```

Use SQLite when you want a local file-backed starter instead of the default PGlite/Postgres-shaped
one:

```sh
pnpm create kovo my-app -- --dialect sqlite
```

The scaffold writes `src/app.tsx`, `src/auth.ts`, `src/db.ts`, `src/schema.ts`, `src/queries.ts`,
`src/mutations.ts`, two starter components, theme/CSS files, a Vitest app test, Vite/Kovo config,
CI, `.env.example`, and a generated local `.env` with a fresh CSRF secret. The generated `.env` is
gitignored; replace the secret in your deployment environment before shipping.

## 2. Run it

```sh
vp dev
```

Open `/login` and sign in with the seeded demo user:

```txt
demo@example.com / password123
```

The home page is a complete HTML document served from typed routes - no client framework booted, no
hydration. View Source and you'll see real markup for the shell, the signed-in user, and the
contact region.

## 3. Check it

Run the starter's focused gates before editing:

```sh
vp check
vp test
```

`vp check` runs the Vite+ type/lint pipeline that surfaces Kovo static errors. `vp test` runs the
starter test through the same app wiring. The production path is also present from day one:

```sh
npm run build:prod
npm start
```

## 4. Make the first real change

Start with the domain data. Add a field to `src/schema.ts`, include it in `src/queries.ts`, render
it in `src/components/contacts.tsx`, and update `src/mutations.ts` if the add-contact form should
write it. That path exercises the whole starter: Drizzle schema, typed query, guarded mutation,
styled component render, and test coverage.

A normal wiring mistake fails early. For example, if `contactsQuery` returns `name` and `email` but
a component tries to render a missing `company` field:

```tsx
<span>{contact.company}</span>
```

then:

```sh
vp check
```

reports the binding error during development instead of letting the mismatch reach production.

## 5. Extend safely

Use [From starter to app](/guides/starter-to-app/) for the first larger extension. It walks through
adding data, routes, guards, queries, mutations, styling, tests, and deploy secrets without
fighting the scaffold.

## The commands you'll use daily

`vp` is the toolchain runner (`vp dev`, `vp check`, `vp test`, `vp build`) and `kovo` is the
framework CLI (`kovo check`, `kovo explain`, `kovo add`). The full table - and the rule for which
binary does what - lives in [Installation > The everyday commands](/docs/installation/#the-everyday-commands).

## Next steps

- [Thinking in Kovo](/docs/mental-model/) - how components become self-describing HTML.
- [Installation](/docs/installation/) - prerequisites and what the scaffold sets up.
- [From starter to app](/guides/starter-to-app/) - the safe path from the scaffold to real product code.
- [Commerce walkthrough](/guides/example-commerce/) - a larger authenticated storefront built the same way.

<details>
<summary>Spec references</summary>

Typed routes and link checking: SPEC section 6.4. Strict-TypeScript sound subset as the basis for
the static guarantees: SPEC section 6.6. Data-binding paths checked against query result shape:
SPEC section 4.8.

</details>
