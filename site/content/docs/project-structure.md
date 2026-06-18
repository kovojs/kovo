---
title: Project structure
description: Tour the files in a scaffolded project and see how the graph-verification workflow plugs into your CI.
order: 5
---

# Project structure

A scaffolded Kovo project is small enough to hold in your head. Here is the whole thing:

```
my-app/
├── index.html              # document shell
├── src/
│   ├── app.ts              # routes + page assembly (the app entry)
│   ├── styles.css          # document CSS: fonts, tokens, page chrome
│   └── theme.ts            # typed style tokens / theme
├── scripts/
│   ├── emit-graph.mjs      # emits graph.json from app facts
│   └── graph-assertions.mjs# your behavior assertions, as graph queries
├── graph.json              # the app's behavior graph (generated)
├── vite.config.ts          # Vite+ config: dev, build, run tasks
└── .github/workflows/ci.yml
```

Most of it is what you'd expect. The part that isn't is `graph.json`.

## What the tutorial adds

The scaffold above is the bare floor. As you work through the [Tutorial](/tutorial/) — and as the
[reference `examples/commerce`](https://github.com/kovojs/kovo/tree/main/examples/commerce) app
shows — a real project grows a small, conventional set of files. Each concept lives in its own
module so the declare-once facts stay easy to find:

```
src/
├── app.ts                  # routes, page assembly, the app graph value
├── domains.ts              # named data domains (invalidation currency)
├── db.ts                   # the data store / per-request database
├── queries.ts              # typed reads (load + read sets)
├── registries.ts           # invalidation/optimistic registry interfaces
├── components/             # one file per component (cart-badge.tsx, …)
└── generated/              # compiler artifacts: lowered .tsx, .client.js, graph.json
```

`src/generated/` holds compiler output — lowered component IR, named client-handler modules, and
the emitted `graph.json`. You don't hand-author these (SPEC §5.2 makes hand-written lowered IR
**KV235**); you read them to verify, and they recompile to a no-op. The tutorial inlines a few of
these facts (registries, the graph value) so the mechanism stays visible; a production project
commits the generated files so graph changes show up as reviewable diffs.

## The graph workflow

Kovo keeps application wiring auditable through one generated artifact: `graph.json`. It records
components, queries, mutations, pages, optimistic coverage, and the touch graph — the derived map
of which writes refresh which queries, the complete "what updates what" of your app.

```sh
vp run emit-graph          # regenerate graph.json from the app
vp run kovo-check            # framework semantic checks (KV310 optimistic coverage, audits…)
kovo explain query cart graph.json
kovo explain mutation cart/add --optimistic graph.json
kovo explain --unguarded graph.json
```

`kovo explain` output is stable and diffable by design. When a product rule matters — "every
component that shows cart data must refresh when the cart changes" — you assert it in
`scripts/graph-assertions.mjs` and CI enforces it from then on. The [kovo check & kovo explain
guide](/guides/kovo-explain/) walks through the recipes. SPEC §11.4

## Styling

StyleX is the default component styling path. Author typed `@kovojs/style` objects in TSX, use
plain document CSS for fonts, page chrome, and theme tokens, and declare stylesheet hints for every
page, mutation fragment, and deferred stream so late HTML arrives styled. SPEC §13.1

## Deployment shape

A Kovo app deploys as a stateless server: mutation responses are ordinary HTML over the wire, the
server keeps no record of what's on screen, and liveness comes from BroadcastChannel tab sync
plus refetch-on-focus — no Redis, no sticky sessions, no socket tier. SPEC §9.3

The [deployment guide](/guides/deployment/) covers the two real obligations: keeping versioned
`/c/*` client modules published across deploys, and not breaking the stateless-server guarantee.
SPEC §6.6
