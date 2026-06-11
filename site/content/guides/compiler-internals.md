---
title: Compiler internals
description: "Advanced: what the compiler emits, the IR contract, the fixpoint, and ejection."
order: 9
---

# Compiler internals

> **Advanced.** You can build complete Jiso applications without reading this page. Everywhere
> else in these docs — and in your codebase — components are authored in TSX. This guide is for
> the moments you want to know what the compiler did with your TSX: reviewing emitted output,
> debugging a stamp, ejecting a component, or building tooling.

## The pipeline

Authoring in Jiso is TSX: JSX renders, inline closures, one component per file. The compiler
(SPEC §5.1) parses each `.tsx` module and emits a small set of plain files with a 1:1 mapping —
`x.tsx` produces exactly `x.server.js` and `x.client.js`, plus shared generated registry types
(SPEC §5.2):

```
cart-badge.tsx ──► cart-badge.server.js   (render with derived stamps)
               ──► cart-badge.client.js   (named handler exports, update plans)
               ──► generated/registries.d.ts
```

Everything below is real compiler output, regenerated from the compiler on every build of this
site — it cannot drift from what `@jiso/compiler` actually emits.

## What you write

{{capture:lowering-input}}

Ordinary TSX: a query dependency, island state, an inline closure mutating that state, and a
plain `{cart.count}` expression bound into the markup.

## What the compiler emits

**The server module.** Your render, with the wiring *derived* and stamped as attributes
(SPEC §4.8):

{{capture:lowering-server}}

Three derivations did the work:

- The inline closure became a **handler reference** — `on:click` pointing at a named export in a
  versioned client module URL. The name is source-derived (`CartBadge$button_click`), appears in
  the HTML, and therefore can never be mangled (Constitution #1). The compiler also emits a lint
  here — `{{capture:lowering-lint}}` — nudging you to name the handler yourself for a stable
  identity across refactors.
- `{cart.count}` became **`data-bind="cart.count"`** — a typed path into the `cart` query's
  result shape, checked at compile time (SPEC §6.2).
- The query dependency became **`fw-deps="cart"`** and the island state a serialized
  **`fw-state`** stamp, which is how mutations later know this element wants fresh fragments
  (SPEC §9.1).

You never write these stamps. Hand-writing one that duplicates what the compiler derives is
FW223; one that drifts from the derivation is FW222 (SPEC §11.3).

**The client module.** Named handler exports plus the compiled update plan for each query this
component consumes:

{{capture:lowering-client}}

The closure's capture channels are checked here: a handler may reach component/query state via
`ctx`, element params via `data-p-*`, and module scope — anything else is compile error FW201,
whose message shows what the closure *would have* compiled to and the fixes (SPEC §4.3).

## The IR contract: emitted output is valid source

The emitted form is not a private artifact — it is **authorable Jiso source** (Constitution #3).
The marker comment `// @jiso-ir` is informational, not load-bearing. Two consequences:

1. **The fixpoint.** Compiling the compiler's own output is a no-op, byte-for-byte, and CI
   enforces it (`assertFixpoint`, SPEC §5.2). If a compiler change ever makes lowering
   non-idempotent, the gate fails — there is no drift channel between "what you wrote" and "what
   ships".
2. **Ejection.** Any component can drop to its emitted form and keep working: check the emitted
   files in, delete the `.tsx`, and you own the output. Nothing else in the toolchain knows the
   difference. This is the escape hatch when you need something the TSX front-end can't express
   yet — though if you hit that, it's usually a compiler gap worth filing.

## Render equivalence

The compiler proves the lowered render and your authored render produce identical markup
(`assertRenderEquivalence`, SPEC §5.2) — the equivalence facts ride the same registry emit the
rest of the toolchain consumes. Combined with the fixpoint, this is why fragments can be rendered
by the same functions that render full pages and never diverge from them.

## Reading emitted output in practice

- `vp build` writes the compiled modules; in dev they're compiled on demand and served under the
  versioned `/c/` namespace (SPEC §6.6 — module URLs are immutable, old versions stay published
  across deploys so long-lived documents never 404 on first interaction).
- The generated `registries.d.ts` is where declare-once typing comes from: handler modules,
  fragment targets, query update plans, and route/mutation registries all land as interface
  augmentations, which is why renames propagate as type errors instead of stale strings
  (SPEC §6.1).
- `fw explain component <Name> graph.json` shows the compiler's view of any component — queries
  consumed, fragments targeted, handlers exported — without reading the emitted files at all.
  See [Reading fw check & fw explain](/guides/fw-explain/).
