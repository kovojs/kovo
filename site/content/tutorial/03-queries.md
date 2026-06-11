---
title: '3. Queries & data binding'
description: Declare typed reads once; get dependency stamps, data bindings, and shared client data derived.
order: 3
---

# Queries & data binding

The shop page needs real data: a product list and a cart badge. This chapter declares two
queries and lets every downstream surface — dependency stamps, binding paths, the JSON the page
ships — be derived from those declarations (SPEC §10.2). Step state:
`site/tutorial/steps/03-queries/`.

## Domains: the invalidation currency

Before queries come domains — named groups of data that writes touch and reads depend on
(SPEC §10.1). They are the currency the invalidation graph trades in:

{{snippet:03-queries/src/domains.ts#domains}}

In the blessed `@jiso/drizzle` path, domains come from schema annotations on real tables and the
read sets below are extracted from the query ASTs — the JOIN is the declaration (SPEC §10.1,
§10.2). The tutorial uses a plain in-memory store so every moving part stays visible:

{{snippet:03-queries/src/db.ts#db}}

## Declare the reads once

A query couples a key, a loader, and the domains it reads. That read set is the entire
registration — no query subscribes to mutations, no mutation enumerates queries
(Constitution #2: no API may require global knowledge at a local site):

{{snippet:03-queries/src/queries.ts#loaders}}

{{snippet:03-queries/src/queries.ts#queries}}

Forgetting a dependency — RTK Query's endemic bug — is unrepresentable here: a query's
relationship to future writes is fixed by what it reads, not by anything you remember to wire up
(SPEC §10.2). Chapter 5 cashes this in.

## Components declare queries; the compiler does the rest

The cart badge consumes the cart query. The authored TSX says only that:

{{snippet:03-queries/src/components/cart-badge.tsx#cart-badge}}

The product list is a keyed list — `fw-key` is authored, because identity is an app-level fact
the morph layer, template stamps, and optimistic reordering all share (SPEC §4.8, §13.2):

{{snippet:03-queries/src/components/product-list.tsx#product-list}}

From these declarations the compiler derives the runtime wiring (SPEC §4.8): the `queries:`
declaration becomes an `fw-deps` stamp on each island, and the `{cart.count}` expression becomes
a typed `data-bind` path. Binding paths type-check against the query's inferred shape — rename
`count` and every template referencing it goes red; bind through a nullable segment without `?.`
and you get teaching error FW227 (SPEC §4.8, §6.2). The step's test pins all of it from the
rendered page:

{{snippet:03-queries/src/app.test.ts#stamps-test}}

## Data ships once, as shared truth

Query values are server-owned and shared: the page ships each value exactly once as a JSON
script, and every island that depends on it reads from that single copy (SPEC §4.2). There is no
per-component fetch and no client cache with a lifecycle — when a value changes, the loader
replaces it and walks the self-describing bindings under each dependent island (SPEC §4.8):

{{snippet:03-queries/src/app.ts#shop-page}}

{{snippet:03-queries/src/app.test.ts#query-json-test}}

Note what the page does **not** contain: no serialized component tree, no hydration script, no
framework boot. The data is inspectable JSON, the dependencies are attributes, and the update
plan _is_ the DOM (SPEC §4.8). The [queries guide](/guides/queries/) covers parameterized
queries, instance keys, and the typed read endpoint when you need them.

Next: writes — and the form-shaped contract they ride in on.
