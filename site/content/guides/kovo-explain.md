---
title: Reading kovo check & kovo explain
description: Query the graph your build emits, turn product rules into CI assertions, and debug mutations straight from the Network panel.
order: 7
---

# Reading kovo check & kovo explain

When you want to know what updates when a button is clicked, you ask `kovo explain` instead of reading
through app code. When you want CI to hold a rule — "every component showing cart data refreshes when
the cart changes" — you assert it with `kovo check`. Both read the same derived facts your build emits,
and both print stable, diffable text that agents and humans consume the same way. This guide is the
working vocabulary: what each command says, how to assert it in CI, and how the same facts show up in
the Network panel.

## The graph workflow

Everything runs off the app graph — components, queries, mutations, pages, optimistic coverage, and
the touch graph (the derived map of which writes refresh which queries). When you materialize that
graph for CI or tooling, the commands read the graph file:

```sh
kovo check graph.json                               # semantic gates (KV310, KV311, audits)
kovo explain query cart graph.json                  # read one node of the graph
kovo explain mutation cart/add --optimistic graph.json
kovo explain page /cart graph.json
kovo explain component CartBadge graph.json
kovo explain --unguarded graph.json
```

Prefer deriving or constructing the graph in tests instead of committing generated graph artifacts;
the output is stable and diffable, so CI can still assert product rules directly.

## Read the output

All output below is generated from the commerce reference app's committed graph. Every format starts
with a version line (`kovo-explain/v1`), and the formats are snapshot-locked so your scripts and CI
assertions don't rot.

**A query** — what it reads, who consumes it, what refreshes it:

```sh
kovo explain query cart graph.json
```

```txt
kovo-explain/v1
QUERY cart
reads: cart
consumers: component:CartBadge,page:/cart
invalidated-by: cart/add
domain-writes: cart.addItem
```

**A mutation** — guard chain, input surface, writes, derived invalidations, and the full update
fan-out, with optimistic coverage when asked:

```sh
kovo explain mutation cart/add --optimistic graph.json
```

