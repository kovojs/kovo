---
title: Caching
description: Understand Kovo's default cache posture, opt into a public query cache, and verify the headers the app actually serves.
order: 1.4
---

# Caching

Use this page when you want the honest answer to "what is cached?" Kovo starts from conservative
defaults, then lets you opt into public caching on queries that are actually public.

## Cache a public read

Start with one query that is safe to share:

```ts
import { publicAccess, query, s } from '@kovojs/server';

export const catalogQuery = query({
  access: publicAccess('the public catalog is shared'),
  output: s.object({ products: s.array(s.string()) }),
  read: { cacheControl: 'public, max-age=300' },
  async load() {
    return { products: ['keyboard'] };
  },
});
```

That `read.cacheControl` field is the typed escape hatch. If the query is session-dependent, do not
add it.

## Run it

Check the headers the app serves before and after the opt-in:

```sh
curl -i http://localhost:5173/_q/catalogQuery
```

For a default private query-backed read, you should expect a private no-store posture. For the
public query above, you should now see the declared `Cache-Control` value instead.

## Understand the production shape

Kovo's defaults are deliberate:

- Session-dependent documents are emitted as `no-store`.
- Session-dependent `/_q/...` reads are private and `no-store`, with `Vary: Cookie`.
- Versioned `/c/__v/...` client modules are immutable and can be cached hard.

That split is why a long-lived document can keep importing its old client module safely while still
refetching fresh private data from the server.

## Handle navigation and deploys

Browser back/forward caching is part of the same posture. Anonymous pages can stay bfcache-friendly.
Guarded or session-dependent pages are forced back through the server when the browser restores
them from history.

Deploys keep old `/c/__v/...` module URLs reachable for the supported skew window. That is the
other half of caching in Kovo: immutable client assets stay reachable even after a new deploy.

## Handle failure

The usual failure here is trying to hand-write a header string the framework will not accept. Keep
the cache decision in `read.cacheControl`, then verify it with `curl` or your proxy logs.

If a page or query is session-dependent, do not try to cache your way around that fact. Move the
public part into a public query or a static asset instead.

## Next

- [Queries & invalidation](/guides/queries/) — see how query refresh and typed reads fit together.
- [Deployment](/guides/deployment/) — retain the immutable client module URLs across deploys.

<details>
<summary>Spec & diagnostics</summary>

Typed read cache config: `packages/server/src/query.ts` (`QueryReadConfig`). Document/query cache
contract and deploy-skew behavior: `spec/09-wire-protocol.md` and `site/content/guides/deployment.md`.
Navigation restore posture: `spec/07-navigation.md`. The typed cache-control rejection path is the
KV415 family referenced by the plan.

API reference: [@kovojs/server](/api/server/).

</details>
