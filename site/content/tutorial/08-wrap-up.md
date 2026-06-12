---
title: '8. Wrap-up & deploy'
description: What you built, the invariants that now hold, and how it ships.
order: 8
---

# Wrap-up & deploy

Seven steps ago this was an empty directory. Now you have a commerce app with an inventory of
properties most apps assert in prose — and yours proves in CI:

- **Pages are complete documents** answered by typed routes; navigation is real navigation, and
  renaming a route path is a compile error at every consumer (SPEC §6.4, §8).
- **Interactivity is declared, not shipped.** The popover costs zero JavaScript; the island's
  handler is a named export the markup points at, loaded on first interaction (SPEC §4.3, §7).
- **Data is declared once.** Queries own their read sets; `fw-deps` and `data-bind` are derived
  stamps; the page ships each query value exactly once (SPEC §4.8, §10.2).
- **Writes are schema-validated, transactional, CSRF-protected POSTs** whose no-JS form is the
  contract and whose enhanced wire is readable in the Network panel (SPEC §6.3, §9.1).
- **Invalidation is derived from declared touches**, optimism is exhaustiveness-checked per
  invalidated query, and the prediction is property-tested against the real handler
  (SPEC §10.3–10.6).
- **The behavior surface is machine-checkable**: `fw check` is green, `fw explain` answers
  intent questions mechanically, observed writes are verified against declared touches, and the
  whole thing is pinned to the reference commerce app's committed graph (SPEC §11.2, §11.4, §16).

No browser test exists anywhere in the tutorial — that is SPEC §16.3, experienced first-hand.

## How this tutorial stays true

Remember the chapter 1 promise that these code blocks can't lie? Here is the machinery behind
it. Every step state lives in the repository under `site/tutorial/steps/`, and
`node site/tutorial/run-steps.mjs` gates all of them in CI: each step typechecks against the
workspace packages, every component compiles through `@jiso/compiler` with zero errors plus the
fixpoint and render-equivalence asserts (SPEC §5.2 rule 3 — compiling the output is a no-op),
committed lowered IR is checked for staleness, and every step's tests run. An API change that
breaks a chapter turns this tutorial red in the same PR — the docs equivalent of
Constitution #4: the artifact is the documentation.

## Deploying a jiso app

A Jiso app is a server-rendered MPA with a stateless v1 server (SPEC §9.3): any Node host that
can run the request handler can run the app, and the emitted client modules under `/c/` are
immutable, versioned static assets — old documents keep resolving their handler refs after a
deploy, so a still-open tab never 404s on first interaction (SPEC §6.6). Static export covers
content-shaped sites (this documentation site is one — exported, no server); the full hosting
matrix lives in the [deployment guide](/guides/deployment/).

## Where to go next

- The [guides](/guides/) go deeper on each subsystem you touched — queries, mutations,
  optimistic updates, streaming, testing, styling, and reading `fw check` output.
- [Compiler internals](/guides/compiler-internals/) is the sanctioned home for "what does my
  TSX compile to", with real captured lowerings.
- The [specification](/spec/) is the normative source for every behavior this tutorial taught;
  the § citations throughout link straight into it.
- `examples/commerce` in the repository is the full reference app — uploads, webhooks, CSV
  export, i18n — built on exactly the patterns you now know.
