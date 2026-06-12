---
title: '5. Invalidation & optimistic updates'
description: Declare what the write touches; derive what re-runs; predict what you can prove — and property-test the prediction.
order: 5
---

# Invalidation & optimistic updates

Chapter 4's mutation committed writes, but the response carried no fresh query data — you
never said what `cart/add` _touches_. This chapter closes the loop: declare the touch
set, derive which queries re-run, and make the cart badge tick instantly with an
exhaustiveness-checked, property-tested optimistic transform. Step state:
`site/tutorial/steps/05-optimistic/`.

## Declare the touches, derive the invalidation

There is no `invalidate()` call in the happy path (SPEC §10.3). A write's touch set — which
domains it writes, keyed how — meets each query's read set from chapter 3, and the intersection
is the invalidation graph. With `@jiso/drizzle`, touch sites are extracted from the write ASTs
and committed as a reviewable graph (SPEC §11.1); the tutorial's plain store has no ASTs, so
you declare the touches — the floor every adapter shares (SPEC §14):

{{snippet:05-optimistic/src/app.ts#touches}}

The mutation registers its touches and the queries it may affect. The loaders now read the
per-request database, so post-commit reruns render what the transaction just committed — the
lifecycle orders `COMMIT` before query re-runs precisely so responses can never show pre-commit
data:

{{snippet:05-optimistic/src/queries.ts#queries}}

Now the enhanced response carries server truth for every invalidated query alongside the
fragments — plus `FW-Changes`, the sanitized write summary (domains and keys, never input
values) (SPEC §9.1):

{{snippet:05-optimistic/src/app.test.ts#rerun-test}}

The loader's side is mechanical: each `<fw-query>` replaces the shared value and runs that
query's update plan — the bindings and stamps chapter 3 derived — across every dependent
island (SPEC §4.8).

## Optimism is keyed to queries, never islands

A one-round-trip wait is fine for the product list, but the cart badge should tick instantly.
You declare optimism per **(mutation × invalidated query)** — never per island — so every
island consuming the query updates from one transform, including islands written months from
now (SPEC §10.4):

{{snippet:05-optimistic/src/app.ts#optimistic}}

Two deliberate choices are visible here:

- **`cart` is hand-written** because the prediction is closed over the input: count goes up by
  `quantity`. (v2 derives transforms like this from the write's dataflow — SPEC §10.5 — and the
  hand-written form shares that IR, so adoption is incremental.)
- **`products` is `'await-fragment'`** — a recorded decision, not an omission. The stock math
  lives in the handler; predicting it client-side would mean duplicating server logic. You
  accept the round-trip latency, in writing.

The exhaustiveness is the point (SPEC §10.6). The step declares its invalidation sets in the
registry interfaces — generated files in a real app (SPEC §6.1), inline here so you can see the
mechanism:

{{snippet:05-optimistic/src/registries.ts#registries}}

Because of that declaration, `OptimisticFor<typeof addToCartForm>` _requires_ an entry per
invalidated query. Delete the `products` line and `tsc` goes red — a forgotten optimistic
update is a compile error (FW310 at the editor, `fw check` in CI), never a silently stale
badge.

{{snippet:05-optimistic/src/app.test.ts#transform-test}}

## Property-test the prediction

A wrong prediction is worse than none: the runtime reconciles server truth over it — a right
guess is a near-no-op morph, a wrong guess a visible correction. So the step proves the
transform commutes with the real handler over generated states: predicting then observing
equals applying then shaping (SPEC §11.4):

{{snippet:05-optimistic/src/app.test.ts#property-helpers}}

{{snippet:05-optimistic/src/app.test.ts#property-test}}

Eighteen generated cases, zero browsers. The [optimistic updates guide](/guides/optimistic/)
covers queues, rebase-on-arrival, and multi-tab behavior.

The loop is closed: declared touches, derived invalidation, a proven instant badge. Next,
first render learns the same trick — streaming expensive fragments without blocking the shell.
