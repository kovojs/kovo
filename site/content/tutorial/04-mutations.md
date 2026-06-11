---
title: '4. Mutations & forms'
description: One typed write, one endpoint, two response modes — a real form without JavaScript, the fragment wire with it.
order: 4
---

# Mutations & forms

Time to sell something. This chapter adds `cart/add`: a schema-validated, transactional write
whose UI is a real HTML form. The same endpoint answers browsers without JavaScript
(POST-redirect-GET) and enhanced browsers (the fragment wire) — one handler, two response modes
(SPEC §9.1). Step state: `site/tutorial/steps/04-mutations/`.

## Declare the write once

{{snippet:04-mutations/src/app.ts#add-to-cart}}

Read it as a set of single declarations, each deriving multiple surfaces (SPEC §6.3):

- **`input`** is the one source of truth for field names, types, _and_ FormData coercion —
  attribute and form values arrive as strings, so `s.number().int().min(1).default(1)` says how
  `quantity` becomes a number, once. The same schema validates the wire at runtime; types
  without validators was explicitly rejected (SPEC §6.6).
- **`errors`** declares the failure vocabulary. `context.fail('OUT_OF_STOCK', …)` is typed
  against it, and every consumer — fragment renderers, `onError` callbacks — receives an
  exhaustive discriminated union (SPEC §9.2).
- **`transaction`** wraps the handler in the fixed lifecycle: validate → guard → `BEGIN` →
  handler → `COMMIT`, with `fail()` rolling back (SPEC §10.3). The step's tiny database makes
  the commit/rollback boundary concrete:

{{snippet:04-mutations/src/db.ts#transaction}}

## CSRF fails closed

Before writing the form, the request shell needs one more declaration. Mutations are
browser-reachable POSTs, so CSRF protection is default-on: a mutation with no token source
refuses every request rather than accepting forged ones (SPEC §6.6). The token is a
session-bound synchronizer the framework stamps into forms and verifies before input parsing:

{{snippet:04-mutations/src/app.ts#csrf}}

{{snippet:04-mutations/src/app.test.ts#csrf-test}}

## The no-JS form is the output

The add-to-cart form is rendered by the product list component — a real form, posting to the
mutation's named endpoint. This is not a fallback bolted on afterwards; it is the contract the
enhanced path upgrades (SPEC §6.3):

{{snippet:04-mutations/src/components/product-list.tsx#add-to-cart-form}}

`enhance` is the entire opt-in: with JavaScript, the loader intercepts the submit and speaks the
fragment wire; without it, the browser posts the form natively. The `fw-fragment-target` names
this form as a patchable region so failures can re-render just it (SPEC §9.1, §9.2). The wire
stays legible either way — a named POST to `/_m/cart/add` with schema-shaped fields
(Constitution #4).

{{snippet:04-mutations/src/app.test.ts#form-markup-test}}

## Mode one: no JavaScript

{{snippet:04-mutations/src/app.test.ts#no-js-test}}

Success is POST-redirect-GET — status 303, fresh page, no resubmit-on-refresh. Failure
re-renders the full page with the typed error in place and HTTP 422, the form still filled in:

{{snippet:04-mutations/src/app.test.ts#no-js-failure-test}}

Safari and Firefox users without the enhancements get exactly this: a working website. That
degradation contract is structural, not aspirational (SPEC §8).

## Mode two: the fragment wire

With JavaScript, the same endpoint sees an `FW-Fragment` header and answers with readable
chunks: re-rendered fragments for the targets the live DOM declared via its `fw-deps` stamps —
the server holds no session of what's on screen, it answers a stateless question (SPEC §9.1):

{{snippet:04-mutations/src/app.test.ts#enhanced-test}}

Fragments are produced by the same component renders that full pages use, so partials cannot
drift from pages (SPEC §9.1). They are DOM-morphed in, preserving focus, scroll, and island
state — a fragment update is a tiny navigation, not a different programming model. Failures ride
the same wire, scoped to the form that caused them:

{{snippet:04-mutations/src/app.test.ts#enhanced-failure-test}}

The [mutations guide](/guides/mutations/) covers guards, file uploads, and response headers.
Notice what the enhanced response did _not_ include yet: updated query JSON. The server
re-rendered fragments, but nothing told it which queries this write invalidated. That derivation
is the next chapter.
