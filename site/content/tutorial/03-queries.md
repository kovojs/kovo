---
title: '3. Queries & data binding'
description: Declare typed reads once; get dependency stamps, data bindings, and shared client data derived.
order: 3
---

# Queries & data binding

So far the catalog is hardcoded. In this chapter you add real data: a product list and a cart
badge. You declare two queries, and every downstream surface — dependency stamps, binding paths,
the JSON the page ships — comes from them. Step state: `site/tutorial/steps/03-queries/`.

## Declare domains

Domains are named groups of data that writes touch and reads depend on. They are the currency
the invalidation graph trades in, so they come first:

{{snippet:03-queries/src/domains.ts#domains}}

In the `@kovojs/drizzle` path, domains come from schema annotations on real tables, and the read
sets below are extracted from the query ASTs — the JOIN is the declaration. The tutorial uses a
plain in-memory store so every moving part stays visible:

{{snippet:03-queries/src/db.ts#db}}

## Declare the reads once

A query couples a key, a loader, and the domains it reads. That read set is the entire
registration: no query subscribes to mutations, and no mutation enumerates queries.

{{snippet:03-queries/src/queries.ts#loaders}}

{{snippet:03-queries/src/queries.ts#queries}}

A query's relationship to future writes is fixed by what it reads, not by anything you remember
to wire up, so you can't forget a dependency here. Chapter 5 cashes this in.

## Bind queries from components

The cart badge consumes the cart query. Your TSX says only that:

{{snippet:03-queries/src/components/cart-badge.tsx#cart-badge}}

The product list is keyed. You author ordinary TSX `key` identity, and the compiler lowers it to
`kovo-key` in the emitted IR because item identity is shared by the morph layer (the runtime's DOM
patcher), template stamps, inferred fragment target suffixes, and optimistic reordering:

{{snippet:03-queries/src/components/product-list.tsx#product-list}}

The compiler derives the runtime wiring from these declarations: `queries:` becomes an `kovo-deps`
stamp on each island, and `{cart.count}` becomes a typed `data-bind` path. Binding paths
type-check against the query's inferred shape — rename `count` and every referencing template
goes red; bind through a nullable segment without `?.` and you get a compile error. The step's
test pins all of it from the rendered page:

{{snippet:03-queries/src/app.test.ts#stamps-test}}

## Ship data once, as shared truth

Query values are server-owned and shared: the page ships each value exactly once as a JSON
script, and every island that depends on it reads from that single copy. There's no
per-component fetch and no client cache with a lifecycle. When a value changes, the loader
replaces it and walks the self-describing bindings under each dependent island:

{{snippet:03-queries/src/app.ts#shop-page}}

{{snippet:03-queries/src/app.test.ts#query-data-test}}

Note what the page does **not** contain: no serialized component tree, no hydration script, no
framework boot. The data is inspectable JSON, the dependencies are attributes, and the update
plan is the DOM. The [queries guide](/guides/queries/) covers parameterized queries, instance
keys, and the typed read endpoint when you need them.

Live data now flows, and every data-to-DOM dependency is an attribute you can read. Next:
writes — and the form-shaped contract they ride in on.

<details>
<summary>Spec & diagnostics</summary>

Domains as invalidation currency: SPEC §10.1. Derived downstream surfaces and read-set
extraction: SPEC §10.2. Read set as the entire registration: Constitution #2 (no API requires
global knowledge at a local site). Derived `kovo-deps`/`data-bind` stamps and binding type-check:
SPEC §4.8; binding through a nullable segment without `?.` is **KV227**. Authored `key` lowering to
runtime `kovo-key`: SPEC §4.8, §13.2. Data shipped once as shared truth: SPEC §4.2.

</details>
