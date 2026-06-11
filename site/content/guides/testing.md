---
title: Testing with @jiso/test
description: The jisoTest harness, pglite-backed verification, observed ⊆ static ∪ declared, and the FW402–FW410 family.
order: 6
---

# Testing with @jiso/test

Most SPA testing exists to compensate for unverifiable wiring — does this button reach that
handler, does that mutation refresh this view. Jiso moves those questions into the type system and
the graph checks, so app tests concentrate on what's left: handler logic, error paths, rendered
HTML, and the honesty of the invalidation graph itself (SPEC §11.4, §12).

## The harness

`@jiso/test` runs mutations as functions and pages as strings — no browser, no HTTP server:

```ts
import { createJisoTestHarness } from '@jiso/test';
import type { TouchGraph } from '@jiso/core';

const harness = createJisoTestHarness({
  db: createCommerceDb(),
  pages: { '/cart': renderCartPage },
  request: { session: { id: 's1', user: { id: 'u1' } } },
  touchGraph: commerceTouchGraph as unknown as TouchGraph,
  verification: {
    domainByTable: { cart_items: 'cart', orders: 'order', products: 'product' },
  },
});

// mutations as functions — full lifecycle, touch-checking automatic on every exec
const result = await harness.exec(addToCart, { productId: 'p1', quantity: 2 });
expect(result).toMatchObject({
  ok: true,
  changes: [
    { domain: 'cart', input: { productId: 'p1', quantity: 2 } },
    { domain: 'order', input: { productId: 'p1', quantity: 2 } },
    { domain: 'product', input: { productId: 'p1', quantity: 2 }, keys: ['p1'] },
  ],
  rerunQueries: ['cart', 'productGrid', 'orderHistory'],
});

// wire-level: render a page, assert HTML, no browser
const page = await harness.page('/cart');
expect(page.fragment('cart-badge')).toContain('data-bind="cart.count"');
```

This is the commerce reference app's own test shape. Note what `exec` returns beyond the
handler's value: the **change records** (`{domain, keys, input}`, SPEC §14's unified record) and
the **rerun query list** — the invalidation behavior is part of every mutation assertion, not a
separate integration suite. The `jisoTest` wrapper packages the same thing as named cases:

```ts
import { jisoTest } from '@jiso/test';
import { it } from 'vitest';

const cartMutations = jisoTest(
  'cart mutations',
  async ({ exec, page }) => {
    const res = await exec(addToCart, { productId: 'p1', quantity: 2 });
    expect(res.ok).toBe(true);
  },
  harnessOptions,
);
it(cartMutations.name, cartMutations.run);
```

## Typed error paths

Declared error codes are part of the mutation's type, and `assertMutationError` checks code and
payload while narrowing the payload type:

```ts
import { assertMutationError } from '@jiso/test';

const fail = await harness.exec(addToCart, { productId: 'p1', quantity: 99 });
const payload = assertMutationError(addToCart, fail, {
  code: 'OUT_OF_STOCK',
  payload: { availableQuantity: 5 },
});
// payload: { availableQuantity: number } — inferred from the declared error schema (SPEC §6.3)
```

## pglite: real Postgres semantics, in-memory

HTTP-level and data-layer tests run against pglite — actual Postgres, in-process, no container
(SPEC §11.4):

```ts
import { createPgliteTestDb } from '@jiso/test';

const db = await createPgliteTestDb();
await db.exec(`create table cart_items (product_id text, qty int, unit_price int)`);
await db.write('cart_items', { product_id: 'p1', qty: 2, unit_price: 1499 });

const rows = await db.read('cart_items');
const totals = await db.sql(`select sum(qty * unit_price) as total from cart_items`);

await db.close();
```

Because it's real Postgres, the SQL your domain writes execute in tests is the SQL that runs in
production — `onConflictDoUpdate`, CTEs, constraint behavior and all.

## The verifier: observed ⊆ static ∪ declared

The static pass _over-approximates_ a write's touch set (it unions all branches); runtime
execution _under-approximates_ (only executed branches). The verifier wraps `db`, parses every
executed statement with a SQL AST parser, and enforces the invariant that makes the whole
invalidation story honest (SPEC §11.2):

