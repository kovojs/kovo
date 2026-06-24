---
title: '1. Scaffold & the first page'
description: Set up the tutorial workspace and serve a complete HTML document from a typed route.
order: 1
---

# Scaffold & the first page

In this chapter you set up the workspace and serve your first page: a typed route that returns
a complete HTML document, with a typed param route and a real 404 alongside it. Over the next
eight chapters you'll grow this into a small e-commerce app — catalog, cart, optimistic
updates, streaming, and a behavior graph a machine can check.

Every code block in this tutorial is extracted at build time from a checked-in, compiling,
tested step state under `site/tutorial/steps/` in the
[kovo repository](https://github.com/kovojs/kovo). One command — `node
site/tutorial/run-steps.mjs` — typechecks every step, compiles every component through the real
compiler, and runs every step's tests, so a chapter and its code stay in sync. This chapter's
state is `site/tutorial/steps/01-first-page/`.

## Prerequisites

Kovo is pre-release, so you'll work inside the repository as workspace code. See
[Installation](/docs/installation/) for the prerequisites (Node 22.15+, pnpm 10+) and a tour of
what `pnpm install` sets up. You'll write strict TypeScript throughout — the framework's
correctness checks are checks on TypeScript programs.

## Declare a catalog and a route

Kovo is an MPA framework: each page is a complete document, there is no client router, and
navigation starts as real navigation. When JavaScript is present, Kovo may enhance an eligible
same-origin click by fetching the full target document and preserving only compiler-proven
unchanged layouts. If that proof is missing, the browser performs the normal navigation. A page
starts on the server, with a route. You declare the route as a plain value, and the compiler
captures its path string as a literal type:

{{snippet:01-first-page/src/app.ts#catalog}}

{{snippet:01-first-page/src/app.ts#home-route}}

`route()` hands you a value you can export, test, and point links at — it doesn't register
anything into a hidden router. Because the path is a literal type, every `<Link>`, GET form, and
`redirect()` that targets it is checked against it. Rename the path and every consumer turns red
under `vp check`. That pattern — declare once, derive everywhere, let renames be compiler errors
— recurs through the whole tutorial.

## Add typed params and a real 404

The product detail route declares its params schema once, coercion included — the same way form
fields will declare theirs in chapter 4:

{{snippet:01-first-page/src/app.ts#product-route}}

`notFound()` is a page outcome, not an exception: return it and the route answers with a real
404 status, so status codes stay part of the typed surface. The render itself is ordinary string
assembly for now — components arrive in the next chapter:

{{snippet:01-first-page/src/app.ts#render-home}}

## Prove it without a browser

Routes are values, so pages are request/response assertions. The step's test renders the route
the same way a server would and checks the document:

{{snippet:01-first-page/src/app.test.ts#home-test}}

{{snippet:01-first-page/src/app.test.ts#params-test}}

This is the testing posture for the whole tutorial: the server renders complete,
self-describing HTML, so you prove behavior from strings and status codes. No headless browser
appears in any chapter.

Run this step's tests from the repo root with `npx vitest --run site/tutorial/steps/01-first-page`.

You now have typed routes serving complete documents, a real 404, and tests that need no
browser. Next: the page's first interactivity — without shipping a framework to the client.

<details>
<summary>Spec & diagnostics</summary>

Tutorial goal and shape: `rules/v1-acceptance.md` and SPEC §1.2. Strict-TypeScript requirement: SPEC §6.6. MPA model
and real navigation: SPEC §8. Typed route paths checked at every consumer: SPEC §6.4. Params
schema with coercion: SPEC §6.3. Self-describing HTML proven from strings: SPEC §11.4. No
browser in the tutorial: `rules/v1-acceptance.md`.

</details>
