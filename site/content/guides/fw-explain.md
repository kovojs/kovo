---
title: Reading fw check & fw explain
description: Query the graph your build emits, turn product rules into CI assertions, and debug mutations straight from the Network panel.
order: 7
---

# Reading fw check & fw explain

When you want to know what updates when a button is clicked, you ask `fw explain` instead of reading
through app code. When you want CI to hold a rule — "every component showing cart data refreshes when
the cart changes" — you assert it with `fw check`. Both read the same derived facts your build emits,
and both print stable, diffable text that agents and humans consume the same way. This guide is the
working vocabulary: what each command says, how to assert it in CI, and how the same facts show up in
the Network panel.

## The graph workflow

Everything runs off one generated artifact, `graph.json` — components, queries, mutations, pages,
optimistic coverage, and the touch graph (the derived map of which writes refresh which queries). The
starter wires the loop:

```sh
vp run emit-graph                                 # regenerate graph.json from app facts
fw check graph.json                               # semantic gates (FW310, FW311, audits)
fw explain query cart graph.json                  # read one node of the graph
fw explain mutation cart/add --optimistic graph.json
fw explain page /cart graph.json
fw explain component CartBadge graph.json
fw explain --unguarded graph.json
```

`graph.json` is committed, so graph changes show up as reviewable diffs — adding a write to a
mutation appears as a changed invalidation set in the same PR.

## Read the output

All output below is generated from the commerce reference app's committed graph. Every format starts
with a version line (`fw-explain/v1`), and the formats are snapshot-locked so your scripts and CI
assertions don't rot.

**A query** — what it reads, who consumes it, what refreshes it:

```sh
fw explain query cart graph.json
```

```txt
fw-explain/v1
QUERY cart
reads: cart
consumers: component:CartBadge,page:/cart
invalidated-by: cart/add
domain-writes: cart.addItem
```

**A mutation** — guard chain, input surface, writes, derived invalidations, and the full update
fan-out, with optimistic coverage when asked:

```sh
fw explain mutation cart/add --optimistic graph.json
```

```txt
fw-explain/v1
MUTATION cart/add
guards: authed,rateLimit:session
session: commerceSession
input-fields: productId,quantity
writes: cart,product,order
invalidates: cart,product,order
manual-invalidates: -
updates: cart->component:CartBadge,page:/cart; orderHistory->component:OrderHistory,page:/cart; productGrid->component:ProductGrid,page:/cart
OPTIMISTIC cart hand-written
OPTIMISTIC productGrid await-fragment
OPTIMISTIC orderHistory await-fragment
OPTIMISTIC-SUMMARY total=3 hand-written=1 await-fragment=2 UNHANDLED=0
```

The `updates:` line answers "what updates when this button is clicked," mechanically, without reading
a line of app code. That property is a framework acceptance criterion: an agent given only
`fw explain` output answers the question with 100% accuracy.

**A page** — what a route ships:

```sh
fw explain page /cart graph.json
```

```txt
fw-explain/v1
PAGE /cart
prefetch: false
meta: title=Jiso Commerce (1) description=Browse products and checkout with 1 verifiable cart item. image=-
i18n: en-US:cartLabel,productStock
modulepreloads: -
stylesheets: /assets/tailwind.css
queries: cart,productGrid,orderHistory
view-transitions: -
```

The grammar is consistent: `key: value` lines, `-` for empty, comma-separated sets, `;`-separated
`a->b` edges. You parse it with `grep` and `awk`; that's the intent.

## Run the gates with fw check

`fw check graph.json` runs the semantic checks that don't belong in `vp check`: optimistic
exhaustiveness (FW310), update coverage (FW311), touch-graph consistency, and the audits. Healthy
output is short:

```txt
fw-check/v1
OK
```

Unhealthy output names the edge and exits non-zero. This is the commerce graph with one hand-written
transform deleted:

```txt
fw-check/v1
WARN FW310 cart/add -> cart Invalidated query lacks optimistic transform.
```

Coverage diagnostics are warnings with teeth: suppressible, but the suppression is recorded in
source rather than left silent.

## Turn product rules into CI assertions

When a product rule matters — "every component that shows cart data must refresh when the cart
changes" — you assert it as a set operation over the printed graph. Here is the starter's shell
recipe:

