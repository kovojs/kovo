---
title: Worked add-to-cart
description: A focused add-to-cart path from query read set through mutation write set and UI refresh.
order: 5
---

# Worked add-to-cart

The add-to-cart path is the smallest complete Kovo dataflow: a product list query, a cart badge query,
a guarded mutation, a domain write, an invalidation edge, and a fragment/query response that updates
the visible UI. The source note is
[`docs/worked-example-add-to-cart.md`](https://github.com/kovojs/kovo/blob/main/docs/worked-example-add-to-cart.md).

## The shape

1. The cart badge component declares the cart query it reads.
2. The product list renders a form that posts a named `cart/add` mutation.
3. The mutation validates input, checks CSRF/idempotency, runs guards, and writes through a domain.
4. The data-layer graph maps the write to touched domains and row keys.
5. Kovo intersects those touched domains with visible query-backed targets.
6. The response sends query JSON, a fragment, or a prod delta, depending on what the update plan can
   cover.

## Why this example matters

Every advanced app repeats this pattern with more domains, guards, and layouts. When something drifts,
the verifier points at the missing read, write, target, or optimistic transform instead of making you
debug the browser after a stale render ships.

See also [Queries & invalidation](/guides/queries/), [Mutations & forms](/guides/mutations/), and
[Optimistic updates](/guides/optimistic/).
