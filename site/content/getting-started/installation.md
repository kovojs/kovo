---
title: Installation
description: Prerequisites, scaffold options, generated files, and the commands the starter uses.
order: 4
---

# Installation

If you just want to get a page on screen fast, start with the [Quickstart](/getting-started/quickstart/).
This page covers prerequisites, scaffold options, generated files, and the two command surfaces
Kovo projects use.

## Prerequisites

- **Node.js 22.15+** - the minimum Node line supported by the current toolchain. Repository
  automation enables Node's transform-types flag where workspace source TS is loaded directly.
- **pnpm 10+** - the workspace package manager.
- **TypeScript, strict** - Kovo's correctness guarantees are guarantees about TypeScript programs
  that stay inside the sound subset. The starter ships strict TypeScript because the compiler can
  only prove handler, form, route, and data-binding facts about code that keeps those facts typed.

## Scaffold a project

```sh
pnpm create kovo my-app
cd my-app
pnpm install
```

The default starter uses PGlite with Drizzle's Postgres dialect. Use SQLite when that is the
deployment target you want to prove from the first commit:

```sh
pnpm create kovo my-app -- --dialect sqlite
```

The CLI accepts:

```txt
create-kovo <target-directory> [--name <package-name>] [--dialect postgres|sqlite] [--disable-git]
```

`--postgres` and `--sqlite` are accepted aliases. The target directory must be empty when it already
exists; the command refuses to merge into a non-empty app. By default, `create-kovo` initializes a
Git repository after writing the scaffold. Pass `--disable-git` to skip that. If the target is
already inside a Git or Mercurial repository, the command does not create a nested Git repository.

> **Pre-v1:** not on npm yet. These commands describe the intended flow and work today inside the
> [Kovo repository](https://github.com/kovojs/kovo) as workspace packages - clone the repo and work
> in a workspace member, as the [Tutorial](/tutorial/) does.

## What the starter writes

The scaffold is intentionally real, not a blank page. It writes:

- Better Auth over the same Drizzle database as app data.
- A session provider, sign-in/sign-out mutations, and anonymous-to-session CSRF binding.
- A guarded home route plus `/login`.
- A contact schema, seeded database, typed contact query, and guarded add-contact mutation.
- Styled UI components, theme tokens, document CSS, Vitest coverage, Vite/Kovo config, and CI.
- `.env.example`, `.gitignore`, and a gitignored `.env` with a fresh local CSRF secret.
- A Git repository for the new app, unless you passed `--disable-git` or scaffolded inside an
  existing Git/Mercurial repository.

The generated `.env` is for local development only. Set `BETTER_AUTH_SECRET` or
`KOVO_CSRF_SECRET` to a strong deployment secret before serving the app outside your machine.

## The everyday commands

This is the authoritative command table; the [Quickstart](/getting-started/quickstart/) links here rather than
repeating it.

| Command                          | What it does                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `vp dev`                         | Dev server with the Kovo compile step.                                                                     |
| `npm run check`                  | Full starter gate: `vp check`, sound-subset policy, and endpoint posture.                                  |
| `vp check`                       | Typecheck + lint sub-gate; this is where Kovo static errors surface.                                       |
| `npm run check:sound-subset`     | Rejects `any`, unchecked casts, and non-null assertions in starter app code.                               |
| `npm run check:endpoint-posture` | Exercises declared endpoint fixtures, then runs `kovo check endpoint-posture .kovo/endpoint-posture.json`. |
| `vp test`                        | Vitest suites.                                                                                             |
| `npm run build:prod`             | Production build through `kovo build ./src/app.tsx`.                                                       |
| `npm start`                      | Run the emitted Node server from `dist/server/server.mjs`.                                                 |

### Two CLIs, two jobs

Kovo projects use two distinct binaries. `vp` is the project/toolchain runner: dev, build, test,
and check. `kovo` is the framework CLI: graph-level checks and explains, production build, and
copy-in commands such as `kovo add`. The [CLI guide](/guides/cli/) covers the full surface of both.

If you internalize one command, make it `npm run check`. `vp check` proves the framework wiring -
handler references, form fields, navigation targets, and data-binding paths - but the scaffold's
full gate also runs the app sound-subset policy and the endpoint-posture audit that verifies declared
machine ingress.

<details>
<summary>Spec & diagnostics</summary>

The starter sound-subset script enforces the app-authored subset Kovo relies on for SPEC §6.6
client-capture and sink guarantees. `npm run check:endpoint-posture` writes
`.kovo/endpoint-posture.json` from real endpoint requests and validates it with
`kovo check endpoint-posture .kovo/endpoint-posture.json`.

</details>

## Which primitive comes from which package

Newcomers trip on import paths before anything else. The split is small and stable:

| Primitive                                                        | Package               | What it is                                                                        |
| ---------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------- |
| `route`, `query`, `mutation`, `s`, `domain`, `guards`, `session` | `@kovojs/server`      | server-side facts: routes, typed reads/writes, schemas, domains, guards, sessions |
| `component`, `form`                                              | `@kovojs/core`        | the component model and form helpers used in TSX                                  |
| Better Auth adapters and guards                                  | `@kovojs/better-auth` | session adaptation and auth mutations backed by Better Auth                       |
| Drizzle extraction helpers                                       | `@kovojs/drizzle`     | query/write metadata the compiler can audit                                       |
| Styled UI components                                             | `@kovojs/ui/*`        | public component subpaths, also available through `kovo add` copy-in              |

The [mental model](/getting-started/mental-model/) and [Queries chapter](/tutorial/03-queries/) repeat this
inline where the primitives first appear.

## Where to go next

- [Project structure](/getting-started/project-structure/) - every generated file and where to extend it.
- [Quickstart](/getting-started/quickstart/#5-extend-the-starter-safely) - the first larger changes to make after install.
- [Better Auth integration](/guides/auth-better-auth/) - auth wiring from the scaffold in detail.
- [Troubleshooting & upgrading](/getting-started/troubleshooting/) - common setup failures and how
  to compare your app against the current scaffold.