```sh
fw explain query cart graph.json > .jiso/cart.query.txt
awk -F': ' '/^consumers: / { print $2 }' .jiso/cart.query.txt \
  | tr ',' '\n' | grep '^component:' | sort > .jiso/cart.consumers.txt
printf '%s\n' component:CartBadge component:CartPanel | sort > .jiso/expected.txt
diff -u .jiso/expected.txt .jiso/cart.consumers.txt

grep '^invalidated-by: .*cart/add' .jiso/cart.query.txt
fw explain mutation cart/add --optimistic graph.json | grep '^OPTIMISTIC-SUMMARY .*UNHANDLED=0'
```

The starter generates the script version into `scripts/graph-assertions.mjs`:

```ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const fwExplain = (args) =>
  execFileSync('fw', ['explain', ...args, 'graph.json'], { encoding: 'utf8' });

const cartAdd = fwExplain(['mutation', 'cart/add', '--optimistic']);
assert.match(cartAdd, /^updates: cart->component:CartBadge,page:\/cart/m);
assert.match(cartAdd, /^OPTIMISTIC-SUMMARY .*UNHANDLED=0$/m);
```

These run in the starter's CI as `vp run graph-assertions`, next to `vp run fw-check`. A graph
assertion differs in kind from a rendering test: it states intent ("cart consumers are exactly
these") and holds as the app grows — a new component that reads cart data either joins the consumer
set correctly or turns CI red.

## The audits

Three explain modes answer security review's first questions from the same artifact:

```sh
fw explain --unguarded graph.json   # every mutation, route, and query reachable without authed
fw explain --unscoped graph.json    # owner-annotated tables whose key predicate isn't session-traceable (IDOR)
fw explain --endpoints graph.json   # machine ingress: endpoints, webhooks, file/stream routes + auth/CSRF posture
```

```txt
fw-explain/v1
UNGUARDED
SUMMARY total=0
```

The commerce app's audits are clean (`total=0`). A finding adds a line per item above its summary; in
CI you run the audits with fail-on-findings so a guard removed in a refactor can't land quietly.

- `--unguarded` lists everything reachable without an `authed` guard — the first question of any
  security review.
- `--unscoped` is the IDOR audit: queries and writes touching an `owner:`-annotated table whose key
  predicate the analyzer can't trace back to `req.session`. In other words, data that should be scoped
  to its owner but provably might not be.
- `--endpoints` is the machine-ingress table — name, path, auth scheme, CSRF posture, and for webhooks
  the write→domain chain — so "what can reach this app and what can it touch?" is answerable without
  executing anything.

## Debug from the Network panel

The wire and the graph speak the same vocabulary, which gives you a tight debugging loop:

1. **Click the thing.** In the Network panel you see `POST /_m/cart/add` — mutations are named POSTs,
   so you know which mutation fired without source maps.
2. **Read the request.** `FW-Targets: cart-badge=cart; …` is the live DOM's dependency claim. If a
   fragment you expected isn't listed, the island is missing its `fw-deps` stamp; inspect the element.
3. **Read the response.** `FW-Changes` names the committed domains, and the body's `<fw-query>` and
   `<fw-fragment>` chunks are exactly what will patch in. If data is stale, check whether the query's
   `<fw-query>` chunk is present.
4. **Cross-check against intent.** `fw explain mutation cart/add` says what should have happened — the
   `invalidates:` and `updates:` lines. The wire says what did. The diff localizes the bug: missing
   from `invalidates:` is a touch-graph problem (see [queries & invalidation](/guides/queries/));
   present there but absent on the wire is a rendering problem.
5. **For a 422**, the body is the re-rendered form with `data-error-code`, readable as HTML (see
   [the 422 path](/guides/mutations/)).

Debugging proceeds down into plainer artifacts — graph text, HTTP, HTML — instead of up into
framework internals.

## Next

- [Testing with @jiso/test](/guides/testing/) — the runtime half: observed ⊆ static ∪ declared.
- [Optimistic updates](/guides/optimistic/) — the coverage FW310 enforces.

<details>
<summary>Spec & diagnostics</summary>

The `fw explain` / `fw check` artifact formats: SPEC §5.3, §11.4. The committed graph and its diffs:
SPEC §11.1. Optimistic exhaustiveness is **FW310** (SPEC §10.6); update coverage is **FW311**
(SPEC §4.9). The "agent answers from `fw explain` alone" acceptance criterion: SPEC §16. The audits
and guard reachability: SPEC §10.3, §11.4; `owner:` annotations behind `--unscoped`: SPEC §10.1. The
wire vocabulary behind Network-panel debugging: SPEC §9.1. Debugging downward into plainer artifacts:
SPEC §1.

</details>
