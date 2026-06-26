---
title: Deployment
description: Run a stateless server, keep old modules and typed reads available across deploys, and choose the right liveness posture.
order: 5
---

# Deployment

To ship a Kovo app, pick the smallest deploy shape that matches the app: a static host for L0/L1
pages, or a stateless server for mutations, guarded routes, typed reads, and per-request data. In
both shapes, keep versioned client modules available across deploys.

## The stateless server

The v1 server holds no state between requests. Concretely:

- **No session of what's on screen.** An enhanced mutation tells the server which fragments to render
  through the `Kovo-Targets` header, read off the live DOM's `kovo-deps` stamps at submit time. The
  server answers a self-contained question on every request.
- **Preview liveness stays stateless.** Ordinary mutation refreshes, refetch-on-focus, and
  BroadcastChannel tab sync need no instance affinity. SSE live queries are roadmap, not part of the
  technical preview.
- **No optimistic state server-side.** Predictions live in the document and die with it.

Operationally, this means any instance can answer ordinary routes, mutations, and typed reads. You
do not need sticky sessions. Session data follows whatever your `sessionProvider` reads — a signed
cookie, a session table — while the framework itself pins no UI state to an instance.

Two request-shaped facts worth knowing at the infrastructure layer:

- Mutations are `POST /_m/<name>` and queries are `GET /_q/<name>` — name-shaped paths you can rate
  limit, cache-exempt, and read in access logs.
- In-flight mutations at navigation use `keepalive`, and the framework registers no `unload`
  handlers, so bfcache hygiene is a guarantee rather than a tuning exercise.

## Retain prior build artifacts and reads

This is the deployment mistake to design out first. Emitted module URLs are immutable and versioned,
and your serving layer has to retain prior versions. The same deploy-skew contract covers typed
read endpoints: a stale document must be able to ask `/_q/<key>` for a token-tagged full value for
the build it was rendered with. That is how token mismatch recovery stays loud and recoverable
instead of silently merging a foreign query shape.

Here's why it matters. Kovo documents are long-lived. A tab opened before your Tuesday deploy still
has HTML pointing at Tuesday-minus-one's handler modules:

```html
<button on:click="/c/__v/8f3a1c/cart.client.js#Cart$removeItem">×</button>
```

The loader imports that URL on first interaction, which may be hours after the deploy that replaced
the module. If deploys delete old artifacts, the user's first click throws a 404 from inside a page
that looks perfectly healthy.

So the rule for your serving layer:

- **Publish `/c/*` artifacts additively.** New deploys add new versioned URLs; they never rewrite or
  delete the ones still referenced by documents in the wild.
- **Serve them immutable.** The version lives in the URL (cache-busting query strings or ETag-driven,
  a server-controlled choice), so `Cache-Control: public, max-age=31536000, immutable` is correct.
- **Keep the required skew window.** Retain prior immutable modules and prior-token `/_q/` reads for
  the supported deploy-skew window, with a required minimum of 24 hours. Configuring less, or using a
  platform that cannot retain both artifact classes for that window, is **KV417**.

A CDN or object store in front of `/c/*` makes this nearly free: deploys upload new versions and
touch nothing else.

The framework handles the merge decision. Every page render, mutation truth chunk, delta, and typed
read response carries the render-plan version token. If a stale document receives a mismatched
payload, the loader discards it, refetches the full query over `/_q/<key>`, and reloads the current
route if the refetch still belongs to a different token. A long-lived document that POSTs yesterday's
form shape is answered by schema validation and the 422 path, never undefined behavior.

## What a deploy actually changes

It helps to see the two artifact classes a deploy touches and their opposite caching rules:

| Artifact              | URL stability          | Cache policy                             | On deploy                                    |
| --------------------- | ---------------------- | ---------------------------------------- | -------------------------------------------- |
| HTML documents        | stable paths (`/cart`) | revalidate (`no-store` on PRG responses) | replaced — next navigation gets the new page |
| `/c/*` client modules | versioned, immutable   | `immutable`, long max-age                | added — old versions retained                |
| `/_q/*` typed reads   | stable typed endpoint  | private/no-store when session-dependent  | serves current and in-window prior tokens    |

Documents update by navigation; modules update by being referenced from newer documents. A tab that
never navigates keeps working against its original module set indefinitely — which is the point of the
retention rule. It also makes rollbacks boring: rolling back re-publishes a previous document set
whose module URLs are still being served, because you never deleted them.

## Static host or node server

Which shape you deploy depends on what the app does.

**A node server** is the normal shape for anything with mutations, guarded routes, or parameterized
queries — the request lifecycle (CSRF, replay, guards, transactions, post-commit query reruns) runs
server-side. It's stateless, so you can run two of them behind a load balancer from day one.

