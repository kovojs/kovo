---
title: '7. Testing & verification'
description: Guards, the app graph, fw check and fw explain, harness tests with write verification — and parity with the reference app.
order: 7
---

# Testing & verification

This is the chapter the previous six were building toward. The app gains its production posture
— a typed session, a guard chain, an order history — and then proves its entire behavior
surface without executing a browser: `fw check` over the app graph, `fw explain` as a queryable
dependency graph, and harness tests that verify observed writes against declared touches
(SPEC §11.4). Step state: `site/tutorial/steps/07-verification/`.

## A typed session and a guard chain

`req.session` is a declared schema, not an `any` bag — guard refinements and the order's
`userId` rest on typed fields, so an untyped session would be a hole directly under the proof
surface (SPEC §6.5):

{{snippet:07-verification/src/app.ts#session}}

{{snippet:07-verification/src/db.ts#request-shell}}

The mutation now runs behind `authed` plus a rate limit, writes a third domain (`order`), and
keeps everything else from chapter 5 — schema, errors, CSRF, declared touches:

{{snippet:07-verification/src/app.ts#add-to-cart}}

An order history island consumes the new domain — and note what did _not_ need to change for it
to participate: nothing. It declares `queries: { orderHistory }`, and every cart mutation ever
written updates it, because optimism and invalidation are keyed to queries, not call sites
(SPEC §10.4, Constitution #2):

{{snippet:07-verification/src/components/order-history.tsx#order-history}}

## The app graph

Everything the app has declared — components and their queries, the mutation's guards and
writes, optimistic statuses, the page's query set, the touch graph — composes into one value
(SPEC §11.4). `examples/commerce` commits this as a generated artifact so graph changes appear
as diffs in code review; the tutorial declares it inline:

{{snippet:07-verification/src/app.ts#graph}}

`fw check` is the CI gate over that graph — touch-graph consistency and optimistic
exhaustiveness in one stable, diffable output (SPEC §10.6, §11.4):

{{snippet:07-verification/src/app.test.ts#fw-check-test}}

## fw explain: the graph, queryable

`fw explain` prints the compiler's and data plane's decisions as stable text — agents consume
the same artifact humans read (SPEC §5.3). The step pins the cart/add explanation, including
the optimistic status of every invalidated query:

{{snippet:07-verification/src/app.test.ts#fw-explain-test}}

And because the output is stable, **intent-level questions become set operations over printed
graphs** — here, the SPEC §16.3 acceptance question "what updates when cart/add commits?",
answered mechanically:

{{snippet:07-verification/src/app.test.ts#intent-test}}

The unguarded audit rides the same surface: `fw explain --unguarded` lists every mutation,
route, and query reachable without `authed` — this app's answer is zero (SPEC §10.3).

## Harness tests with write verification

`@jiso/test` executes mutations as functions, with belt-and-suspenders verification switched on:
every observed write must fall inside the declared touch set, or the test fails — the
`observed ⊆ static` invariant from SPEC §11.2. If the handler someday writes a table the
touches don't declare, this test goes red before any user sees a stale page:

{{snippet:07-verification/src/app.test.ts#harness-test}}

Note the shape of the pitch, honestly stated: application wiring is proof-carrying, so the app
needs few or no browser tests of its own — the framework keeps morph survival and L0 behaviors
under its _own_ browser suites; what it removes is the testing SPAs need to compensate for
unverifiable wiring (SPEC §11.4).

## Parity with the reference app

Finally, the tutorial keeps itself honest. `examples/commerce` is the SPEC §16 acceptance
target, and this step asserts behavior parity with its committed graph artifact: same mutation
key and named POST, same input fields and write set, same optimistic statuses per pair, same
fragment wire and failure code. If the reference app changes shape, this tutorial fails in the
same PR:

{{snippet:07-verification/src/app.test.ts#parity-test}}

The [testing guide](/guides/testing/) covers pglite-backed harnesses and HTTP-level assertions;
the [fw explain guide](/guides/fw-explain/) tours the full command surface.

One short chapter remains: shipping it.
