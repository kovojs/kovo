---
title: Static export
description: Decide when a route can ship as HTML plus immutable modules, and when it needs the request shell at runtime.
order: 5.1
---

# Static export

Use static export when a route can ship as HTML plus immutable modules and stay correct without a
runtime request shell. Kovo proves that by replaying synthetic GET `Request`s through the same
handler that serves the app dynamically, then writing HTML, immutable `/c/__v/*` modules, and static
assets. There is no parallel renderer and no hand-authored static variant.

## Exportable route shape

Export is for L0/L1 pages:

- Platform behavior, links, forms that submit as plain GETs, CSS, and static assets.
- Pure client islands whose state is local to the document.
- Parameterized routes only when `staticPaths` enumerates concrete paths.
- No requirement for server refetch after the document is published.

The exporter fails or skips loudly, according to policy, when a route has a guard, unproven session
dependence, mutation-only interaction, or an unenumerated param path. This page is the source of
truth for that static-export constraint; the deployment guide links back here instead of repeating
the diagnostic rules.

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

## Run the exporter

Use the CLI when you want a checked output directory from an app entry:

```sh
kovo export ./src/app.ts --out dist/static --origin https://example.com
```

If you own the build script, call `exportStaticApp` directly:

```ts
import '@kovojs/server/runtime-bootstrap';
import { exportStaticApp, type StaticExportOptions } from '@kovojs/server';
import app from './app.js';

const options: StaticExportOptions = {
  outDir: new URL('../dist/static/', import.meta.url),
  origin: 'https://example.com',
  onNonExportable: 'error',
};

await exportStaticApp(app, options);
```

Set `onNonExportable: 'skip'` only when the deploy intentionally mixes exported pages with server
routes. The skipped paths are still review evidence; do not hide them in a generic site script.

## Run it

Export one app, then inspect the output tree and the exporter report:

```sh
kovo export ./src/app.tsx --out dist/static --origin https://example.com
ls -R dist/static
```

You should see HTML files, static assets, and immutable `/c/__v/` modules only for the routes the
exporter proved safe to replay.

## Checks to run

For an app project, run the exporter itself in CI:

```sh
kovo export ./src/app.tsx --origin https://example.com
```

That command is the exportability gate. It exits non-zero when a route cannot be replayed faithfully
or when earlier app diagnostics already block the build. Add your own link checker only after the
export succeeds. Any third-party HTML link checker is fine; Kovo does not ship one for app projects.

## Handle failure

The main export failure is the one you should surface verbatim in CI:

```txt
ERROR KV229 Route "/account" is not exportable because it depends on request-time auth or session state.
```

If the build intentionally mixes exported pages with server routes, rerun with
`--skip-non-exportable` and review the skipped-path report as part of the deploy.

## Next

- [Deployment](/guides/deployment/) — runtime deploy skew and retention checks.
- [Request shell](/guides/request-shell/) — the handler static export replays.
- [Routing & navigation](/guides/routing/) — `staticPaths`, route guards, and KV229.

<details>
<summary>Spec & diagnostics</summary>

Static export through the request shell, L0/L1 limits, guarded/session-dependent route constraints,
param path enumeration, and KV229: SPEC §9.5. Prior immutable module retention and KV417:
SPEC §14. The MPA degradation contract: SPEC §8.

API reference: [@kovojs/server](/api/server/).

</details>
