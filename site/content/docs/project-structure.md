---
title: Project structure
description: What's in a Jiso project and how the verification workflow fits your CI.
order: 3
---

# Project structure

A scaffolded Jiso project looks like this:

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

## The graph workflow

Jiso keeps application wiring auditable through one generated artifact: `graph.json`. It records
components, queries, mutations, pages, optimistic coverage, and the touch graph — the complete
"what updates what" of your app.

```sh
vp run emit-graph          # regenerate graph.json from the app
vp run fw-check            # framework semantic checks (FW310 optimistic coverage, audits…)
fw explain query cart graph.json
fw explain mutation cart/add --optimistic graph.json
fw explain --unguarded graph.json
```

`fw explain` output is stable and diffable by design (SPEC §11.4): when a product rule matters —
"every component that shows cart data must refresh when the cart changes" — you assert it in
`scripts/graph-assertions.mjs` and CI enforces it forever. The [fw check & fw explain
guide](/guides/fw-explain/) walks through the recipes.

## Styling

Tailwind is the default styling path (SPEC §13.1). The rule that matters: **class names must be
statically discoverable**. Keep them as literal strings in your templates, and safelist anything
dynamic with `@source inline("...")` in `styles.css` — server-rendered pages, mutation fragments,
and deferred streams all need their CSS present in the single generated stylesheet.

## Deployment shape

A Jiso app deploys as a stateless server (SPEC §9.3): mutation responses are ordinary HTML over
the wire, the server retains no session of what's on screen, and liveness comes from
BroadcastChannel tab sync plus refetch-on-focus — no Redis, no sticky sessions, no socket tier.
The [deployment guide](/guides/deployment/) covers the two real obligations: keeping versioned
`/c/*` client modules published across deploys (SPEC §6.6) and the stateless-server guarantee.
