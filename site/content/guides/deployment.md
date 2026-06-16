---
title: Deployment
description: Run a stateless server, keep old client modules published across deploys, and know what "live" means without sockets.
order: 5
---

# Deployment

To ship a Kovo app you run a stateless app server (or, for sites without mutations, no server at
all), a database, and one thing most platforms leave implicit: you keep versioned client modules
available across deploys. This guide covers each piece, and what "live" means without a socket tier.

## The stateless server

The v1 server holds no state between requests. Concretely:

- **No session of what's on screen.** An enhanced mutation tells the server which fragments to render
  through the `Kovo-Targets` header, read off the live DOM's `kovo-deps` stamps at submit time. The
  server answers a self-contained question on every request.
- **No socket tier, no pub/sub.** v1 ships no SSE and no live bus. `<kovo-live>` over SSE is v2, added
  as a transport over the same fragment/query vocabulary, so adopting it later isn't a rearchitecture.
- **No optimistic state server-side.** Predictions live in the document and die with it.

Operationally, this means any instance can answer any request. Horizontal scaling is
load-balancer-plain: no sticky sessions, no Redis for UI state, no draining protocol beyond finishing
in-flight requests. Session data follows whatever your `sessionProvider` reads — a signed cookie, a
session table — while the framework itself pins nothing to an instance.

Two request-shaped facts worth knowing at the infrastructure layer:

- Mutations are `POST /_m/<name>` and queries are `GET /_q/<name>` — name-shaped paths you can rate
  limit, cache-exempt, and read in access logs.
- In-flight mutations at navigation use `keepalive`, and the framework registers no `unload`
  handlers, so bfcache hygiene is a guarantee rather than a tuning exercise.

## Retain `/c/*` module versions

This is the deployment mistake to design out first. Emitted module URLs are immutable and versioned,
and your serving layer has to retain prior versions — so an old document's `on:*` refs keep
resolving after a deploy, and the first interaction on a still-open tab never 404s.

Here's why it matters. Kovo documents are long-lived. A tab opened before your Tuesday deploy still
has HTML pointing at Tuesday-minus-one's handler modules:

```html
<button on:click="/c/cart.client.js?v=8f3a1c#Cart$removeItem">×</button>
```

The loader imports that URL on first interaction, which may be hours after the deploy that replaced
the module. If deploys delete old artifacts, the user's first click throws a 404 from inside a page
that looks perfectly healthy.

So the rule for your serving layer:

- **Publish `/c/*` artifacts additively.** New deploys add new versioned URLs; they never rewrite or
  delete the ones still referenced by documents in the wild.
- **Serve them immutable.** The version lives in the URL (cache-busting query strings or ETag-driven,
  a server-controlled choice), so `Cache-Control: public, max-age=31536000, immutable` is correct.
- **Age out by document lifetime, not deploy count.** Retain versions for as long as you believe a
  tab can stay open against your app; pruning is a cleanup policy, separate from the deploy.

A CDN or object store in front of `/c/*` makes this nearly free: deploys upload new versions and
touch nothing else.

The framework handles the other half of deploy skew. A long-lived document that POSTs yesterday's
form shape is answered by schema validation and the 422 path, never undefined behavior. You keep old
modules resolvable; the framework keeps old documents safe.

## What a deploy actually changes

It helps to see the two artifact classes a deploy touches and their opposite caching rules:

| Artifact              | URL stability          | Cache policy                             | On deploy                                    |
| --------------------- | ---------------------- | ---------------------------------------- | -------------------------------------------- |
| HTML documents        | stable paths (`/cart`) | revalidate (`no-store` on PRG responses) | replaced — next navigation gets the new page |
| `/c/*` client modules | versioned, immutable   | `immutable`, long max-age                | added — old versions retained                |

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

The `/c/*` retention rule applies to both shapes. On a static host it just means not deleting old
module files when you re-upload.

## Liveness without a socket tier

v1 ships liveness only where the server stays stateless:

- **BroadcastChannel rebroadcast** — a mutation's `<kovo-query>` response is rebroadcast to the user's
  other open tabs. Add to cart in tab A, and the badge in tab B ticks. Zero server cost, no
  infrastructure.
- **Refetch on focus/visibility** — the loader re-runs queries over the typed read endpoint
  (`GET /_q/…`) when a stale tab returns, with per-query opt-out. One conditional in the loader fakes
  a lot of "live" UX.

Both arrive with the loader, so there's nothing to deploy for them. What v1 deliberately doesn't
cover: another user's write appearing in your open tab without a refetch trigger. That's L4 —
SSE-pushed fragments with guards re-checked at every push — and it lands in v2 with the first
genuinely stateful infrastructure in the design. Don't provision for it now.

## Pre-deploy gates

The verification surface is browser-free by design, so the full behavioral gate runs in ordinary CI
ahead of any deploy:

```sh
vp check                  # typecheck + lint — wiring proofs (handlers, forms, links, bindings)
vp test                   # vitest suites, including wire-level and pglite-backed tests
vp run build              # production build
vp run kovo-check           # graph checks: KV310 optimistic coverage, KV311 update coverage, audits
vp run graph-assertions   # your app's behavior rules, as graph queries
```

The starter's CI workflow runs exactly this list. If a deploy passes these, the things that usually
need a staging click-through — does this button do anything, does that mutation refresh the badge —
are already proven. See [reading kovo check & kovo explain](/guides/kovo-explain/).

## Checklist

- [ ] App server is stateless; no instance affinity configured anywhere.
- [ ] `/c/*` published additively, served immutable, retained across deploys.
- [ ] HTML responses are not cached as immutable (documents change per deploy; modules don't).
- [ ] 103 Early Hints / preload wired from `renderPageHints` output if your edge supports it.
- [ ] Speculation Rules prefetch only on routes that opted in — it is per-route, default off.
- [ ] CI runs `vp check`, `vp test`, `vp run kovo-check`, and graph assertions before deploy.

## Next

- [Reading kovo check & kovo explain](/guides/kovo-explain/) — the gates in that checklist.
- [Streaming & defer](/guides/streaming/) — response streaming and what it needs from the edge.

<details>
<summary>Spec & diagnostics</summary>

The stateless-server guarantee and liveness without sockets: SPEC §9.3. `Kovo-Targets` and the
mutation round-trip: SPEC §9.1. Session providers: SPEC §6.5. The typed read endpoint: SPEC §9.4.
`keepalive` and bfcache hygiene, plus per-route Speculation Rules: SPEC §8. Immutable versioned
module URLs and the retention rule, plus deploy-skew handling: SPEC §6.6. Schema-validated old-form
recovery via the 422 path: SPEC §9.2. The request lifecycle: SPEC §10.3. Browser-free pre-deploy
gates: SPEC §11.4.

</details>
