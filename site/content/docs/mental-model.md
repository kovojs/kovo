---
title: Thinking in Kovo
description: Build a cart badge that updates itself, and learn how Kovo turns components into self-describing HTML along the way.
order: 3
---

# Thinking in Kovo

The fastest way to understand Kovo is to build one small thing and watch what happens to it. We'll
make a cart badge — the little "Cart: 3" counter in a header — that updates when you add an item,
without you writing any code to connect the two. By the end you'll know how Kovo thinks, and the
rest of the docs will read like footnotes.

## Step 1: declare the data once

A query is a named read. You say what it loads and which parts of your data it depends on:

```ts
import { query } from '@kovojs/server';
import { cart } from './domains.js';

export const cartQuery = query('cart', {
  load: (_input) => loadCart(db), // returns e.g. { count: 3 }
  reads: [cart], // this query depends on the "cart" domain
});
```

That `reads: [cart]` is the important part. It's not a tag you have to remember to update — it's the
whole dependency declaration. Anything that writes to the `cart` domain will refresh this query, and
you'll never write the code that makes that happen.

## Step 2: a component declares what it reads

```tsx
import { component } from '@kovojs/core';
import { cartQuery } from './queries.js';

export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <cart-badge>
      Cart: <span>{cart.count}</span>
    </cart-badge>
  ),
});
```

You wrote plain JSX. You didn't write any attributes describing the dependency, and you didn't fetch
anything. The component just says "I read `cart`," and uses the value.

## Step 3: the compiler wires it up

Here's what that component becomes when it renders:

```html
<cart-badge kovo-deps="cart">Cart: <span data-bind="cart.count">3</span></cart-badge>

<script type="application/json" kovo-query="cart">
  { "count": 3 }
</script>
```

The compiler derived two things and stamped them into the HTML:

- `kovo-deps="cart"` says this element depends on the `cart` query. When a mutation changes the cart,
  this is what asks for fresh data.
- `data-bind="cart.count"` says this element shows `cart.count`. When the value changes, the loader
  writes the new number here.

The query value ships once, as JSON in a `<script>` tag. Open View Source on any Kovo page and you
can read its entire data story — what data is on the page, and which elements depend on it. You
didn't write any of these attributes; the compiler did, and if one ever drifted out of sync with
your code, the build would fail before a user saw it.

## Step 4: a write updates the badge — automatically

Now add an item. A mutation is a typed write:

```ts
import { mutation, s } from '@kovojs/server';

export const addToCart = mutation('cart/add', {
  input: s.object({ productId: s.string(), quantity: s.number().int().min(1).default(1) }),
  handler(input) {
    /* insert into cart_items… */
  },
});
```

Notice what's _not_ here: a list of which queries to refresh. You never write `invalidate('cart')`.
The framework reads the write, sees it touches the `cart` domain, finds every query that reads
`cart` (just `cartQuery` here), re-runs it, and ships the new value back in the same response. The
badge updates. So does any other component that reads `cart` — including one a teammate adds next
month, with no extra wiring.

That's the core loop: **declare each fact once, and let the compiler derive every place it's used.**
A renamed column, a new component, a different mutation — each is a single edit, and the
dependencies follow.

## The four ideas behind that loop

Everything else in Kovo is a consequence of four choices.

### Components compile; they don't hydrate

Other frameworks ship a runtime that re-runs your components in the browser to "hydrate" the HTML.
Kovo doesn't. The HTML already carries everything it needs as attributes, and an 8KB loader handles
events globally. Until you interact with something, zero component JavaScript loads. The handler for
a button is right there in the markup:

```html
<button on:click="/c/cart.js#Cart$remove">×</button>
```

On the first click, the loader imports that exact URL and calls that exact export. Names like
`Cart$remove` survive minification, because the HTML refers to them — so debugging a button means
reading an attribute, not stepping through a framework.

### Navigation is the browser's job

Kovo is a multi-page app. A `<Link to="/products/:id" params={{ id }}>` compiles to a plain
`<a href="/products/p1">`. You get typed links — rename a route and every link to it turns red —
with no router running in the browser.

When JavaScript is present, Kovo may enhance an eligible same-origin click by fetching the full
target document, comparing compiler-stamped route/layout segments, and preserving only unchanged
layout DOM. The fetched document is still the source of truth. If the loader cannot prove the
target is compatible, the browser performs the normal full navigation. There is no app-authored
navigation partial response or client route table to maintain.

### Interactions use the lowest layer that works

Not every button needs JavaScript. Kovo ranks interactions and uses the cheapest one that does the
job:

| Layer | What it is                                                | JavaScript shipped               |
| ----- | --------------------------------------------------------- | -------------------------------- |
| L0    | Platform behavior: `<dialog>`, popovers, `:has()`         | none                             |
| L1    | A client island: local state + a handler                  | one module, on first interaction |
| L2    | A mutation: a real form → HTML fragment response          | the loader + form module         |
| L3    | Optimistic: predict the result before the server confirms | a small transform module         |

A size-guide popover that the platform can do natively ships no JavaScript at all. You don't pick
the layer; the compiler proves which one applies.

### The server is always right

Optimistic updates are throwaway sketches. You predict a result, show it instantly, and when the
server's real answer arrives, Kovo morphs the authoritative version in. There's no client cache to
keep consistent and no reconciliation protocol — the server's HTML wins, every time.

## What the compiler emits

If you want the full picture of authoring-to-runtime, here it is. You write the left column; the
compiler produces the middle; the browser runs the right:

```
AUTHORING                 COMPILED IR                   RUNTIME
cart.tsx          ──►     cart.server.js        ──►     Self-describing HTML
(JSX, inline              (render fns, queries)         • on:click="/c/cart.js#Cart$remove"
 closures)                cart.client.js                • <script kovo-query="cart"> JSON
                          (named handler exports)       • kovo-deps="cart" stamps
```

The emitted code is plain and readable, and compiling it again is a no-op — you can eject any
component and keep going. How that lowering works, with real captured output, is in the
[Compiler internals guide](/guides/compiler-internals/) when you're curious; you don't need it to
build.

## Next steps

- [Quickstart](/docs/quickstart/) — get this running on your machine.
- [Queries & invalidation](/guides/queries/) — the data loop in depth.
- [Tutorial](/tutorial/) — build the whole shop, step by step.

<details>
<summary>Spec references</summary>

Architecture overview: SPEC §3. Component model and the `kovo-deps`/`data-bind` stamps: SPEC §4.1,
§4.8. Handlers and the loader: SPEC §4.3, §4.4. Navigation and typed links: SPEC §6.4, §8. The
interaction ladder (L0–L3): SPEC §7. Queries, domains, and the touch graph: SPEC §10.1–10.3.
Server-truth reconciliation: SPEC §2 (design test 5). Compiler output as authorable IR: SPEC §5.2.

</details>
