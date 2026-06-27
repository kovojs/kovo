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

A transform is a pure `(draft, input) => void` function over a query's result type. Put the
optimistic map on the mutation, next to the write it predicts:

```ts
export const addToCart = mutation({
  input: addToCartInput,
  queue: true,
  optimistic: {
    cart(draft, input) {
      draft.count = (draft.count ?? 0) + input.quantity;
    },
    orderHistory: 'await-fragment',
    productGrid: 'await-fragment',
  },
  handler: addToCartHandler,
});
```

Three things to notice:

- **The keys are query names**, and the required set is the mutation's derived invalidation set. The
  compiler emits each mutation's invalidated-query keys into the registries, so the inline
  `optimistic` object is typed from that source-derived mutation identity and the query result
  registry.
  Add a write that touches a new domain and `kovo check optimistic` reports the uncovered query.
- **`'await-fragment'` is a real answer.** It says "considered; the 1-RTT latency is fine here" — the
  product grid re-renders from the server fragment instead of being predicted. A deliberate deferral
  and a forgotten transform are different states, and only the second one is a diagnostic.
- **`queue: true`** gives this mutation its own FIFO queue. Submissions sharing a queue run strictly
  in submit order — each waits for the previous to settle before its transform and request fire — so
  two quick "add" clicks can't land out of order or race to a wrong predicted count. Use
  `queue('checkout')` when several mutations intentionally share one conceptual queue.

Transforms receive a cloned draft of the query's inferred result, so mutate the draft and return
nothing. A column rename breaks the transform in the editor instead of in production.

The standalone `OptimisticFor<typeof form>` shape still exists as an escape hatch for rare cases
where a transform must live outside the mutation module. The default path is inline on
`mutation()`.

## Catch a missing transform

Coverage is the invalidated-query set checked against the declared status, per mutation. The valid
v1 statuses are `hand-written`, `derived`, and `await-fragment`; anything else is a diagnostic. The
check runs from the same derived set in `kovo check` and in editor-visible registry typing.

Here is the failure, from running `kovo check` against the commerce graph with the `cart` transform
uncovered:

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
OPTIMISTIC-SUMMARY total=3 derived=0 hand-written=0 await-fragment=2 UNHANDLED=1 PUNTED=0
```

With the transform in place, the same command reports clean coverage:
`OPTIMISTIC-SUMMARY ... UNHANDLED=0`, with one `OPTIMISTIC` line per invalidated query. The full
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

If server truth never arrives for an applied transform, the client discards the prediction. The
affected query rolls back to its pre-transform snapshot or refetches from `/_q/<key>`; it does not
keep the optimistic value on screen as settled data. Fragment-only responses are allowed when you
declared `'await-fragment'`, but silent inconsistency is not.

## Rebase concurrent mutations

Each query keeps a pending-transform log. When server truth arrives while other mutations are still
in flight, the runtime morphs the authoritative value in, then re-applies the still-pending
transforms in order. This rebase is safe because transforms are pure draft mutations:

```ts
// Conceptually, the loader keeps a per-query pending-transform log.
pending.add('m1', { productId: 'p1', quantity: 2 }, addToCartOptimistic); // predict
pending.applyServerTruth('cart', { count: 7 }); // morph truth in, re-apply pending
pending.settle('m1'); // m1's response landed
```

Navigation reconciles for free: in-flight mutations complete via `keepalive`, and the pending log
dies with the document, so stale optimism can't outlive its mutation.

## Test the prediction

A transform is a pure draft mutation, so you can unit-test it by cloning before apply:

```ts
const draft = structuredClone({ count: 1 });
addToCart.optimistic.cart(draft, { productId: 'p1', quantity: 2 });
expect(draft).toEqual({ count: 3 });
```

Beyond a point check, you can property-test that the prediction is _contained in eventual truth_ over
generated states — the commuting diagram `patch(shape(s), input) ≡ shape(apply(effect, s, input))`.
That's `propertyTest`, and it lives in the
[testing guide](/guides/testing/#property-test-optimistic-transforms) along with the harness it runs in.

## Derived, mixed, and punted coverage

Kovo supports a spectrum rather than a single optimistic style:

- **Derived** transforms are compiler-emitted from writes whose dataflow is closed over mutation
  input, schema constants, and data the query already ships. The StackOverflow example uses this
  shape for votes and answers.
- **Hand-written** transforms are still the right answer when the product rule is the important part
  of the UI. The CRM example uses this for dashboard summaries whose visible update is clearer as
  domain code.
- **`'await-fragment'`** is an explicit punt to server truth. Use it when totals, rankings,
  inventory, or authorization-sensitive output should not be guessed.

`kovo explain mutation <name> --optimistic` prints one row per invalidated query with the status
`derived`, `hand-written`, or `await-fragment`. When derivation cannot prove a transform, the output
names the expression and the reason for the punt so the choice can be reviewed in code.

### Derivation grammar

The compiler derives transforms by pushing symbolic write effects through query shapes:

```text
Stage 1  write  ->  symbolic row-effects
         value ::= Param(path) | Const | ColRef(t.c) | Arith(op,v,v) | Opaque
         effect ::= INSERT{vals} | UPDATE{match, sets} | DELETE{match} | UPSERT{...}
         (match = eq-predicates on keys; ranges/server-time => Opaque match => punt)

Stage 2  query  ->  shape mapping
         field ::= Scalar(keyed row col) | COUNT(R[, pred]) | SUM(R, arith)
                 | AGG(R, projection)    where R = rowset(filter chain, key, orderBy)

Stage 3  push effect through shape  ->  JSON-patch program over client data
         INSERT x AGG   => push (defaults from schema; Opaque cols => tempId()/now()
                          placeholders, pending-styled, content-matched on reconcile;
                          orderBy decides insertion point; Opaque orderBy col => punt)
         UPSERT x AGG   => find-then-update-else-push (branchiness reproduced client-side)
         DELETE x COUNT => -(matched count, computable iff client holds rows)
         DELETE x SUM   => -SUM(contribution) iff query also ships the rows; else punt
         SET on filtered col => membership transition: Const vs filter => exit derivable,
                                entry punts because the client lacks the row's other columns
         row possibly outside client's rowset => emit guard (find-or-no-op), not punt
```

Punts are all-or-nothing per field. Wrong predictions are worse than none, so these cases stay
explicit: opaque `SET` expressions such as SQL functions, subqueries, or server computation;
non-key match predicates; window functions; `GROUP BY` plus `HAVING`; `DISTINCT`;
interprocedural opacity such as external packages receiving `db`; and params untraceable to
mutation input or a session key.

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
Derived transforms and explicit punts: SPEC §10.5. The coverage check at both altitudes: SPEC §10.6;
the emitted invalidation sets it reads: SPEC §6.1. A missing optimistic transform is **KV310**;
anything other than `hand-written`/`await-fragment` is the same code. Every query-dependent DOM
position needing a declared update status is **KV311** (SPEC §4.9). Fragment-status positions:
SPEC §4.9. Missing server truth for an applied transform is **KV313**; SPEC §10.4 requires the
runtime to discard or refetch the prediction rather than freeze it. Navigation and `keepalive`:
SPEC §8. Property-testing transforms: SPEC §12.

</details>
