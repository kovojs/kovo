---
title: Deployment
description: The stateless-server guarantee, versioned /c/* module retention across deploys, and v1 liveness.
order: 5
---

# Deployment

A Jiso v1 deployment has unusually little moving machinery: a stateless app server (or, for
sites without mutations, no server at all), a database, and one real obligation most platforms
don't make explicit — keeping versioned client modules available across deploys. This guide
covers each, plus what "live" means without a socket tier.

## The stateless-server guarantee

The v1 server is stateless, full stop (SPEC §9.3). Concretely:

- **No session of what's on screen.** An enhanced mutation tells the server which fragments to
  render via the `FW-Targets` header, read off the live DOM's `fw-deps` stamps at submit time.
  The server answers a self-contained question on every request (SPEC §9.1).
- **No socket tier, no pub/sub.** v1 ships no SSE and no live bus; `<fw-live>` over SSE is v2,
  designed as an additive transport over the same fragment/query vocabulary — adopting it later
  is not a rearchitecture (SPEC §9.3).
- **No optimistic state server-side.** Predictions live in the document and die with it
  (SPEC §10.4).

What this buys you operationally: any instance can answer any request, so horizontal scaling is
load-balancer-plain — no sticky sessions, no Redis for UI state, no draining protocol beyond
finishing in-flight requests. Session *data* follows whatever your `sessionProvider` reads
(a signed cookie, a session table); the framework itself pins nothing to an instance (SPEC §6.5).

Two request-shaped consequences worth knowing at the infrastructure layer:

- Mutations are `POST /_m/<name>`, queries are `GET /_q/<name>` — name-shaped paths you can rate
  limit, cache-exempt, and read in access logs (SPEC §9.1, §9.4).
- In-flight mutations at navigation use `keepalive`, and the framework registers no `unload`
  handlers — bfcache hygiene is a guarantee, not a tuning exercise (SPEC §8).

## The one real obligation: retain `/c/*` module versions

This is normative, and it is the deployment mistake to design out first (SPEC §6.6):

> Emitted module URLs are immutable and versioned, and the serving layer retains prior versions —
> an old document's `on:*` refs keep resolving after a deploy; first interaction on a still-open
> tab never 404s.

Why it exists: Jiso documents are long-lived. A tab opened before your Tuesday deploy still has
HTML pointing at Tuesday-minus-one's handler modules:

```html
<button on:click="/c/cart.client.js?v=8f3a1c#Cart$removeItem">×</button>
```

The loader imports that URL on *first interaction* — which may be hours after the deploy that
replaced the module. If deploys delete old artifacts, the user's first click throws a 404 from
inside a page that looks perfectly healthy.

So the rule for your serving layer:

- **Publish `/c/*` artifacts additively.** New deploys add new versioned URLs; they never rewrite
  or delete the ones still referenced by documents in the wild.
- **Serve them immutable.** The version lives in the URL (cache-busting query strings or
  ETag-driven — a server-controlled choice, SPEC §5.2), so
  `Cache-Control: public, max-age=31536000, immutable` is correct.
- **Age out by document lifetime, not deploy count.** Retain versions for as long as you believe
  a tab can stay open against your app; pruning is a cleanup policy, not part of the deploy.

A CDN or object store in front of `/c/*` makes this nearly free: deploys upload new versions and
touch nothing else.

The other half of deploy skew is handled for you: a long-lived document POSTing yesterday's form
shape is answered by schema validation and the 422 path — never undefined behavior (SPEC §6.6,
§9.2). You keep old modules resolvable; the framework keeps old documents safe.

## What a deploy actually changes

It helps to see the two artifact classes a deploy touches and their opposite caching rules:

| Artifact | URL stability | Cache policy | On deploy |
| --- | --- | --- | --- |
| HTML documents | stable paths (`/cart`) | revalidate (`no-store` on PRG responses) | replaced — next navigation gets the new page |
| `/c/*` client modules | versioned, immutable | `immutable`, long max-age | added — old versions retained |

Documents update by navigation; modules update by being *referenced* from newer documents. A tab
that never navigates keeps working against its original module set indefinitely — that is the
point of the retention rule, and it also makes rollbacks boring: rolling back re-publishes a
previous document set whose module URLs are still being served, because you never deleted them.

## Static host vs. node server

Which shape you deploy depends on what the app does:

**A node server** is the normal shape for anything with mutations, guarded routes, or
parameterized queries — the request lifecycle (CSRF, replay, guards, transactions, post-commit
query reruns, SPEC §10.3) runs server-side. Stateless, so run two of them behind a load balancer
from day one if you like.

**A static export** suffices when the site is L0/L1 only — platform behaviors and client islands,
no mutations, no per-request rendering. The export is plain HTML plus the loader plus `/c/*`
modules, deployable to any static host. This docs site is exactly that: every page works with JS
disabled, and the search island's module loads on first use. The degradation contract holds
either way — Safari/Firefox and no-JS visitors get a working website, not a blank screen
(SPEC §8).

The `/c/*` retention rule applies to both shapes; on a static host it just means not deleting old
module files when you re-upload.

## Liveness without a socket tier

v1 ships liveness only where the server stays stateless (SPEC §9.3):

- **BroadcastChannel rebroadcast** — a mutation's `<fw-query>` response is rebroadcast to the
  user's other open tabs. Add to cart in tab A; the badge in tab B ticks. Zero server cost, no
  infrastructure.
- **Refetch on focus/visibility** — the loader re-runs queries over the typed read endpoint
  (`GET /_q/…`, SPEC §9.4) when a stale tab returns, per-query opt-out. This fakes an
  embarrassing share of "live" UX for one conditional in the loader.

Both arrive with the loader; there is nothing to deploy for them. What v1 deliberately does not
cover: another user's write appearing in your open tab without a refetch trigger. That is L4 —
SSE-pushed fragments with guards re-checked at every push — and it lands in v2 with the first
genuinely stateful infrastructure in the design (SPEC §9.3). Don't provision for it now.

## Pre-deploy gates

The verification surface is browser-free by design (SPEC §11.4), so the full behavioral gate runs
in ordinary CI ahead of any deploy:

```sh
vp check                  # typecheck + lint — wiring proofs (handlers, forms, links, bindings)
vp test                   # vitest suites, including wire-level and pglite-backed tests
vp run build              # production build
vp run fw-check           # graph checks: FW310 optimistic coverage, FW311 update coverage, audits
vp run graph-assertions   # your app's behavior rules, as graph queries
```

The starter's CI workflow runs exactly this list. If a deploy passes these, the things that
usually need a staging click-through — does this button do anything, does that mutation refresh
the badge — are already proven (see [reading fw check & fw explain](/guides/fw-explain/)).

## Checklist

- [ ] App server is stateless; no instance affinity configured anywhere.
- [ ] `/c/*` published additively, served immutable, retained across deploys (SPEC §6.6).
- [ ] HTML responses are not cached as immutable (documents change per deploy; modules don't).
- [ ] 103 Early Hints / preload wired from `renderPageHints` output if your edge supports it.
- [ ] Speculation Rules prefetch only on routes that opted in — it is per-route, default off
      (SPEC §8).
- [ ] CI runs `vp check`, `vp test`, `vp run fw-check`, and graph assertions before deploy.

## Next

- [Reading fw check & fw explain](/guides/fw-explain/) — the gates in that checklist.
- [Streaming & defer](/guides/streaming/) — response streaming and what it needs from the edge.
