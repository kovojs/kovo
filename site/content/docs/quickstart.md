---
title: Quickstart
description: Scaffold a Jiso app, get a page rendering, and watch the compiler catch a bug you'd normally ship.
order: 2
---

# Quickstart

In a few minutes you'll have a typed page rendering in the browser — and you'll see the thing that
makes Jiso different: a wiring mistake that fails the build instead of reaching production.

> **Status: pre-v1.** Jiso isn't on npm yet. The commands below describe the intended flow and work
> today inside the [Jiso repository](https://github.com/jiso-sh/jiso) as workspace packages. Until
> packages publish, clone the repo and work in a workspace member — that's all the
> [Tutorial](/tutorial/) does, and it runs against the real compiler.

## 1. Scaffold

```sh
pnpm create jiso my-app
cd my-app
pnpm install
```

You get a deliberately small project: one component, one route's worth of HTML, Tailwind wired
through Vite, and the graph-check scripts that make Jiso's verification part of your CI from day one.

## 2. Run it

```sh
vp dev
```

Open the page. It's a complete HTML document served from a typed route — no client framework
booted, no hydration. View Source and you'll see real markup, not an empty `<div id="root">`.

## 3. Add a page

A route is a plain value. The compiler captures its path as a literal type, so everything that
points at it is checked against it:

```ts
import { route } from '@jiso/server';

export const productRoute = route('/products/:id', {
  params: { id: String },
  page({ params }) {
    return `<main><h1>Product ${params.id}</h1></main>`;
  },
});
```

A `<Link to="/products/:id" params={{ id }}>` anywhere in your app now typechecks against this
route. Rename the path and every link to it turns red under `vp check`.

## 4. Watch the compiler catch a bug

This is the part worth seeing. Make a normal-looking mistake — bind an element to data the query
doesn't return:

```tsx
// the query returns { count: number }
<span>{cart.total}</span> // there is no `total`
```

Then run the check:

```sh
vp check
```

Instead of a blank render in production, you get a compile error at the binding, naming the fix.
This is where Jiso surfaces the mistakes other stacks only reveal at runtime: handler references,
form fields, navigation targets, and data-binding paths all live in the type system.

```sh
vp check     # typecheck + lint — Jiso's static errors show up here
```

If you internalize one command, make it `vp check`.

## The commands you'll use daily

| Command                   | What it does                                         |
| ------------------------- | ---------------------------------------------------- |
| `vp dev`                  | Dev server with the Jiso compile step                |
| `vp check`                | Typecheck + lint — where wiring errors surface       |
| `vp test`                 | Vitest suites                                        |
| `vp run build`            | Production build                                     |
| `vp run fw-check`         | Framework semantic checks over the emitted app graph |
| `vp run graph-assertions` | Your app's own behavior assertions, as graph queries |

## Next steps

- [Thinking in Jiso](/docs/mental-model/) — how components become self-describing HTML.
- [Installation](/docs/installation/) — prerequisites and what the scaffold sets up.
- [Tutorial](/tutorial/) — build a real commerce app end to end.

<details>
<summary>Spec references</summary>

Typed routes and link checking: SPEC §6.4. Strict-TypeScript sound subset as the basis for the
static guarantees: SPEC §6.6. Data-binding paths checked against query result shape: SPEC §4.8.

</details>
