---
title: Static export
description: Decide when a route can ship as HTML plus immutable modules, and when it needs the request shell at runtime.
order: 5.1
---

# Static export

Static export is Kovo's request shell replayed at build time. The exporter sends synthetic GET
`Request`s through the same handler that serves the app dynamically, then writes HTML, immutable
`/c/__v/*` modules, and static assets. There is no parallel renderer and no hand-authored static
variant.

## Exportable route shape

Export is for L0/L1 pages:

- Platform behavior, links, forms that submit as plain GETs, CSS, and static assets.
- Pure client islands whose state is local to the document.
- Parameterized routes only when `staticPaths` enumerates concrete paths.
- No requirement for server refetch after the document is published.

The exporter fails or skips loudly, according to policy, when a route has a guard, unproven session
dependence, mutation-only interaction, or an unenumerated param path. That is **KV229**.

## When to keep a server

Use a dynamic request shell for:

- Mutations and no-JS POST-redirect-GET.
- Guarded or session-dependent routes and queries.
- Typed `/_q/` reads, refetch-on-focus, async option/search reads, or live subscriptions.
- Raw `endpoint()` / `webhook()` ingress.
- Parameterized routes whose path set is not known at build time.

An exported document is the artifact. It should not depend on a future server refetch for correctness.

## Deploying exported output

Static output still contains versioned client modules. Upload new `/c/__v/*` files additively and
retain prior versions for at least 24 hours, the same deploy-skew floor dynamic apps obey. If a
platform deletes old module files on every deploy, change that behavior before shipping.

Because there is no runtime typed-read surface for exported pages, prefer static export for pages
whose client truth is document-local. A page that needs prior-token `/_q/` recovery after deploy is a
server page, not a pure static page.

## Checks to run

The site export path exercises the same route data as the Kovo app:

```sh
pnpm --filter @kovojs/site run build
pnpm --filter @kovojs/site run check:links
pnpm --filter @kovojs/site run smoke:navigation
```

For app projects, pair static export with the graph checks from [Testing with @kovojs/test](/guides/testing/)
and [Reading kovo check & kovo explain](/guides/kovo-explain/). If a route cannot be replayed
faithfully, keep it on the server path.

## Next

- [Deployment](/guides/deployment/) — runtime deploy skew and retention checks.
- [Request shell](/guides/request-shell/) — the handler static export replays.
- [Routing & navigation](/guides/routing/) — `staticPaths`, route guards, and KV229.

<details>
<summary>Spec & diagnostics</summary>

Static export through the request shell, L0/L1 limits, guarded/session-dependent route constraints,
param path enumeration, and KV229: SPEC §9.5. Prior immutable module retention and KV417:
SPEC §14. The MPA degradation contract: SPEC §8.

</details>
