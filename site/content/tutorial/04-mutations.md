---
title: '4. Mutations & forms'
description: One typed write, one endpoint, two response modes — a real form without JavaScript, the fragment wire with it.
order: 4
---

# Mutations & forms

Your shop shows live data; now you'll sell something. In this chapter you add `cart/add`: a typed
write behind a real HTML form. The same endpoint handles no-JS POST-redirect-GET and the enhanced
fragment response. Step state: `site/tutorial/steps/04-mutations/`.

## Declare the input

{{snippet:04-mutations/src/app.ts#add-to-cart-input}}

This is the form contract. `quantity` arrives as a string, and the schema says how it becomes a
number.

## Add the CSRF token source

Before the form can submit, the request shell needs a token source. Mutations are browser-reachable
POSTs, so Kovo stamps a `kovo-csrf` hidden field into the form and verifies it before input parsing:

{{snippet:04-mutations/src/app.ts#csrf}}

{{snippet:04-mutations/src/app.test.ts#csrf-test}}

## Declare the mutation

The mutation now has its token source, input schema, failure vocabulary, transaction wrapper, and
handler in one place. This step also lists the query definitions the request shell can rerun after
commit; the next chapters show how the invalidation graph derives that set from domains and writes
instead of making you maintain it by hand.

{{snippet:04-mutations/src/app.ts#add-to-cart}}

`errors` gives the form a typed `OUT_OF_STOCK` state. `transaction` gives `fail()` a rollback
boundary.

The step's tiny database makes the commit/rollback boundary concrete:

{{snippet:04-mutations/src/db.ts#transaction}}

## Render the no-JS form

The product list component renders the add-to-cart form — a real form, posting to the
mutation's named endpoint. The no-JS form is the contract the enhanced path upgrades, not a
fallback bolted on afterward:

{{snippet:04-mutations/src/components/product-list.tsx#add-to-cart-form}}

`enhance` is the entire opt-in: with JavaScript, the loader intercepts the submit and speaks the
fragment wire; without it, the browser posts natively. Repeated forms use ordinary keyed identity,
and the compiler derives the submitted-form target so failures can re-render just that instance.
Either way the wire stays legible — a named POST to `/_m/cart/add` with schema-shaped fields.

{{snippet:04-mutations/src/app.test.ts#form-markup-test}}

## Mode one: no JavaScript

{{snippet:04-mutations/src/app.test.ts#no-js-test}}

Success is POST-redirect-GET — status 303, fresh page, no resubmit-on-refresh. Failure
re-renders the full page with the typed error in place and HTTP 422, the form still filled in:

{{snippet:04-mutations/src/app.test.ts#no-js-failure-test}}

Users without the enhancements get a working website. That degradation is structural, not
aspirational.

## Mode two: the fragment wire

With JavaScript, the same endpoint sees an `Kovo-Fragment` header and answers with readable chunks:
query values or fragments for the live targets declared by `kovo-deps` stamps. The server holds no
record of what's on screen — it answers a stateless question:

{{snippet:04-mutations/src/app.test.ts#enhanced-test}}

Fragments come from the same component renders as full pages, so partials can't drift from
pages. They are DOM-morphed in — patched in place, not replaced — so focus, scroll, and island
state survive; a fragment update is a tiny navigation. Failures ride the same wire, scoped to the
form that caused them:

{{snippet:04-mutations/src/app.test.ts#enhanced-failure-test}}

The [mutations guide](/guides/mutations/) covers guards, file uploads, and response headers.

You now have a real write, working with and without JavaScript. The next chapter makes the refresh
path feel instant by adding optimistic query transforms.

<details>
<summary>Spec & diagnostics</summary>

`input` schema as single source of truth, validators required: SPEC §6.3, §6.6. `errors` as a
typed discriminated union: SPEC §9.2. Transaction lifecycle and rollback: SPEC §10.3. CSRF
default-on, fail-closed: SPEC §6.6. No-JS degradation as a structural contract: SPEC §8. Legible
named POST: Constitution #4. Stateless fragment responses keyed off live `kovo-deps`: SPEC §9.1.
Submitted-form target inference and typed failure state: SPEC §6.3, §9.2.

</details>
