---
title: Installation
description: Get a Jiso project on your machine and learn the handful of commands you'll run every day.
order: 1
---

# Installation

Jiso is a compiler-first framework: you write TSX components, and the build turns them into
self-describing HTML that needs almost no client runtime. This page gets a project running and
introduces the commands you'll live in.

## Prerequisites

- **Node.js 24+** — the toolchain targets current Node.
- **pnpm 10+** — the workspace package manager.
- **TypeScript, strict** — Jiso's correctness guarantees are guarantees about TypeScript programs
  that stay inside the sound subset. The starter ships `strict` everything plus lint bans on
  `any`, non-null assertions, and `as` casts in app code. These aren't style preferences: the
  static checks can only prove things about code that plays by these rules. SPEC §6.6

## Scaffold a project

```sh
pnpm create jiso my-app
cd my-app
pnpm install
```

> **One caveat before you copy-paste.** Jiso is pre-v1 and not yet published to npm. These
> commands describe the intended flow, and they work today inside the
> [jiso repository](https://github.com/jiso-sh/jiso) as workspace packages. Until packages are
> published, clone the repo and work in a workspace member — the [Tutorial](/tutorial/) does
> exactly that.

The starter is deliberately small: one component, one route's worth of HTML, Tailwind wired
through Vite+, and the graph-verification scripts that make the framework's checks part of your
CI from day one.

## The everyday commands

| Command                   | What it does                                                  |
| ------------------------- | ------------------------------------------------------------- |
| `vp dev`                  | Dev server with the Jiso compile step                         |
| `vp check`                | Typecheck + lint — this is where Jiso's static errors surface |
| `vp test`                 | Vitest suites                                                 |
| `vp run build`            | Production build                                              |
| `vp run fw-check`         | Framework semantic checks over the emitted app graph          |
| `vp run graph-assertions` | Your app's own behavior assertions, as graph queries          |

Everything routes through [Vite+](https://viteplus.dev) (`vp`) as the single project entrypoint.

If you internalize one command, make it `vp check`. Jiso pushes application wiring — handler
references, form fields, navigation targets, data-binding paths — into the type system and the
compiler, so the error you would otherwise find by clicking around in a browser shows up here
instead, with a teaching message that cites the spec section it enforces.

## Where to go next

- The [mental model](/docs/mental-model/) — what Jiso compiles your components into, and why the
  output is meant to be read.
- The [Tutorial](/tutorial/) — build a working e-commerce app step by step.
