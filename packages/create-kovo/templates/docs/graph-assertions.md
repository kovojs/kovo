# Graph Assertion Recipes

Kovo keeps application wiring auditable through the generated graph file consumed by the CLI:

```sh
vp run emit-graph
vp run kovo-check
vp run graph-assertions
kovo explain component CartBadge graph.json
kovo explain mutation cart/add --optimistic graph.json
kovo explain --unguarded graph.json
kovo explain query cart graph.json
kovo explain page /cart graph.json
```

Use `kovo check graph.json` in CI for semantic checks that do not belong in `vp check`: optimistic coverage (`KV310`), update coverage (`KV311`), touch-graph consistency, unguarded mutation audits, manual invalidation review, and Kovo-specific lints.
Use `kovo explain --unguarded graph.json` when you need the stable, diffable audit list from SPEC.md section 10.3.
When debugging enhanced mutations, keep the wire contract from SPEC.md section 9.1 visible: `Kovo-Idem` keys make duplicate POSTs replayable, and `Kovo-Targets` shows which live DOM dependencies asked for fragments.

## Intent Assertions

SPEC.md section 11.4.3 treats behavior checks as graph queries over stable `kovo explain` output. Keep these assertions in CI beside ordinary tests when a product rule matters more than one rendered page snapshot.
This starter wires the minimal cart assertions into `vp run graph-assertions` and GitHub Actions; extend `scripts/graph-assertions.mjs` as product rules become important.

This starter's `scripts/emit-graph.mjs` is the tiny runnable graph-emission path. Keep app facts explicit in that local script or replace it with your own app-owned generator before writing `graph.json`; the starter's CI contract is `kovo check` plus focused graph assertions, not direct compiler API ownership.

Assert that every component displaying cart data is registered as a cart consumer:

```sh
mkdir -p .kovo
kovo explain query cart graph.json > .kovo/cart.query.txt
awk -F': ' '/^consumers: / { print $2 }' .kovo/cart.query.txt | tr ',' '\n' | grep '^component:' | sort > .kovo/cart.consumers.txt
printf '%s\n' component:CartBadge component:CartPanel | sort > .kovo/cart.expected-consumers.txt
diff -u .kovo/cart.expected-consumers.txt .kovo/cart.consumers.txt
```

Assert that `cart/add` refreshes those consumers by invalidating the cart query:

```sh
grep '^invalidated-by: .*cart/add' .kovo/cart.query.txt
grep '^domain-writes: .*cart.addItem' .kovo/cart.query.txt
kovo explain mutation cart/add --optimistic graph.json | grep '^OPTIMISTIC cart await-fragment'
```

Keep every mutation/query pair explicit in `graph.json`:

```json
{
  "optimistic": [
    { "mutation": "cart/add", "query": "cart", "status": "hand-written" },
    { "mutation": "cart/add", "query": "recommendations", "status": "await-fragment" }
  ],
  "touchGraph": {
    "cart.addItem": {
      "touches": [
        { "domain": "cart", "keys": null, "site": "src/cart.ts:12", "via": "cart_items" }
      ],
      "unresolved": []
    }
  }
}
```

`UNHANDLED` optimistic entries are useful while developing, but `kovo check` fails on `KV310` warnings so they stay visible in CI.
