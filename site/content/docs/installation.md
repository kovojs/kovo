---
title: Installation
description: Prerequisites, what the scaffold sets up, and why Kovo asks for strict TypeScript.
order: 4
---

# Installation

If you just want to get a page on screen fast, start with the [Quickstart](/docs/quickstart/). This
page covers the prerequisites, what the scaffold gives you, and why Kovo insists on strict
TypeScript.

## Prerequisites

- **Node.js 24+** — the toolchain targets current Node.
- **pnpm 10+** — the workspace package manager.
- **TypeScript, strict** — Kovo's correctness guarantees are guarantees about TypeScript programs
  that stay inside the sound subset. The starter ships `strict` everything plus lint bans on
  `any`, non-null assertions, and `as` casts in app code. These aren't style preferences: the
  static checks can only prove things about code that plays by these rules. SPEC §6.6

## Scaffold a project

```sh
pnpm create kovo my-app
cd my-app
pnpm install
```

> **Pre-v1:** not on npm yet. These commands describe the intended flow and work today inside the
> [Kovo repository](https://github.com/kovojs/kovo) as workspace packages — clone the repo and work
> in a workspace member, as the [Tutorial](/tutorial/) does.

The starter is deliberately small: one component, one route's worth of HTML, StyleX component
styles plus plain document CSS, and the graph-verification scripts that make the framework's checks
part of your CI from day one.

## The everyday commands

This is the authoritative command table; the [Quickstart](/docs/quickstart/) links here rather
than repeating it.

| Command                   | What it does                                                  |
| ------------------------- | ------------------------------------------------------------- |
| `vp dev`                  | Dev server with the Kovo compile step                         |
| `vp check`                | Typecheck + lint — this is where Kovo's static errors surface |
| `vp test`                 | Vitest suites                                                 |
| `vp run build`            | Production build                                              |
| `vp run kovo-check`       | npm script that runs `kovo check` — framework graph checks     |
| `vp run graph-assertions` | Your app's own behavior assertions, as graph queries          |

### Two CLIs, two jobs

> Kovo ships **two distinct binaries**. `vp` is the project/toolchain runner — Vite+ drives `vp
> dev`, `vp build`, `vp test`, and `vp check` (typecheck + lint). `kovo` is the framework CLI — it
> owns the graph-level work: `kovo check` (the framework graph check), `kovo explain`, and
> scaffolding via `kovo add`. The `vp run kovo-check` script above is just an npm script that
> shells out to `kovo check`; `vp check` itself only runs typecheck + lint, not the framework graph
> check. The [CLI guide](/guides/cli/) covers the full surface of both.

Everything project-level routes through [Vite+](https://viteplus.dev) (`vp`) as the single
toolchain entrypoint; the framework graph work routes through `kovo`.

If you internalize one command, make it `vp check`. Kovo pushes application wiring — handler
references, form fields, navigation targets, data-binding paths — into the type system and the
compiler, so the error you would otherwise find by clicking around in a browser shows up here
instead, with a teaching message that cites the spec section it enforces.

## Which primitive comes from which package

Newcomers trip on import paths before anything else. The split is small and stable:

| Primitive | Package | What it is |
| --- | --- | --- |
| `route`, `query`, `mutation`, `s`, `domain`, `guards`, `session` | `@kovojs/server` | server-side facts: routes, typed reads/writes, schemas, domains, guards, sessions |
| `component`, `form` | `@kovojs/core` | the component model and form helpers used in TSX |

The [mental model](/docs/mental-model/) and [Queries chapter](/tutorial/03-queries/) repeat this
inline where the primitives first appear.

## Where to go next

- The [mental model](/docs/mental-model/) — what Kovo compiles your components into, and why the
  output is meant to be read.
- The [Tutorial](/tutorial/) — build a working e-commerce app step by step.