```txt
kovo-explain/v1
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
`kovo explain` output answers the question with 100% accuracy.

**A page** — what a route ships:

```sh
kovo explain page /cart graph.json
```

```txt
kovo-explain/v1
PAGE /cart
prefetch: false
meta: title=Kovo Commerce (1) description=Browse products and checkout with 1 verifiable cart item. image=-
i18n: en-US:cartLabel,productStock
modulepreloads: -
stylesheets: /assets/site.css
queries: cart,productGrid,orderHistory
view-transitions: -
```

**A component** — its queries, fragment targets, DOM identity, and the wiring the compiler extracted
from its TSX: handlers (with their capture channels and platform substitutions), derives, and
mount triggers:

```sh
kovo explain component CartBadge graph.json
```

```txt
kovo-explain/v1
COMPONENT CartBadge
queries: cart
fragments: cart-badge
dom-name: cart-badge
effective-dom-name: components/cart/cart-badge/cart-badge
STYLE class=kv-button-bg-a1b2c3 source=button.tsx#root style-ref=base.root
HANDLER click export=CartBadge$button_click ref=/c/cart-badge.client.js#CartBadge$button_click captures=ctx,element-params params=itemId substitution=-
SUBSTITUTION dialog tag=button event=click target=cart-drawer action=show-modal
DERIVE CartBadge$isEmpty inputs=cart ref=/c/cart-badge.client.js#CartBadge$isEmpty target=button[data-bind:disabled]
TRIGGER visible export=CartBadge$mountChart ref=/c/cart-badge.client.js#CartBadge$mountChart deps=cart justification=chart boots when visible
MERGE button attr=aria-expanded rule=aria-author-override decision=author-wins diagnostics=KV232
```

Each `HANDLER` line names the extracted client handler, the `/c/*` module ref the served `on:*`
attribute points at, its capture channels (`ctx`, `element-params`), and any platform `substitution`;
`SUBSTITUTION` lines record where the compiler swapped an author event for a native platform behavior
(here, `show-modal` on a `<dialog>`); `DERIVE` lines are the computed bindings and their DOM targets.
This is how `on:*` refs, captures, and substitutions become inspectable without reading the lowered IR
(SPEC §5.3, §4.x).

The grammar is consistent: `key: value` lines, `-` for empty, comma-separated sets, `;`-separated
`a->b` edges. You parse it with `grep` and `awk`; that's the intent.

## Run the gates with kovo check

`kovo check graph.json` runs the semantic checks that don't belong in `vp check`: optimistic
exhaustiveness, update coverage, touch-graph consistency, and the audits. Healthy output is short:

```txt
kovo-check/v1
OK
```

Unhealthy output names the edge and exits non-zero. This is the commerce graph with one hand-written
transform deleted:

```txt
kovo-check/v1
WARN KV310 cart/add -> cart Invalidated query lacks optimistic transform.
```

Coverage diagnostics are warnings with teeth: suppressible, but the suppression is recorded in
source rather than left silent.

## Turn product rules into CI assertions

When a product rule matters — "every component that shows cart data must refresh when the cart
changes" — you assert it as a set operation over the printed graph. Here is the starter's shell
recipe:

```sh
kovo explain query cart graph.json > .kovo/cart.query.txt
awk -F': ' '/^consumers: / { print $2 }' .kovo/cart.query.txt \
  | tr ',' '\n' | grep '^component:' | sort > .kovo/cart.consumers.txt
printf '%s\n' component:CartBadge component:CartPanel | sort > .kovo/expected.txt
diff -u .kovo/expected.txt .kovo/cart.consumers.txt

grep '^invalidated-by: .*cart/add' .kovo/cart.query.txt
kovo explain mutation cart/add --optimistic graph.json | grep '^OPTIMISTIC-SUMMARY .*UNHANDLED=0'
```

The starter generates the script version into `scripts/graph-assertions.mjs`:

```ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const kovoExplain = (args) =>
  execFileSync('kovo', ['explain', ...args, 'graph.json'], { encoding: 'utf8' });

const cartAdd = kovoExplain(['mutation', 'cart/add', '--optimistic']);
assert.match(cartAdd, /^updates: cart->component:CartBadge,page:\/cart/m);
assert.match(cartAdd, /^OPTIMISTIC-SUMMARY .*UNHANDLED=0$/m);
```

These run in the starter's CI as `vp run graph-assertions`, next to `vp run kovo-check`. A graph
assertion differs in kind from a rendering test: it states intent ("cart consumers are exactly
these") and holds as the app grows — a new component that reads cart data either joins the consumer
set correctly or turns CI red.

## The audits

Three explain modes answer security review's first questions from the same artifact:

```sh
kovo explain --unguarded graph.json   # every mutation, route, and query reachable without authed
kovo explain --unscoped graph.json    # owner-annotated tables whose key predicate isn't session-traceable (IDOR)
kovo explain --endpoints graph.json   # machine ingress: endpoints, webhooks, file/stream routes + auth/CSRF posture
```

```txt
kovo-explain/v1
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
2. **Read the request.** `Kovo-Targets: cart-badge=cart; …` is the live DOM's dependency claim. If a
   fragment you expected isn't listed, the island is missing its `kovo-deps` stamp; inspect the element.
3. **Read the response.** `Kovo-Changes` names the committed domains, and the body's `<kovo-query>` and
   `<kovo-fragment>` chunks are exactly what will patch in. If data is stale, check whether the query's
   `<kovo-query>` chunk is present.
4. **Cross-check against intent.** `kovo explain mutation cart/add` says what should have happened — the
   `invalidates:` and `updates:` lines. The wire says what did. The diff localizes the bug: missing
   from `invalidates:` is a touch-graph problem (see [queries & invalidation](/guides/queries/));
   present there but absent on the wire is a rendering problem.
5. **For a 422**, the body is the re-rendered form with `data-error-code`, readable as HTML (see
   [the 422 path](/guides/mutations/)).

Debugging proceeds down into plainer artifacts — graph text, HTTP, HTML — instead of up into
framework internals.

## Next

- [Testing with @kovojs/test](/guides/testing/) — the runtime half: observed ⊆ static ∪ declared.
- [Optimistic updates](/guides/optimistic/) — the coverage these checks enforce.

<details>
<summary>Spec & diagnostics</summary>

The `kovo explain` / `kovo check` artifact formats: SPEC §5.3, §11.4. The committed graph and its diffs:
SPEC §11.1. Optimistic exhaustiveness is **KV310** (SPEC §10.6); update coverage is **KV311**
(SPEC §4.9). The "agent answers from `kovo explain` alone" acceptance criterion: `rules/v1-acceptance.md`. The audits
and guard reachability: SPEC §10.3, §11.4; `owner:` annotations behind `--unscoped`: SPEC §10.1. The
wire vocabulary behind Network-panel debugging: SPEC §9.1. Debugging downward into plainer artifacts:
SPEC §1.

</details>
