---
title: Live queries
description: Keep open pages fresh with shipped mutation responses, tab sync, and refetch-on-focus; SSE live queries are roadmap.
order: 1.1
---

# Live queries

Most apps do not need a live transport. A form submit already returns server truth for the
submitting tab, the loader can rebroadcast that truth to same-principal tabs with
`BroadcastChannel`, and refetch-on-focus catches stale pages when a user comes back to them.

Use those paths first. SSE live queries are roadmap, not part of the technical preview.

## Return truth from the mutation

After a mutation commits, Kovo reruns the affected queries and sends the new values in the enhanced
mutation response. The submitting tab patches from that response immediately:

```html
<kovo-query name="cart">{"count":3}</kovo-query>
<kovo-fragment target="cart-badge">
  <span kovo-c="cart-badge" kovo-deps="cart">3</span>
</kovo-fragment>
```

That is the lowest-cost liveness path because it rides on the write the user already made. It also
keeps the no-JS path honest: a normal form post still gets a redirect or full page response with the
same server truth.

## Sync same-principal tabs

When tab A receives a mutation response, the loader may rebroadcast the same query truth to the
user's other open tabs on the same origin. The receiving tab applies the same update plan it would
apply for its own mutation response.

The important operational detail: `BroadcastChannel` is origin-scoped, not user-scoped. Kovo
envelopes include a principal fingerprint, and a tab drops any message for a different current
principal. That keeps account-switching and shared-device sessions from crossing streams.

## Refetch when a stale tab returns

For stale pages that were not open when the write happened, refetch-on-focus is the simple answer.
The loader re-runs query reads over the typed endpoint:

```http
GET /_q/cart
```

Guarded and session-dependent reads use private/no-store cache posture, so a refetch cannot serve
another principal's data from an intermediary. Build-token checks keep stale documents from merging
query shapes from a newer deploy.

## Roadmap: SSE live queries

The technical preview does not ship the SSE live-query subsystem. Do not author `live: true`,
`<kovo-live>`, `createApp({ live })`, `redisLiveEmitter()`, or `inProcessLiveEmitter()` in preview
apps.

The intended roadmap shape is still useful for planning infrastructure: an SSE push would carry the
same `<kovo-query>` and `<kovo-fragment>` chunks mutation responses use, keyed by the query instance.
It would be for cases where another actor's write must appear while the page stays open: order
status, presence, queues, dashboards, and collaborative review.

Until that ships, make correctness depend on mutation responses, BroadcastChannel, and
refetch-on-focus. Treat live transport as a freshness improvement, not the only path to server truth.

## Next

- [Queries & invalidation](/guides/queries/) — instance keys, typed reads, and cache posture.
- [Mutations & forms](/guides/mutations/) — returning server truth after writes.
- [Deployment](/guides/deployment/) — stateless servers, tab sync, and the live-query caveat.

<details>
<summary>Spec & diagnostics</summary>

Shipped liveness paths: mutation response query/fragment chunks and server-truth reconciliation:
SPEC §9.1; BroadcastChannel principal filtering and refetch-on-focus: SPEC §9.3; typed reads and
render-plan version tokens: SPEC §9.4. Roadmap-only live-query shape: SSE transport, `live: true`,
`<kovo-live>`, instance-key routing, and per-push guard rechecks: SPEC §9.3.

</details>
