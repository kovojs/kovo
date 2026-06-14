---
title: Installation
description: Prerequisites, what the scaffold sets up, and why Jiso asks for strict TypeScript.
order: 4
---

# Installation

If you just want to get a page on screen fast, start with the [Quickstart](/docs/quickstart/). This
page covers the prerequisites, what the scaffold gives you, and why Jiso insists on strict
TypeScript.

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

> **Pre-v1:** not on npm yet. These commands describe the intended flow and work today inside the
> [Jiso repository](https://github.com/jiso-sh/jiso) as workspace packages — clone the repo and work
> in a workspace member, as the [Tutorial](/tutorial/) does.

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
