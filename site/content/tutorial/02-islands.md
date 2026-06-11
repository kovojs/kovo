---
title: '2. Components & islands'
description: Author a TSX component with state and a click handler; let the compiler decide what ships as JavaScript.
order: 2
---

# Components & islands

The product page needs two interactions: a size-guide popover and a "save for later" button.
This chapter authors both in one TSX component and lets the compiler decide, per interaction,
what actually ships to the browser. Step state: `site/tutorial/steps/02-islands/`.

## The interaction ladder

Jiso ranks every interaction on a ladder and enforces the lowest layer that suffices (SPEC §7):
**L0** is platform behavior — popovers, dialogs, `<details>` — costing zero JavaScript; **L1**
is a pure client island whose handler module loads on first interaction. Authoring does not
choose the layer; the compiler proves it. You write ordinary TSX:

{{snippet:02-islands/src/components/product-actions.tsx#product-actions}}

Three things to notice in what you just wrote — and did not write:

- **No stamps.** Authored sugar never carries `fw-c`, `fw-state`, or binding attributes; the
  compiler derives them (SPEC §4.1, §4.8). Hand-writing one is lint FW223, and one that
  disagrees with the typed expression it wraps is error FW222 — drift between markup and code is
  unrepresentable, not unlikely.
- **`state` is a typed, serializable fact.** The `JsonValue` constraint makes unserializable
  state a compile error (SPEC §4.1) — island state lives in the document, not in a JavaScript
  heap, so it must survive serialization by construction.
- **Two closures, two fates.** The compiler proves the size-guide closure equivalent to a
  platform invoker and emits `popovertarget` attributes instead of JavaScript (SPEC §5.2 rule 4).
  The save closure becomes a named export in a per-component client module that the loader
  imports on first click (SPEC §4.3, §4.4). Curious exactly what got emitted? That lowering is
  the compiler's business, and it is documented with real captured output in
  [Compiler internals](/guides/compiler-internals/) — the served page below tells you everything
  you need here.

## The page is the documentation

The app imports the component's committed lowered IR (the compiled, still-authorable form under
`src/generated/` — Constitution #3) and renders it into the product page:

{{snippet:02-islands/src/app.ts#render-island}}

The step's first test reads the served HTML the way you would read it in the Elements panel
(SPEC §4.2): the popover is wired as plain attributes, the handler is a full URL plus a named
export — names are load-bearing, so minification structurally cannot mangle them
(Constitution #1) — and the island's state is right there in the markup:

{{snippet:02-islands/src/app.test.ts#page-test}}

This is the legibility contract at work: a developer who has never seen this codebase can answer
"what does this button do?" from devtools alone, because the answer is an attribute, not a stack
trace through framework internals (SPEC §16.2).

## Run the handler without a browser

Handlers are named exports with the signature `(event, ctx)` (SPEC §4.3), and the loader's job —
delegate the event, import the module, invoke the export, persist state — is mechanical. So the
test does exactly what the loader does, against the real emitted handler module:

{{snippet:02-islands/src/app.test.ts#dispatch-test}}

Two clicks, state `0 → 2`, persisted back into the `fw-state` attribute. Note what loaded when:
nothing at page load, the module on first interaction (SPEC §4.4). "Zero JS before interaction"
is not an optimization setting — it is the default the markup declares.

## The compiler nudges, in the open

The step's last test compiles the authored source and pins the diagnostics — the anonymous save
closure earns FW210, the naming nudge (SPEC §5.2), and the popover substitution is recorded:

{{snippet:02-islands/src/app.test.ts#lint-test}}

Diagnostics are part of the teaching surface: every Jiso error shows what would have been
generated, why it can't be, and the fix menu (SPEC §5.2 rule 5). The
[reading fw check guide](/guides/fw-explain/) tours the diagnostic registry.

Next: real data — queries, and the bindings the compiler derives from them.
