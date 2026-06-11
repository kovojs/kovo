---
title: '1. Scaffold & the first page'
description: Set up the tutorial workspace and serve a complete HTML document from a typed route.
order: 1
---

# Scaffold & the first page

This tutorial builds a small e-commerce app — a product catalog, a cart, optimistic updates,
streaming, and a machine-checkable behavior graph — the same shape as the reference commerce app
the framework's own acceptance criteria are written against (SPEC §16). Along the way it teaches
the Jiso model: declare facts once, let the toolchain derive every surface, and keep everything
the system produces readable and checkable (SPEC §1.1).

One rule before anything else: **every code block in this tutorial is extracted from a
checked-in, compiling, tested step state** — never pasted into prose by hand. Each chapter has a
directory under `site/tutorial/steps/` in the [jiso repository](https://github.com/jiso-sh/jiso),
and a single command typechecks every step, compiles every component through the real compiler,
and runs every step's tests:

`node site/tutorial/run-steps.mjs`

If a chapter and its code ever disagreed, CI would go red — the tutorial cannot drift, it can
only fail loudly. This chapter's state is `site/tutorial/steps/01-first-page/`.

## Prerequisites

Jiso is pre-release, so the tutorial runs inside the repository as workspace code — see
[Installation](/docs/installation/) for the prerequisites (Node 24+, pnpm 10+) and a tour of
what `pnpm install` sets up. Strict TypeScript is not optional: the framework's correctness
claims are claims about TypeScript programs that stay inside the sound subset (SPEC §6.6).

## A catalog and a route

Jiso is an MPA framework: each page is a complete document, there is no client router, and
navigation is real navigation (SPEC §8). A page therefore starts on the server, with a route —
a declared value whose path string is captured as a literal type (SPEC §6.4):

{{snippet:01-first-page/src/app.ts#catalog}}

{{snippet:01-first-page/src/app.ts#home-route}}

`route()` is not registration into a hidden router — it is a plain value you can export, test,
and point links at. Because the path is a literal type, every `<Link>`, GET form, and
`redirect()` that targets it is checked against it; renaming a route path turns every consumer
red under `vp check` (SPEC §6.4). That is the propagation property this whole tutorial keeps
returning to: declare once, derive everywhere, and let renames be compiler errors instead of
production incidents.

## Typed params and a real 404

The product detail route declares its params schema once — coercion included — exactly the way
form fields will declare theirs in chapter 4 (SPEC §6.3, §6.4):

{{snippet:01-first-page/src/app.ts#product-route}}

`notFound()` is a sanctioned page outcome, not an exception: returning it renders a 404 with the
correct status, so status codes stay part of the typed surface (SPEC §6.4). The render itself is
ordinary string assembly for now — components arrive in the next chapter:

{{snippet:01-first-page/src/app.ts#render-home}}

## Prove it without a browser

Routes are values, so pages are request/response assertions. The step's test renders the route
the same way a server would and checks the document:

{{snippet:01-first-page/src/app.test.ts#home-test}}

{{snippet:01-first-page/src/app.test.ts#params-test}}

This is the testing posture for the entire tutorial (SPEC §11.4): the server renders complete,
self-describing HTML, so behavior is provable from strings and status codes. No headless
browser appears in any chapter — by the end, you will have an app whose full behavior surface is
checked by TypeScript, tests, and graph queries alone (SPEC §16.3).

Run this step's tests from the repo root with `npx vitest --run site/tutorial/steps/01-first-page`.

Next: the page gets its first interactivity — without shipping a framework to the client.
