---
title: Reading fw check & fw explain
description: The graph workflow — stable output formats, CI graph assertions, the unguarded and unscoped audits, and debugging from the Network panel.
order: 7
---

# Reading fw check & fw explain

`fw explain` prints the compiler's decision tree on demand; `fw check` turns the same derived
facts into pass/fail gates. Both emit stable, diffable text — agents consume the same artifact
humans read (SPEC §5.3, §11.4). This guide is the working vocabulary: what each command says, how
to assert it in CI, and how the same facts appear in the Network panel.

## The graph workflow

Everything runs off one generated artifact, `graph.json` — components, queries, mutations, pages,
optimistic coverage, and the touch graph. The starter wires the loop:

```sh
vp run emit-graph                                 # regenerate graph.json from app facts
fw check graph.json                               # semantic gates (FW310, FW311, audits)
fw explain query cart graph.json                  # read one node of the graph
fw explain mutation cart/add --optimistic graph.json
fw explain page /cart graph.json
fw explain component CartBadge graph.json
fw explain --unguarded graph.json
```

`graph.json` is committed, so graph changes appear as reviewable diffs — adding a write to a
mutation shows up as a changed invalidation set in the same PR (SPEC §11.1).

## Reading the output

All output below is generated from the commerce reference app's committed graph. Every format
starts with a version line (`fw-explain/v1`); the formats are snapshot-locked so your scripts and
CI assertions don't rot (SPEC §11.4).

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

The `updates:` line is the answer to "what updates when this button is clicked" — mechanically,
without reading a line of app code. That property is an acceptance criterion for the framework:
an agent given only `fw explain` output answers it with 100% accuracy (SPEC §16).

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
`a->b` edges. Parse it with `grep` and `awk`; that's the intent.

## fw check: the gates

`fw check graph.json` runs the semantic checks that don't belong in `vp check`: optimistic
exhaustiveness (FW310, SPEC §10.6), update coverage (FW311, SPEC §4.9), touch-graph consistency,
and the audits. Healthy output is short:

```txt
fw-check/v1
OK
```

Unhealthy output names the edge and exits non-zero. This is the commerce graph with one
hand-written transform deleted:

```txt
fw-check/v1
WARN FW310 cart/add -> cart Invalidated query lacks optimistic transform.
```

Coverage diagnostics are warnings with teeth: suppressible, but the suppression is recorded in
source — never a silent inconsistency (SPEC §10.6).

## Graph assertions in CI

When a product rule matters — "every component that shows cart data must refresh when the cart
changes" — assert it as a set operation over the printed graph (SPEC §11.4). Shell version, the
starter's recipe:

```sh
fw explain query cart graph.json > .jiso/cart.query.txt
awk -F': ' '/^consumers: / { print $2 }' .jiso/cart.query.txt \
  | tr ',' '\n' | grep '^component:' | sort > .jiso/cart.consumers.txt
printf '%s\n' component:CartBadge component:CartPanel | sort > .jiso/expected.txt
diff -u .jiso/expected.txt .jiso/cart.consumers.txt

grep '^invalidated-by: .*cart/add' .jiso/cart.query.txt
fw explain mutation cart/add --optimistic graph.json | grep '^OPTIMISTIC-SUMMARY .*UNHANDLED=0'
```

Script version, as the starter generates into `scripts/graph-assertions.mjs`:

```ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const fwExplain = (args) =>
  execFileSync('fw', ['explain', ...args, 'graph.json'], { encoding: 'utf8' });

const cartAdd = fwExplain(['mutation', 'cart/add', '--optimistic']);
assert.match(cartAdd, /^updates: cart->component:CartBadge,page:\/cart/m);
assert.match(cartAdd, /^OPTIMISTIC-SUMMARY .*UNHANDLED=0$/m);
```

These run in the starter's CI as `vp run graph-assertions`, next to `vp run fw-check`. The
difference in kind from a rendering test: a graph assertion states _intent_ ("cart consumers are
exactly these") and holds as the app grows — a new component that reads cart data either joins
the consumer set correctly or turns CI red.

## The audits

Three explain modes answer security review's first questions from the same artifact (SPEC §10.3,
§11.4):

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

The commerce app's audits are clean (`total=0`). A finding adds a line per item above its
summary; in CI, run the audits with fail-on-findings so a guard removed in a refactor cannot land
quietly. `--unscoped` is the IDOR audit: it lists queries and writes touching an `owner:`-annotated
table (SPEC §10.1) whose key predicate the analyzer cannot trace to `req.session` (SPEC §10.3).
`--endpoints` is the machine-ingress table — name, path, auth scheme, CSRF posture, and for
webhooks the write→domain chain — so "what can reach this app and what can it touch?" is
answerable without executing anything (SPEC §11.4).

## Debugging from the Network panel

The wire and the graph speak the same vocabulary, which makes a tight debugging loop (SPEC §9.1,
Constitution #4 in SPEC §2):

1. **Click the thing.** In the Network panel you see `POST /_m/cart/add` — mutations are named
   POSTs, so you already know which mutation fired without source maps.
2. **Read the request.** `FW-Targets: cart-badge=cart; …` is the live DOM's dependency claim. If a
   fragment you expected isn't listed, the island is missing its `fw-deps` stamp — inspect the
   element.
3. **Read the response.** `FW-Changes` names the committed domains; the body's `<fw-query>` and
   `<fw-fragment>` chunks are exactly what will patch in. If data is stale, check whether the
   query's `<fw-query>` chunk is present.
4. **Cross-check against intent.** `fw explain mutation cart/add` says what _should_ have
   happened — the `invalidates:` and `updates:` lines. Wire says what did. The diff between them
   localizes the bug: missing from `invalidates:` is a touch-graph problem (see
   [queries & invalidation](/guides/queries/)); present there but absent on the wire is a
   rendering problem.
5. **For a 422**, the body is the re-rendered form with `data-error-code` — readable as HTML
   (see [the 422 path](/guides/mutations/)).

Debugging proceeds _down_ into plainer artifacts — graph text, HTTP, HTML — never up into
framework internals (SPEC §1).

## Next

- [Testing with @jiso/test](/guides/testing/) — the runtime half: observed ⊆ static ∪ declared.
- [Optimistic updates](/guides/optimistic/) — the coverage FW310 enforces.
