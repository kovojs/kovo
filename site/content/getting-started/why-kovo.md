---
title: Why Kovo?
description: What Kovo is for, the trade-offs it makes, and how it compares to Next, Remix, htmx, Qwik, and Astro.
order: 1
---

# Why Kovo?

You rename a column in your database — `price` becomes `priceCents`. In most stacks, you find out
what that broke the same way your users do: a page renders blank, a form posts to nothing, a link
404s. The query still typechecks. The template still compiles. The bug ships.

Kovo is built so that rename fails the build instead — at the query that selected the old column,
the element bound to it, the form field that fed it, and the link that linked to it. One change,
every downstream break, caught before anyone clicks.

That's the whole idea: **your app's wiring — every handler, data dependency, form field,
navigation target, and mutation — is checked by TypeScript and a few static graph queries, and
readable in View Source and the Network panel.** If it's wired wrong, it doesn't compile.

## What you'd build with it

Kovo is a framework for **multi-page apps that are interactive the moment they paint**: commerce,
dashboards, CRMs, forums, marketplaces, internal tools — the data-heavy, content-and-CRUD majority
of the web. You write components in TSX. The compiler turns them into plain HTML that carries its
own behavior as attributes, plus a tiny loader that wakes up on the first click. There is no
hydration step, no client router, and no client-state library to architect.

Two kinds of teams get the most out of it:

- **People who want SPA-grade UX without owning a client-state system.** You get optimistic
  updates, instant navigation, and live-feeling data — but the server stays the source of truth,
  so there's no cache to invalidate and no consistency protocol to debug.
- **People generating apps with AI.** Kovo is designed to be the most checkable target an agent
  can emit. A generated app that's wired wrong fails `vp check`; intent can be verified against a
  printed dependency graph without spinning up a browser. The error messages name the fix.

## See it: change one thing, catch every break

Say a product's price moves from a top-level column to a nested field. Here's the chain Kovo
checks, top to bottom:

```ts
// 1. the schema changes
products = table({ priceCents: integer() }); // was: price

// 2. the query that still selects `price` → compile error at the read
query('product', { load: () => db.select({ price: products.price }) /* ✗ no such column */ });

// 3. the element bound to `product.price` → compile error at the binding
<span>{product.price}</span>; // ✗ not on the query's result type

// 4. the link built against a dropped route param → compile error at the call site
<Link to="/sale" params={{ max: priceParam }} />; // ✗ param no longer exists
```

You don't annotate any of this. You write ordinary JSX and queries; the compiler derives the
wiring — which mutations refresh which queries, which elements update when data changes, which
handler each button calls — and stamps it into the HTML. When you open View Source on a Kovo page,
the dependency story is right there in the attributes. When you watch the Network panel, a mutation
is a named form POST whose response is HTML fragments plus query JSON — no framework envelope to
decode.

## The trade-offs (read this part)

Kovo makes sharp choices, and they cost you things. Here's where it's the wrong tool:

- **Long-lived, single-heap client apps.** Figma-class canvases, video editors, DAWs, anything
  built around one mutable client session that lives across navigations — Kovo won't grow a global
  client store or client router to serve those. Its islands can host a rich widget, but the app
  shell is the document, not a persistent runtime.
- **Offline-first.** The server is unconditionally authoritative. There's no sync engine and no
  local-first story.
- **Media that must survive every navigation.** Kovo can preserve media inside an unchanged,
  compiler-stamped layout when enhanced navigation proves the target document is compatible. That
  is a progressive enhancement, not a client-router guarantee: JS-off, unsupported browsers, guard
  changes, shell drift, or incompatible layouts still perform a normal full document navigation.
- **Browser-uniform fancy transitions.** Instant prerendering and invoker commands are
  Chromium-led. Kovo degrades gracefully — real navigations, real forms — but it doesn't polyfill
  them, so non-Chromium users get the solid version, not the deluxe one.
- **Escape-hatch-heavy code.** The static guarantees hold because app code stays in TypeScript's
  sound subset: `strict` on, no `any`, no `as` casts, no non-null `!`. If your team leans on those,
  expect friction — they're lint errors here, not warnings.
- **Pick-your-own-database freedom, today.** The automatic "which write refreshes which query"
  graph is derived from Drizzle metadata on the blessed dialects. Other data stacks can work, but
  you own the query/write metadata instead of getting it from the Drizzle extractor.

And the honest status line: **Kovo is pre-v1 and not published to npm.** You can build with it today
inside the repository (the [Tutorial](/tutorial/) does exactly that), but it isn't a `pnpm add`
away yet, and the ecosystem of ready-made widgets (charts, date pickers, rich editors) is still
thin. React interop — mounting real React components inside an island — is a planned workstream,
not a shipped feature.

## How it compares

| If you've used…     | What's familiar                                   | What Kovo changes                                                                                                                                                          |
| ------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Next / Remix**    | Server-rendered React, file-based routing         | No hydration and no client-state library; the server↔client wiring is typechecked end-to-end, not runtime-discovered                                                       |
| **htmx / LiveView** | HTML over the wire, server-rendered fragments     | Same wire philosophy, but the fragment/query contracts are statically typed; no stateful socket tier (htmx has none either; unlike LiveView, no per-client server session) |
| **Qwik**            | Resumability, lazy handler loading on interaction | Borrows resumability, but compiles to near-zero client runtime and stays a true MPA — no resumable client app graph                                                        |
| **Astro**           | Islands, MPA, ship-little-JS                      | Same islands-on-an-MPA shape, but Kovo owns the typed data/mutation/invalidation graph across the stack, where Astro stays framework-agnostic and content-first            |

The one-line version: if you like Astro's islands and htmx's wire but want the database-to-DOM
wiring to be a _type error when it's wrong_, that's the gap Kovo fills.

## Design principles

Kovo's Prime Principle is security by construction: trust-boundary mistakes should be impossible
where static analysis can prove them, fail closed where it cannot, and show every escape hatch in
`kovo explain`.

The five design tests are the pressure checks behind that claim:

| Test                          | Consequence for app code                                                  |
| ----------------------------- | ------------------------------------------------------------------------- |
| Legibility is load-bearing    | Handler, query, route, and wire names stay visible in HTML and Network.   |
| No global knowledge           | Declare security and data facts once; do not enumerate distant consumers. |
| Sugar lowers to authorable IR | Compiler output is inspectable Kovo source, not an opaque VM.             |
| The wire documents decisions  | Frames show what the server sent while `secret` data stays ineligible.    |
| Server truth wins             | Optimistic UI is disposable; reconciliation morphs authoritative HTML.    |

That is why the framework is strict about imports, sound TypeScript, generated artifacts, and
audits: those constraints are what make rename, stale-data, and security failures show up before
runtime.

## Next steps

- [Quickstart](/getting-started/quickstart/) — get a page rendering and see the checks fire.
- [Thinking in Kovo](/getting-started/mental-model/) — the mental model, built through one small app.
- [Tutorial](/tutorial/) — build a real commerce app end to end.

<details>
<summary>Spec references</summary>

Vision and audience: SPEC §1. The five design tests (legibility, no global knowledge at local
sites, sugar lowers to authorable IR, the wire is the documentation, server truth wins): SPEC §2.
Non-goals (Figma-class apps, offline-first, cross-navigation media, browser parity, public JSON
API): SPEC §1.4. Rejected prior art (client router, hydration, client store, shadow DOM): SPEC §3.1.

</details>
