---
title: Installation
description: Prerequisites, scaffolding a project, and the commands you will run every day.
order: 1
---

# Installation

> **Pre-release status.** Jiso is pre-v1 and nothing is published to npm yet. The scaffolder and
> commands below describe the intended flow and work today _inside the
> [jiso repository](https://github.com/jiso-sh/jiso)_ as workspace packages. Until packages are
> published, clone the repo and work in a workspace member — the [Tutorial](/tutorial/) does
> exactly that.

## Prerequisites

- **Node.js 24+** — the toolchain targets current Node.
- **pnpm 10+** — the workspace package manager.
- **A TypeScript-strict disposition** — Jiso's correctness claims are claims about TypeScript
  programs that stay inside the sound subset. The starter ships `strict` everything plus lint bans
  on `any`, non-null assertions, and `as` casts in app code (SPEC §6.6). Those aren't style
  preferences; the proof surface depends on them.

## Scaffold a project

```sh
pnpm create jiso my-app
cd my-app
pnpm install
```

The starter is intentionally small: one component, one route's worth of HTML, Tailwind wired
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

`vp check` is the command to internalize. Jiso pushes application wiring — handler references,
form fields, navigation targets, data-binding paths — into the type system and the compiler, so
the error you would have found by clicking around in a browser shows up here instead, with a
teaching message that cites the spec section it enforces.

## Where to go next

- The [mental model](/docs/mental-model/) — what Jiso compiles your components into, and why the
  output is meant to be read.
- The [Tutorial](/tutorial/) — build a working e-commerce app step by step.
