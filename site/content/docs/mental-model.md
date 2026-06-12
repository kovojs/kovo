---
title: The mental model
description: Understand what Jiso compiles your components into, and why the HTML it ships is the application.
order: 2
---

# The mental model

Most frameworks ship a runtime that interprets your application in the browser. Jiso compiles
your application instead — into artifacts that need almost no interpreter, each one designed to
be read by a human and checked by a machine without executing a browser. Get this picture into
your head and the rest of the docs follow from it.

One picture. SPEC §3

```
AUTHORING                 COMPILED IR                   RUNTIME
cart.tsx          ──►     cart.server.js        ──►     Self-describing HTML
(JSX, inline              (render fns, queries)         • on:click="/c/cart.js#Cart$remove"
 closures)                cart.client.js                • <script fw-query="cart"> JSON
                          (named handler exports)       • fw-deps="cart" stamps
```

## Components compile, they don't hydrate

You author components in TSX — JSX renders, inline closures, one file per component. The
compiler turns each one into a server render module and a client module of named handler exports.
There is no hydration step because there is nothing to hydrate: the HTML carries everything the
page needs to be interactive, as attributes you can read in view-source. SPEC §5.2

Three attribute families do the work:

- **`on:click="/c/cart.js#Cart$remove"`** — a handler reference. The 4KB loader delegates all
  events globally; on first interaction it imports that URL and calls that export. Until you
  touch it, zero component JavaScript loads. SPEC §4.4
- **`data-bind="cart.count"`** — a binding into declared query data. When the `cart` query value
  changes, the loader walks these self-describing attributes and updates the DOM. The path is
  typed against the query's result shape at compile time — rename the column and `vp check` goes
  red. SPEC §4.8, §6.2
- **`fw-deps="cart"`** — a dependency stamp. When a mutation invalidates `cart`, this element is
  what asks the server for a fresh fragment. SPEC §9.1

You never write these attributes yourself. Write ordinary JSX and the compiler stamps the wiring
into the HTML for you — and if a stamp ever drifts out of sync, the build fails before a user can
see the bug.

## No framework-private output

Everything the compiler emits is plain, readable code, and compiling its own output again is a
no-op — a fixpoint that CI enforces (Constitution #3). You can eject any component and keep
going. What that output looks like, and why it's designed to be authorable, is an advanced topic:
see the [Compiler Internals guide](/guides/compiler-internals/). SPEC §5.2

## Navigation is the browser's job

Jiso is a multi-page app. `<Link to="/products/:id" params={{id}}>` is compile-time sugar that
lowers to a plain `<a href="/products/p1">` — TanStack-Router-class link typing with zero router
runtime. Every navigation is a real navigation; cross-document View Transitions and bfcache
hygiene carry the polish. SPEC §6.4, §8

## Interactions use the lowest layer that suffices

Every interaction sits on a ladder, from "the platform already does this" up to "predict the
result before the server confirms it" — and the ladder is enforced, not aspirational. SPEC §7

| Layer | Mechanism                                                            | JS shipped                    |
| ----- | -------------------------------------------------------------------- | ----------------------------- |
| L0    | Platform behaviors: `<dialog>`, popovers, invoker commands, `:has()` | 0                             |
| L1    | Client islands: local state + the update plan                        | handler module on first touch |
| L2    | Mutations: real forms + enhanced fetch → fragment/query patch        | loader + form module          |
| L3    | Optimistic: declared transforms over query values                    | transform module              |

The compiler substitutes L0 where a platform behavior suffices, and lints push everything else
down the ladder. The search dialog on this site is an L1 island — open view-source and find
`on:click="/c/search.js#open"` in the header. No search JavaScript loads until you use it.

## The wire is the documentation

A mutation is a named form POST (`POST /_m/cart/add`); the response is readable HTML fragments
plus query JSON. What you see in the Network panel _is_ the protocol — there is no framework RPC
envelope to decode. This is Constitution #4, and it's why debugging a Jiso app rarely requires
the framework's source at all. SPEC §9.1
