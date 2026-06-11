# Graph Assertion Recipes

Jiso keeps application wiring auditable through the generated graph file consumed by the CLI:

```sh
vp run emit-graph
vp run fw-check
vp run graph-assertions
fw explain component CartBadge graph.json
fw explain mutation cart/add --optimistic graph.json
fw explain --unguarded graph.json
fw explain query cart graph.json
fw explain page /cart graph.json
```

Use `fw check graph.json` in CI for semantic checks that do not belong in `vp check`: optimistic coverage (`FW310`), update coverage (`FW311`), touch-graph consistency, unguarded mutation audits, manual invalidation review, and Jiso-specific lints.
Use `fw explain --unguarded graph.json` when you need the stable, diffable audit list from SPEC.md section 10.3.
When debugging enhanced mutations, keep the wire contract from SPEC.md section 9.1 visible: `FW-Idem` keys make duplicate POSTs replayable, and `FW-Targets` shows which live DOM dependencies asked for fragments.

## Intent Assertions

SPEC.md section 11.4.3 treats behavior checks as graph queries over stable `fw explain` output. Keep these assertions in CI beside ordinary tests when a product rule matters more than one rendered page snapshot.
This starter wires the minimal cart assertions into `vp run graph-assertions` and GitHub Actions; extend `scripts/graph-assertions.mjs` as product rules become important.

This starter's `scripts/emit-graph.mjs` is the tiny runnable graph-emission path. Keep app facts flowing through `deriveAppGraph`; as your app grows, replace the inline declarations with compiler-emitted component/query/route facts before writing `graph.json`.

Assert that every component displaying cart data is registered as a cart consumer:

```sh
mkdir -p .jiso
fw explain query cart graph.json > .jiso/cart.query.txt
awk -F': ' '/^consumers: / { print $2 }' .jiso/cart.query.txt | tr ',' '\n' | grep '^component:' | sort > .jiso/cart.consumers.txt
printf '%s\n' component:CartBadge component:CartPanel | sort > .jiso/cart.expected-consumers.txt
diff -u .jiso/cart.expected-consumers.txt .jiso/cart.consumers.txt
```

Assert that `cart/add` refreshes those consumers by invalidating the cart query:

```sh
grep '^invalidated-by: .*cart/add' .jiso/cart.query.txt
grep '^domain-writes: .*cart.addItem' .jiso/cart.query.txt
fw explain mutation cart/add --optimistic graph.json | grep '^OPTIMISTIC cart await-fragment'
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

`UNHANDLED` optimistic entries are useful while developing, but `fw check` fails on `FW310` warnings so they stay visible in CI.
