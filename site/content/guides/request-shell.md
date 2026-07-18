---
title: Request shell
description: Configure createApp(), dispatch order, structured documents, adapters, error shells, and pre-dispatch load shedding.
order: 4.7
---

# Request shell

Your app needs one exported server value that knows its routes, mutations, queries, document shell,
database, and session provider. `createApp()` is that value; the request shell turns it into a
Web-standard `Request -> Response` handler, assembles documents, serves framework endpoints, and
runs guards before route/query/mutation code.

## Create the app aggregate

Start with the surfaces the app serves:

```ts
export default createApp({
  routes,
  mutations,
  queries,
  db: () => db,
});
```

Then add the document, session, error, and limit policy around that core:

```text
import { BodyEnd, Document, FontPreload, Head, InlineScript } from '@kovojs/server';

import { appCsrf, appSessionProvider } from './auth.js';
import { appRuntimeDbProvider } from './_kovo/app-runtime-db.js';

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
  db: appRuntimeDbProvider,
  sessionProvider: appSessionProvider,
  csrf: appCsrf,
  document: appDocument,
  errorShells: {
    notFound: NotFoundShell,
    forbidden: ForbiddenShell,
    serverError: ErrorShell,
  },
  requestLimits: {
    maxBodyBytes: 1_000_000,
    mutations: {
      perIp: { max: 60, windowMs: 60_000 },
      global: { max: 2_000, windowMs: 60_000 },
    },
    queries: {
      perIp: { max: 300, windowMs: 60_000 },
      global: { max: 10_000, windowMs: 60_000 },
    },
    maxQueryListItems: 500,
  },
});
```

The generated route IR, live-target registry, and client-module registry are build artifacts wired
by the compiler integration. Do not point app config into `src/generated/*`; the authored app entry
is ordinary TSX/TS.

## Run it

Start the app and hit one route from each dispatch tier:

```sh
curl -i http://localhost:3000/_q/cart
curl -i http://localhost:3000/c/__v/dev/cart-badge.client.js
curl -i http://localhost:3000/cart
```

The point is to see the shell's fixed dispatch order in real responses: typed reads under `/_q/`,
immutable client modules under `/c/__v/`, then the route table for document requests.

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
- A request target over 65,536 characters, or with more than 10,000 query entries, returns **414**
  before Kovo constructs `URL` or `URLSearchParams`.
- Per-IP and global request budgets return **429** with `Retry-After`.
- A bound on query/list result size prevents one response from shipping an unbounded list payload.

These budgets stay on. `false` is not a valid body or rate-limit setting. You can raise a budget for
an audited surface, but each option has a hard finite maximum so a config typo cannot turn the shell
into an unbounded parser or in-memory key store.

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
objects at the edge. Define the host-independent handler first:

```ts
// handler.ts
import { createRequestHandler } from '@kovojs/server';
import app from './app.js';

export const handler = createRequestHandler(app);
```

Keep raw host authority in a separate adapter entry:

```ts
// server.ts
import '@kovojs/server/runtime-bootstrap';

import { createServer } from 'node:http';
import { toNodeHandler } from '@kovojs/server';
import { handler } from './handler.js';

createServer(toNodeHandler(handler)).listen(3000);
```

For a custom adapter entry, keep `@kovojs/server/runtime-bootstrap` as the literal first import so
request-reachable package code cannot replace classifier-reviewed globals before dispatch starts.
Keep `createRequestHandler(app)` in the separate handler module; this leaves the adapter's raw
`node:http` listener outside the request-reachable module graph while the handler and app graphs
remain capability-closed.
Generated Kovo runners apply this bootstrap for you. The dispatch refusal detects omission, not the
history of a mutable JavaScript realm: a bootstrap imported after app/package evaluation cannot
repair that ordering and is outside the supported custom-runner contract.

Edge, Node, and test adapters should preserve the same protocol fields: status, headers,
`Kovo-*` framework headers, `Location`, and body. App code should not branch on adapter-specific
objects inside route/query/mutation logic.

## Next

- [Error handling](/guides/error-handling/) — decide which failures stay local and which change the whole shell.
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

API reference: [@kovojs/server](/api/server/).

</details>
