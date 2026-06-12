---
title: '1. Scaffold & the first page'
description: Set up the tutorial workspace and serve a complete HTML document from a typed route.
order: 1
---

# Scaffold & the first page

Over the next eight chapters you'll build a small e-commerce app: a product catalog, a cart,
optimistic updates, streaming, and a behavior graph a machine can check — the same shape as the
reference app the framework's own acceptance criteria are written against (SPEC §16). Along the
way you'll absorb the Jiso model: declare each fact once, derive every dependent surface, and
keep everything the system produces readable and checkable (SPEC §1.1).

> **These code blocks can't lie.** Every code block in this tutorial is extracted at build time
> from a checked-in, compiling, tested step state under `site/tutorial/steps/` in the
> [jiso repository](https://github.com/jiso-sh/jiso). One command —
> `node site/tutorial/run-steps.mjs` — typechecks every step, compiles every component through
> the real compiler, and runs every step's tests. If a chapter and its code ever disagreed, CI
> would go red. This chapter's state is `site/tutorial/steps/01-first-page/`.

## Prerequisites

Jiso is pre-release, so you'll work inside the repository as workspace code — see
[Installation](/docs/installation/) for the prerequisites (Node 24+, pnpm 10+) and a tour of
what `pnpm install` sets up. Strict TypeScript is non-negotiable: the framework's correctness
claims are claims about TypeScript programs that stay inside the sound subset (SPEC §6.6).

## A catalog and a route

Jiso is an MPA framework: each page is a complete document, there is no client router, and
navigation is real navigation (SPEC §8). So a page starts on the server, with a route. You
declare the route as a plain value, and the compiler captures its path string as a literal type:

{{snippet:01-first-page/src/app.ts#catalog}}

{{snippet:01-first-page/src/app.ts#home-route}}

`route()` doesn't register anything into a hidden router — it hands you a value you can export,
test, and point links at. Because the path is a literal type, every `<Link>`, GET form, and
`redirect()` that targets it is checked against it; rename the path and every consumer turns
red under `vp check` (SPEC §6.4). Hold onto that idea — the whole tutorial returns to it:
declare once, derive everywhere, let renames be compiler errors instead of production
incidents.

## Typed params and a real 404

The product detail route declares its params schema once, coercion included — the same way form
fields will declare theirs in chapter 4 (SPEC §6.3):

{{snippet:01-first-page/src/app.ts#product-route}}

`notFound()` is a sanctioned page outcome, not an exception: return it and the route answers
with a real 404 status, so status codes stay part of the typed surface. The render itself is
ordinary string assembly for now — components arrive in the next chapter:

{{snippet:01-first-page/src/app.ts#render-home}}

## Prove it without a browser

Routes are values, so pages are request/response assertions. The step's test renders the route
the same way a server would and checks the document:

{{snippet:01-first-page/src/app.test.ts#home-test}}

{{snippet:01-first-page/src/app.test.ts#params-test}}

This is the testing posture for the whole tutorial: the server renders complete,
self-describing HTML, so you prove behavior from strings and status codes (SPEC §11.4). No
headless browser appears in any chapter — by the end, your app's full behavior surface is
checked by TypeScript, tests, and graph queries alone (SPEC §16.3).

Run this step's tests from the repo root with `npx vitest --run site/tutorial/steps/01-first-page`.

You now have typed routes serving complete documents, a real 404, and tests that need no
browser. Next: the page's first interactivity — without shipping a framework to the client.
