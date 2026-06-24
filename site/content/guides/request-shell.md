---
title: Request shell
description: Configure createApp(), dispatch order, structured documents, adapters, error shells, and pre-dispatch load shedding.
order: 4.7
---

# Request shell

The request shell is the server-owned composition point. Your app exports a closed `createApp()`
aggregate; the shell turns it into a Web-standard `Request -> Response` handler, assembles documents,
serves framework endpoints, and runs guards before route/query/mutation code.

## The app aggregate

```ts
import { BodyEnd, Document, FontPreload, Head, InlineScript } from '@kovojs/server';

const appDocument = (
  <Document lang="en">
    <Head>
      <FontPreload href="/fonts/inter.woff2" />
      <InlineScript id="theme" run="beforePaint">
        {themeScript}
      </InlineScript>
    </Head>
    <BodyEnd>
      <SearchDialog />
    </BodyEnd>
  </Document>
);

export default createApp({
  routes,
  mutations,
  queries,
  endpoints,
  db: () => db,
  sessionProvider,
  csrf: { secret: process.env.CSRF_SECRET! },
  document: appDocument,
  errors: {
    notFound: NotFoundShell,
    forbidden: ForbiddenShell,
    unexpected: ErrorShell,
  },
  limits: {
    maxBodyBytes: 1_000_000,
    mutationRate: { perIp: 60, global: 2_000 },
    queryRate: { perIp: 300, global: 10_000 },
    maxFragmentTargets: 50,
  },
});
```

The generated route IR, live-target registry, and client-module registry are build artifacts wired
by the compiler integration. Do not point app config into `src/generated/*`; the authored app entry
is ordinary TSX/TS.

## Dispatch order

Dispatch is fixed and printable:

1. `/_m/<mutation-key>` mutation POSTs.
2. `/_q/<query-key>` typed reads.
3. `/c/__v/<version>/<module>` immutable client modules.
4. Declared `endpoint()` exact and prefix mounts.
5. The route table.
6. The 404 shell.

There is no user middleware chain in v1. Control-flow extension points are declared surfaces:
`sessionProvider`, guards, `endpoint()`, and `webhook()`. That is why `kovo explain --endpoints`,
`--unguarded`, and `--unscoped` can audit the app without executing a browser.

## Load shed before parsing

Because there is no middleware chain, the shell/adapter owns coarse pre-dispatch limits. They run
before replay lookup, schema parse/coercion, and guards:

- Request/body size over the configured maximum returns **413** before the body is read or parsed.
- Per-IP and global request budgets return **429** with `Retry-After`.
- A bound on reconstructed fragment targets prevents one response from asking the server to rebuild
  unbounded live targets.

Fine-grained `guards.rateLimit()` still belongs in the guard chain for per-principal policy. It
composes with shell limits; it does not replace them, especially for anonymous floods.

## Documents and error shells

The shell owns document assembly: doctype, `<html lang>`, route/query meta, stylesheets,
modulepreloads, optional Speculation Rules, initial `<kovo-query>` data before consumers, page body,
deferred stream close framing, and the inline loader. Apps add path-independent document facts with
structured primitives such as `Document`, `Head`, `FontPreload`, `InlineScript`, `InlineStyle`,
`BodyStart`, and `BodyEnd`.

`document.template` is not an app authoring surface. Full-document string templates cannot preserve
Kovo's framework-owned shell contracts safely enough for v1, so app document customization goes
through structured document primitives only. Scripts, styles, URLs, shell attributes, and body-end UI
stay visible to Kovo's document assembly and CSP accounting.

Unexpected-error shells are app configuration with safe defaults. Apps may provide 404, 403, and 500
documents. Unexpected failures still use no-internals bodies when no shell is supplied, and enhanced
mutation render failures use the typed render-error fragment path.

## Adapters

The handler currency is Web-standard `Request -> Response`. Adapters convert host-specific request
objects at the edge:

```ts
import { createServer } from 'node:http';
import { createRequestHandler, toNodeHandler } from '@kovojs/server';
import app from './app.js';

createServer(toNodeHandler(createRequestHandler(app))).listen(3000);
```

Edge, Node, and test adapters should preserve the same protocol fields: status, headers,
`Kovo-*` framework headers, `Location`, and body. App code should not branch on adapter-specific
objects inside route/query/mutation logic.

## Next

- [Deployment](/guides/deployment/) — serving the shell and retaining prior artifacts.
- [Endpoints & webhooks](/guides/endpoints-webhooks/) — raw machine ingress in the dispatch table.
- [Security & authorization](/guides/security/) — guards and audits over the shell surfaces.
- [Server API reference](/api/server/) — generated reference for `@kovojs/server`.

<details>
<summary>Spec & diagnostics</summary>

`createApp()` ownership, app options, generated artifacts, Web `Request -> Response` handler,
dispatch order, no middleware chain, document assembly, error shells, static export through the
handler, and pre-dispatch 413/429 limits: SPEC §9.5. Mutation lifecycle after pre-dispatch:
SPEC §10.3. Endpoint audit enrollment for the coarse limiter: SPEC §11.4.

</details>
