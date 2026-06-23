---
title: '8. Wrap-up & deploy'
description: What you built, the invariants that now hold, and how it ships.
order: 8
---

# Wrap-up & deploy

Seven steps ago this was an empty directory. Now you have a commerce app that proves a set of
properties in CI:

- **Pages are complete documents** answered by typed routes; navigation is real navigation, and
  renaming a route path is a compile error at every consumer.
- **Interactivity is declared, not shipped.** The popover costs zero JavaScript; the island's
  handler is a named export the markup points at, loaded on first interaction.
- **Data is declared once.** Queries own their read sets; `kovo-deps` and `data-bind` are derived
  stamps; the page ships each query value exactly once.
- **Writes are schema-validated, transactional, CSRF-protected POSTs** whose no-JS form is the
  contract and whose enhanced wire is readable in the Network panel.
- **Invalidation is derived from declared touches**, optimism is exhaustiveness-checked per
  invalidated query, and the prediction is property-tested against the real handler.
- **The behavior surface is machine-checkable:** `kovo check` is green, `kovo explain` answers intent
  questions mechanically, observed writes are verified against declared touches, and the whole
  thing is pinned to the reference commerce app's committed graph.

No browser test exists anywhere in the tutorial.

## How this tutorial stays true

Every code block you read came from a checked-in step state under `site/tutorial/steps/`, and
`node site/tutorial/run-steps.mjs` gates all of them in CI: each step typechecks against the
workspace packages, every component compiles through `@kovojs/compiler` with zero errors plus the
fixpoint and render-equivalence asserts, committed lowered IR is checked for staleness, and every
step's tests run. An API change that breaks a chapter turns this tutorial red in the same PR.

### Parity with the reference app

The final step of [chapter 7](/tutorial/07-verification/#assert-parity-with-the-reference-app) does
one more thing: it pins the tutorial app to `examples/commerce`, the v1 acceptance target. The
parity test asserts the two apps agree on the things that matter — same mutation key and named POST,
same input fields and write set, same optimistic statuses per (mutation × query) pair, same fragment
wire and failure code — by comparing against `examples/commerce`'s on-demand graph artifact. The
mechanism is the point: because both apps reduce to a comparable graph value, "are these the same
behavior?" is a set comparison, not a manual audit. If the reference app changes shape, that test —
run by `run-steps.mjs` alongside every other step — turns this tutorial red in the same PR, so the
chapters can never silently drift from the framework they teach.

## Deploy a Kovo app

A Kovo app is a server-rendered MPA with a stateless v1 server: any Node host that can run the
request handler can run the app, and the emitted client modules under `/c/` are immutable,
versioned static assets. Old documents keep resolving their handler refs after a deploy, so a
still-open tab never 404s on first interaction. Static export covers content-shaped sites — this
documentation site is one, exported with no server. The full hosting matrix lives in the
[deployment guide](/guides/deployment/).

## Where to go next

- The [guides](/guides/) go deeper on each subsystem you touched — queries, mutations, optimistic
  updates, streaming, testing, styling, and reading `kovo check` output.
- [Compiler internals](/guides/compiler-internals/) is the home for "what does my TSX compile
  to", with real captured lowerings.
- The [specification](/spec/) is the normative source for every behavior this tutorial taught.
- `examples/commerce` in the repository is the full reference app — uploads, webhooks, i18n,
  and other app-owned raw integrations — built on the same patterns you now know.

<details>
<summary>Spec & diagnostics</summary>

Typed route paths and real navigation: SPEC §6.4, §8. Declared interactivity and lazy handlers:
SPEC §4.3, §7. Declare-once data and derived stamps: SPEC §4.8, §10.2. Schema-validated
transactional CSRF POSTs and readable wire: SPEC §6.3, §9.1. Derived invalidation, optimistic
exhaustiveness, property-tested predictions: SPEC §10.3–10.6. Machine-checkable behavior surface
and reference-app pinning: SPEC §11.2, SPEC §11.4, and `rules/v1-acceptance.md`. No browser test in the tutorial: `rules/v1-acceptance.md`.
`run-steps.mjs` gating and compile-output no-op: SPEC §5.2 rule 3. Artifact-is-the-documentation:
Constitution #4. Stateless v1 server and immutable versioned client modules: SPEC §9.3, §6.6.

</details>