> **observed ⊆ static ∪ FW406-declared.** A violation means an analyzer bug or smuggled SQL;
> either is a CI failure.

You enable it by giving the harness the committed touch graph and the table→domain mapping (the
`touchGraph` and `verification` options above). Every `exec` is then touch-checked: a write to a
table whose domain the static graph doesn't list for that mutation fails the test. After a run:

```ts
expect(harness.verificationDiagnostics()).toEqual([]);
```

Read-side gets identical treatment: the tables a query's SQL actually selects from are checked
against its declared read set, and observed result shapes are checked against declared output
schemas — the runtime half of FW410 (SPEC §11.2).

## The FW402–FW410 family

These are the diagnostics the verification layer produces (SPEC §11.3). The pattern: **4xx codes
police the boundary between declared dataflow and actual dataflow**, from both sides.

| Code  | Severity   | What it catches                                                                                |
| ----- | ---------- | ---------------------------------------------------------------------------------------------- |
| FW402 | error      | Write touched an undeclared domain — the silent-stale-UI bug                                   |
| FW403 | warn       | Declared domain never observed written — stale claim or untested branch                        |
| FW404 | error      | Write to an unmapped table — map it or mark `exempt` (write-side only, SPEC §10.1)             |
| FW405 | warn       | Conditional writes on branches never executed under instrumentation                            |
| FW406 | warn/error | Statically un-analyzable write site — manual `touches` required, runtime-verified              |
| FW407 | error      | Query read from an undeclared domain — missed invalidations                                    |
| FW408 | error      | Declared row key ≠ observed row predicate                                                      |
| FW409 | notice     | Non-eq predicate — degraded to table-level invalidation                                        |
| FW410 | error      | Opaque projection (`sql<T>`, raw SQL) without a declared output schema, shape runtime-verified |

Adjacent and worth knowing: FW411 (a query reads an `exempt` table — caught statically _and_ by
the verifier when raw SQL smuggles the read, SPEC §10.1, §11.2).

The asymmetric severities are deliberate. Excess declaration (FW403, FW409) degrades to warnings
and over-invalidation — wasteful but correct. Missing declaration (FW402, FW404, FW407) means a
query somewhere renders stale data with no error anywhere — the bug class this whole layer exists
to kill, so those are errors.

## Property-testing optimistic transforms

For every hand-written transform, assert prediction ⊆ eventual truth over generated states — the
commuting diagram as a test (SPEC §12, §10.5):

```ts
import { propertyTest } from '@jiso/test';

expect(
  propertyTest({
    apply: (state, input) => applyAddToCartEffect(state, input), // server effect on real state
    shape: (state) => shapeCartQuery(state), // state → what the query ships
    predict: (state, input) => addToCartOptimistic.transforms.cart(shapeCartQuery(state), input),
    cases: generatedCartStates(), // seeded {state, input} cases
  }),
).toEqual({ cases: 18 });
```

If `predict(shape(s), i)` ever disagrees with `shape(apply(s, i))`, the case is reported with its
inputs. See the [optimistic guide](/guides/optimistic/) for the transforms themselves.

## What about browser tests?

The framework's own suite owns the irreducibly browser-bound parts — morph's survival contract
(focus, caret, scroll), L0 platform behaviors. Application wiring is proof-carrying: handler refs,
form fields, binding paths, fragment targets, and coverage are checked by `vp check` and
`fw check`, so apps need few or no browser tests of their own (SPEC §11.4). The reference
commerce app's acceptance criterion is exactly that: full behavior surface, zero app-level
browser tests (SPEC §16).

A practical app suite is therefore:

1. **Handler logic** — mutations as functions via `exec`, including `fail()` paths.
2. **Rendered HTML** — `page()`/`fragment()` string assertions on the contracts that matter
   (`data-bind` paths present, forms posting to the right action).
3. **Graph honesty** — the verifier enabled on every `exec`, diagnostics asserted empty.
4. **Transform soundness** — `propertyTest` per hand-written transform.
5. **Graph assertions** — product rules over `fw explain` output, in CI
   ([the fw explain guide](/guides/fw-explain/) shows the recipes).

## Next

- [Reading fw check & fw explain](/guides/fw-explain/) — the static half of verification.
- [Mutations & forms](/guides/mutations/) — the lifecycle `exec` runs.
