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
│   ├── app.tsx             # components (JSX → compiled IR)
│   ├── client.ts           # loader installation
│   └── styles.css          # Tailwind entry (+ @source rules)
├── scripts/
│   ├── emit-graph.mjs      # emits graph.json from app facts
│   └── graph-assertions.mjs# your behavior assertions, as graph queries
├── graph.json              # the app's behavior graph (generated)
├── vite.config.ts          # Vite+ config: dev, build, run tasks
└── .github/workflows/ci.yml
```

Most of it is what you'd expect. The part that isn't is `graph.json`.

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

Tailwind is the default styling path. The one rule that matters: **class names must be
statically discoverable**. Keep them as literal strings in your templates, and safelist anything
dynamic with `@source inline("...")` in `styles.css` — server-rendered pages, mutation fragments,
and deferred streams all need their CSS present in the single generated stylesheet. SPEC §13.1

## Deployment shape

A Kovo app deploys as a stateless server: mutation responses are ordinary HTML over the wire, the
server keeps no record of what's on screen, and liveness comes from BroadcastChannel tab sync
plus refetch-on-focus — no Redis, no sticky sessions, no socket tier. SPEC §9.3

The [deployment guide](/guides/deployment/) covers the two real obligations: keeping versioned
`/c/*` client modules published across deploys, and not breaking the stateless-server guarantee.
SPEC §6.6