**A static export** is enough when the site is L0/L1 only: platform behaviors and client islands, no
mutations, no per-request rendering. The export is plain HTML plus the loader plus `/c/*` modules,
deployable to any static host. This docs site is exactly that — every page works with JS disabled,
and the search island's module loads on first use. The degradation contract holds either way: Safari,
Firefox, and no-JS visitors get a working website rather than a blank screen.

The 24-hour `/c/*` retention floor applies to both shapes. On a static host it means not deleting old
module files during the skew window when you re-upload.

### Static export decision tree

Static export replays synthetic GET `Request`s through the same request handler; there is no second
render path. Use it when every exported route is L0/L1: platform behavior, pure islands, static
assets, and no per-request server truth.

Use a server deploy instead when the app needs mutations, guarded routes, parameterized queries
without an enumerable path set, raw endpoints, webhooks, typed reads, or per-request data. Exported
documents should not assume server refetches will exist later; the no-JS HTML document is the
artifact. The detailed static-export constraints and diagnostic ownership live in
[Static export](/guides/static-export/).

### A node-server entrypoint

The server is the `createApp()` aggregate (SPEC §9.3): your routes, mutations, queries, the `db`
provider, and the §6.5 `sessionProvider`. `toNodeHandler()` adapts its Web-standard `Request ->
Response` handler to a `node:http` listener, so the entrypoint is small:

```ts
// server.ts — production entrypoint
import { createServer } from 'node:http';
import { createApp, createRequestHandler, toNodeHandler } from '@kovojs/server';

import { routes, mutations, queries } from './app.js';
import { connectDb } from './db.js';
import { sessionProvider } from './session.js';

const db = await connectDb(process.env.DATABASE_URL!);

const app = createApp({
  db: () => db,
  routes,
  mutations,
  queries,
  // Runs once before route/query/mutation guards; return null for anonymous (SPEC §6.5).
  sessionProvider,
  csrf: { secret: process.env.BETTER_AUTH_SECRET ?? process.env.KOVO_CSRF_SECRET! },
});

const handler = toNodeHandler(createRequestHandler(app), { earlyHints: true });
const port = Number(process.env.PORT ?? 3000);
createServer(handler).listen(port, () => console.log(`listening on :${port}`));
```

The instance pins nothing per-request: `sessionProvider` reads whatever your auth layer stored (a
signed cookie, a session row), so any instance answers any request and you scale by adding instances.

A minimal container, with `/c/*` artifacts baked into the image so they're served immutably:

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY dist ./dist           # output of `vp build`, including /c/* client modules
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

The container needs database and auth secrets from the environment. None of these is
instance-specific — the same image runs behind a load balancer unchanged.

| Variable                           | Owner              | Required when                                                                        |
| ---------------------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `DATABASE_URL`                     | Your `db` provider | The app opens a remote database connection.                                          |
| `KOVO_CSRF_SECRET`                 | Kovo CSRF          | Always set for deployed mutation forms.                                              |
| `BETTER_AUTH_SECRET`               | Better Auth        | Set when using Better Auth; the scaffold also accepts it as the CSRF HMAC secret.    |
| `BETTER_AUTH_URL`                  | Better Auth        | Set when the public origin is not `http://localhost:5173`.                           |
| `PORT`                             | Node preset        | Optional; defaults to `3000`.                                                        |
| `HOST`                             | Node preset        | Optional; defaults to `0.0.0.0` in emitted Node servers.                             |
| `NODE_ENV`                         | Runtime posture    | Set to `production` for secure-cookie and boot-secret floors.                        |
| `KOVO_PRESET`                      | `kovo build`       | Optional override: `node`, `vercel`, or `cloudflare`.                                |
| `VERCEL`, `CLOUDFLARE`, `CF_PAGES` | Host detection     | Read by `kovo build` when no preset is configured.                                   |
| `KOVO_SQL_GUARD`                   | Raw SQL migration  | Temporary fail-open escape for unmanaged raw SQL sinks; managed sinks still enforce. |

`KOVO_CSRF_SECRET` is the scaffold's local-development name. The generated auth adapter reads
`BETTER_AUTH_SECRET ?? KOVO_CSRF_SECRET`, so one strong deployment secret can back both Better Auth
and Kovo's CSRF HMAC, or you can split them by wiring separate values in your app config.

## Liveness in the technical preview

Kovo has three shipped liveness paths, each with a different operational cost:

- **BroadcastChannel rebroadcast** — a mutation's `<kovo-query>` response is rebroadcast to the user's
  other open tabs. Add to cart in tab A, and the badge in tab B ticks. Zero server cost, no
  infrastructure. Envelopes carry a principal fingerprint so another user on the same origin cannot
  receive private query data after an account switch.
- **Refetch on focus/visibility** — the loader re-runs queries over the typed read endpoint
  (`GET /_q/…`) when a stale tab returns, with per-query opt-out. One conditional in the loader fakes
  a lot of live UX.
