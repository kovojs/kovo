---
title: Optimistic updates
description: Make writes feel instant by declaring one transform per query, with a check that catches the one you forgot.
order: 3
---

# Optimistic updates

When someone clicks "Add to cart," you want the badge to tick up immediately instead of after a
round-trip. You declare one transform for the cart query that predicts the new count, and every
island showing that query updates from it — including islands you write months later. You don't
wire per-component optimistic state, and there's no cache to patch. A check tells you the moment you
forget a transform.

## Declare transforms

A transform is a pure `(current, input)` function over a query's result type. You declare one per
query the mutation invalidates. Here is the commerce app's cart transform:

```ts
import { form } from '@kovojs/core';
import type { OptimisticFor } from '@kovojs/browser';

export const addToCartForm = form<'cart/add', AddToCartInput>('cart/add');

export const addToCartOptimistic = {
  queue: 'cart',
  transforms: {
    cart(current, input) {
      return { count: (current?.count ?? 0) + input.quantity };
    },
    orderHistory: 'await-fragment',
    productGrid: 'await-fragment',
  },
} satisfies OptimisticFor<typeof addToCartForm>;
```

Three things to notice:

- **The keys are query names**, and the required set is the mutation's derived invalidation set. The
  compiler emits each mutation's invalidated-query keys into the registries, so
  `OptimisticFor<typeof addToCartForm>` demands an entry per invalidated query under plain `tsc`.
  Add a write that touches a new domain and this object goes red.
- **`'await-fragment'` is a real answer.** It says "considered; the 1-RTT latency is fine here" — the
  product grid re-renders from the server fragment instead of being predicted. A deliberate deferral
  and a forgotten transform are different states, and only the second one is a diagnostic.
- **`queue: 'cart'`** names a FIFO queue. Submissions sharing a queue name run strictly in
  submit order — each waits for the previous to settle before its transform and request fire — so
  two quick "add" clicks can't land out of order or race to a wrong predicted count. Mutations with
  different queue names (or none) stay concurrent.

Transforms are typed against the query's inferred result, so a column rename breaks the transform in
the editor instead of in production.

## Catch a missing transform

Coverage is the invalidated-query set checked against the declared status, per mutation. The valid
v1 statuses are `hand-written` and `await-fragment`; anything else is a diagnostic. The check runs at
two altitudes off the same derived set: as a type error in the editor, and as `kovo check` in CI.

Here is the failure, from running `kovo check` against the commerce graph with the hand-written `cart`
transform deleted:

```txt
kovo-check/v1
WARN KV310 cart/add -> cart Invalidated query lacks optimistic transform.
```

`kovo check` exits non-zero on that warning, so the gap can't ship silently. The matching
`kovo explain mutation cart/add --optimistic` run shows the same gap inline with its fix menu:

```txt
OPTIMISTIC productGrid await-fragment
OPTIMISTIC orderHistory await-fragment
OPTIMISTIC cart UNHANDLED
  -> hand-write in the mutation module, or declare 'await-fragment'
OPTIMISTIC-SUMMARY total=3 hand-written=0 await-fragment=2 UNHANDLED=1
```

With the transform in place, the same command reports clean coverage —
`OPTIMISTIC-SUMMARY … UNHANDLED=0`, with one `OPTIMISTIC` line per invalidated query. The full
annotated artifact lives in [reading kovo check & kovo explain](/guides/kovo-explain/#read-the-output).

A forgotten optimistic update is a visible, suppressible diagnostic with the suppression recorded in
source. The same check runs one hop further down: every query-dependent DOM position needs a
declared update status too.

## What the runtime does on submit

When the user submits, the loader runs a fixed sequence:

1. **Snapshot** the affected query values with `structuredClone` — safe because query data is
   `JsonValue` by construction.
2. **Apply transforms** to the shared query values and run their update plans. Every dependent island
   updates at once.
3. **Stamp pending state.** Affected islands get `kovo-pending` and `aria-busy="true"` automatically,
   so you style the in-flight state with CSS and wire no per-component spinner:

```html
<cart-badge kovo-deps="cart" kovo-pending aria-busy="true">…</cart-badge>
```

4. **On success**, the response's `<kovo-query>` values and fragments reconcile over the prediction. A
   right guess is a near-no-op morph; a wrong guess is corrected silently. Server truth always wins,
   because predictions are throwaway sketches.
5. **On error**, the snapshots are restored and the typed error fragment renders. See the
   [mutations guide](/guides/mutations/) for the 422 path.

If server truth never arrives for an applied transform, the client raises a visible runtime
diagnostic, then settles that transform without promoting the prediction to authoritative data.
Fragment-only responses are allowed; silent inconsistency is not.

## Rebase concurrent mutations

Each query keeps a pending-transform log. When server truth arrives while other mutations are still
in flight, the runtime morphs the authoritative value in, then re-applies the still-pending
transforms in order. This rebase is safe because transforms are pure `(data, input)` functions:

```ts
// Conceptually, the loader keeps a per-query pending-transform log.
pending.add('m1', { productId: 'p1', quantity: 2 }, addToCartOptimistic); // predict
pending.applyServerTruth('cart', { count: 7 }); // morph truth in, re-apply pending
pending.settle('m1'); // m1's response landed
```

Navigation reconciles for free: in-flight mutations complete via `keepalive`, and the pending log
dies with the document, so stale optimism can't outlive its mutation.

## Test the prediction

A transform is a pure function, so you can unit-test it directly:

```ts
expect(addToCartOptimistic.transforms.cart({ count: 1 }, { productId: 'p1', quantity: 2 })).toEqual(
  { count: 3 },
);
```

Beyond a point check, you can property-test that the prediction is _contained in eventual truth_ over
generated states — the commuting diagram `patch(shape(s), input) ≡ shape(apply(effect, s, input))`.
That's `propertyTest`, and it lives in the
[testing guide](/guides/testing/#property-test-optimistic-transforms) along with the harness it runs in.

## Hand-written now, derived later

In v1 you hand-write transforms against the same transform IR that v2's compiler derivation will
emit. For writes whose dataflow is closed over the mutation input, schema constants, and data the
query already ships, v2 generates the transform. Because the IR is shared, you can adopt derivation
pair by pair: delete a hand-written transform and derivation takes over. Cases it can't derive punt
loudly, with the exact expression and reason named in `kovo explain --optimistic`.

## When not to predict

Reach for `'await-fragment'` more often than SPA habits suggest:

- The server computes something the client can't — totals with tax rules, ranking, inventory races.
  A wrong prediction is worse than a 1-RTT wait.
- The query feeds a `fragment`-status region. Fragment positions get no optimistic update by
  definition; the server re-render is the update.
- The data is rarely on screen during the mutation.

Declare the deferral and move on. The check is satisfied either way.

## Next

- [Mutations & forms](/guides/mutations/) — the round-trip these transforms predict.
- [Reading kovo check & kovo explain](/guides/kovo-explain/) — the coverage checks in CI.

<details>
<summary>Spec & diagnostics</summary>

Optimism keyed to queries, the runtime protocol, rebase, and navigation reconciliation: SPEC §10.4.
The punt philosophy and v2 derivation: SPEC §10.5. The coverage check at both altitudes: SPEC §10.6;
the emitted invalidation sets it reads: SPEC §6.1. A missing optimistic transform is **KV310**;
anything other than `hand-written`/`await-fragment` is the same code. Every query-dependent DOM
position needing a declared update status is **KV311** (SPEC §4.9). Fragment-status positions:
SPEC §4.9. Navigation and `keepalive`: SPEC §8. Property-testing transforms: SPEC §12.

</details>
