---
title: Compiler internals
description: See exactly what the compiler emits from your TSX, why the output is valid source, and how to eject a component.
order: 9
---

# Compiler internals

You don't need this page to build a Jiso app — everywhere else in these docs, and in your codebase,
you author components in TSX. Read it when you want to see what the compiler did with that TSX:
reviewing emitted output, debugging a stamp, ejecting a component, or building tooling.

## The pipeline

You author in TSX: JSX renders, inline closures, one component per file. The compiler parses each
`.tsx` module and emits a small set of plain files with a 1:1 mapping — `x.tsx` produces exactly
`x.server.js` and `x.client.js`, plus shared generated registry types.

```
cart-badge.tsx ──► cart-badge.server.js   (render with derived stamps)
               ──► cart-badge.client.js   (named handler exports, update plans)
               ──► generated/registries.d.ts
```

Everything below is real compiler output, regenerated from the compiler on every build of this site,
so it can't drift from what `@jiso/compiler` actually emits.

## What you write

{{capture:lowering-input}}

Ordinary TSX: a query dependency, island state, an inline closure mutating that state, and a plain
`{cart.count}` expression bound into the markup.

## What the compiler emits

**The server module.** Your render, with the wiring derived and stamped as attributes.

{{capture:lowering-server}}

Three derivations did the work:

- The inline closure became a **handler reference** — `on:click` pointing at a named export in a
  versioned client module URL. The name is source-derived (`CartBadge$button_click`), appears in the
  HTML, and therefore can never be mangled. The compiler also emits a lint here —
  `{{capture:lowering-lint}}` — nudging you to name the handler yourself for a stable identity across
  refactors.
- `{cart.count}` became **`data-bind="cart.count"`** — a typed path into the `cart` query's result
  shape, checked at compile time.
- The query dependency became **`fw-deps="cart"`** and the island state a serialized **`fw-state`**
  stamp, which is how mutations later know this element wants fresh fragments.

You never write these stamps. Hand-writing one that duplicates the derivation, or drifts from it, is
a compile error.

**The client module.** Named handler exports plus the compiled update plan for each query this
component consumes:

{{capture:lowering-client}}

The closure's capture channels are checked here: a handler may reach component/query state via `ctx`,
element params via `data-p-*`, and module scope. Anything else is a compile error whose message shows
what the closure would have compiled to and how to fix it.

## Emitted output is valid source

The emitted form isn't a private artifact — it's authorable Jiso source. The marker comment
`// @jiso-ir` is informational, not load-bearing. Two consequences follow:

1. **The fixpoint.** Compiling the compiler's own output is a no-op, byte-for-byte, and CI enforces it
   with `assertFixpoint`. If a compiler change ever makes lowering non-idempotent, the gate fails —
   there's no drift channel between what you wrote and what ships.
2. **Ejection.** Any component can drop to its emitted form and keep working: check the emitted files
   in, delete the `.tsx`, and you own the output. Nothing else in the toolchain knows the difference.
   This is the escape hatch for something the TSX front-end can't express yet — though if you hit
   that, it's usually a compiler gap worth filing.

## Render equivalence

The compiler proves the lowered render and your authored render produce identical markup, with
`assertRenderEquivalence`. The equivalence facts ride the same registry emit the rest of the
toolchain consumes. Combined with the fixpoint, this is why fragments can be rendered by the same
functions that render full pages without diverging from them.

## Reading emitted output in practice

- `vp build` writes the compiled modules; in dev they're compiled on demand and served under the
  versioned `/c/` namespace. Module URLs are immutable, and old versions stay published across deploys
  so long-lived documents never 404 on first interaction.
- The generated `registries.d.ts` is where declare-once typing comes from: handler modules, fragment
  targets, query update plans, and route/mutation registries all land as interface augmentations,
  which is why renames propagate as type errors instead of stale strings.
- `fw explain component <Name> graph.json` shows the compiler's view of any component — queries
  consumed, fragments targeted, handlers exported — without reading the emitted files at all. See
  [Reading fw check & fw explain](/guides/fw-explain/).

<details>
<summary>Spec & diagnostics</summary>

The TSX-to-`{server,client}.js` pipeline and the 1:1 mapping: SPEC §5.1, §5.2. Derived stamps
(`fw-deps`, `data-bind`, `fw-state`): SPEC §4.8; typed binding paths: SPEC §6.2; the mutation
fragment contract behind `fw-state`: SPEC §9.1. A hand-written stamp that drifts from the derivation
is **FW222**; one that duplicates it is **FW223** (SPEC §11.3). A handler reaching outside its allowed
capture channels (`ctx`, `data-p-*`, module scope) is **FW201** (SPEC §4.3). Source-derived,
unmanglable handler names: Constitution #1. Emitted output as authorable source, the `// @jiso-ir`
marker, the fixpoint (`assertFixpoint`), and ejection: Constitution #3, SPEC §5.2. Render equivalence
(`assertRenderEquivalence`): SPEC §5.2. Declare-once registry typing: SPEC §6.1. Immutable versioned
module URLs retained across deploys: SPEC §6.6.

</details>