- **Enhanced mutation responses** — the submitting tab gets server truth in the POST response, using
  the same `<kovo-query>` / `<kovo-fragment>` vocabulary that powers later refreshes.

SSE live queries are roadmap, not part of the technical preview. Do not deploy `live: true`,
`<kovo-live>`, `createApp({ live })`, or live emitters in preview apps. See
[Live queries](/guides/live-queries/) for the shipped paths and the roadmap caveat.

## Observe the request shell

The app server gives operators two stable handles before you add product-specific metrics:
name-shaped framework paths and the `onError` hook.

Access logs can group by endpoint without parsing a framework envelope:

- `POST /_m/<mutation-key>` — mutation submissions, including no-JS form posts.
- `GET /_q/<query-key>` — typed reads, refetch-on-focus, and stale-tab recovery.
- `/c/__v/<version>/<module>` — immutable client modules.
- Declared `endpoint()` and `webhook()` paths — raw machine ingress.

Use `createApp({ onError })` for runtime exceptions from the request shell. It receives the thrown
error plus a `ServerErrorDiagnosticContext` with the failing operation and any known route,
mutation, query, target, status, URL, or request identity. The hook is diagnostic only: errors thrown
inside it are swallowed, and it cannot change Kovo's stable 403/404/500 responses.

```ts
import { createApp } from '@kovojs/server';

export default createApp({
  routes,
  mutations,
  queries,
  onError(error, context) {
    console.error('kovo request failed', { error, ...context });
  },
});
```

Keep build-time and runtime signals separate. `vp check`, `kovo check`, `kovo explain`, and the
source/sink audits answer "what can this app do?" before deploy. `onError`, access logs, and rate
limit counters answer "what happened in production?" after deploy.

## Pre-deploy gates

The verification surface is browser-free by design, so the full behavioral gate runs in ordinary CI
ahead of any deploy:

```sh
vp check                  # vp toolchain: typecheck + lint — wiring proofs (handlers, forms, links, bindings)
vp test                   # vp toolchain: vitest suites, including wire-level and pglite-backed tests
vp build                  # vp toolchain: production build
vp run kovo-check         # runs the framework's `kovo check`: KV310 optimistic coverage, KV311 update coverage, audits
vp run graph-assertions   # runs your app's graph-query behavior rules
```

`vp check` and `vp build` are the toolchain's own commands (typecheck/lint and bundle); they are
distinct from the framework's `kovo check`, which runs the graph/coverage gates and is invoked here
through the `kovo-check` npm script via `vp run`. The starter's CI workflow runs exactly this list. If a deploy passes these, the things that usually
need a staging click-through — does this button do anything, does that mutation refresh the badge —
are already proven. See [reading kovo check & kovo explain](/guides/kovo-explain/).

## Checklist

- [ ] App server is stateless; no instance affinity configured anywhere.
- [ ] `/c/*` published additively, served immutable, retained across deploys.
- [ ] HTML responses are not cached as immutable (documents change per deploy; modules don't).
- [ ] 103 Early Hints / preload wired from route page hints if your edge supports it.
- [ ] Speculation Rules prefetch only on routes that opted in — it is per-route, default off.
- [ ] CI runs `vp check`, `vp test`, `vp build`, `vp run kovo-check` (the framework's `kovo check`),
      and graph assertions before deploy.

## Next

- [Reading kovo check & kovo explain](/guides/kovo-explain/) — the gates in that checklist.
- [Live queries](/guides/live-queries/) — shipped liveness paths and the roadmap SSE caveat.
- [Static export](/guides/static-export/) — deciding whether a route can ship without a server.
- [Streaming & defer](/guides/streaming/) — response streaming and what it needs from the edge.

<details>
<summary>Spec & diagnostics</summary>

The stateless-server guarantee, BroadcastChannel, and refetch-on-focus: SPEC §9.3. `Kovo-Targets`
and the mutation round-trip: SPEC §9.1. Session providers: SPEC §6.5. The typed read endpoint:
SPEC §9.4.
`keepalive` and bfcache hygiene, plus per-route Speculation Rules: SPEC §8. Immutable versioned
module URLs, prior-token typed reads, the 24-hour retention floor, and deploy-skew recovery:
SPEC §6.6 and §14. Static export through the request shell: SPEC §9.5; see
[Static export](/guides/static-export/) for exportability diagnostics. Schema-validated old-form
recovery via the 422 path: SPEC §9.2. The request lifecycle: SPEC §10.3. Browser-free pre-deploy
gates: SPEC §11.4. `createApp({ onError })` and `ServerErrorDiagnosticContext` report
request-shell runtime failures without changing stable error responses: SPEC §9.2. KV417 reports a
serving layer that cannot meet the skew-retention floor.

</details>
