---
title: '7. Testing & verification'
description: Guards, the app graph, kovo check and kovo explain, harness tests with write verification — and parity with the reference app.
order: 7
---

# Testing & verification

In this chapter the app gains its production posture — a typed session, a guard chain, an order
history — and then proves its entire behavior surface without running a browser: `kovo check` over
the app graph, `kovo explain` as a queryable dependency graph, and harness tests that verify
observed writes against declared touches. Step state:
`site/tutorial/steps/07-verification/`.

## Add a typed session and a guard chain

`req.session` is a declared schema, not an `any` bag. Guard refinements and the order's `userId`
rest on typed fields; an untyped session would be a hole directly under the proof surface:

{{snippet:07-verification/src/app.ts#session}}

{{snippet:07-verification/src/db.ts#request-shell}}

The mutation now runs behind `authed` plus a rate limit, writes a third domain (`order`), and
keeps everything else from chapter 5 — schema, errors, CSRF, declared touches:

{{snippet:07-verification/src/app.ts#add-to-cart}}

An order history island consumes the new domain. What had to change for it to participate:
nothing. It declares `queries: { orderHistory }`, and every cart mutation ever written updates
it, because optimism and invalidation are keyed to queries, not call sites:

{{snippet:07-verification/src/components/order-history.tsx#order-history}}

## Check the app graph

Everything the app has declared — components and their queries, the mutation's guards and writes,
optimistic statuses, the page's query set, the touch graph (write sites mapped to touched
domains) — composes into one value. `examples/commerce` commits this as a generated artifact so
graph changes appear as diffs in code review; the tutorial declares it inline:

{{snippet:07-verification/src/app.ts#graph}}

`kovo check` is the CI gate over that graph — touch-graph consistency and optimistic exhaustiveness
in one stable, diffable output:

{{snippet:07-verification/src/app.test.ts#kovo-check-test}}

## Query the graph with kovo explain

`kovo explain` prints the compiler's and data plane's decisions as stable text, so agents consume
the same artifact humans read. The step pins the cart/add explanation, including the optimistic
status of every invalidated query:

{{snippet:07-verification/src/app.test.ts#kovo-explain-test}}

Because the output is stable, intent-level questions become set operations over printed graphs.
Here is the acceptance question — "what updates when cart/add commits?" — answered mechanically:

{{snippet:07-verification/src/app.test.ts#intent-test}}

The unguarded audit rides the same surface: `kovo explain --unguarded` lists every mutation, route,
and query reachable without `authed`. This app's answer is zero.

## Verify writes in harness tests

`@kovojs/test` executes mutations as functions, with write verification on: every observed write
must fall inside the declared touch set, or the test fails. If the handler someday writes a table
the touches don't declare, this test goes red before any user sees a stale page:

{{snippet:07-verification/src/app.test.ts#harness-test}}

Because application wiring is proof-carrying, the app needs few or no browser tests of its own.
The framework keeps morph survival and L0 behaviors under its own browser suites; what it removes
is the testing SPAs need to compensate for unverifiable wiring.

## Assert parity with the reference app

Finally, the tutorial keeps itself honest. `examples/commerce` is the acceptance target, and this
step asserts behavior parity with its committed graph artifact: same mutation key and named POST,
same input fields and write set, same optimistic statuses per pair, same fragment wire and
failure code. If the reference app changes shape, this tutorial fails in the same PR:

{{snippet:07-verification/src/app.test.ts#parity-test}}

The [testing guide](/guides/testing/) covers pglite-backed harnesses and HTTP-level assertions;
the [kovo explain guide](/guides/kovo-explain/) tours the full command surface.

Guarded, session-typed, and provable without a browser. One short chapter remains: shipping it.

<details>
<summary>Spec & diagnostics</summary>

Behavior surface proven without a browser: SPEC §11.4. Typed session schema: SPEC §6.5. Optimism
and invalidation keyed to queries, not call sites: SPEC §10.4. App graph as one composed value:
SPEC §11.4. `kovo check` exhaustiveness and consistency gate: SPEC §10.6. `kovo explain` stable text
for humans and agents: SPEC §5.3. Acceptance intent question: `rules/v1-acceptance.md`. Unguarded audit and
zero unauthed reach: SPEC §10.3. `observed ⊆ static` write-verification invariant: SPEC §11.2.
Reference-app parity: `rules/v1-acceptance.md`.

</details>
