---
title: Testing with @jiso/test
description: Test handler logic, rendered HTML, and the honesty of your invalidation graph — without starting a browser.
order: 6
---

# Testing with @jiso/test

Most SPA test suites exist to compensate for wiring you can't otherwise trust — does this button
reach that handler, does that mutation refresh this view. Jiso moves those questions into the type
system and the graph checks, so your tests concentrate on what's left: handler logic, error paths,
rendered HTML, and whether the invalidation graph is honest. `@jiso/test` runs all of that without a
browser.

## Run mutations as functions

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

This is the commerce reference app's own test shape. Notice what `exec` returns beyond the handler's
value: the **change records** (`{domain, keys, input}`) and the **rerun query list**. Invalidation
behavior is part of every mutation assertion, so you don't need a separate integration suite for it.
The `jisoTest` wrapper packages the same thing as named cases:

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

## Assert typed error paths

Declared error codes are part of the mutation's type, and `assertMutationError` checks the code and
payload while narrowing the payload type:

```ts
import { assertMutationError } from '@jiso/test';

const fail = await harness.exec(addToCart, { productId: 'p1', quantity: 99 });
const payload = assertMutationError(addToCart, fail, {
  code: 'OUT_OF_STOCK',
  payload: { availableQuantity: 5 },
});
// payload: { availableQuantity: number } — inferred from the declared error schema
```

## Test against real Postgres with pglite

HTTP-level and data-layer tests run against pglite — actual Postgres, in-process, no container:

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

## Verify the invalidation graph: observed ⊆ static ∪ declared

The invalidation graph is derived from static analysis, which raises the obvious question: what if
the analysis is wrong? The verifier answers it at test time. The static pass over-approximates a
write's touch set (it unions every branch); runtime execution under-approximates it (only the
branches that ran). The verifier wraps `db`, parses every executed statement with a SQL AST parser,
and enforces the invariant that makes the invalidation story honest:

> **observed ⊆ static ∪ FW406-declared.** A violation means an analyzer bug or smuggled SQL; either
> is a CI failure.

You turn it on by giving the harness the committed touch graph and the table→domain mapping (the
`touchGraph` and `verification` options above). Every `exec` is then touch-checked: a write to a
table whose domain the static graph doesn't list for that mutation fails the test. After a run:

```ts
expect(harness.verificationDiagnostics()).toEqual([]);
```

The read side gets the same treatment: the tables a query's SQL actually selects from are checked
against its declared read set, and observed result shapes are checked against declared output
schemas.

## The FW402–FW410 family

These are the diagnostic codes the verification layer produces. The pattern is that 4xx codes police
the boundary between declared dataflow and actual dataflow, from both sides:

| Code  | Severity   | What it catches                                                                                |
| ----- | ---------- | ---------------------------------------------------------------------------------------------- |
| FW402 | error      | Write touched an undeclared domain — the silent-stale-UI bug                                   |
| FW403 | warn       | Declared domain never observed written — stale claim or untested branch                        |
| FW404 | error      | Write to an unmapped table — map it or mark `exempt` (write-side only)                         |
| FW405 | warn       | Conditional writes on branches never executed under instrumentation                            |
| FW406 | warn/error | Statically un-analyzable write site — manual `touches` required, runtime-verified              |
| FW407 | error      | Query read from an undeclared domain — missed invalidations                                    |
| FW408 | error      | Declared row key ≠ observed row predicate                                                      |
| FW409 | notice     | Non-eq predicate — degraded to table-level invalidation                                        |
| FW410 | error      | Opaque projection (`sql<T>`, raw SQL) without a declared output schema, shape runtime-verified |

Worth knowing alongside these: FW411 fires when a query reads an `exempt` table — caught statically,
and by the verifier when raw SQL smuggles the read.

The severities are deliberately asymmetric. Excess declaration (FW403, FW409) degrades to a warning
and to over-invalidation — wasteful but correct. Missing declaration (FW402, FW404, FW407) means a
query somewhere renders stale data with no error anywhere, which is the bug class this whole layer
exists to kill, so those are errors.

## Property-test optimistic transforms

For every hand-written transform, assert that the prediction is contained in eventual truth over
generated states — the commuting diagram as a test:

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
form fields, binding paths, fragment targets, and coverage are all checked by `vp check` and
`fw check`, so apps need few or no browser tests of their own. The reference commerce app meets
exactly that bar: its full behavior surface is tested with zero app-level browser tests.

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

<details>
<summary>Spec & diagnostics</summary>

The browser-free verification posture: SPEC §11.4, §16. The test harness and unit/property testing:
SPEC §12. The unified change record (`{domain, keys, input}`): SPEC §14. Typed error schemas:
SPEC §6.3. The `observed ⊆ static ∪ declared` invariant and read-side shape verification: SPEC §11.2.
The FW402–FW410 verification family: SPEC §11.3; manual touches at an opaque write are **FW406**; a
query reading an `exempt` table is **FW411** (SPEC §10.1); `exempt` tables and the read/write rules:
SPEC §10.1.

</details>
