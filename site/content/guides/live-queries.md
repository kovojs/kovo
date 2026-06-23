---
title: Live queries
description: Subscribe to query truth over SSE using the same fragment and query vocabulary as mutations.
order: 1.1
---

# Live queries

Kovo's normal liveness is cheap: mutation responses update the submitting tab, BroadcastChannel
rebroadcasts truth to same-principal tabs, and refetch-on-focus reruns stale queries over `/_q/`.
Use live queries only when another actor's write must appear while the page stays open: order
status, presence, queues, dashboards, and collaborative review.

Live is L4 on the Interaction Ladder. It is not a second data protocol. An SSE push carries the same
`<kovo-query>` and `<kovo-fragment>` chunks the enhanced mutation path already understands.

## Opt a query into live

Declare live where the query is defined:

```ts
export const orderStatus = query('orderStatus', {
  args: s.object({ id: s.string() }),
  guard: guards.all(guards.authed(), guards.owns((args) => args.id, ownsOrder)),
  live: true,
  load(input, { request }) {
    return request.db.orders.status(input.id);
  },
});
```

The instance key is the same one used everywhere else: `orderStatus:o_123` in query JSON,
`kovo-deps`, optimistic transforms, `/_q/` reads, and graph output. A component opts into the stream
with `<kovo-live>`:

```tsx
export const OrderStatusPanel = component({
  queries: { status: orderStatus },
  render: ({ status }) => (
    <section kovo-deps={`orderStatus:${status.id}`}>
      <kovo-live query="orderStatus" args={{ id: status.id }} />
      <strong data-bind="orderStatus.state">{status.state}</strong>
    </section>
  ),
});
```

The loader subscribes over SSE. When the server pushes a new value, the client applies the same
update plan it would apply for mutation truth; if the plan cannot cover the affected subtree, the
server sends a fragment target.

## Guard every push

Live subscriptions do not freeze authorization at page render. The query guard runs when the stream
is opened and again before every pushed chunk. If the user logs out, loses a role, or loses ownership
of the keyed row, the push is withheld and the client recovers through the normal auth/reload path.
That recheck is mandatory: fragments must not become a privilege-escalation side channel.

BroadcastChannel has a similar principal check. Its messages are origin-scoped by the platform, so
Kovo envelopes carry a session/principal fingerprint and receivers discard messages for any other
principal.

## Choose the emitter

Single-node apps can use the in-process emitter. Multi-node apps need fan-out so a write committed on
node A reaches a subscription held by node B. Redis pub/sub is the default operational shape:

```ts
createApp({
  queries: [orderStatus],
  live: {
    emitter: process.env.REDIS_URL
      ? redisLiveEmitter(process.env.REDIS_URL)
      : inProcessLiveEmitter(),
  },
});
```

Route events by query instance key, not by component. Components subscribe to `orderStatus:o_123`;
writes publish change records for the domains/keys they touched; the same graph that invalidates
mutation responses decides which live instances receive truth.

## Degrade deliberately

Live is additive. If SSE is unavailable, the page is still a working MPA:

- The document starts with server-rendered query truth.
- The submitting tab updates from enhanced mutation responses.
- Other tabs for the same principal update through BroadcastChannel.
- Refetch-on-focus catches common stale-tab cases through `/_q/`.

Do not make correctness depend on live. It should improve freshness, not be the only path to server
truth.

## Next

- [Queries & invalidation](/guides/queries/) — instance keys, typed reads, and cache posture.
- [Deployment](/guides/deployment/) — choosing in-process versus Redis fan-out.
- [Security & authorization](/guides/security/) — guards and principal checks.

<details>
<summary>Spec & diagnostics</summary>

Live queries, BroadcastChannel principal filtering, refetch-on-focus, SSE transport, `live: true`,
instance-key routing, and per-push guard rechecks: SPEC §9.3. The fragment/query vocabulary reused by
SSE: SPEC §9.1. Typed reads and render-plan version tokens: SPEC §9.4.

</details>
