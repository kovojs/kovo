---
title: '2. Components & islands'
description: Author a TSX component with state and a click handler; let the compiler decide what ships as JavaScript.
order: 2
---

# Components & islands

In this chapter you add two interactions to the product page — a size-guide popover and a "save
for later" button — written as one TSX component. You'll see the compiler decide, per
interaction, what actually ships to the browser, and you'll test both behaviors from strings.
Step state: `site/tutorial/steps/02-islands/`.

## Write the component

Kovo ranks every interaction on a fixed ladder and uses the lowest layer that works. **L0** is
platform behavior — popovers, dialogs, `<details>` — costing zero JavaScript. **L1** is a pure
client island whose handler module loads on first interaction. You don't pick the layer; the
compiler does. You write TSX:

{{snippet:02-islands/src/components/product-actions.tsx#product-actions}}

Three things to notice in what you wrote — and didn't:

- **No stamps.** You never hand-write `kovo-c`, `kovo-state`, or binding attributes; the compiler
  derives them. Hand-writing one is a lint warning, and one that disagrees with the typed
  expression it wraps is a compile error.
- **`state` is a typed, serializable fact.** The `JsonValue` constraint makes unserializable
  state a compile error: island state lives in the document, not in a JavaScript heap, so it has
  to survive serialization.
- **Two closures, two fates.** The compiler proves your size-guide closure equivalent to a
  platform invoker and emits `popovertarget` attributes instead of JavaScript. Your save closure
  becomes a named export in a per-component client module that loads on first click. To see what
  got emitted, [Compiler internals](/guides/compiler-internals/) shows real captured output; the
  served page below tells you what you need here.

## Render it into the page

The app renders the authored TSX component into the product page. The compiler may emit generated
artifacts under `src/generated/` for inspection, but those are outputs to verify, not source you
author or import by hand:

{{snippet:02-islands/src/app.ts#render-island}}

The step's first test reads the served HTML the way you'd read it in the Elements panel: the
popover wired as plain attributes, the handler as a full URL plus a named export, and the
island's state right there in the markup. Names are load-bearing, so minification can't mangle
them:

{{snippet:02-islands/src/app.test.ts#page-test}}

Someone who has never seen this codebase can answer "what does this button do?" from devtools
alone — the answer is an attribute, not a stack trace through framework internals.

## Run the handler without a browser

Handlers are named exports with the signature `(event, ctx)`. The loader's job — delegate the
event, import the module, invoke the export, persist state — is mechanical, so the test does
exactly what the loader does, against the real emitted handler module:

{{snippet:02-islands/src/app.test.ts#dispatch-test}}

Two clicks, state `0 → 2`, persisted back into the `kovo-state` attribute. Note what loaded when:
nothing at page load, the module on first interaction. Zero JS before interaction is the default
the markup declares, not an optimization you turn on.

## Read the compiler's diagnostics

The step's last test compiles the authored source and pins the diagnostics: the anonymous save
closure earns a naming nudge, and the popover substitution is recorded:

{{snippet:02-islands/src/app.test.ts#lint-test}}

Every Kovo diagnostic shows what would have been generated, why it can't be, and the fix menu.
The [reading kovo check guide](/guides/kovo-explain/) tours the diagnostic registry.

## Next

You now have a free popover, a lazy island, and tests proving both from strings. Next: real
data — queries, and the bindings the compiler derives from them.

<details>
<summary>Spec & diagnostics</summary>

Interaction ladder and lowest-layer rule: SPEC §7. Compiler-derived stamps: SPEC §4.1, §4.8;
hand-written stamp is **KV223**, a stamp that disagrees with its typed expression is **KV222**.
Serializable island state: SPEC §4.1. Popover lowering and naming nudge: SPEC §5.2 rule 4,
**KV210**. Committed lowered IR under `src/generated/`: Constitution #3. Legible served HTML and
load-bearing names: SPEC §4.2, `rules/v1-acceptance.md`, Constitution #1. Handler signature and lazy load: SPEC
§4.3, §4.4.

</details>
